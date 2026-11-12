import { NextResponse } from 'next/server';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccess,
  type AccessRequestContext,
} from '@/lib/access-control-server';
import { hasPermission } from '@/lib/access-control';
import {
  assignmentFor,
  expensesAction,
  mayAct,
  resolveExpensesRolesDoc,
  viewableDepartmentsFor,
  type ExpensesActionKey,
} from '@/lib/expenses-roles';
import {
  EMPTY_BANK,
  cleanBank,
  employeeNameKey,
  hasBank,
  isIfsc,
  type EmployeeBankLookup,
  type EmployeeBankMatch,
  type ExpenseBankDetails,
} from '@/lib/expenses-bank';
import { isEmployeeMasterRecord, type EmployeeSensitiveDetail } from '@/lib/greythr';
import { fetchEmployeeBankDetail, isGreytHRConfigured } from '@/lib/greythr-client';

/**
 * An employee's bank account, for an expense request that pays them.
 *
 * `GET /api/expenses/employee-bank?departmentId=…&name=…`        — by the request's party name
 * `GET /api/expenses/employee-bank?departmentId=…&employeeId=…`  — one of several same-named people
 *
 * ── Who may ask ─────────────────────────────────────────────────────────────────────────────────
 *
 * Bank accounts live in `employeeSensitive`, which no browser reads, behind
 * `Employee.Personal Data · View`. Paying an employee from Expenses needs the account without that
 * permission, so this answers anyone who may raise or edit a request in the department named —
 * judged exactly as New Request judges it: the role's `Create`/`Edit` on that department, the
 * assignment under Expenses › Settings › User Roles (which can widen or narrow it), and the limit
 * that keeps someone assigned to particular departments out of the others. Holders of
 * `Employee.Personal Data · View` may ask regardless, as they can read the record anyway.
 *
 * Only the five fields a transfer needs are returned — never the rest of the restricted record.
 *
 * ── Which employee ──────────────────────────────────────────────────────────────────────────────
 *
 * A party name matches an employee when the two are the same once case, spacing and the dots in
 * initials are set aside (`employeeNameKey`). greytHR's current roster is searched first; a name not
 * on it is looked for in the mirror, under the spellings greytHR stores names in, so someone who has
 * left (a full-and-final settlement) is still found. Two people with one name are both returned,
 * without bank details, for the user to choose between.
 *
 * ── Which account ───────────────────────────────────────────────────────────────────────────────
 *
 * The Employee module's stored record first. When the sync has not stored the bank group (it is off
 * by default) or the record lacks the account number or IFSC, greytHR is asked directly — the bank
 * record and the BANKACCNO identity only, which is where greytHR keeps the IFSC.
 */

export const runtime = 'nodejs';

/** `expensesSettings/user-roles` (src/components/expenses/use-expenses-roles.ts). */
const ROLES_DOC = { collection: 'expensesSettings', doc: 'user-roles' } as const;

/** The actions that put someone in front of a request's bank details. */
const DEPARTMENT_ACTIONS: readonly ExpensesActionKey[] = ['raise-request', 'edit-request'];

async function mayLookUp(db: Firestore, context: AccessRequestContext, departmentId: string): Promise<boolean> {
  if (hasPermission(context.access, 'Employee.Personal Data', 'View')) return true;

  const rolesSnap = await db.collection(ROLES_DOC.collection).doc(ROLES_DOC.doc).get();
  const rolesDoc = resolveExpensesRolesDoc(rolesSnap.exists ? rolesSnap.data() : null);

  /**
   * Every role the caller holds, by name and by id — a by-role assignment stores ids, the session
   * knows names. The same bridge `useExpensesActor` builds in the browser, read only when some
   * assignment is by role.
   */
  const roleNames = context.roleNames ?? [];
  let roleIds = [...roleNames];
  const byRole = DEPARTMENT_ACTIONS.some((key) => assignmentFor(rolesDoc, key).type === 'roles');
  if (byRole && roleNames.length) {
    const wanted = new Set(roleNames.map((name) => name.trim().toLowerCase()));
    const roles = await db.collection('roles').select('name').get();
    for (const role of roles.docs) {
      if (wanted.has(String(role.get('name') ?? '').trim().toLowerCase())) roleIds.push(role.id);
    }
    roleIds = [...new Set(roleIds)];
  }
  const actor = { userId: context.userId, roleIds };

  // Someone User Roles places in particular departments is not let into the others.
  const viewAll = hasPermission(context.access, 'Expenses.Expense Requests', 'View All');
  const limitedTo = viewAll ? null : viewableDepartmentsFor(rolesDoc, actor);
  if (limitedTo && !limitedTo.includes(departmentId)) return false;

  return DEPARTMENT_ACTIONS.some((key) => {
    const def = expensesAction(key);
    if (!def) return false;
    const permitted = hasPermission(
      context.access,
      def.permission.section,
      def.permission.action,
      def.departmentScoped ? departmentId : undefined,
    );
    return mayAct(assignmentFor(rolesDoc, key), actor, permitted, { departmentId }).allowed;
  });
}

/* ── finding the employee ─────────────────────────────────────────────────────────────────────── */

interface RosterEntry extends EmployeeBankMatch {
  key: string;
}

/**
 * greytHR's current roster, a few fields of it, kept per server instance for a short while: a party
 * name is looked up as it is chosen, and re-reading some thousand documents for each would be waste.
 */
const ROSTER_TTL_MS = 5 * 60 * 1000;
let rosterCache: { at: number; value: Promise<RosterEntry[]> } | null = null;

function currentRoster(db: Firestore): Promise<RosterEntry[]> {
  const now = Date.now();
  if (rosterCache && now - rosterCache.at < ROSTER_TTL_MS) return rosterCache.value;
  const value = db
    .collection('greythrCurrentRoster')
    .select('employeeId', 'employeeNo', 'name', 'department', 'designation')
    .get()
    .then((snapshot) =>
      snapshot.docs
        .map((doc) => {
          const data = doc.data();
          const name = String(data.name ?? '').trim();
          return {
            employeeId: String(data.employeeId ?? doc.id),
            employeeNo: String(data.employeeNo ?? ''),
            name,
            department: data.department ? String(data.department) : undefined,
            designation: data.designation ? String(data.designation) : undefined,
            current: true,
            key: employeeNameKey(name),
          };
        })
        .filter((entry) => entry.key),
    );
  rosterCache = { at: now, value };
  value.catch(() => {
    if (rosterCache?.value === value) rosterCache = null;
  });
  return value;
}

/** The roster entry without its search key. */
const asMatch = (entry: RosterEntry): EmployeeBankMatch => ({
  employeeId: entry.employeeId,
  employeeNo: entry.employeeNo,
  name: entry.name,
  department: entry.department,
  designation: entry.designation,
  current: entry.current,
});

const titleCase = (key: string) => key.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

async function employeesNamed(db: Firestore, name: string): Promise<EmployeeBankMatch[]> {
  const key = employeeNameKey(name);
  if (!key) return [];

  const onRoster = (await currentRoster(db).catch(() => [] as RosterEntry[])).filter((entry) => entry.key === key);
  if (onRoster.length) return onRoster.map(asMatch);

  /**
   * Not on the current roster — someone who has left, or a roster never fetched. The mirror cannot
   * be searched case-blind, so it is asked for the spellings greytHR stores names in: as typed,
   * capitals, and Title Case.
   */
  const variants = [...new Set([name.trim().replace(/\s+/g, ' '), key, titleCase(key)])].filter(Boolean);
  const snapshot = await db.collection('employees').where('name', 'in', variants).limit(20).get();
  const found = new Map<string, EmployeeBankMatch>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    // The mirror also holds a salary row per employee per month; only the master record is a person.
    if (!isEmployeeMasterRecord(data)) continue;
    const employeeId = String(data.employeeId ?? doc.id);
    if (found.has(employeeId)) continue;
    found.set(employeeId, {
      employeeId,
      employeeNo: String(data.employeeNo ?? ''),
      name: String(data.name ?? ''),
      department: data.department ? String(data.department) : undefined,
      designation: data.designation ? String(data.designation) : undefined,
      current: false,
    });
  }
  return [...found.values()];
}

/** The employee asked for by id: the roster, else the mirror, else just the id. */
async function employeeById(db: Firestore, employeeId: string): Promise<EmployeeBankMatch> {
  const onRoster = (await currentRoster(db).catch(() => [] as RosterEntry[])).find((entry) => entry.employeeId === employeeId);
  if (onRoster) return asMatch(onRoster);
  const direct = await db.collection('employees').doc(employeeId).get();
  const data: Record<string, unknown> = direct.exists && isEmployeeMasterRecord(direct.data()) ? direct.data() ?? {} : {};
  return {
    employeeId,
    employeeNo: String(data.employeeNo ?? ''),
    name: String(data.name ?? ''),
    department: data.department ? String(data.department) : undefined,
    designation: data.designation ? String(data.designation) : undefined,
    current: false,
  };
}

/* ── the account ──────────────────────────────────────────────────────────────────────────────── */

/** Later sources fill only what the earlier ones left blank. */
const fillBlanks = (...sources: Array<Partial<ExpenseBankDetails>>): ExpenseBankDetails => {
  const out = { ...EMPTY_BANK };
  for (const source of sources) {
    for (const field of Object.keys(out) as Array<keyof ExpenseBankDetails>) {
      if (!out[field] && source[field]) out[field] = String(source[field]).trim();
    }
  }
  return out;
};

/** greytHR's branch code is the IFSC on tenants that file it there; anything else is not used as one. */
const ifscFrom = (...candidates: Array<string | null | undefined>) =>
  candidates.map((value) => String(value ?? '').trim()).find(isIfsc) ?? '';

async function bankFor(
  db: Firestore,
  employee: EmployeeBankMatch,
): Promise<Pick<EmployeeBankLookup, 'bank' | 'bankFrom' | 'note'>> {
  const storedSnap = await db.collection('employeeSensitive').doc(employee.employeeId).get().catch(() => null);
  const stored = storedSnap?.exists ? (storedSnap.data() as EmployeeSensitiveDetail) : null;
  const storedIdentity = stored?.identities?.BANKACCNO;
  const fromStore: Partial<ExpenseBankDetails> = {
    accountHolderName: stored?.bank?.nameAsPerBank || storedIdentity?.nameAsPerDoc,
    accountNumber: stored?.bank?.accountNumber || storedIdentity?.documentNo,
    ifscCode: ifscFrom(storedIdentity?.ifscCode, stored?.bank?.branchCode),
    bankName: stored?.bank?.bankName,
    branchName: stored?.bank?.bankBranch,
  };

  let fromGreytHR: Partial<ExpenseBankDetails> = {};
  let liveNote: string | null = null;
  const storedComplete = !!fromStore.accountNumber && !!fromStore.ifscCode;
  if (!storedComplete && /^\d+$/.test(employee.employeeId) && isGreytHRConfigured()) {
    try {
      const live = await fetchEmployeeBankDetail(employee.employeeId);
      fromGreytHR = {
        accountHolderName: String(live.bank?.nameAsPerBank ?? live.bankIdentity?.nameAsPerDoc ?? ''),
        accountNumber: String(live.bank?.bankAccountNumber ?? live.bankIdentity?.documentNo ?? ''),
        ifscCode: ifscFrom(live.bankIdentity?.ifscCode, live.bank?.branchCode),
        bankName: live.bankName,
        branchName: String(live.bank?.bankBranch ?? ''),
      };
    } catch (error) {
      // Not fatal: whatever the stored record has is still worth filling in.
      console.warn(`[expenses/employee-bank] greytHR bank detail unavailable for ${employee.employeeId}.`, error);
      liveNote = 'greytHR could not be reached just now, so only what the Employee module has stored is shown.';
    }
  }

  // greytHR now over the stored copy, field by field; the employee's own name if neither has one.
  const merged = cleanBank(
    fillBlanks(fromGreytHR, fromStore, hasBank({ ...fromGreytHR, ...fromStore }) ? { accountHolderName: employee.name } : {}),
  );
  if (!hasBank(merged)) {
    return {
      bank: null,
      bankFrom: null,
      note: liveNote ?? 'No bank details are on file for this employee in the Employee module.',
    };
  }
  const usedGreytHR = Object.values(fromGreytHR).some(Boolean);
  const missing = [!merged.accountNumber && 'account number', !merged.ifscCode && 'IFSC'].filter(Boolean);
  return {
    bank: merged,
    bankFrom: usedGreytHR ? 'greythr' : 'employee-module',
    note:
      liveNote ??
      (missing.length ? `The Employee module has no ${missing.join(' or ')} for this employee — enter it here.` : null),
  };
}

export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    const url = new URL(request.url);
    const departmentId = (url.searchParams.get('departmentId') ?? '').trim();
    const name = (url.searchParams.get('name') ?? '').trim();
    const employeeId = (url.searchParams.get('employeeId') ?? '').trim();

    if (!departmentId) {
      return NextResponse.json({ error: 'Choose the department first.' }, { status: 400 });
    }
    if (!name && !employeeId) {
      return NextResponse.json({ error: 'A party name or an employee id is required.' }, { status: 400 });
    }

    const db = getFirebaseAdminFirestore();
    if (!(await mayLookUp(db, context, departmentId))) {
      throw new AccessDeniedError(
        'Looking up an employee’s bank details needs permission to raise or edit expense requests in this department.',
      );
    }

    let matches: EmployeeBankMatch[];
    let employee: EmployeeBankMatch | null;
    if (employeeId) {
      employee = await employeeById(db, employeeId);
      matches = [employee];
    } else {
      matches = await employeesNamed(db, name);
      employee = matches.length === 1 ? matches[0] : null;
    }

    const answer: EmployeeBankLookup = employee
      ? { ok: true, matches, employee, ...(await bankFor(db, employee)) }
      : {
          ok: true,
          matches,
          employee: null,
          bank: null,
          bankFrom: null,
          note: matches.length > 1 ? `${matches.length} employees have this name — choose which one is being paid.` : null,
        };

    // Account numbers: never kept by a browser or proxy cache.
    return NextResponse.json(answer, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
