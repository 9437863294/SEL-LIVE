import 'server-only';

/**
 * Mail Hub — the background worker.
 *
 * `/api/mail-hub/worker` calls `runWorkerTick` every minute (Cloud Scheduler, Vercel Cron or any
 * scheduler — see docs/mail-hub.md). A tick does two things:
 *
 *   1. **Sweeps**: enqueue the jobs that time makes due — polls (IMAP every few minutes; a slow
 *      safety-net poll for push-backed accounts), watch renewals, scheduled sends, deadline
 *      reminders, grant re-verification, retention. Every sweep enqueue has a dedupe key, so a tick
 *      that overlaps the previous one enqueues nothing twice.
 *   2. **Drain**: claim and run queued jobs until the time budget is spent.
 *
 * Webhooks (Gmail Pub/Sub, Graph notifications) and user actions enqueue `sync` jobs directly and
 * are picked up by the next tick — within a minute — or immediately if the route runs one inline.
 */

import { dispatchNotificationOnce } from '../notifications-server';
import { ensureWatch, purgeAccount } from './accounts-service';
import { sendDeps } from './compose-service';
import { runMailWorker, type MailJobHandler, type WorkerSummary } from './jobs';
import { retentionSweep } from './mailbox-service';
import { MAIL_HUB_ACTIVITY_MODULE, MAIL_HUB_COLLECTIONS as C, type MailAccount, type MailOutbound, type MailSharedMailbox } from './model';
import { purgeExpiredOAuthStates } from './oauth';
import { ProviderAuthError } from './providers/types';
import { stableHash } from './rules';
import { executeSend } from './send-engine';
import { adapterForAccount } from './server';
import { db, getOne, jobQueue, syncStore } from './store';
import { runMailSync } from './sync-engine';
import { notificationSweep, notifyAssigned, reverifyAllGrants } from './workflow-service';

/** IMAP has no push; poll it often. Push-backed accounts get a slow poll that catches lost notifications. */
export const IMAP_POLL_MS = 5 * 60_000;
export const PUSH_SAFETY_POLL_MS = 30 * 60_000;
const WATCH_RENEW_WINDOW_MS = 24 * 3_600_000;

/* ── handlers ─────────────────────────────────────────────────────────────────────────────── */

const syncHandler: MailJobHandler = async (job) => {
  const account = job.accountId ? await getOne<MailAccount>(C.accounts, job.accountId) : null;
  if (!account || account.status === 'disconnected') return { kind: 'done' };
  if (account.status === 'reauth_required') return { kind: 'done' };
  // Honour a provider back-off recorded by a previous run.
  if (account.sync.nextAttemptAt && account.sync.nextAttemptAt > new Date().toISOString()) {
    return { kind: 'continue', delayMs: Date.parse(account.sync.nextAttemptAt) - Date.now() };
  }
  let adapter;
  try {
    adapter = await adapterForAccount(account);
  } catch (error) {
    if (error instanceof ProviderAuthError) {
      await syncStore.updateAccount(account.id, { status: 'reauth_required', statusReason: error.detail ?? error.message });
      await notifyReauth(account, error.detail ?? error.message);
      return { kind: 'done' };
    }
    throw error;
  }
  try {
    const outcome = await runMailSync({ store: syncStore, adapter, budgetMs: 45_000 }, account.id);
    for (const event of outcome.events) {
      const mailbox = await getOne<MailSharedMailbox>(C.sharedMailboxes, event.sharedMailboxId);
      await notifyAssigned({ userId: event.assigneeId, threadId: event.threadId, subject: event.subject, mailboxName: mailbox?.name ?? 'Shared mailbox', byName: 'A routing rule', dueAt: event.dueAt });
    }
    switch (outcome.result) {
      case 'continue':
        return { kind: 'continue', delayMs: 0 };
      case 'backoff':
        // The engine records failures and the retry time on the account itself.
        return { kind: 'continue', delayMs: outcome.retryAfterMs ?? 60_000 };
      case 'reauth':
        await notifyReauth(account, outcome.error ?? 'Access was revoked.');
        return { kind: 'done' };
      default:
        return { kind: 'done' };
    }
  } finally {
    await adapter.close?.().catch(() => {});
  }
};

async function notifyReauth(account: MailAccount, reason: string) {
  await dispatchNotificationOnce(
    { userIds: [account.ownerUserId] },
    {
      type: 'mail_reauth_required',
      title: `Reconnect ${account.emailAddress}`,
      body: `Mail Hub can no longer sync this mailbox: ${reason}`,
      module: MAIL_HUB_ACTIVITY_MODULE,
      severity: 'WARNING',
      itemId: account.id,
      link: '/mail/settings/accounts',
    },
    `mail-reauth-${account.id}-${stableHash(account.updatedAt ?? '')}`,
  );
}

const handlers: Partial<Record<string, MailJobHandler>> = {
  sync: syncHandler,
  'watch.renew': async (job) => {
    const account = job.accountId ? await getOne<MailAccount>(C.accounts, job.accountId) : null;
    if (!account || account.status === 'disconnected' || account.status === 'reauth_required') return { kind: 'done' };
    await ensureWatch(account);
    return { kind: 'done' };
  },
  'send.outbound': async (job) => {
    const outboundId = String(job.payload.outboundId ?? '');
    if (!outboundId) return { kind: 'fail', error: 'Missing outbound id.' };
    const result = await executeSend(sendDeps(), outboundId);
    if (result.status === 'retry') return { kind: 'retry', error: result.error, retryAfterMs: result.retryAfterMs };
    if (result.status === 'skipped' && result.plan === 'not-due') {
      const outbound = await getOne<MailOutbound>(C.outbound, outboundId);
      return { kind: 'continue', delayMs: outbound?.scheduledAt ? Math.max(0, Date.parse(outbound.scheduledAt) - Date.now()) : 60_000 };
    }
    return { kind: 'done' };
  },
  'account.purge': async (job) => {
    if (job.accountId) await purgeAccount(job.accountId);
    return { kind: 'done' };
  },
  'grants.verify': async () => {
    await reverifyAllGrants();
    return { kind: 'done' };
  },
  'notify.sweep': async () => {
    await notificationSweep();
    return { kind: 'done' };
  },
  'retention.sweep': async () => {
    await retentionSweep();
    await purgeExpiredOAuthStates();
    return { kind: 'done' };
  },
};

/* ── sweeps ───────────────────────────────────────────────────────────────────────────────── */

export async function scheduleSweeps(now = new Date()): Promise<Record<string, number>> {
  const at = now.toISOString();
  const counts = { polls: 0, renewals: 0, sends: 0 };

  // Polls, respecting each account's back-off.
  const due = await db().collection(C.accounts).where('watch.nextPollAt', '<=', at).limit(500).get();
  for (const doc of due.docs) {
    const account = { ...(doc.data() as MailAccount), id: doc.id };
    if (!['active', 'connecting', 'error'].includes(account.status)) continue;
    const runAt = account.sync.nextAttemptAt && account.sync.nextAttemptAt > at ? account.sync.nextAttemptAt : at;
    await jobQueue.enqueue({ type: 'sync', accountId: account.id, dedupeKey: `sync:${account.id}`, payload: { reason: 'poll' }, runAt });
    const pushHealthy = (account.watch.kind === 'gmail-watch' || account.watch.kind === 'graph-subscription') && !account.watch.lastError;
    const interval = pushHealthy ? PUSH_SAFETY_POLL_MS : IMAP_POLL_MS;
    await doc.ref.set({ watch: { nextPollAt: new Date(now.getTime() + interval).toISOString() } }, { merge: true });
    counts.polls += 1;
  }

  // Watch renewals: expiring within a day, or a push provider stuck on the poll fallback.
  const day = at.slice(0, 10);
  const soon = new Date(now.getTime() + WATCH_RENEW_WINDOW_MS).toISOString();
  const expiring = await db().collection(C.accounts).where('watch.expiresAt', '<=', soon).limit(500).get();
  const fallback = await db().collection(C.accounts).where('watch.kind', '==', 'imap-poll').where('provider', 'in', ['gmail', 'microsoft']).limit(500).get();
  for (const doc of [...expiring.docs, ...fallback.docs]) {
    const account = { ...(doc.data() as MailAccount), id: doc.id };
    if (account.status !== 'active') continue;
    await jobQueue.enqueue({ type: 'watch.renew', accountId: account.id, dedupeKey: `watch:${account.id}:${day}` });
    counts.renewals += 1;
  }

  // Scheduled sends coming due, and sends stranded by a dead worker (a lapsed `sending` lease).
  const scheduled = await db().collection(C.outbound).where('status', '==', 'scheduled').where('scheduledAt', '<=', new Date(now.getTime() + 60_000).toISOString()).limit(200).get();
  const stranded = await db().collection(C.outbound).where('status', 'in', ['sending', 'queued']).where('leaseUntil', '<', at).limit(200).get();
  for (const doc of [...scheduled.docs, ...stranded.docs]) {
    await jobQueue.enqueue({ type: 'send.outbound', dedupeKey: `send:${doc.id}`, payload: { outboundId: doc.id }, runAt: (doc.get('scheduledAt') as string | null) ?? at });
    counts.sends += 1;
  }

  const fiveMinutes = Math.floor(now.getTime() / 300_000);
  await jobQueue.enqueue({ type: 'notify.sweep', dedupeKey: `notify:${fiveMinutes}` });
  await jobQueue.enqueue({ type: 'grants.verify', dedupeKey: `grants:${at.slice(0, 13)}` });
  await jobQueue.enqueue({ type: 'retention.sweep', dedupeKey: `retention:${day}` });
  return counts;
}

export async function runWorkerTick(options: { budgetMs?: number } = {}): Promise<{ sweeps: Record<string, number>; worker: WorkerSummary }> {
  const sweeps = await scheduleSweeps();
  const worker = await runMailWorker({ queue: jobQueue, handlers, budgetMs: options.budgetMs ?? 240_000, batchSize: 8 });
  return { sweeps, worker };
}

/**
 * Run one account's sync right now (after connecting, and "Sync now"). Claims that one job through
 * the queue, so it cannot overlap a worker already syncing the same account: if the job is running
 * elsewhere, this marks it to run again and returns.
 */
export async function runSyncNow(accountId: string): Promise<'ran' | 'queued'> {
  const { id } = await jobQueue.enqueue({ type: 'sync', accountId, dedupeKey: `sync:${accountId}`, payload: { reason: 'manual' } });
  const job = await jobQueue.claimById(id, new Date());
  if (!job) return 'queued';
  let result;
  try {
    result = await syncHandler(job);
  } catch (error) {
    result = { kind: 'retry' as const, error: error instanceof Error ? error.message : String(error) };
  }
  await jobQueue.finish(job, result, new Date());
  return 'ran';
}
