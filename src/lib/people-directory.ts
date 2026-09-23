/**
 * Who a person *is* — their current designation — rather than what the app lets them do.
 *
 * ── The problem this exists to fix ──────────────────────────────────────────────────────────────
 *
 * Every "pick a person" control in this application used to label its rows with `users.role`. That
 * field is an **authorisation** artefact: it names the permission bundle an administrator attached
 * to a login ("Admin", "Site User", "Approver"). It is not a job title, it is not maintained by HR,
 * and two people with identical titles routinely hold different roles. Presenting it where a human
 * is choosing an approver reads as a designation and is wrong the moment somebody is promoted, or
 * whenever a role was named for convenience rather than for the org chart.
 *
 * The designation greytHR holds *is* maintained — effective-dated, resolved to the window containing
 * today by the sync (`docs/greythr-integration.md` §"Designation and project live in categories")
 * and mirrored onto `employees/{id}.designation`. That is the value these controls should show.
 *
 * ── The join ────────────────────────────────────────────────────────────────────────────────────
 *
 *     users/{uid}          the login — owns role, permissions, scope
 *          │  employeeId   maintained by Access Management → greytHR Linking
 *          ▼
 *     employees/{id}       the HR record — owns name, department, designation, location
 *
 * Driven from `users`, because a picker offers *logins*: an employee with no account cannot be sent
 * an approval. `employeeId` is the join, falling back to a case-insensitive email match for accounts
 * created before the linking screen existed — the same two-step fallback
 * `loadOfficeHubDirectory` already uses, kept identical on purpose so the two never disagree about
 * who somebody is.
 *
 * ── Why the fallback chain ends at `role` ───────────────────────────────────────────────────────
 *
 * Contractors, service accounts and not-yet-linked joiners have no HR record at all. Blanking their
 * subtitle would make the list look broken and would hide the one identifying fact those rows do
 * have. So the chain is designation → role → email, and callers that need to *distinguish* the two
 * can read `designationSource`.
 *
 * ── Why the Firestore half lives next door ──────────────────────────────────────────────────────
 *
 * Nothing here reads a database. The cached `employees` read is in `people-directory-client.ts`,
 * the same split `e-approval-policy` / `e-approval-service` uses: the rules about which fact wins
 * are the part worth testing, and they stay testable without an emulator or a bundler alias.
 */

/** The fields of an employee record this module reads. Everything else stays in Employee Management. */
export interface EmployeeFacts {
  /** The `employees` document id. */
  id: string;
  employeeId?: string;
  employeeNo?: string;
  email?: string;
  department?: string;
  designation?: string;
  location?: string;
  status?: string;
}

/**
 * The employee master indexed the two ways the join needs it.
 *
 * Both maps point at the same objects — this is an index, not a copy.
 */
export interface EmployeeFactsIndex<T extends EmployeeFacts = EmployeeFacts> {
  byEmployeeId: Map<string, T>;
  byEmail: Map<string, T>;
  /** When the underlying read happened, so a caller can say how stale the labels are. */
  fetchedAt: number;
  /** False when the read failed and the index is empty — callers fall back rather than show blanks. */
  loaded: boolean;
}

export const EMPTY_EMPLOYEE_FACTS_INDEX: EmployeeFactsIndex = {
  byEmployeeId: new Map(),
  byEmail: new Map(),
  fetchedAt: 0,
  loaded: false,
};

const normaliseEmail = (value: unknown): string => String(value ?? '').trim().toLowerCase();
const normaliseKey = (value: unknown): string => String(value ?? '').trim();

/**
 * Generic in the row type so a screen that already holds full `Employee` records — Access
 * Management loads them for its department and designation filters — can index those and still read
 * the fields this module does not name, rather than fetching the collection a second time.
 */
export function buildEmployeeFactsIndex<T extends EmployeeFacts>(rows: T[]): EmployeeFactsIndex<T> {
  const byEmployeeId = new Map<string, T>();
  const byEmail = new Map<string, T>();
  for (const row of rows) {
    // Three keys per row, because `users.employeeId` has historically been written from all three:
    // the document id, greytHR's numeric employee id, and the human-facing employee number.
    for (const key of [row.id, row.employeeId, row.employeeNo]) {
      const id = normaliseKey(key);
      if (id && !byEmployeeId.has(id)) byEmployeeId.set(id, row);
    }
    const email = normaliseEmail(row.email);
    if (email && !byEmail.has(email)) byEmail.set(email, row);
  }
  return { byEmployeeId, byEmail, fetchedAt: Date.now(), loaded: true };
}

/* ------------------------------------------------------------------------------------------------
 * Resolving one person
 * ---------------------------------------------------------------------------------------------- */

/** The minimum a caller has to hand us. `User` satisfies it; so do the module-local row types. */
export interface PersonLike {
  name?: string | null;
  email?: string | null;
  role?: string | null;
  employeeId?: string | null;
  employeeNo?: string | null;
  /** Already-resolved designation, when the caller's own query carries one. Wins over the index. */
  designation?: string | null;
  /** Same: the caller's own department, when it has one. */
  department?: string | null;
}

export function employeeFactsFor<T extends EmployeeFacts>(
  person: PersonLike | null | undefined,
  index: EmployeeFactsIndex<T>,
): T | null {
  if (!person) return null;
  const byId =
    index.byEmployeeId.get(normaliseKey(person.employeeId)) ??
    index.byEmployeeId.get(normaliseKey(person.employeeNo));
  if (byId) return byId;
  const email = normaliseEmail(person.email);
  return (email && index.byEmail.get(email)) || null;
}

/** Where a label came from, so a screen can mark an unlinked account rather than imply HR said so. */
export type DesignationSource = 'greythr' | 'role' | 'none';

export interface ResolvedDesignation {
  /** What to show. Empty string when there is nothing at all — callers show the email instead. */
  label: string;
  source: DesignationSource;
  department: string | null;
  employeeCode: string | null;
}

export function resolveDesignation(
  person: PersonLike | null | undefined,
  index: EmployeeFactsIndex = EMPTY_EMPLOYEE_FACTS_INDEX,
): ResolvedDesignation {
  const facts = employeeFactsFor(person, index);
  const fromHr = normaliseKey(person?.designation) || normaliseKey(facts?.designation);
  if (fromHr) {
    return {
      label: fromHr,
      source: 'greythr',
      department: normaliseKey(facts?.department) || null,
      employeeCode: normaliseKey(facts?.employeeNo ?? facts?.employeeId) || null,
    };
  }
  const role = normaliseKey(person?.role);
  return {
    label: role,
    source: role ? 'role' : 'none',
    department: normaliseKey(facts?.department) || null,
    employeeCode: normaliseKey(facts?.employeeNo ?? facts?.employeeId) || null,
  };
}

/**
 * The one-line subtitle a person row shows under the name.
 *
 * Designation first, then the role as the stand-in for somebody with no HR record, then the email so
 * the row is never a bare name. This is the function every picker calls; keeping the fallback order
 * in one place is what stops the application drifting back to labelling people by their role.
 */
export function personSubtitle(
  person: PersonLike | null | undefined,
  index: EmployeeFactsIndex = EMPTY_EMPLOYEE_FACTS_INDEX,
): string {
  const { label } = resolveDesignation(person, index);
  return label || normaliseKey(person?.email);
}

/** `"Sarika Palo — Site Engineer"`, for the single-line `<SelectItem>` controls. */
export function personOptionLabel(
  person: PersonLike | null | undefined,
  index: EmployeeFactsIndex = EMPTY_EMPLOYEE_FACTS_INDEX,
  options: { separator?: string } = {},
): string {
  const name = normaliseKey(person?.name) || normaliseKey(person?.email) || 'Unnamed user';
  const subtitle = personSubtitle(person, index);
  // A row with no name and no HR record has already used its email as the name; repeating it as the
  // subtitle would render "a@b.com — a@b.com".
  if (!subtitle || subtitle === name) return name;
  return `${name}${options.separator ?? ' — '}${subtitle}`;
}

/**
 * Everything a person row can be searched by.
 *
 * Designation is in here as well as on screen: an administrator looking for "the site engineers"
 * types the title, and a filter that only matched name and role would return nothing.
 */
export function personSearchText(
  person: PersonLike | null | undefined,
  index: EmployeeFactsIndex = EMPTY_EMPLOYEE_FACTS_INDEX,
): string {
  const facts = employeeFactsFor(person, index);
  return [
    person?.name,
    person?.email,
    person?.role,
    person?.designation ?? facts?.designation,
    facts?.department,
    facts?.employeeNo ?? facts?.employeeId,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Copies the HR designation onto a list of users.
 *
 * Returns new objects — the callers hold these in React state, and mutating the array they were
 * handed would leave a stale render. `designation` is a **derived** field: nothing writes it back to
 * `users/{uid}`, and every write in this application sets named fields rather than spreading a user
 * object, so it cannot leak into Firestore.
 */
export function attachDesignations<T extends PersonLike>(people: T[], index: EmployeeFactsIndex): T[] {
  if (!index.loaded) return people;
  return people.map((person) => {
    const facts = employeeFactsFor(person, index);
    const designation = normaliseKey(person.designation) || normaliseKey(facts?.designation);
    if (!designation && !facts) return person;
    return {
      ...person,
      designation: designation || null,
      department: normaliseKey(facts?.department) || null,
    } as T;
  });
}
