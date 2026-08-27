import 'server-only';

/**
 * The persisted snapshot of greytHR's CURRENT roster: fetch → store → next fetch replaces it.
 *
 * ── What this is, and what it deliberately is not ──────────────────────────────────────────────
 *
 * `employees` is the **mirror**: every employee greytHR has ever returned, current and departed,
 * maintained by `runGreytHRSync` with `merge: true` and never pruned. Departed records have to stay
 * there — `resolveAccessDecision` can only close a leaver's login if it can still see a record
 * saying they left, and `employeeSensitive`, `employeeLeaveBalance`, `employeeAttendance` and
 * `users.employeeId` are all keyed to those documents.
 *
 * This collection is a different thing: a **replaceable snapshot** of who greytHR says is currently
 * employed, at one moment. Each successful complete fetch clears the previous snapshot and writes the
 * new one, so it never accumulates and never goes stale in the way the mirror can.
 *
 * Kept separate from `employees` for a reason that is structural rather than cautious. Pruning
 * `employees` down to the CURRENT roster cannot hold: the hourly sync fetches `state=ALL` and writes
 * all of them back, so the two would fight — the snapshot deleting leavers, the sync recreating them
 * an hour later — and the mirror would flip between two shapes depending on which ran last. Two
 * writers with opposite intentions on one collection is not a policy that can be made to work by
 * ordering them more carefully.
 *
 * The payoff of persisting it at all: when greytHR is unreachable, this is a *dated, complete*
 * answer to "who currently works here", which is strictly better than the mirror's derived guess.
 *
 * ── The deletion guard ─────────────────────────────────────────────────────────────────────────
 *
 * This is the only module in the integration that deletes anything, so it refuses to do so unless
 * the incoming data can carry the weight:
 *
 *   1. The page walk must have **completed** (`complete: true`). A roster truncated by the page cap
 *      is indistinguishable from a shrunken one by content alone.
 *   2. The fetch must be **non-empty**. Zero current employees is not a real state for a company; a
 *      permission or paging fault very much is.
 *   3. It must match greytHR's own `totalElements` when the envelope reported one.
 *   4. It must not have **collapsed** against the last stored snapshot. A roster that suddenly loses
 *      most of itself is far more likely to be an API scope change than 90% of the company resigning
 *      overnight, and the cost of pausing is one stale snapshot versus a wrongly emptied one.
 *
 * When a guard trips, the previous snapshot is left exactly as it was and the reason is returned for
 * the caller to surface. Refusing to write is always recoverable; deleting is not.
 */

import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from './firebase-admin';
import { shouldReplaceRosterSnapshot, type SyncedEmployee } from './greythr';

export const ROSTER_STORE = {
  /** One document per currently-employed person, keyed by greytHR's numeric employee id. */
  snapshot: 'greythrCurrentRoster',
  /** `settings/greythrCurrentRoster` — when the snapshot was taken and what it contains. */
  settings: 'settings',
  settingsDoc: 'greythrCurrentRoster',
} as const;

/** Firestore's hard ceiling is 500 operations per batch; 400 leaves room for the metadata write. */
const BATCH_LIMIT = 400;

export interface RosterSnapshotMeta {
  fetchedAt: string | null;
  count: number;
  /** Why the last attempt did not replace the snapshot, when it did not. */
  lastRefusalReason?: string | null;
  lastRefusedAt?: string | null;
}

export interface ReplaceSnapshotResult {
  replaced: boolean;
  written: number;
  deleted: number;
  /** Set when the snapshot was left alone, naming the guard that stopped it. */
  refusedReason: string | null;
  fetchedAt: string;
  count: number;
}

export async function readSnapshotMeta(
  db: Firestore = getFirebaseAdminFirestore(),
): Promise<RosterSnapshotMeta> {
  const doc = await db.collection(ROSTER_STORE.settings).doc(ROSTER_STORE.settingsDoc).get();
  if (!doc.exists) return { fetchedAt: null, count: 0 };
  const data = doc.data() ?? {};
  return {
    fetchedAt: typeof data.fetchedAt === 'string' ? data.fetchedAt : null,
    count: typeof data.count === 'number' ? data.count : 0,
    lastRefusalReason: typeof data.lastRefusalReason === 'string' ? data.lastRefusalReason : null,
    lastRefusedAt: typeof data.lastRefusedAt === 'string' ? data.lastRefusedAt : null,
  };
}

/** Commit in chunks, because a snapshot is larger than one batch allows. */
async function commitChunked(
  db: Firestore,
  operations: Array<{ kind: 'set'; id: string; data: Record<string, unknown> } | { kind: 'delete'; id: string }>,
): Promise<void> {
  for (let index = 0; index < operations.length; index += BATCH_LIMIT) {
    const batch = db.batch();
    for (const operation of operations.slice(index, index + BATCH_LIMIT)) {
      const ref = db.collection(ROSTER_STORE.snapshot).doc(operation.id);
      if (operation.kind === 'delete') batch.delete(ref);
      // Not merged: a snapshot document should be exactly what greytHR just returned, with no
      // residue from a previous shape. That is the whole point of a replace.
      else batch.set(ref, operation.data);
    }
    await batch.commit();
  }
}

/**
 * Replace the stored snapshot with a freshly fetched CURRENT roster.
 *
 * Writes every incoming employee and deletes every stored document the incoming set does not
 * mention. Returns `replaced: false` with a reason rather than throwing when a guard trips — the
 * caller is usually serving a page and should still be able to answer, just with older data.
 */
export async function replaceCurrentRosterSnapshot(
  input: {
    employees: SyncedEmployee[];
    fetchedAt: string;
    complete: boolean;
    totalElements: number | null;
  },
  db: Firestore = getFirebaseAdminFirestore(),
): Promise<ReplaceSnapshotResult> {
  const { employees, fetchedAt, complete, totalElements } = input;
  const refuse = async (reason: string): Promise<ReplaceSnapshotResult> => {
    // Recorded so a refusal is visible on the settings document rather than only in a log line
    // nobody reads. A snapshot that quietly stopped updating is the failure this guards against.
    await db
      .collection(ROSTER_STORE.settings)
      .doc(ROSTER_STORE.settingsDoc)
      .set({ lastRefusalReason: reason, lastRefusedAt: new Date().toISOString() }, { merge: true })
      .catch(() => {});
    return { replaced: false, written: 0, deleted: 0, refusedReason: reason, fetchedAt, count: employees.length };
  };

  // The decision itself is a pure function in `greythr.ts` so it can be tested without an Admin SDK
  // — this is the only code in the integration that deletes, so its guards are the ones most worth
  // being able to exercise exhaustively.
  const previous = await readSnapshotMeta(db);
  const decision = shouldReplaceRosterSnapshot({
    fetched: employees.length,
    complete,
    totalElements,
    previousCount: previous.count,
  });
  if (!decision.replace) return refuse(decision.reason ?? 'The stored snapshot was kept.');

  /* ── Guards passed: write the new set, delete what it does not mention ── */

  const existingIds = new Set<string>();
  // Ids only — the documents themselves are about to be overwritten or deleted, so their contents
  // are of no interest and reading them would cost a full collection read for nothing.
  const existing = await db.collection(ROSTER_STORE.snapshot).select(FieldPath.documentId()).get();
  for (const doc of existing.docs) existingIds.add(doc.id);

  const incomingIds = new Set(employees.map((employee) => String(employee.employeeId)));

  const operations: Array<{ kind: 'set'; id: string; data: Record<string, unknown> } | { kind: 'delete'; id: string }> = [];
  for (const employee of employees) {
    operations.push({
      kind: 'set',
      id: String(employee.employeeId),
      data: { ...employee, snapshotFetchedAt: fetchedAt } as unknown as Record<string, unknown>,
    });
  }
  const stale = [...existingIds].filter((id) => !incomingIds.has(id));
  for (const id of stale) operations.push({ kind: 'delete', id });

  await commitChunked(db, operations);

  await db
    .collection(ROSTER_STORE.settings)
    .doc(ROSTER_STORE.settingsDoc)
    .set(
      {
        fetchedAt,
        count: employees.length,
        // Cleared on success, so a stale refusal reason cannot linger and misrepresent a healthy
        // snapshot as a stuck one.
        lastRefusalReason: null,
        lastRefusedAt: null,
      },
      { merge: true },
    );

  return {
    replaced: true,
    written: employees.length,
    deleted: stale.length,
    refusedReason: null,
    fetchedAt,
    count: employees.length,
  };
}

/**
 * The stored snapshot.
 *
 * The fallback when greytHR is unreachable: a dated, complete roster beats a derived guess, provided
 * the reader is told how old it is — which `readSnapshotMeta` supplies.
 */
export async function readCurrentRosterSnapshot(
  db: Firestore = getFirebaseAdminFirestore(),
): Promise<{ employees: SyncedEmployee[]; meta: RosterSnapshotMeta }> {
  const [snapshot, meta] = await Promise.all([
    db.collection(ROSTER_STORE.snapshot).get(),
    readSnapshotMeta(db),
  ]);
  const employees = snapshot.docs
    .map((doc) => doc.data() as SyncedEmployee)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  return { employees, meta };
}
