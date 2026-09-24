import 'server-only';

/**
 * Mail Hub — the Firestore implementations of the engine's storage interfaces.
 *
 * `FirestoreMailSyncStore`, `FirestoreMailJobQueue` and `FirestoreSendStore` have the same
 * semantics as the in-memory doubles the tests use; the differences are only Firestore's: batches
 * of at most 500 writes, `getAll` for multi-document reads, and transactions for every
 * compare-and-set (claiming a job, claiming an outbound message for sending).
 *
 * Every write goes through `clean`, which drops `undefined` — the Admin SDK rejects a document
 * containing one, and an optional field left unset is the easiest way to lose a sync run to it.
 */

import type { DocumentReference, Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '../firebase-admin';
import {
  DEFAULT_LEASE_MS,
  claimPatch,
  completionPatch,
  isClaimable,
  jobIdFor,
  planEnqueue,
  type EnqueueInput,
  type MailJobQueue,
  type MailJobResult,
} from './jobs';
import {
  MAIL_HUB_COLLECTIONS as C,
  type MailAccount,
  type MailFolder,
  type MailJob,
  type MailMessage,
  type MailOutbound,
  type MailRoutingRule,
  type MailSharedMailbox,
  type MailSyncCursor,
  type MailThread,
} from './model';
import { planSendAttempt, type SendPlan, type SendStore } from './send-engine';
import type { MailSyncStore } from './sync-engine';

export const db = (): Firestore => getFirebaseAdminFirestore();

export function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function writeAll<T extends { id: string }>(collection: string, docs: T[], merge = false): Promise<void> {
  const firestore = db();
  for (const group of chunk(docs, 450)) {
    const batch = firestore.batch();
    group.forEach((doc) => batch.set(firestore.collection(collection).doc(doc.id), clean(doc), { merge }));
    await batch.commit();
  }
}

export async function getMany<T>(collection: string, ids: string[]): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  const firestore = db();
  for (const group of chunk([...new Set(ids)], 100)) {
    if (!group.length) continue;
    const refs = group.map((id) => firestore.collection(collection).doc(id));
    const snapshots = await firestore.getAll(...refs);
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) out.set(snapshot.id, { ...(snapshot.data() as T), id: snapshot.id } as T);
    });
  }
  return out;
}

export async function getOne<T>(collection: string, id: string): Promise<T | null> {
  if (!id) return null;
  const snapshot = await db().collection(collection).doc(id).get();
  return snapshot.exists ? ({ ...(snapshot.data() as T), id: snapshot.id } as T) : null;
}

export async function deleteWhere(collection: string, field: string, value: string, max = 5000): Promise<number> {
  let deleted = 0;
  const firestore = db();
  while (deleted < max) {
    const snapshot = await firestore.collection(collection).where(field, '==', value).limit(400).get();
    if (snapshot.empty) break;
    const batch = firestore.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;
    if (snapshot.size < 400) break;
  }
  return deleted;
}

/* ── sync store ───────────────────────────────────────────────────────────────────────────── */

export class FirestoreMailSyncStore implements MailSyncStore {
  async getAccount(accountId: string) {
    return getOne<MailAccount>(C.accounts, accountId);
  }

  async updateAccount(accountId: string, patch: Partial<MailAccount>) {
    await db().collection(C.accounts).doc(accountId).set(clean(patch), { merge: true });
  }

  async getFolders(accountId: string) {
    const snapshot = await db().collection(C.folders).where('accountId', '==', accountId).get();
    return snapshot.docs.map((doc) => ({ ...(doc.data() as MailFolder), id: doc.id }));
  }

  async putFolders(folders: MailFolder[]) {
    await writeAll(C.folders, folders, true);
  }

  async getCursors(accountId: string) {
    const snapshot = await db().collection(C.cursors).where('accountId', '==', accountId).get();
    return snapshot.docs.map((doc) => ({ ...(doc.data() as MailSyncCursor), id: doc.id }));
  }

  async putCursors(cursors: MailSyncCursor[]) {
    await writeAll(C.cursors, cursors);
  }

  async deleteCursors(accountId: string) {
    await deleteWhere(C.cursors, 'accountId', accountId);
  }

  async getMessages(ids: string[]) {
    return getMany<MailMessage>(C.messages, ids);
  }

  async putMessages(messages: MailMessage[]) {
    await writeAll(C.messages, messages);
  }

  async getThread(threadId: string) {
    return getOne<MailThread>(C.threads, threadId);
  }

  async getThreadMessages(threadId: string) {
    const snapshot = await db().collection(C.messages).where('threadId', '==', threadId).limit(500).get();
    return snapshot.docs.map((doc) => ({ ...(doc.data() as MailMessage), id: doc.id }));
  }

  async putThreads(threads: MailThread[]) {
    await writeAll(C.threads, threads);
  }

  async staleMessageIds(accountId: string, generation: number, sinceIso: string | null, limit: number) {
    // Paged, and the window filter applied in memory: one inequality in the query keeps it on a
    // single composite index (accountId, deleted, syncGeneration).
    const out: string[] = [];
    let cursor: QueryDocumentSnapshot | null = null;
    for (let page = 0; page < 50 && out.length < limit; page += 1) {
      let query = db()
        .collection(C.messages)
        .where('accountId', '==', accountId)
        .where('deleted', '==', false)
        .where('syncGeneration', '<', generation)
        .orderBy('syncGeneration')
        .limit(400);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      snapshot.docs.forEach((doc) => {
        const receivedAt = String(doc.get('receivedAt') ?? '');
        if (!sinceIso || receivedAt >= sinceIso) out.push(doc.id);
      });
      cursor = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.size < 400) break;
    }
    return out.slice(0, limit);
  }

  async getSharedMailboxByAccount(accountId: string) {
    const snapshot = await db().collection(C.sharedMailboxes).where('accountId', '==', accountId).limit(1).get();
    return snapshot.empty ? null : ({ ...(snapshot.docs[0].data() as MailSharedMailbox), id: snapshot.docs[0].id });
  }

  async getRoutingRules(sharedMailboxId: string) {
    const snapshot = await db().collection(C.routingRules).where('sharedMailboxId', '==', sharedMailboxId).get();
    return snapshot.docs.map((doc) => ({ ...(doc.data() as MailRoutingRule), id: doc.id }));
  }
}

/* ── job queue ────────────────────────────────────────────────────────────────────────────── */

export class FirestoreMailJobQueue implements MailJobQueue {
  private ref(id: string): DocumentReference {
    return db().collection(C.jobs).doc(id);
  }

  async enqueue(input: EnqueueInput) {
    const id = jobIdFor(input, () => db().collection(C.jobs).doc().id);
    const ref = this.ref(id);
    const action = await db().runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const existing = snapshot.exists ? ({ ...(snapshot.data() as MailJob), id }) : null;
      const plan = planEnqueue(existing, id, input, new Date());
      if (plan.action === 'create') tx.set(ref, clean(plan.job));
      else if (plan.action === 'update') tx.set(ref, clean(plan.patch), { merge: true });
      return plan.action;
    });
    return { id, action };
  }

  async claim(limit: number, now: Date, leaseMs = DEFAULT_LEASE_MS) {
    const at = now.toISOString();
    const [due, expired] = await Promise.all([
      db().collection(C.jobs).where('status', '==', 'queued').where('runAt', '<=', at).orderBy('runAt').limit(limit).get(),
      db().collection(C.jobs).where('status', '==', 'running').where('leaseUntil', '<', at).limit(limit).get(),
    ]);
    const candidates = [...due.docs, ...expired.docs].slice(0, limit);
    const claimed: MailJob[] = [];
    for (const doc of candidates) {
      // Each claim is its own transaction: two workers racing for the same job, one wins.
      const job = await db().runTransaction(async (tx) => {
        const snapshot = await tx.get(doc.ref);
        if (!snapshot.exists) return null;
        const current = { ...(snapshot.data() as MailJob), id: snapshot.id };
        if (!isClaimable(current, now)) return null;
        const patch = claimPatch(current, now, leaseMs);
        tx.set(doc.ref, clean(patch), { merge: true });
        return { ...current, ...patch } as MailJob;
      });
      if (job) claimed.push(job);
    }
    return claimed;
  }

  /** Claim one known job, if it is claimable. Used to run a user-triggered sync inline. */
  async claimById(id: string, now: Date, leaseMs = DEFAULT_LEASE_MS): Promise<MailJob | null> {
    const ref = this.ref(id);
    return db().runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return null;
      const current = { ...(snapshot.data() as MailJob), id };
      if (!isClaimable(current, now)) return null;
      const patch = claimPatch(current, now, leaseMs);
      tx.set(ref, clean(patch), { merge: true });
      return { ...current, ...patch } as MailJob;
    });
  }

  async finish(job: MailJob, result: MailJobResult, now: Date) {
    const ref = this.ref(job.id);
    await db().runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      // Read the current `rerun` flag: an enqueue during the run may have set it.
      const current = snapshot.exists ? ({ ...(snapshot.data() as MailJob), id: job.id }) : job;
      tx.set(ref, clean(completionPatch(current, result, now)), { merge: true });
    });
  }
}

/* ── outbound ─────────────────────────────────────────────────────────────────────────────── */

export class FirestoreSendStore implements SendStore {
  async claimOutbound(outboundId: string, now: Date, leaseMs: number): Promise<{ outbound: MailOutbound | null; plan: SendPlan }> {
    const ref = db().collection(C.outbound).doc(outboundId);
    return db().runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return { outbound: null, plan: 'not-ready' as SendPlan };
      const current = { ...(snapshot.data() as MailOutbound), id: snapshot.id };
      const plan = planSendAttempt(current, now);
      if (plan !== 'send' && plan !== 'verify-then-send') return { outbound: current, plan };
      const patch = {
        status: 'sending' as const,
        attempts: current.attempts + 1,
        leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
        updatedAt: now.toISOString(),
      };
      tx.set(ref, patch, { merge: true });
      return { outbound: { ...current, ...patch }, plan };
    });
  }

  async markOutbound(outboundId: string, patch: Partial<MailOutbound>) {
    await db().collection(C.outbound).doc(outboundId).set(clean(patch), { merge: true });
  }
}

export const syncStore = new FirestoreMailSyncStore();
export const jobQueue = new FirestoreMailJobQueue();
export const sendStore = new FirestoreSendStore();
