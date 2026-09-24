/**
 * Mail Hub — the background job queue.
 *
 * There is no queue service in this deployment (App Hosting, with Cloud Scheduler hitting HTTP
 * routes), so the queue is a Firestore collection and the worker is `/api/mail-hub/worker`. The
 * transitions a job goes through are pure functions here, the storage is behind `MailJobQueue`,
 * and `runMailWorker` drains it — which is how the tests drive the real worker loop against an
 * in-memory queue.
 *
 * ── Why the queue has the shape it has ────────────────────────────────────────────────────────
 *
 *  - **Dedupe keys collapse bursts.** Gmail can deliver five notifications for one incoming
 *    message; each enqueues `sync:<accountId>`, and they collapse into one queued job whose
 *    `runAt` is the earliest asked for.
 *  - **A notification during a run is not lost.** If the job is already running, the duplicate
 *    enqueue sets `rerun`, and completion puts the job straight back in the queue — otherwise a
 *    message that arrived just after the run listed its changes would wait for the next poll.
 *  - **Leases, not locks.** A claimed job carries `leaseUntil`. A worker that dies mid-job leaves
 *    a lease that expires, and the next worker reclaims the job. Handlers must therefore be
 *    idempotent, and every one of them is (see the sync engine and the send pipeline).
 *  - **`continue` is not failure.** A sync that stopped at its time budget is re-queued without
 *    spending an attempt; only real errors count towards `maxAttempts`, after which the job is
 *    dead-lettered (`dead`) and visible on the admin page rather than retried forever.
 */

import type { MailJob, MailJobType } from './model.ts';
import { retryDelayMs } from './rules.ts';

export interface EnqueueInput {
  type: MailJobType;
  accountId?: string | null;
  payload?: Record<string, unknown>;
  runAt?: string;
  dedupeKey?: string | null;
  maxAttempts?: number;
}

export const DEFAULT_MAX_ATTEMPTS = 8;
export const DEFAULT_LEASE_MS = 5 * 60_000;

export function jobIdFor(input: EnqueueInput, random: () => string): string {
  if (input.dedupeKey) return `k_${input.dedupeKey.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 300)}`;
  return `j_${random()}`;
}

export type EnqueuePlan =
  | { action: 'create'; job: MailJob }
  | { action: 'update'; patch: Partial<MailJob> }
  | { action: 'noop' };

export function planEnqueue(existing: MailJob | null, id: string, input: EnqueueInput, now: Date): EnqueuePlan {
  const nowIso = now.toISOString();
  const runAt = input.runAt ?? nowIso;
  const fresh: MailJob = {
    id,
    type: input.type,
    accountId: input.accountId ?? null,
    payload: input.payload ?? {},
    status: 'queued',
    runAt,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    leaseUntil: null,
    rerun: false,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  if (!existing || existing.status === 'done' || existing.status === 'dead') return { action: 'create', job: fresh };
  if (existing.status === 'queued') {
    const earlier = runAt < existing.runAt ? runAt : existing.runAt;
    if (earlier === existing.runAt && !input.payload) return { action: 'noop' };
    return { action: 'update', patch: { runAt: earlier, payload: { ...existing.payload, ...(input.payload ?? {}) }, updatedAt: nowIso } };
  }
  // running
  return existing.rerun ? { action: 'noop' } : { action: 'update', patch: { rerun: true, updatedAt: nowIso } };
}

export function isClaimable(job: MailJob, now: Date): boolean {
  const at = now.toISOString();
  if (job.status === 'queued') return job.runAt <= at;
  if (job.status === 'running') return Boolean(job.leaseUntil) && (job.leaseUntil as string) < at;
  return false;
}

export function claimPatch(job: MailJob, now: Date, leaseMs = DEFAULT_LEASE_MS): Partial<MailJob> {
  return {
    status: 'running',
    attempts: job.attempts + 1,
    leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
    // A reclaimed job has already been asked to run again by whoever enqueued during the dead run.
    rerun: job.status === 'running' ? job.rerun : false,
    updatedAt: now.toISOString(),
  };
}

export type MailJobResult =
  | { kind: 'done' }
  /** Stopped at a budget or waiting for a provider window. Does not spend an attempt. */
  | { kind: 'continue'; delayMs: number }
  | { kind: 'retry'; error: string; retryAfterMs?: number | null }
  /** Permanent: no retry will help (account gone, malformed payload). */
  | { kind: 'fail'; error: string };

export function completionPatch(job: MailJob, result: MailJobResult, now: Date, random: () => number = Math.random): Partial<MailJob> {
  const nowIso = now.toISOString();
  const base = { leaseUntil: null, updatedAt: nowIso };
  switch (result.kind) {
    case 'done':
      return job.rerun
        ? { ...base, status: 'queued', runAt: nowIso, rerun: false, attempts: 0, lastError: null }
        : { ...base, status: 'done', rerun: false, lastError: null };
    case 'continue':
      return {
        ...base,
        status: 'queued',
        runAt: new Date(now.getTime() + Math.max(0, result.delayMs)).toISOString(),
        attempts: Math.max(0, job.attempts - 1),
        rerun: false,
      };
    case 'retry': {
      if (job.attempts >= job.maxAttempts) return { ...base, status: 'dead', lastError: result.error };
      const delay = retryDelayMs(job.attempts, result.retryAfterMs ?? null, random);
      return { ...base, status: 'queued', runAt: new Date(now.getTime() + delay).toISOString(), lastError: result.error };
    }
    case 'fail':
      return { ...base, status: 'dead', lastError: result.error, rerun: false };
  }
}

/* ── the queue and the worker loop ─────────────────────────────────────────────────────────── */

export interface MailJobQueue {
  enqueue(input: EnqueueInput): Promise<{ id: string; action: EnqueuePlan['action'] }>;
  /** Atomically claim up to `limit` claimable jobs. */
  claim(limit: number, now: Date, leaseMs?: number): Promise<MailJob[]>;
  finish(job: MailJob, result: MailJobResult, now: Date): Promise<void>;
}

export type MailJobHandler = (job: MailJob) => Promise<MailJobResult>;

export interface WorkerSummary {
  claimed: number;
  done: number;
  continued: number;
  retried: number;
  failed: number;
  errors: { jobId: string; type: string; error: string }[];
}

export async function runMailWorker(input: {
  queue: MailJobQueue;
  handlers: Partial<Record<MailJobType, MailJobHandler>>;
  now?: () => Date;
  budgetMs?: number;
  batchSize?: number;
  leaseMs?: number;
}): Promise<WorkerSummary> {
  const now = input.now ?? (() => new Date());
  const started = now().getTime();
  const budgetMs = input.budgetMs ?? 240_000;
  const summary: WorkerSummary = { claimed: 0, done: 0, continued: 0, retried: 0, failed: 0, errors: [] };

  while (now().getTime() - started < budgetMs) {
    const jobs = await input.queue.claim(input.batchSize ?? 10, now(), input.leaseMs);
    if (!jobs.length) break;
    summary.claimed += jobs.length;
    for (const job of jobs) {
      const handler = input.handlers[job.type];
      let result: MailJobResult;
      if (!handler) result = { kind: 'fail', error: `No handler for job type ${job.type}.` };
      else {
        try {
          result = await handler(job);
        } catch (error) {
          result = { kind: 'retry', error: error instanceof Error ? error.message : String(error) };
        }
      }
      await input.queue.finish(job, result, now());
      if (result.kind === 'done') summary.done += 1;
      else if (result.kind === 'continue') summary.continued += 1;
      else if (result.kind === 'retry') summary.retried += 1;
      else summary.failed += 1;
      if (result.kind === 'retry' || result.kind === 'fail') summary.errors.push({ jobId: job.id, type: job.type, error: result.error });
    }
    // Everything claimed is finished; the budget only stops further claims.
  }
  return summary;
}

/** An in-memory queue with the same semantics as the Firestore one. Used by tests and local scripts. */
export class MemoryMailJobQueue implements MailJobQueue {
  readonly jobs = new Map<string, MailJob>();
  private counter = 0;
  private readonly clock: () => Date;
  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock;
  }

  async enqueue(input: EnqueueInput) {
    const id = jobIdFor(input, () => `${++this.counter}`);
    const plan = planEnqueue(this.jobs.get(id) ?? null, id, input, this.clock());
    if (plan.action === 'create') this.jobs.set(id, plan.job);
    else if (plan.action === 'update') this.jobs.set(id, { ...(this.jobs.get(id) as MailJob), ...plan.patch });
    return { id, action: plan.action };
  }

  async claim(limit: number, now: Date, leaseMs?: number) {
    const claimable = [...this.jobs.values()].filter((job) => isClaimable(job, now)).sort((a, b) => a.runAt.localeCompare(b.runAt)).slice(0, limit);
    return claimable.map((job) => {
      const next = { ...job, ...claimPatch(job, now, leaseMs) } as MailJob;
      this.jobs.set(job.id, next);
      return next;
    });
  }

  async finish(job: MailJob, result: MailJobResult, now: Date) {
    const current = this.jobs.get(job.id) ?? job;
    this.jobs.set(job.id, { ...current, ...completionPatch(current, result, now, () => 0.5) } as MailJob);
  }
}
