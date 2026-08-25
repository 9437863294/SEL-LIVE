import 'server-only';

/**
 * Reading and writing the user ↔ employee link.
 *
 * Admin SDK, server-only. The rules live in `greythr-linking.ts`; this module does the I/O and
 * nothing else, so the classification logic stays testable without Firestore.
 *
 * ── Why linking is not part of the sync ─────────────────────────────────────────────────────────
 *
 * The sync runs unattended on a schedule. Linking a login to an employee decides whose resignation
 * revokes whose access, and an unattended job guessing at that is how the wrong person loses their
 * account. So the sync consumes links (via the strict `matchUserForEmployee`) and only an
 * administrator creates them.
 *
 * The one concession to volume is `bulk-link`, which applies the matches the report already
 * classified as confident. First-run linking across ~900 accounts is not realistic by hand, and
 * every write it makes is previewable and individually reversible.
 */

import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from './firebase-admin';
import { AccessDeniedError } from './access-control-server';
import {
  isEmployeeMasterRecord,
  type EmploymentState,
  type SyncedEmployee,
} from './greythr';
import {
  assertNoProtectedFields,
  buildLinkAudit,
  buildLinkReport,
  buildLinkWrite,
  buildUnlinkWrite,
  planBulkLink,
  type BulkLinkPlan,
  type LinkAuditEntry,
  type LinkMethod,
  type LinkReport,
  type LinkUserRow,
  type UserGreytHRLink,
} from './greythr-linking';

export const LINK_COLLECTIONS = {
  users: 'users',
  employees: 'employees',
  /**
   * Append-only link history.
   *
   * The history a `greythrMappings` collection would have given us, without making it the source of
   * truth for the current link — see the header of `greythr-linking.ts`.
   */
  audit: 'greythrLinkAudit',
} as const;

interface EmployeeRow {
  employeeId: string;
  employeeNo: string;
  name: string;
  email: string | null;
  phone: string | null;
  department: string;
  designation: string;
  employmentState: EmploymentState;
}

/**
 * Load both sides of the reconciliation.
 *
 * Two full collection reads. Acceptable because this screen is opened deliberately by an
 * administrator, not on every page load, and because reconciliation is inherently whole-set work:
 * "which employee numbers appear twice" cannot be answered from a page of results.
 */
async function loadBothSides(db: Firestore): Promise<{ users: LinkUserRow[]; employees: EmployeeRow[] }> {
  const [userSnapshot, employeeSnapshot] = await Promise.all([
    db.collection(LINK_COLLECTIONS.users).get(),
    db.collection(LINK_COLLECTIONS.employees).get(),
  ]);

  const users: LinkUserRow[] = userSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: String(data.name ?? data.email ?? ''),
      email: data.email ? String(data.email) : null,
      // Two spellings exist in this database; both are read rather than migrated.
      phone: (data.phone ?? data.mobile ?? null) as string | null,
      employeeId: (data.employeeId ?? null) as string | null,
      employeeNo: (data.employeeNo ?? null) as string | null,
      status: data.status === 'Inactive' ? 'Inactive' : 'Active',
      role: data.role ? String(data.role) : undefined,
      greytHR: (data.greytHR ?? null) as UserGreytHRLink | null,
    };
  });

  const employees: EmployeeRow[] = employeeSnapshot.docs
    // Excludes the monthly salary documents the legacy salary sync writes into this same collection;
    // without it, "CON-005 · March 2026" appears as a person to link somebody to.
    .filter((doc) => isEmployeeMasterRecord(doc.data()))
    .map((doc) => {
      const data = doc.data() as Partial<SyncedEmployee> & { mobile?: string };
      return {
        employeeId: String(data.employeeId ?? doc.id),
        employeeNo: String(data.employeeNo ?? ''),
        name: String(data.name ?? ''),
        email: data.email ? String(data.email) : null,
        phone: (data.phone ?? data.mobile ?? null) as string | null,
        department: String(data.department ?? ''),
        designation: String(data.designation ?? ''),
        employmentState: (data.employmentState ?? 'Active') as EmploymentState,
      };
    });

  return { users, employees };
}

export interface LinkReportResponse extends LinkReport {
  /** When the employee mirror was last refreshed, so a stale report says so. */
  mirrorSyncedAt: string | null;
  /** What a bulk run would do, computed here so the button can show a count before it is pressed. */
  plan: BulkLinkPlan;
  recent: LinkAuditEntry[];
}

export async function buildReport(db: Firestore = getFirebaseAdminFirestore()): Promise<LinkReportResponse> {
  const [{ users, employees }, audit] = await Promise.all([loadBothSides(db), recentAudit(db)]);
  const report = buildLinkReport(users, employees);

  const employeeSnapshot = await db
    .collection(LINK_COLLECTIONS.employees)
    .orderBy('syncedAt', 'desc')
    .limit(1)
    .get()
    // No index and no `syncedAt` on legacy documents both land here. A missing timestamp is
    // displayed as "unknown", which is honest; failing the whole report over it would not be.
    .catch(() => null);

  return {
    ...report,
    mirrorSyncedAt:
      (employeeSnapshot?.docs[0]?.data()?.syncedAt as string | undefined) ?? null,
    plan: planBulkLink(report),
    recent: audit,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Writing
 * ---------------------------------------------------------------------------------------------- */

interface Actor {
  userId: string;
  userName: string;
}

/**
 * Link one user to one employee.
 *
 * Runs in a transaction over both the user being linked and any user already claiming the employee,
 * because the invariant is across documents: one employee, at most one login. Two administrators
 * linking two accounts to the same employee at the same moment would otherwise both succeed, and the
 * resulting pair is exactly the `conflict` state the report has to flag afterwards.
 */
export async function linkUser(
  input: { userId: string; employeeId: string; method?: LinkMethod },
  actor: Actor,
  db: Firestore = getFirebaseAdminFirestore(),
): Promise<{ audit: LinkAuditEntry }> {
  const at = new Date().toISOString();
  const method: LinkMethod = input.method ?? 'manual';

  const audit = await db.runTransaction(async (transaction) => {
    const userRef = db.collection(LINK_COLLECTIONS.users).doc(input.userId);
    const employeeRef = db.collection(LINK_COLLECTIONS.employees).doc(String(input.employeeId));

    const [userDoc, employeeDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(employeeRef),
    ]);

    if (!userDoc.exists) throw new AccessDeniedError('That user no longer exists.', 404);
    if (!employeeDoc.exists) {
      throw new AccessDeniedError(
        `Employee ${input.employeeId} is not in the employee mirror. Run a greytHR sync first.`,
        404,
      );
    }

    const employee = employeeDoc.data() as Partial<SyncedEmployee>;

    // Whoever else already claims this employee. Queried inside the transaction so the read is part
    // of it — a check outside would be a race, which is the bug this transaction exists to prevent.
    const claimants = await transaction.get(
      db.collection(LINK_COLLECTIONS.users).where('employeeId', '==', String(input.employeeId)),
    );
    const other = claimants.docs.find((doc) => doc.id !== input.userId);
    if (other) {
      throw new AccessDeniedError(
        `${other.data().name || 'Another account'} is already linked to employee ` +
          `${employee.employeeNo || input.employeeId}. Unlink it first — one employee may have only one login.`,
        409,
      );
    }

    const write = buildLinkWrite({
      employeeId: String(input.employeeId),
      employeeNo: String(employee.employeeNo ?? ''),
      method,
      actor: actor.userId,
      at,
    });

    // The same guard the sync passes through. Linking writes HR fields only; if this ever throws,
    // something has added an authorization field to the link payload.
    assertNoProtectedFields(write, 'Linking a user to a greytHR employee');
    transaction.set(userRef, write, { merge: true });

    const entry = buildLinkAudit({
      action: 'link',
      userId: input.userId,
      userName: String(userDoc.data()?.name ?? ''),
      employeeId: String(input.employeeId),
      employeeNo: String(employee.employeeNo ?? ''),
      method,
      actorId: actor.userId,
      actorName: actor.userName,
      at,
      reason: `Linked to ${employee.name ?? 'employee'} (${employee.employeeNo ?? input.employeeId}).`,
    });
    transaction.set(db.collection(LINK_COLLECTIONS.audit).doc(entry.id), entry);
    return entry;
  });

  return { audit };
}

/**
 * Remove a link.
 *
 * Roles, permissions and status are untouched. Unlinking says "stop treating this greytHR record as
 * this person's HR data"; it does not say "revoke their access", and conflating the two would make
 * fixing a mis-link a destructive operation.
 */
export async function unlinkUser(
  input: { userId: string; reason?: string },
  actor: Actor,
  db: Firestore = getFirebaseAdminFirestore(),
): Promise<{ audit: LinkAuditEntry }> {
  const at = new Date().toISOString();
  const userRef = db.collection(LINK_COLLECTIONS.users).doc(input.userId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new AccessDeniedError('That user no longer exists.', 404);

  const data = userDoc.data() ?? {};
  const previous = (data.greytHR ?? null) as UserGreytHRLink | null;
  const employeeId = String(data.employeeId ?? previous?.employeeId ?? '');
  if (!employeeId) throw new AccessDeniedError('That user is not linked to a greytHR employee.', 400);

  const reason = input.reason?.trim() || 'Unlinked by an administrator.';
  const write = buildUnlinkWrite({ previous, actor: actor.userId, at, reason });
  assertNoProtectedFields(write, 'Unlinking a user from a greytHR employee');

  const entry = buildLinkAudit({
    action: 'unlink',
    userId: input.userId,
    userName: String(data.name ?? ''),
    employeeId,
    employeeNo: String(data.employeeNo ?? previous?.employeeNo ?? ''),
    method: previous?.method ?? null,
    actorId: actor.userId,
    actorName: actor.userName,
    at,
    reason,
  });

  const batch = db.batch();
  batch.set(userRef, write, { merge: true });
  batch.set(db.collection(LINK_COLLECTIONS.audit).doc(entry.id), entry);
  await batch.commit();

  return { audit: entry };
}

export interface BulkLinkResult {
  batchId: string;
  linked: number;
  failed: Array<{ userId: string; userName: string; error: string }>;
  plan: BulkLinkPlan;
}

/**
 * Apply every confident match.
 *
 * Deliberately not one big batch. A single failure — an employee claimed in the moment between the
 * report and the write — would roll back all 887 links, and re-running would hit the same row again.
 * Linking each user separately means one bad row costs one bad row, and the failures come back named
 * so they can be fixed individually.
 */
export async function bulkLink(
  actor: Actor,
  db: Firestore = getFirebaseAdminFirestore(),
): Promise<BulkLinkResult> {
  const report = await buildReport(db);
  const plan = report.plan;
  const batchId = `bulk_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;

  const failed: BulkLinkResult['failed'] = [];
  let linked = 0;

  // Sequential on purpose. Each link runs a transaction that queries `users` by `employeeId`;
  // firing 900 of those at once would contend on the same index for no wall-clock gain worth having.
  for (const entry of plan.apply) {
    try {
      await linkUser({ userId: entry.userId, employeeId: entry.employeeId, method: entry.method }, actor, db);
      linked += 1;
    } catch (error) {
      failed.push({
        userId: entry.userId,
        userName: entry.userName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  if (linked) {
    // One summary row alongside the per-user entries, so a bulk run reads as one action in the
    // history rather than 887 unexplained ones.
    const at = new Date().toISOString();
    const summary = buildLinkAudit({
      action: 'bulk-link',
      userId: actor.userId,
      userName: actor.userName,
      employeeId: '',
      employeeNo: '',
      method: null,
      actorId: actor.userId,
      actorName: actor.userName,
      at,
      reason: `Bulk link: ${linked} account(s) linked, ${failed.length} failed, ${plan.skip.length} left for review.`,
      batchId,
    });
    await db.collection(LINK_COLLECTIONS.audit).doc(summary.id).set(summary);
  }

  return { batchId, linked, failed, plan };
}

async function recentAudit(db: Firestore, limit = 50): Promise<LinkAuditEntry[]> {
  const snapshot = await db
    .collection(LINK_COLLECTIONS.audit)
    // Ordered by document id, which is timestamp-prefixed — so no composite index is needed and the
    // history cannot silently degrade to unordered reads on an installation that has not deployed one.
    .orderBy(FieldPath.documentId(), 'desc')
    .limit(limit)
    .get()
    .catch(() => null);

  if (!snapshot) return [];
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as LinkAuditEntry);
}
