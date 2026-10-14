import 'server-only';

import { randomUUID } from 'node:crypto';
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
  EMPTY_REPORTING_COPY_STATE,
  EXCLUDED_COLLECTIONS,
  isDirectChildOf,
  makeValueConverter,
  normalizeReportingCopyConfig,
  READ_PAGE,
  REPORTING_COPY_COLLECTION,
  reportingCopyDue,
  reportingCopyNextDueAt,
  subcollectionTarget,
  SUBCOLLECTION_SAMPLE,
  TARGET_DATABASE,
  WRITE_BATCH,
  type ReportingCopyConfig,
  type ReportingCopyDue,
  type ReportingCopyProgress,
  type ReportingCopyRun,
  type ReportingCopySettingsInput,
  type ReportingCopyState,
} from './reporting-copy';

/**
 * The scheduled refresh of the reporting copy — the app-hosted port of `tools/mongo-sync/sync.mjs`.
 *
 * Same copy, same shapes: root collections → same-named MongoDB collections with `_id` = document
 * id; subcollections (found by sampling) → `<parent>.<sub>` with `_id` = full path and
 * `_parentPath`; every document stamped `_syncRun` / `_syncedAt`, and each collection's documents
 * not stamped by this run deleted once the collection has been written in full.
 *
 * What differs is that a request has a time limit and a full copy (≈100k documents, ~150
 * collections) does not fit in one. So a run is a sequence of slices: each tick claims the run for
 * its time budget, copies page after page, saves its cursor to `reportingCopy/state` after every
 * page, and the next tick carries on from that cursor. The run id is kept for the whole run, so a
 * collection whose pages were written over several ticks still has every document stamped with the
 * same `_syncRun` when its stale-delete runs — which is why that delete waits until the collection
 * has been fully written in this run.
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
});

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
  /** `running`: a run is in progress; `working`: a slice of it is copying at this moment. */
  state: Omit<ReportingCopyState, 'lease'> & { running: boolean; working: boolean };
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
  return {
    configured: reportingCopyConfigured(),
    config,
    state: { ...state, running, working },
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
export async function requestReportingCopyRun(userId: string): Promise<{ queued: boolean; reason: string }> {
  const db = getFirebaseAdminFirestore();
  const { config: configRef, state: stateRef } = refs(db);
  return db.runTransaction(async (tx) => {
    const stateSnap = await tx.get(stateRef);
    if (normalizeState(stateSnap.data()).progress) return { queued: false, reason: 'A refresh is already running.' };
    tx.set(configRef, { requestedAt: new Date().toISOString(), requestedBy: userId }, { merge: true });
    return { queued: true, reason: 'Refresh requested.' };
  });
}

/* ------------------------------------------------------------------------------------------------
 * The run
 * ---------------------------------------------------------------------------------------------- */

export interface ReportingCopyTickResult {
  ok: boolean;
  /** idle: nothing due · busy: another slice holds the run · started/continued: worked, more to do · finished · not-configured. */
  action: 'idle' | 'busy' | 'started' | 'continued' | 'finished' | 'not-configured';
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

const newProgress = (runId: number): ReportingCopyProgress => ({
  runId, roots: null, index: 0, step: 'root', subcollections: [], subIndex: 0,
  cursor: null, target: null, attempts: 0, lastError: null, failures: [], ticks: 1,
});

/** On to the next root collection. */
function nextRoot(progress: ReportingCopyProgress) {
  Object.assign(progress, { index: progress.index + 1, step: 'root', subcollections: [], subIndex: 0, cursor: null, attempts: 0, lastError: null });
}

/** On to the next subcollection of the current root, or the next root after the last one. */
function nextSub(progress: ReportingCopyProgress) {
  if (progress.subIndex + 1 >= progress.subcollections.length) return nextRoot(progress);
  Object.assign(progress, { subIndex: progress.subIndex + 1, cursor: null, attempts: 0, lastError: null });
}

/**
 * Give up on the current collection after repeated failures, so one bad collection cannot stall the
 * copy of the rest. Its MongoDB copy is left as it was (no stale-delete) and the run ends failed.
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

/** Copy one page of a source query (in document-id order, after `cursor`) into `name`. */
async function copyPage(
  target: Db,
  name: string,
  query: Query,
  cursor: string | null,
  options: {
    after: (cursor: string) => string | DocumentReference;
    cursorOf: (doc: QueryDocumentSnapshot) => string;
    keep: (doc: QueryDocumentSnapshot) => boolean;
    toDoc: (doc: QueryDocumentSnapshot) => Document;
    runId: number;
  },
): Promise<{ written: number; cursor: string | null; done: boolean }> {
  let q = query.orderBy(FieldPath.documentId()).limit(READ_PAGE);
  if (cursor) q = q.startAfter(options.after(cursor));
  const snap = await q.get();
  const syncedAt = new Date();
  const ops: AnyBulkWriteOperation<Document>[] = snap.docs.filter(options.keep).map((doc) => {
    const body: Document = { ...options.toDoc(doc), _syncRun: options.runId, _syncedAt: syncedAt };
    return { replaceOne: { filter: { _id: body._id }, replacement: body, upsert: true } };
  });
  for (let i = 0; i < ops.length; i += WRITE_BATCH) {
    await target.collection(name).bulkWrite(ops.slice(i, i + WRITE_BATCH), { ordered: false });
  }
  const last = snap.docs[snap.docs.length - 1];
  return { written: ops.length, cursor: last ? options.cursorOf(last) : cursor, done: snap.size < READ_PAGE };
}

/**
 * One slice of work: start a due run or continue the one in progress, for at most `budgetMs`.
 *
 * Called by the scheduler tick (a ~4-minute budget) and by "Refresh now" (a short one, so the screen
 * shows the run moving). Fast when there is nothing to do: two reads, and a write only when the
 * next due time changed.
 */
export async function advanceReportingCopy({ budgetMs }: { budgetMs: number }): Promise<ReportingCopyTickResult> {
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
    if (state.lease && Date.parse(state.lease.expiresAt) > now.getTime()) {
      return { action: 'busy' as const, reason: 'Another tick is working on the run.', state };
    }
    const lease = { holder, expiresAt: new Date(now.getTime() + budgetMs + LEASE_GRACE_MS).toISOString() };

    if (state.progress && state.lastRun) {
      if (now.getTime() - Date.parse(state.lastRun.startedAt) > MAX_RUN_MS) {
        const lastRun: ReportingCopyRun = {
          ...state.lastRun, status: 'failed', finishedAt: stamp,
          durationSeconds: Math.round((now.getTime() - Date.parse(state.lastRun.startedAt)) / 1000),
          error: `The run did not finish within 24 hours (stopped at ${state.progress.target ?? 'the start'}).`,
        };
        const next = { ...state, lastRun, progress: null, lease: null, nextDueAt: reportingCopyNextDueAt(config, state, now), updatedAt: stamp };
        tx.set(stateRef, next);
        return { action: 'idle' as const, reason: 'Ended a run that had been going for over 24 hours.', state: next };
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
      return { action: 'continued' as const, reason: 'Continuing the run in progress.', state: next };
    }

    const due = reportingCopyDue(config, state, now);
    if (!due.due) {
      const nextDueAt = reportingCopyNextDueAt(config, state, now);
      if (nextDueAt !== state.nextDueAt) tx.set(stateRef, { nextDueAt }, { merge: true });
      return { action: 'idle' as const, reason: due.reason, state: { ...state, nextDueAt } };
    }

    // Starting a run answers the request and every slot up to now, so neither starts a second one.
    const latest = [due.slot, state.lastScheduledSlot].filter((slot): slot is string => Boolean(slot)).sort().pop() ?? null;
    const consumed = {
      lastScheduledSlot: latest,
      handledRequestAt: due.trigger === 'manual' ? config.requestedAt : state.handledRequestAt,
    };
    const run: ReportingCopyRun = {
      runId: now.getTime(), trigger: due.trigger ?? 'schedule', status: 'running', startedAt: stamp,
      finishedAt: null, durationSeconds: null, documents: 0, collections: 0, removed: 0, error: null,
    };
    if (!reportingCopyConfigured()) {
      const lastRun: ReportingCopyRun = { ...run, status: 'failed', finishedAt: stamp, durationSeconds: 0, error: NOT_CONFIGURED };
      const next = { ...state, ...consumed, lastRun, nextDueAt: reportingCopyNextDueAt(config, { ...state, ...consumed }, now), updatedAt: stamp };
      tx.set(stateRef, next);
      return { action: 'not-configured' as const, reason: NOT_CONFIGURED, state: next };
    }
    const next = { ...state, ...consumed, lastRun: run, progress: newProgress(run.runId), lease, nextDueAt: null, updatedAt: stamp };
    tx.set(stateRef, next);
    return { action: 'started' as const, reason: due.reason, state: next };
  });

  const result = (ok: boolean, action: ReportingCopyTickResult['action'], reason: string, state: ReportingCopyState, error?: string): ReportingCopyTickResult => ({
    ok, action, reason, lastRun: state.lastRun, progress: state.progress, nextDueAt: state.nextDueAt, ...(error ? { error } : {}),
  });
  if (claim.action !== 'started' && claim.action !== 'continued') {
    return result(claim.action !== 'not-configured', claim.action, claim.reason, claim.state);
  }

  const state: ReportingCopyState = claim.state;
  const progress = state.progress!;
  const run = state.lastRun!;

  /** Save progress, only while this slice still holds the run. `{ lease: null }` also gives the run back. */
  const save = async (extra: Partial<ReportingCopyState> = {}) => {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(stateRef);
      if (normalizeState(snap.data()).lease?.holder !== holder) throw new LeaseLostError();
      tx.update(stateRef, { progress: state.progress, lastRun: state.lastRun, updatedAt: new Date().toISOString(), ...extra });
    });
  };

  const finish = async () => {
    const finishedAt = new Date();
    const failures = progress.failures;
    state.lastRun = {
      ...run, status: failures.length ? 'failed' : 'succeeded', finishedAt: finishedAt.toISOString(),
      durationSeconds: Math.round((finishedAt.getTime() - Date.parse(run.startedAt)) / 1000),
      error: failures.length
        ? `${failures.length} collection(s) could not be copied: ${failures.slice(0, 5).join('; ')}${failures.length > 5 ? ` …and ${failures.length - 5} more` : ''}`
        : null,
    };
    state.progress = null;
    const config = normalizeReportingCopyConfig((await configRef.get()).data());
    state.nextDueAt = reportingCopyNextDueAt(config, state, finishedAt);
    await save({ lease: null, nextDueAt: state.nextDueAt });
  };

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
    while (Date.now() < deadline) {
      if (!progress.roots) {
        progress.roots = (await db.listCollections()).map((ref) => ref.id).filter((id) => !excluded.has(id)).sort();
        await save();
        continue;
      }
      if (progress.index >= progress.roots.length) {
        await finish();
        return result(true, 'finished', 'The copy is up to date.', state);
      }
      const root = progress.roots[progress.index];

      if (progress.step === 'root') {
        progress.target = root;
        const page = await copyPage(target, root, db.collection(root), progress.cursor, {
          after: (cursor) => cursor,
          cursorOf: (doc) => doc.id,
          keep: () => true,
          toDoc: (doc) => ({ _id: doc.id, ...(convert(doc.data()) as Document) }),
          runId: run.runId,
        });
        run.documents += page.written;
        progress.cursor = page.cursor;
        progress.attempts = 0;
        if (page.done) {
          run.removed += (await target.collection(root).deleteMany({ _syncRun: { $ne: run.runId } })).deletedCount;
          run.collections += 1;
          Object.assign(progress, { step: 'discover', cursor: null, lastError: null });
        }
        await save();
        continue;
      }

      if (progress.step === 'discover') {
        if (deadline - Date.now() < DISCOVERY_RESERVE_MS) break;
        progress.target = `${root} (looking for subcollections)`;
        const subs = await subcollectionsOf(db, root);
        if (subs.length) Object.assign(progress, { step: 'sub', subcollections: subs, subIndex: 0, cursor: null, attempts: 0, lastError: null });
        else nextRoot(progress);
        await save();
        continue;
      }

      // step === 'sub'
      const sub = progress.subcollections[progress.subIndex];
      const name = subcollectionTarget(root, sub);
      progress.target = name;
      // A collection group spans every parent of this name; keep only this root's children.
      const page = await copyPage(target, name, db.collectionGroup(sub), progress.cursor, {
        after: (cursor) => db.doc(cursor),
        cursorOf: (doc) => doc.ref.path,
        keep: (doc) => isDirectChildOf(doc.ref.path, root),
        toDoc: (doc) => ({ _id: doc.ref.path, _parentPath: doc.ref.parent.parent!.path, ...(convert(doc.data()) as Document) }),
        runId: run.runId,
      });
      run.documents += page.written;
      progress.cursor = page.cursor;
      progress.attempts = 0;
      if (page.done) {
        run.removed += (await target.collection(name).deleteMany({ _syncRun: { $ne: run.runId } })).deletedCount;
        run.collections += 1;
        nextSub(progress);
      }
      await save();
    }
    await save({ lease: null });
    return result(true, claim.action, 'Time budget used; the next tick continues.', state);
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
