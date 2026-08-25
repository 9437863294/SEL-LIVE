/**
 * Linking platform users to greytHR employees.
 *
 * Pure rules, no I/O — same shape as `greythr.ts`, and testable under
 * `node --experimental-strip-types --test`.
 *
 * ── The model ───────────────────────────────────────────────────────────────────────────────────
 *
 *     users/{uid}            the login identity. Owns roles, permissions, scope. Never touched by
 *                            greytHR beyond `status` when somebody leaves.
 *          │  employeeId
 *          ▼
 *     employees/{id}         the HR record, mirrored from greytHR. Owns name, department,
 *                            designation, location, manager, joining date, employment state.
 *
 * One employee → at most one login. Not every employee needs one: a site technician exists in
 * greytHR and may never sign in here.
 *
 * ── Why the link is a field and not a collection ────────────────────────────────────────────────
 *
 * The obvious alternative is a third `greythrMappings` collection holding the pairing. It is
 * rejected on purpose. The link is 1:1 and already implied by `users.employeeId`, so a separate
 * collection stores the same fact twice with no transaction spanning both — and when they disagree,
 * the sync reads one while the screens read the other. That divergence is silent, and the way it
 * surfaces is a resignation that does not revoke a login.
 *
 * What a mappings collection would legitimately give you is *history* — who linked whom, when, and
 * on what evidence. That is kept, as an append-only audit trail, without making it the source of
 * truth for the current link.
 *
 * ── Two tiers of matching ───────────────────────────────────────────────────────────────────────
 *
 * `matchUserForEmployee` in `greythr.ts` drives automated deactivation, and deliberately only
 * accepts an explicit link or an exact email. Everything looser lives here, produces *suggestions*,
 * and requires a human to confirm — because the cost of a wrong match is not a wrong row on a
 * screen, it is one person's resignation revoking another person's access.
 */

import type { EmploymentState, LinkableEmployee } from './greythr';

/* ------------------------------------------------------------------------------------------------
 * Field ownership
 * ---------------------------------------------------------------------------------------------- */

/**
 * The only user fields greytHR may write.
 *
 * `status` is here because the exit policy needs it — that is the whole point of syncing employment
 * state. The profile fields are here because HR owns them and re-typing a designation in two systems
 * guarantees they disagree.
 */
export const GREYTHR_OWNED_USER_FIELDS = [
  'name',
  'email',
  'phone',
  'department',
  'designation',
  'location',
  'reportingManager',
  'dateOfJoining',
  'employmentState',
  'employeeNo',
  'status',
  // Written alongside `status` so an administrator can see who deactivated an account and why.
  'deactivatedBy',
  'deactivatedAt',
  'deactivationReason',
  'reactivatedBy',
  'reactivatedAt',
  'greytHR',
] as const;

/**
 * Fields the sync must never write, at any cost.
 *
 * Listed explicitly rather than left as "we happen not to write those", because the failure mode is
 * catastrophic and silent: an HR sync that touched `permissions` would quietly undo every additive
 * grant an administrator had made, and nothing would report it. `assertNoProtectedFields` turns that
 * from a code-review question into a thrown error.
 */
export const ERP_PROTECTED_USER_FIELDS = [
  'role',
  'roles',
  'permissions',
  'additionalRoles',
  'directPermissions',
  'projectAccess',
  'siteAccess',
  'approvalPermissions',
  'financePermissions',
  'adminPermissions',
  'moduleAccess',
  'temporaryAccess',
  'uid',
  'password',
] as const;

const PROTECTED = new Set<string>(ERP_PROTECTED_USER_FIELDS);
const OWNED = new Set<string>(GREYTHR_OWNED_USER_FIELDS);

/**
 * Throw if a sync-authored write touches an authorization field.
 *
 * Called on the actual payload immediately before it is committed, not on the code path that builds
 * it — a guard that runs anywhere else can be bypassed by the next person to add a write.
 */
export function assertNoProtectedFields(
  data: Record<string, unknown>,
  context = 'greytHR sync',
): void {
  const offenders = Object.keys(data).filter((key) => PROTECTED.has(key));
  if (offenders.length) {
    throw new Error(
      `${context} attempted to write protected authorization field(s): ${offenders.join(', ')}. ` +
        'greytHR owns HR data; roles and permissions are owned by this platform only.',
    );
  }
}

/**
 * Narrow an update to the fields greytHR owns.
 *
 * Anything unrecognised is dropped rather than passed through, so adding a field to the HR mirror
 * cannot accidentally start writing it onto login records.
 */
export function pickGreytHRFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (OWNED.has(key)) out[key] = value;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Normalising the join keys
 * ---------------------------------------------------------------------------------------------- */

export const normalizeEmail = (value: string | null | undefined): string =>
  String(value ?? '').trim().toLowerCase();

/**
 * Reduce a phone number to comparable digits.
 *
 * greytHR holds `+91 98765 43210`, `09876543210` and `9876543210` for the same person across
 * different fields. Compared on the last ten digits, because the country code is present in some
 * records and absent in others, and a leading trunk `0` is common in Indian data entry.
 */
export function normalizePhone(value: string | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

/**
 * Reduce an employee number to a comparable form.
 *
 * `E1401`, `e-1401` and `E 1401` are one number typed three ways. Case and separators are dropped;
 * the digits are not zero-stripped, because `E014` and `E14` are genuinely different people in
 * organisations that pad.
 */
export const normalizeEmployeeNo = (value: string | null | undefined): string =>
  String(value ?? '').trim().toUpperCase().replace(/[\s._/-]+/g, '');

/**
 * Reduce a name to a comparable form.
 *
 * Word order is normalised too, because "Bhoi Debaprasad" and "Debaprasad Bhoi" are the same person
 * entered by two different people. Only ever used for suggestions.
 */
export function normalizeName(value: string | null | undefined): string {
  const words = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.sort().join(' ');
}

/* ------------------------------------------------------------------------------------------------
 * The link record on the user
 * ---------------------------------------------------------------------------------------------- */

/** How a link was established. Ordered by trust, strongest first. */
export type LinkMethod = 'manual' | 'employeeId' | 'employeeNo' | 'email' | 'phone' | 'name';

/**
 * Where the confidence ordering comes from:
 *
 *   `manual`      — an administrator said so. Beats anything inferred, including a conflicting id.
 *   `employeeId`  — greytHR's own primary key, recorded at user creation.
 *   `employeeNo`  — the human-facing code. Unique in practice, occasionally re-typed.
 *   `email`       — reliable when present, absent for a large share of field staff.
 *   `phone`       — shared handsets and family numbers exist, so suggestion only.
 *   `name`        — never automatic. Two people share a name eventually.
 */
export const LINK_METHOD_RANK: Record<LinkMethod, number> = {
  manual: 0,
  employeeId: 1,
  employeeNo: 2,
  email: 3,
  phone: 4,
  name: 5,
};

/** Methods trusted enough to link without a human confirming. */
export const AUTO_LINK_METHODS: readonly LinkMethod[] = ['manual', 'employeeId', 'employeeNo', 'email'];

export const isAutoLinkable = (method: LinkMethod): boolean => AUTO_LINK_METHODS.includes(method);

export const linkMethodLabel = (method: LinkMethod): string =>
  ({
    manual: 'Linked manually',
    employeeId: 'Matched on greytHR employee ID',
    employeeNo: 'Matched on employee number',
    email: 'Matched on official email',
    phone: 'Matched on mobile number',
    name: 'Matched on name',
  })[method];

/** The `greytHR` block written onto a user document. */
export interface UserGreytHRLink {
  linked: boolean;
  employeeId: string;
  employeeNo: string;
  method: LinkMethod;
  linkedAt: string;
  linkedBy: string;
  /** Set when a link is removed, so the row can explain itself rather than just emptying. */
  unlinkedAt?: string;
  unlinkedBy?: string;
  unlinkReason?: string;
}

/**
 * The user fields to write when linking.
 *
 * `employeeId` stays a top-level field because `indexUsersByEmployeeId` and the Firestore queries
 * behind the picker already read it there, and moving it would break the join it exists to serve.
 * The `greytHR` block carries the provenance alongside it.
 */
export function buildLinkWrite(input: {
  employeeId: string;
  employeeNo: string;
  method: LinkMethod;
  actor: string;
  at: string;
}): Record<string, unknown> {
  const link: UserGreytHRLink = {
    linked: true,
    employeeId: String(input.employeeId),
    employeeNo: String(input.employeeNo ?? ''),
    method: input.method,
    linkedAt: input.at,
    linkedBy: input.actor,
  };
  return {
    employeeId: link.employeeId,
    employeeNo: link.employeeNo,
    greytHR: link,
  };
}

/**
 * The user fields to write when unlinking.
 *
 * `employeeId` is cleared but the `greytHR` block is kept with `linked: false`, because "this was
 * linked to E1401 and somebody removed it on Tuesday" is the question that gets asked when HR data
 * stops appearing on a profile. A deleted field cannot answer it.
 *
 * Nothing about roles or permissions changes: unlinking removes an HR data source, not access.
 */
export function buildUnlinkWrite(input: {
  previous: UserGreytHRLink | null | undefined;
  actor: string;
  at: string;
  reason: string;
}): Record<string, unknown> {
  return {
    employeeId: '',
    greytHR: {
      ...(input.previous ?? { employeeId: '', employeeNo: '', method: 'manual' as LinkMethod }),
      linked: false,
      unlinkedAt: input.at,
      unlinkedBy: input.actor,
      unlinkReason: input.reason,
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * The reconciliation report
 * ---------------------------------------------------------------------------------------------- */

export interface LinkUserRow {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  employeeId?: string | null;
  employeeNo?: string | null;
  status: 'Active' | 'Inactive';
  role?: string;
  greytHR?: UserGreytHRLink | null;
}

export interface LinkCandidate {
  employeeId: string;
  employeeNo: string;
  name: string;
  department: string;
  designation: string;
  employmentState: EmploymentState;
  method: LinkMethod;
  /** True when the method is trusted enough to apply in a bulk run without review. */
  auto: boolean;
}

export type LinkRowStatus =
  /** A confirmed link, by id or by an administrator. */
  | 'linked'
  /** Confidently matched but not yet recorded — a bulk run can apply these. */
  | 'suggested'
  /** Matched more than one employee, or matched only by name or phone. Needs a decision. */
  | 'review'
  /** Two users claim one employee, or the recorded employee no longer exists. */
  | 'conflict'
  /** No candidate at all. */
  | 'unlinked';

export interface LinkRow {
  user: LinkUserRow;
  status: LinkRowStatus;
  /** The employee this user is, or would be, linked to. */
  employee: LinkCandidate | null;
  /** Everything that matched, best first — so a reviewer sees the alternatives. */
  candidates: LinkCandidate[];
  /** Plain-language explanation, shown in the table. */
  reason: string;
}

export interface LinkReport {
  rows: LinkRow[];
  /** Employees with no user account at all. Not a problem — most of them never need one. */
  unlinkedEmployees: LinkCandidate[];
  counts: Record<LinkRowStatus, number> & { unlinkedEmployees: number };
  /** Employee numbers or emails appearing on more than one record, which block automatic matching. */
  ambiguous: { employeeNos: string[]; emails: string[]; phones: string[]; names: string[] };
}

type EmployeeInput = Pick<
  LinkableEmployee,
  'employeeId' | 'employeeNo' | 'name' | 'department' | 'designation' | 'employmentState'
> & { email?: string | null; phone?: string | null };

const toCandidate = (employee: EmployeeInput, method: LinkMethod): LinkCandidate => ({
  employeeId: String(employee.employeeId),
  employeeNo: String(employee.employeeNo ?? ''),
  name: String(employee.name ?? ''),
  department: String(employee.department ?? ''),
  designation: String(employee.designation ?? ''),
  employmentState: employee.employmentState,
  method,
  auto: isAutoLinkable(method),
});

/**
 * Build a one-to-many index, then discard every key that matched more than one employee.
 *
 * Discarding rather than picking the first is the whole point: two employees on one email is a data
 * problem, and choosing either would produce a confident-looking wrong link. The dropped keys are
 * reported so somebody can fix them at the source.
 */
function groupBy(
  employees: EmployeeInput[],
  key: (employee: EmployeeInput) => string,
): { index: Map<string, EmployeeInput>; ambiguous: string[] } {
  const buckets = new Map<string, EmployeeInput[]>();
  for (const employee of employees) {
    const value = key(employee);
    if (!value) continue;
    const bucket = buckets.get(value);
    if (bucket) bucket.push(employee);
    else buckets.set(value, [employee]);
  }

  const index = new Map<string, EmployeeInput>();
  const ambiguous: string[] = [];
  for (const [value, bucket] of buckets) {
    if (bucket.length === 1) index.set(value, bucket[0]);
    else ambiguous.push(value);
  }
  return { index, ambiguous };
}

/**
 * Reconcile every platform user against the employee mirror.
 *
 * Runs all five joins for every user rather than stopping at the first hit, because the alternatives
 * are what make a review screen useful: "matched E1401 by email, but E1402 by name" is a row an
 * administrator should look at, and a first-match-wins implementation would show it as settled.
 */
export function buildLinkReport(
  users: LinkUserRow[],
  employees: EmployeeInput[],
): LinkReport {
  const byId = new Map(employees.map((employee) => [String(employee.employeeId), employee]));
  const byNo = groupBy(employees, (employee) => normalizeEmployeeNo(employee.employeeNo));
  const byEmail = groupBy(employees, (employee) => normalizeEmail(employee.email));
  const byPhone = groupBy(employees, (employee) => normalizePhone(employee.phone));
  const byName = groupBy(employees, (employee) => normalizeName(employee.name));

  // Which employees are claimed by more than one login. Detected before classifying, because a
  // conflict is a property of the pair, not of either row alone.
  const claims = new Map<string, string[]>();
  for (const user of users) {
    const claimed = String(user.employeeId ?? '').trim();
    if (!claimed) continue;
    const list = claims.get(claimed);
    if (list) list.push(user.id);
    else claims.set(claimed, [user.id]);
  }

  const rows: LinkRow[] = [];
  const linkedEmployeeIds = new Set<string>();

  for (const user of users) {
    const recorded = String(user.employeeId ?? '').trim();

    /* ── An existing link ── */

    if (recorded) {
      const employee = byId.get(recorded);
      const contenders = claims.get(recorded) ?? [];

      if (!employee) {
        rows.push({
          user,
          status: 'conflict',
          employee: null,
          candidates: [],
          // Almost always a deleted greytHR record or an API user whose scope narrowed. Reported
          // rather than silently unlinked, because the two are indistinguishable from here.
          reason: `Linked to employee ${recorded}, which is not in the employee mirror.`,
        });
        continue;
      }

      linkedEmployeeIds.add(recorded);

      if (contenders.length > 1) {
        rows.push({
          user,
          status: 'conflict',
          employee: toCandidate(employee, user.greytHR?.method ?? 'employeeId'),
          candidates: [],
          reason: `${contenders.length} accounts are linked to employee ${employee.employeeNo || recorded}. Only one may be.`,
        });
        continue;
      }

      rows.push({
        user,
        status: 'linked',
        employee: toCandidate(employee, user.greytHR?.method ?? 'employeeId'),
        candidates: [],
        reason: linkMethodLabel(user.greytHR?.method ?? 'employeeId'),
      });
      continue;
    }

    /* ── No link: gather candidates ── */

    const found: LinkCandidate[] = [];
    const seen = new Set<string>();
    const consider = (employee: EmployeeInput | undefined, method: LinkMethod) => {
      if (!employee) return;
      const id = String(employee.employeeId);
      // Already claimed by another login, so offering it would create the conflict above.
      if (claims.has(id)) return;
      if (seen.has(id)) return;
      seen.add(id);
      found.push(toCandidate(employee, method));
    };

    consider(byNo.index.get(normalizeEmployeeNo(user.employeeNo)), 'employeeNo');
    consider(byEmail.index.get(normalizeEmail(user.email)), 'email');
    consider(byPhone.index.get(normalizePhone(user.phone)), 'phone');
    consider(byName.index.get(normalizeName(user.name)), 'name');

    found.sort((a, b) => LINK_METHOD_RANK[a.method] - LINK_METHOD_RANK[b.method]);

    if (!found.length) {
      rows.push({
        user,
        status: 'unlinked',
        employee: null,
        candidates: [],
        reason: 'No matching employee in greytHR.',
      });
      continue;
    }

    const best = found[0];

    // More than one distinct employee matched. Even if the strongest is an employee-number hit, the
    // disagreement itself is the signal — one of the two records is wrong.
    if (found.length > 1) {
      rows.push({
        user,
        status: 'review',
        employee: null,
        candidates: found,
        reason: `${found.length} possible employees matched. Choose one.`,
      });
      continue;
    }

    rows.push({
      user,
      status: best.auto ? 'suggested' : 'review',
      employee: best.auto ? best : null,
      candidates: found,
      reason: best.auto
        ? `${linkMethodLabel(best.method)} — ready to link.`
        : `${linkMethodLabel(best.method)} — confirm before linking.`,
    });
  }

  const counts = {
    linked: 0,
    suggested: 0,
    review: 0,
    conflict: 0,
    unlinked: 0,
    unlinkedEmployees: 0,
  } as LinkReport['counts'];
  for (const row of rows) counts[row.status] += 1;

  const unlinkedEmployees = employees
    .filter((employee) => !claims.has(String(employee.employeeId)))
    .map((employee) => toCandidate(employee, 'manual'));
  counts.unlinkedEmployees = unlinkedEmployees.length;

  return {
    rows,
    unlinkedEmployees,
    counts,
    ambiguous: {
      employeeNos: byNo.ambiguous,
      emails: byEmail.ambiguous,
      phones: byPhone.ambiguous,
      names: byName.ambiguous,
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Bulk linking
 * ---------------------------------------------------------------------------------------------- */

export interface BulkLinkPlan {
  /** Links that will be written. */
  apply: Array<{ userId: string; userName: string; employeeId: string; employeeNo: string; method: LinkMethod }>;
  /** Rows deliberately left alone, with the reason, so the preview accounts for every user. */
  skip: Array<{ userId: string; userName: string; reason: string }>;
}

/**
 * What a "link all confident matches" run would do.
 *
 * Separated from the writing so the count can be shown before anything is committed. First-run
 * linking touches every account in the organisation; an administrator should see "887 will be
 * linked, 12 need review" before agreeing to it, not after.
 */
export function planBulkLink(report: LinkReport): BulkLinkPlan {
  const apply: BulkLinkPlan['apply'] = [];
  const skip: BulkLinkPlan['skip'] = [];

  for (const row of report.rows) {
    if (row.status === 'suggested' && row.employee) {
      apply.push({
        userId: row.user.id,
        userName: row.user.name,
        employeeId: row.employee.employeeId,
        employeeNo: row.employee.employeeNo,
        method: row.employee.method,
      });
      continue;
    }
    if (row.status === 'linked') continue; // Nothing to do; not worth reporting as skipped.
    skip.push({ userId: row.user.id, userName: row.user.name, reason: row.reason });
  }

  return { apply, skip };
}

/* ------------------------------------------------------------------------------------------------
 * Audit
 * ---------------------------------------------------------------------------------------------- */

export interface LinkAuditEntry {
  id: string;
  action: 'link' | 'unlink' | 'bulk-link';
  userId: string;
  userName: string;
  employeeId: string;
  employeeNo: string;
  method: LinkMethod | null;
  actorId: string;
  actorName: string;
  at: string;
  reason: string;
  /** Set on bulk entries so one run's writes can be found together. */
  batchId?: string;
}

/**
 * A sortable, collision-resistant id.
 *
 * Timestamp-prefixed so a plain `orderBy(documentId)` returns chronological order — the audit table
 * needs no composite index, which matters because an index that has not been deployed makes the
 * screen fall back to unordered reads.
 */
export const linkAuditId = (at: string, userId: string): string =>
  `${at.replace(/[^0-9]/g, '').slice(0, 17)}_${userId}`;

export function buildLinkAudit(input: Omit<LinkAuditEntry, 'id'>): LinkAuditEntry {
  return { id: linkAuditId(input.at, input.userId), ...input };
}

/* ------------------------------------------------------------------------------------------------
 * Presentation
 * ---------------------------------------------------------------------------------------------- */

export const LINK_STATUS_LABELS: Record<LinkRowStatus, string> = {
  linked: 'Linked',
  suggested: 'Ready to link',
  review: 'Needs review',
  conflict: 'Conflict',
  unlinked: 'Not in greytHR',
};

/** Ordered worst-first, because the rows that need work should be at the top of the table. */
export const LINK_STATUS_ORDER: LinkRowStatus[] = [
  'conflict',
  'review',
  'suggested',
  'unlinked',
  'linked',
];

export const linkRowSearchText = (row: LinkRow): string =>
  [
    row.user.name,
    row.user.email,
    row.user.employeeNo,
    row.employee?.employeeNo,
    row.employee?.name,
    row.employee?.department,
    row.employee?.designation,
    ...row.candidates.map((candidate) => `${candidate.employeeNo} ${candidate.name}`),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

export function sortLinkRows(rows: LinkRow[]): LinkRow[] {
  return rows.slice().sort((a, b) => {
    const byStatus = LINK_STATUS_ORDER.indexOf(a.status) - LINK_STATUS_ORDER.indexOf(b.status);
    if (byStatus !== 0) return byStatus;
    return (a.user.name || '').localeCompare(b.user.name || '');
  });
}
