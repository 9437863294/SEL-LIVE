import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import {
  DocumentReference,
  FieldPath,
  GeoPoint,
  Timestamp,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { MongoClient, type AnyBulkWriteOperation, type Db, type Document } from 'mongodb';
import { getFirebaseAdminFirestore } from './firebase-admin';
import {
  ACTIVE_COPY_FILTER,
  addChangeCounts,
  addCollectionCount,
  buildReportingCopyHistoryEntry,
  cachedSubcollections,
  decideDeletionCheck,
  decideReportingCopyStop,
  DELETION_CHECK_BATCH,
  deletionScanDone,
  EMPTY_REPORTING_COPY_STATE,
  endReportingCopyRun,
  EXCLUDED_COLLECTIONS,
  EXISTING_COPY_PROJECTION,
  isDirectChildOf,
  makeValueConverter,
  markDeletedUpdate,
  normalizeReportingCopyConfig,
  planPageWrites,
  READ_PAGE,
  REPORTING_COPY_COLLECTION,
  REPORTING_COPY_HISTORY_KEEP,
  REPORTING_COPY_HISTORY_SUBCOLLECTION,
  reportingCopyDue,
  reportingCopyHistoryOverflow,
  reportingCopyNextDueAt,
  reportingCopyStopRequested,
  subcollectionTarget,
  SUBCOLLECTION_SAMPLE,
  TARGET_DATABASE,
  WRITE_BATCH,
  type ExistingCopy,
  type ReportingCopyChangeCounts,
  type ReportingCopyConfig,
  type ReportingCopyDue,
  type ReportingCopyHistoryEntry,
  type ReportingCopyProgress,
  type ReportingCopyRun,
  type ReportingCopySettingsInput,
  type ReportingCopyState,
} from './reporting-copy';

/**
 * The scheduled refresh of the reporting copy — the app-hosted port of `tools/mongo-sync/sync.mjs`.
 *
 * Same copy, same shapes: root collections → same-named MongoDB collections with `_id` = document
 * id; subcollections (found by sampling, the names cached for a week) → `<parent>.<sub>` with
 * `_id` = full path and `_parentPath`.
 *
 * Incremental (from 2026-10-15): every Firestore document is read, but only new and changed ones
 * are written. Each copy carries `_hash` (the fingerprint of its converted content), and a page's
 * existing copies are looked up in one `$in` query; a same-hash document is not written at all.
 * Nothing is ever deleted: once a collection is read in full, its copies not marked deleted are
 * counted against the documents read, and only when the copy has more are its ids checked against
 * Firestore — the missing ones get `_deletedInApp: true` and `_deletedNoticedAt`, and are restored
 * if they come back. A collection is complete only once that check has finished.
 *
 * A request has a time limit and a full read (≈100k documents, ~150 collections) does not fit in
 * one. So a run is a sequence of slices: each tick claims the run for its time budget, works page
 * after page (or batch after batch of the deletion check), saves its cursor to
 * `reportingCopy/state` after each, and the next tick carries on from that cursor.
 */

const NOT_CONFIGURED = 'NEWDATABASE_MONGODB_URI is not set on the server (App Hosting secret), so the copy cannot connect.';
/** A slice's claim lasts its budget plus this, so a page in flight at the deadline can finish. */
const LEASE_GRACE_MS = 90_000;
/** Subcollection discovery is up to 500 lookups; it starts only with this much of the budget left. */
const DISCOVERY_RESERVE_MS = 45_000;
/** Consecutive failures at one collection before the run gives up on it and moves on. */
const MAX_ATTEMPTS = 3;
/** A run still going after this long is ended as failed, so a broken one cannot block the schedule forever. */
const MAX_RUN_MS = 24 * 60 * 60 * 1000;

const convert = makeValueConverter({ Timestamp, GeoPoint, DocumentReference });
const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');

/* ------------------------------------------------------------------------------------------------
 * Connections
 * ---------------------------------------------------------------------------------------------- */

const cache = globalThis as typeof globalThis & { __reportingCopyMongo?: Promise<MongoClient> };

export const reportingCopyConfigured = () => Boolean(process.env.NEWDATABASE_MONGODB_URI);

/**
 * One MongoClient per server instance, connected on first use and kept: the client pools its own
 * connections, and the tick runs every 15 minutes. Held on `globalThis` so a dev-server reload does
 * not leak a client per edit. A failed connect is forgotten, so the next tick tries again.
 */
async function targetDatabase(): Promise<Db> {
  const uri = process.env.NEWDATABASE_MONGODB_URI;
  if (!uri) throw new Error(NOT_CONFIGURED);
  if (!cache.__reportingCopyMongo) {
    cache.__reportingCopyMongo = new MongoClient(uri, { maxPoolSize: 5 }).connect().catch((error) => {
      cache.__reportingCopyMongo = undefined;
      throw error;
    });
  }
  return (await cache.__reportingCopyMongo).db();
}

const refs = (db: Firestore) => ({
  config: db.collection(REPORTING_COPY_COLLECTION).doc('config'),
  state: db.collection(REPORTING_COPY_COLLECTION).doc('state'),
  /** Finished runs, newest REPORTING_COPY_HISTORY_KEEP kept. Server-only with the rest of `reportingCopy`. */
  history: db.collection(REPORTING_COPY_COLLECTION).doc('state').collection(REPORTING_COPY_HISTORY_SUBCOLLECTION),
});

/**
 * Save a finished run to the history and drop the oldest beyond the limit. Best effort: a run that
 * copied everything is not failed because its history line could not be written.
 */
async function recordHistory(db: Firestore, run: ReportingCopyRun, progress: ReportingCopyProgress | null): Promise<void> {
  try {
    const history = refs(db).history;
    const entry = buildReportingCopyHistoryEntry(run, progress);
    await history.doc(String(entry.runId)).set(entry);
    const ids = (await history.select('runId').get()).docs.map((doc) => Number(doc.get('runId'))).filter(Number.isFinite);
    const overflow = reportingCopyHistoryOverflow(ids, REPORTING_COPY_HISTORY_KEEP);
    await Promise.all(overflow.map((runId) => history.doc(String(runId)).delete()));
  } catch (error) {
    console.error('[reporting-copy] could not record the run in the history', error);
  }
}

/** The newest finished runs, newest first. */
export async function listReportingCopyHistory(limit = REPORTING_COPY_HISTORY_KEEP): Promise<ReportingCopyHistoryEntry[]> {
  const db = getFirebaseAdminFirestore();
  const capped = Math.min(REPORTING_COPY_HISTORY_KEEP, Math.max(1, Math.floor(limit) || REPORTING_COPY_HISTORY_KEEP));
  const snap = await refs(db).history.orderBy('runId', 'desc').limit(capped).get();
  return snap.docs.map((doc) => doc.data() as ReportingCopyHistoryEntry);
}

const normalizeState = (raw: Record<string, unknown> | undefined): ReportingCopyState => ({
  ...EMPTY_REPORTING_COPY_STATE,
  ...(raw as Partial<ReportingCopyState> | undefined),
});

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

/* ------------------------------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------------------------- */

export interface ReportingCopyOverview {
  configured: boolean;
  config: ReportingCopyConfig;
  /**
   * `running`: a run is in progress; `working`: a slice of it is copying at this moment;
   * `stopping`: Stop has been pressed and the slice copying has not ended the run yet.
   */
  state: Omit<ReportingCopyState, 'lease'> & { running: boolean; working: boolean; stopping: boolean };
  due: ReportingCopyDue;
  nextDueAt: string | null;
  checkedAt: string;
}

export async function readReportingCopy(): Promise<ReportingCopyOverview> {
  const db = getFirebaseAdminFirestore();
  const { config: configRef, state: stateRef } = refs(db);
  const [configSnap, stateSnap] = await db.getAll(configRef, stateRef);
  const config = normalizeReportingCopyConfig(configSnap.data());
  const { lease, ...state } = normalizeState(stateSnap.data());
  const now = new Date();
  const running = Boolean(state.progress);
  // The lease holder is an internal id; whether a slice is working right now is enough.
  const working = Boolean(lease && Date.parse(lease.expiresAt) > now.getTime());
  // Runs started before names were recorded: look up whoever pressed Refresh now.
  if (state.lastRun?.trigger === 'manual' && !state.lastRun.requestedBy && config.requestedBy) {
    const user = await db.collection('users').doc(config.requestedBy).get().catch(() => null);
    const name = user?.exists ? String(user.get('name') || user.get('email') || '') : '';
    state.lastRun = { ...state.lastRun, requestedBy: config.requestedByName || name || null };
  }
  return {
    configured: reportingCopyConfigured(),
    config,
    state: { ...state, running, working, stopping: reportingCopyStopRequested(state) },
    due: reportingCopyDue(config, state, now),
    nextDueAt: running ? null : reportingCopyNextDueAt(config, state, now),
    checkedAt: now.toISOString(),
  };
}

/** Save the schedule. Slots before now never count as missed afterwards (`scheduleFrom`). */
export async function saveReportingCopySettings(value: ReportingCopySettingsInput, userId: string): Promise<ReportingCopyOverview> {
  const db = getFirebaseAdminFirestore();
  const now = new Date().toISOString();
  await refs(db).config.set({ ...value, scheduleFrom: now, updatedAt: now, updatedBy: userId }, { merge: true });
  const overview = await readReportingCopy();
  await refs(db).state.set({ nextDueAt: overview.nextDueAt }, { merge: true });
  return overview;
}

/**
 * "Refresh now": mark a request the next tick answers. Refused while a run is going — that run is
 * already refreshing everything, and a request queued behind it would start a second full copy
 * the moment it finished.
 */
export async function requestReportingCopyRun(
  userId: string,
  userName: string,
  options: { full?: boolean } = {},
): Promise<{ queued: boolean; reason: string }> {
  const db = getFirebaseAdminFirestore();
  const { config: configRef, state: stateRef } = refs(db);
  const full = options.full === true;
  return db.runTransaction(async (tx) => {
    const stateSnap = await tx.get(stateRef);
    if (normalizeState(stateSnap.data()).progress) return { queued: false, reason: 'A refresh is already running.' };
    tx.set(configRef, { requestedAt: new Date().toISOString(), requestedBy: userId, requestedByName: userName, requestedFull: full }, { merge: true });
    return { queued: true, reason: full ? 'Full refresh requested.' : 'Refresh requested.' };
  });
}

export interface ReportingCopyStopResult {
  /** nothing: no run to stop · signalled: the slice copying ends it after its page · stopped: ended now. */
  outcome: 'nothing' | 'signalled' | 'stopped';
  reason: string;
}

/**
 * Stop. While a slice holds the run it is only asked to stop (`cancelRequestedAt`): it finishes the
 * page it is on, saves, and ends the run as `stopped` — so nothing is half-written. With no slice
 * copying (no lease, or one that expired) the run is ended here and now. Either way what was copied
 * stays, and the unfinished collection gets no deletion check.
 */
export async function stopReportingCopyRun(userName: string): Promise<ReportingCopyStopResult> {
  const db = getFirebaseAdminFirestore();
  const { config: configRef, state: stateRef } = refs(db);
  const outcome = await db.runTransaction(async (tx) => {
    const [configSnap, stateSnap] = await tx.getAll(configRef, stateRef);
    const state = normalizeState(stateSnap.data());
    const now = new Date();
    const stamp = now.toISOString();
    const decision = decideReportingCopyStop(state, now);
    if (decision === 'nothing') return { outcome: 'nothing' as const, reason: 'No refresh is running.', ended: null };
    if (decision === 'signal') {
      tx.update(stateRef, { cancelRequestedAt: stamp, cancelRequestedBy: userName, updatedAt: stamp });
      return { outcome: 'signalled' as const, reason: 'Stopping after the page being copied.', ended: null };
    }
    const config = normalizeReportingCopyConfig(configSnap.data());
    const progress = state.progress;
    const lastRun = state.lastRun ? endReportingCopyRun(state.lastRun, progress, { now, stoppedBy: userName }) : state.lastRun;
    const next: ReportingCopyState = {
      ...state, lastRun, progress: null, lease: null, cancelRequestedAt: null, cancelRequestedBy: null,
      nextDueAt: reportingCopyNextDueAt(config, state, now), updatedAt: stamp,
    };
    tx.set(stateRef, next);
    return { outcome: 'stopped' as const, reason: 'The refresh has been stopped.', ended: lastRun ? { run: lastRun, progress } : null };
  });
  if (outcome.ended) await recordHistory(db, outcome.ended.run, outcome.ended.progress);
  return { outcome: outcome.outcome, reason: outcome.reason };
}

/* ------------------------------------------------------------------------------------------------
 * The run
 * ---------------------------------------------------------------------------------------------- */

export interface ReportingCopyTickResult {
  ok: boolean;
  /**
   * idle: nothing due (or, for `continue`, nothing in progress) · busy: another slice holds the run ·
   * started/continued: worked, more to do · finished · stopped: Stop ended the run · not-configured.
   */
  action: 'idle' | 'busy' | 'started' | 'continued' | 'finished' | 'stopped' | 'not-configured';
  reason: string;
  lastRun: ReportingCopyRun | null;
  progress: ReportingCopyProgress | null;
  nextDueAt: string | null;
  error?: string;
}

class LeaseLostError extends Error {
  constructor() {
    super('Another tick took over this run.');
    this.name = 'LeaseLostError';
  }
}

const newProgress = (runId: number, full: boolean): ReportingCopyProgress => ({
  runId, roots: null, index: 0, step: 'root', subcollections: [], subIndex: 0, phase: 'copy', deletionScan: null, full,
  cursor: null, target: null, attempts: 0, lastError: null, failures: [], ticks: 1,
});

/** A fresh target: copy phase, no cursor, no deletion scan. */
const freshTarget = { phase: 'copy' as const, deletionScan: null, cursor: null, attempts: 0, lastError: null };

/** On to the next root collection. */
function nextRoot(progress: ReportingCopyProgress) {
  Object.assign(progress, { ...freshTarget, index: progress.index + 1, step: 'root', subcollections: [], subIndex: 0 });
}

/** On to the next subcollection of the current root, or the next root after the last one. */
function nextSub(progress: ReportingCopyProgress) {
  if (progress.subIndex + 1 >= progress.subcollections.length) return nextRoot(progress);
  Object.assign(progress, { ...freshTarget, subIndex: progress.subIndex + 1 });
}

/**
 * Give up on the current collection after repeated failures, so one bad collection cannot stall the
 * copy of the rest. Its MongoDB copy is left as it was (no deletion check) and the run ends failed.
 * A root that fails takes its subcollections with it; listing the roots failing ends the run.
 */
function giveUpOnTarget(progress: ReportingCopyProgress, message: string) {
  if (!progress.roots) {
    progress.failures.push(`listing the collections: ${message}`);
    progress.roots = [];
    return;
  }
  progress.failures.push(`${progress.target ?? progress.roots[progress.index]}: ${message}`);
  if (progress.step === 'sub') nextSub(progress);
  else nextRoot(progress);
}

/** Subcollection names found under a sample of a collection's documents. */
async function subcollectionsOf(db: Firestore, root: string): Promise<string[]> {
  const names = new Set<string>();
  const sample = (await db.collection(root).select().limit(SUBCOLLECTION_SAMPLE).get()).docs.map((doc) => doc.ref);
  // Twenty at a time: each lookup is a round trip.
  for (let i = 0; i < sample.length; i += 20) {
    const found = await Promise.all(sample.slice(i, i + 20).map((ref) => ref.listCollections()));
    for (const subs of found) for (const sub of subs) names.add(sub.id);
  }
  return [...names].sort();
}

type PageCounts = Omit<ReportingCopyChangeCounts, 'markedDeleted'>;

/**
 * Copy one page of a source query (in document-id order, after `cursor`) into `name`, writing only
 * what is new or changed: one `$in` lookup of the page's existing copies, then upserts for the
 * documents planPageWrites says differ.
 */
async function copyPage(
  target: Db,
  name: string,
  query: Query,
  cursor: string | null,
  options: {
    after: (cursor: string) => string | DocumentReference;
    cursorOf: (doc: QueryDocumentSnapshot) => string;
    keep: (doc: QueryDocumentSnapshot) => boolean;
    toDoc: (doc: QueryDocumentSnapshot) => Document & { _id: string };
  },
): Promise<{ counts: PageCounts; cursor: string | null; done: boolean }> {
  let q = query.orderBy(FieldPath.documentId()).limit(READ_PAGE);
  if (cursor) q = q.startAfter(options.after(cursor));
  const snap = await q.get();
  const docs = snap.docs.filter(options.keep).map(options.toDoc);
  const existing = docs.length
    ? await target.collection(name).find({ _id: { $in: docs.map((doc) => doc._id) } } as Document, { projection: EXISTING_COPY_PROJECTION }).toArray()
    : [];
  const plan = planPageWrites(docs, existing as ExistingCopy[], { hash: sha1, now: new Date() });
  const ops = plan.writes as unknown as AnyBulkWriteOperation<Document>[];
  for (let i = 0; i < ops.length; i += WRITE_BATCH) {
    await target.collection(name).bulkWrite(ops.slice(i, i + WRITE_BATCH), { ordered: false });
  }
  const last = snap.docs[snap.docs.length - 1];
  return { counts: plan.counts, cursor: last ? options.cursorOf(last) : cursor, done: snap.size < READ_PAGE };
}

/**
 * One step of a finished collection's deletion check. The first step counts the copies not marked
 * deleted against the documents read this run (decideDeletionCheck); equal ends the check there.
 * Otherwise each step takes the next DELETION_CHECK_BATCH ids of the copy (in `_id` order, after
 * `progress.cursor`), asks Firestore which still exist (getAll with an empty field mask), and marks
 * the rest `_deletedInApp`. Never deletes.
 */
async function checkDeletionsStep(
  target: Db,
  name: string,
  progress: ReportingCopyProgress,
  firestoreRead: number,
  exists: (ids: string[]) => Promise<Set<string>>,
): Promise<{ markedDeleted: number; done: boolean }> {
  const collection = target.collection(name);
  if (!progress.deletionScan) {
    const mongoActive = await collection.countDocuments(ACTIVE_COPY_FILTER as Document);
    const decision = decideDeletionCheck({ mongoActive, firestoreRead, full: progress.full === true });
    if (!decision.scan) return { markedDeleted: 0, done: true };
    progress.deletionScan = { expectedMissing: decision.expectedMissing, found: 0 };
    progress.cursor = null;
  }
  const filter: Document = progress.cursor ? { ...ACTIVE_COPY_FILTER, _id: { $gt: progress.cursor } } : { ...ACTIVE_COPY_FILTER };
  const batch = await collection.find(filter, { projection: { _id: 1 } }).sort({ _id: 1 }).limit(DELETION_CHECK_BATCH).toArray();
  const ids = batch.map((doc) => String(doc._id));
  let markedDeleted = 0;
  if (ids.length) {
    const present = await exists(ids);
    const missing = ids.filter((id) => !present.has(id));
    if (missing.length) {
      await collection.updateMany({ _id: { $in: missing } } as Document, markDeletedUpdate(new Date()));
      markedDeleted = missing.length;
    }
    progress.cursor = ids[ids.length - 1];
  }
  progress.deletionScan.found += markedDeleted;
  return { markedDeleted, done: deletionScanDone(ids.length, progress.deletionScan.found, progress.deletionScan.expectedMissing) };
}

/** Which of these documents exist in Firestore — a read each, with no fields returned. */
async function existingInFirestore(db: Firestore, refsOf: (id: string) => DocumentReference, ids: string[]): Promise<Set<string>> {
  const snaps = await db.getAll(...ids.map(refsOf), { fieldMask: [] });
  const present = new Set<string>();
  snaps.forEach((snap, i) => { if (snap.exists) present.add(ids[i]); });
  return present;
}

/**
 * One slice of work: start a due run or continue the one in progress, for at most `budgetMs`.
 *
 * Called by the scheduler tick (a ~4-minute budget), by "Refresh now" (a short one, so the screen
 * shows the run moving) and by the settings screen while it is open (`mode: 'continue'`, ~40 s at a
 * time, back to back). `continue` only carries on a run in progress; it never starts one. Fast when
 * there is nothing to do: two reads, and a write only when the next due time changed.
 *
 * A lease that has expired is claimable: the slice that held it died (timed out, tab closed with
 * the instance stopped) and the next caller — tick or screen — takes over from the saved cursor.
 */
export async function advanceReportingCopy({ budgetMs, mode = 'any' }: { budgetMs: number; mode?: 'any' | 'continue' }): Promise<ReportingCopyTickResult> {
  const db = getFirebaseAdminFirestore();
  const { config: configRef, state: stateRef } = refs(db);
  const holder = randomUUID();
  const deadline = Date.now() + budgetMs;

  // Claim: one run at a time, and one slice of it at a time.
  const claim = await db.runTransaction(async (tx) => {
    const [configSnap, stateSnap] = await tx.getAll(configRef, stateRef);
    const config = normalizeReportingCopyConfig(configSnap.data());
    const state = normalizeState(stateSnap.data());
    const now = new Date();
    const stamp = now.toISOString();
    const noEnded = null as { run: ReportingCopyRun; progress: ReportingCopyProgress | null } | null;
    if (state.lease && Date.parse(state.lease.expiresAt) > now.getTime()) {
      return { action: 'busy' as const, reason: 'Another part of the run is copying right now.', state, ended: noEnded };
    }
    const lease = { holder, expiresAt: new Date(now.getTime() + budgetMs + LEASE_GRACE_MS).toISOString() };

    if (state.progress && state.lastRun) {
      // Stop was pressed and no slice was left to act on it: end the run here.
      if (reportingCopyStopRequested(state)) {
        const lastRun = endReportingCopyRun(state.lastRun, state.progress, { now, stoppedBy: state.cancelRequestedBy });
        const next = {
          ...state, lastRun, progress: null, lease: null, cancelRequestedAt: null, cancelRequestedBy: null,
          nextDueAt: reportingCopyNextDueAt(config, state, now), updatedAt: stamp,
        };
        tx.set(stateRef, next);
        return { action: 'stopped' as const, reason: 'The refresh was stopped.', state: next, ended: { run: lastRun, progress: state.progress } };
      }
      if (now.getTime() - Date.parse(state.lastRun.startedAt) > MAX_RUN_MS) {
        const lastRun = endReportingCopyRun(state.lastRun, state.progress, {
          now, error: `The run did not finish within 24 hours (stopped at ${state.progress.target ?? 'the start'}).`,
        });
        const next = { ...state, lastRun, progress: null, lease: null, nextDueAt: reportingCopyNextDueAt(config, state, now), updatedAt: stamp };
        tx.set(stateRef, next);
        return { action: 'idle' as const, reason: 'Ended a run that had been going for over 24 hours.', state: next, ended: { run: lastRun, progress: state.progress } };
      }
      const progress = { ...state.progress, ticks: state.progress.ticks + 1 };
      // A lease that expired rather than being released: the last slice died mid-page (timed out or
      // the instance was stopped). Count it against the collection it was on.
      if (state.lease) {
        progress.attempts += 1;
        progress.lastError = progress.lastError ?? 'The previous slice stopped without saving (timed out?).';
        if (progress.attempts >= MAX_ATTEMPTS) giveUpOnTarget(progress, progress.lastError);
      }
      const next = { ...state, progress, lease, updatedAt: stamp };
      tx.set(stateRef, next);
      return { action: 'continued' as const, reason: 'Continuing the run in progress.', state: next, ended: noEnded };
    }

    if (mode === 'continue') return { action: 'idle' as const, reason: 'No refresh is running.', state, ended: noEnded };

    const due = reportingCopyDue(config, state, now);
    if (!due.due) {
      const nextDueAt = reportingCopyNextDueAt(config, state, now);
      if (nextDueAt !== state.nextDueAt) tx.set(stateRef, { nextDueAt }, { merge: true });
      return { action: 'idle' as const, reason: due.reason, state: { ...state, nextDueAt }, ended: noEnded };
    }

    // Starting a run answers the request and every slot up to now, so neither starts a second one.
    const latest = [due.slot, state.lastScheduledSlot].filter((slot): slot is string => Boolean(slot)).sort().pop() ?? null;
    const consumed = {
      lastScheduledSlot: latest,
      handledRequestAt: due.trigger === 'manual' ? config.requestedAt : state.handledRequestAt,
    };
    // Only "Full refresh" is full; a scheduled run never is.
    const full = due.trigger === 'manual' && config.requestedFull;
    const run: ReportingCopyRun = {
      runId: now.getTime(), trigger: due.trigger ?? 'schedule',
      requestedBy: due.trigger === 'manual' ? config.requestedByName : null,
      status: 'running', startedAt: stamp, finishedAt: null, durationSeconds: null,
      documents: 0, inserted: 0, updated: 0, unchanged: 0, restored: 0, markedDeleted: 0, collections: 0, full, error: null,
    };
    // A Stop left over from an earlier run must not end this one.
    const cleared = { cancelRequestedAt: null, cancelRequestedBy: null };
    if (!reportingCopyConfigured()) {
      const lastRun: ReportingCopyRun = { ...run, status: 'failed', finishedAt: stamp, durationSeconds: 0, error: NOT_CONFIGURED };
      const next = { ...state, ...consumed, ...cleared, lastRun, nextDueAt: reportingCopyNextDueAt(config, { ...state, ...consumed }, now), updatedAt: stamp };
      tx.set(stateRef, next);
      return { action: 'not-configured' as const, reason: NOT_CONFIGURED, state: next, ended: { run: lastRun, progress: null } };
    }
    const next = { ...state, ...consumed, ...cleared, lastRun: run, progress: newProgress(run.runId, full), lease, nextDueAt: null, updatedAt: stamp };
    tx.set(stateRef, next);
    return { action: 'started' as const, reason: due.reason, state: next, ended: noEnded };
  });

  const result = (ok: boolean, action: ReportingCopyTickResult['action'], reason: string, state: ReportingCopyState, error?: string): ReportingCopyTickResult => ({
    ok, action, reason, lastRun: state.lastRun, progress: state.progress, nextDueAt: state.nextDueAt, ...(error ? { error } : {}),
  });
  if (claim.action !== 'started' && claim.action !== 'continued') {
    if (claim.ended) await recordHistory(db, claim.ended.run, claim.ended.progress);
    return result(claim.action !== 'not-configured', claim.action, claim.reason, claim.state);
  }

  const state: ReportingCopyState = claim.state;
  const progress = state.progress!;
  const run = state.lastRun!;

  /**
   * Save progress, only while this slice still holds the run. `{ lease: null }` also gives the run
   * back. Answers whether Stop has been pressed meanwhile, so the loop ends after this page.
   */
  const save = async (extra: Partial<ReportingCopyState> = {}): Promise<{ stop: boolean; stoppedBy: string | null }> =>
    db.runTransaction(async (tx) => {
      const current = normalizeState((await tx.get(stateRef)).data());
      if (current.lease?.holder !== holder) throw new LeaseLostError();
      tx.update(stateRef, { progress: state.progress, lastRun: state.lastRun, updatedAt: new Date().toISOString(), ...extra });
      return { stop: Boolean(current.cancelRequestedAt), stoppedBy: current.cancelRequestedBy };
    });

  /** End the run: finished (`stoppedBy` undefined) or stopped. Releases the lease and records the history. */
  const end = async (stoppedBy?: string | null) => {
    const endedAt = new Date();
    const finalProgress: ReportingCopyProgress = { ...progress };
    state.lastRun = endReportingCopyRun(run, progress, stoppedBy === undefined ? { now: endedAt } : { now: endedAt, stoppedBy });
    state.progress = null;
    const config = normalizeReportingCopyConfig((await configRef.get()).data());
    state.nextDueAt = reportingCopyNextDueAt(config, state, endedAt);
    await save({ lease: null, nextDueAt: state.nextDueAt, cancelRequestedAt: null, cancelRequestedBy: null });
    await recordHistory(db, state.lastRun, finalProgress);
  };

  /** After each saved page: end the run if Stop was pressed. True when it was. */
  const stopIfAsked = async (saved: { stop: boolean; stoppedBy: string | null }) => {
    if (!saved.stop) return false;
    await end(saved.stoppedBy);
    return true;
  };
  const stopped = () => result(true, 'stopped', 'The refresh was stopped; what was copied is kept.', state);

  /** Added to the run's counts and the per-collection tally. */
  const tally = (name: string, delta: Partial<ReportingCopyChangeCounts> & { complete?: boolean }) => {
    const { complete, ...counts } = delta;
    Object.assign(run, addChangeCounts(run, counts));
    if (complete) run.collections += 1;
    progress.collectionCounts = addCollectionCount(progress.collectionCounts, name, delta);
  };
  /** Documents read from Firestore for `name` so far in this run — what the deletion check counts against. */
  const readSoFar = (name: string) => progress.collectionCounts?.find((entry) => entry.name === name)?.documents ?? 0;

  let target: Db;
  try {
    target = await targetDatabase();
  } catch (error) {
    // Not the current collection's fault: leave its attempts alone and let the next tick reconnect.
    // A run that can never connect is ended by the 24-hour limit.
    const message = `Could not connect to ${TARGET_DATABASE}: ${messageOf(error)}`;
    progress.lastError = message;
    await save({ lease: null }).catch(() => undefined);
    return result(false, claim.action, 'Could not connect to the reporting copy; the next tick retries.', state, message);
  }

  try {
    const excluded = new Set(EXCLUDED_COLLECTIONS);
    // Discovery waits for a fresh slice when little budget is left — but a slice shorter than the
    // reserve (the screen's 40 s ones) must still be able to do it, or the run would never move on.
    let worked = false;
    while (Date.now() < deadline) {
      if (!progress.roots) {
        progress.roots = (await db.listCollections()).map((ref) => ref.id).filter((id) => !excluded.has(id)).sort();
        worked = true;
        if (await stopIfAsked(await save())) return stopped();
        continue;
      }
      if (progress.index >= progress.roots.length) {
        await end();
        return result(true, 'finished', 'The copy is up to date.', state);
      }
      const root = progress.roots[progress.index];

      if (progress.step === 'discover') {
        const now = new Date();
        const cached = cachedSubcollections(state.subcollectionCache, root, now, progress.full === true);
        let extra: Partial<ReportingCopyState> = {};
        let subs = cached;
        if (!subs) {
          if (worked && deadline - Date.now() < DISCOVERY_RESERVE_MS) break;
          progress.target = `${root} (looking for subcollections)`;
          subs = await subcollectionsOf(db, root);
          state.subcollectionCache = { ...(state.subcollectionCache ?? {}), [root]: { names: subs, discoveredAt: now.toISOString() } };
          extra = { subcollectionCache: state.subcollectionCache };
        }
        if (subs.length) Object.assign(progress, { ...freshTarget, step: 'sub', subcollections: subs, subIndex: 0 });
        else nextRoot(progress);
        worked = true;
        if (await stopIfAsked(await save(extra))) return stopped();
        continue;
      }

      // A root collection or one of its subcollections: pages of documents, then the deletion check.
      const isRoot = progress.step === 'root';
      const sub = isRoot ? null : progress.subcollections[progress.subIndex];
      const name = sub ? subcollectionTarget(root, sub) : root;
      if ((progress.phase ?? 'copy') === 'copy') {
        progress.target = name;
        const page = sub
          // A collection group spans every parent of this name; keep only this root's children.
          ? await copyPage(target, name, db.collectionGroup(sub), progress.cursor, {
            after: (cursor) => db.doc(cursor),
            cursorOf: (doc) => doc.ref.path,
            keep: (doc) => isDirectChildOf(doc.ref.path, root),
            toDoc: (doc) => ({ _id: doc.ref.path, _parentPath: doc.ref.parent.parent!.path, ...(convert(doc.data()) as Document) }),
          })
          : await copyPage(target, root, db.collection(root), progress.cursor, {
            after: (cursor) => cursor,
            cursorOf: (doc) => doc.id,
            keep: () => true,
            toDoc: (doc) => ({ _id: doc.id, ...(convert(doc.data()) as Document) }),
          });
        progress.cursor = page.cursor;
        progress.attempts = 0;
        tally(name, page.counts);
        if (page.done) Object.assign(progress, { phase: 'deletions', deletionScan: null, cursor: null, lastError: null });
      } else {
        progress.target = `${name} (checking for deletions)`;
        const check = await checkDeletionsStep(target, name, progress, readSoFar(name), (ids) =>
          existingInFirestore(db, sub ? (id) => db.doc(id) : (id) => db.collection(root).doc(id), ids));
        progress.attempts = 0;
        tally(name, { markedDeleted: check.markedDeleted, complete: check.done });
        if (check.done) {
          if (isRoot) Object.assign(progress, { ...freshTarget, step: 'discover' });
          else nextSub(progress);
        }
      }
      worked = true;
      if (await stopIfAsked(await save())) return stopped();
    }
    // Check for Stop while still holding the lease (ending the run needs it), then give the run back.
    if (await stopIfAsked(await save())) return stopped();
    await save({ lease: null });
    return result(true, claim.action, 'Time budget used; the next slice continues.', state);
  } catch (error) {
    if (error instanceof LeaseLostError) return result(true, 'busy', error.message, state);
    const message = messageOf(error);
    console.error('[reporting-copy] slice failed', error);
    progress.attempts += 1;
    progress.lastError = message;
    if (progress.attempts >= MAX_ATTEMPTS) giveUpOnTarget(progress, message);
    await save({ lease: null }).catch(() => undefined);
    return result(false, claim.action, 'The slice failed; the next tick retries.', state, message);
  }
}
