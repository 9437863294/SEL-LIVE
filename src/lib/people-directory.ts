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
 * today by the sync (`docs/greythr-integration.md` §"Designation and project live in categories").
 * That is the value these controls should show.
 *
 * ── Where the designation actually lives ────────────────────────────────────────────────────────
 *
 *     users/{uid}                 the login — owns role, permissions, scope
 *          │  employeeId          greytHR's numeric id, e.g. "313"
 *          │  employeeNo          the human-facing code, e.g. "E1597"
 *          ├─▶ greythrCurrentRoster/{employeeId}   ← keyed by the numeric id. **Has designations.**
 *          └─▶ employees/{docId}                   ← keyed by a random id; `employeeId` holds "E1597"
 *
 * Both are read, **roster first**. This ordering is not a preference, it is the whole fix: in this
 * tenant the `employees` mirror carries `designation: ''` for most people — 232 of 412 at the time
 * of writing, including every account that has a login — while the roster snapshot has one for 132
 * of its 135 rows. Joining only against the mirror therefore found the right person and read an
 * empty title off them, which is why these controls kept showing `role` instead.
 *
 * The mirror is still read, second: it is the only record of somebody who has left or is on notice,
 * and those people still hold logins that appear in a picker.
 *
 * Note the two collections do not share a key space. The roster's document id and `employeeId` are
 * greytHR's numeric id; the mirror's `employeeId` field holds the employee *number*. Every row is
 * therefore indexed under its document id, its `employeeId`, its `employeeNo` and its email, so a
 * user matches whichever of those their `employeeId` was written from.
 *
 * ── The subtitle never falls back to `role` ─────────────────────────────────────────────────────
 *
 * It did, on the reasoning that a blank line looks broken. That was wrong here: this tenant's roles
 * include "Default" (31 of 54 logins), module names like "Recurring Payments", and at least one
 * account whose role is the holder's own name. Rendering any of those under a person's name states
 * a job title that nobody chose and HR never saw. The chain is **designation → department → email**:
 * every link in it is a fact about the person rather than about their access.
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
  /** Searched on by the Access Management user filter. */
  phone?: string;
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
 * Index rows from one or more collections, **highest priority first**.
 *
 * Generic in the row type so a screen that already holds full `Employee` records — Access
 * Management loads them for its department and designation filters — can index those and still read
 * the fields this module does not name, rather than fetching the collection a second time.
 *
 * When two rows collide on a key, the one that actually carries a designation wins, and priority
 * order only breaks the tie. Two things make that rule necessary rather than clever:
 *
 *   - the roster and the mirror hold the same person, and it is the mirror's copy that is blank;
 *   - the mirror itself has duplicate documents for some people (one employee number, two random
 *     document ids), of which at most one is populated.
 *
 * Taking whichever arrived first would make the label depend on Firestore's iteration order.
 */
export function buildEmployeeFactsIndex<T extends EmployeeFacts>(...sources: T[][]): EmployeeFactsIndex<T> {
  const byEmployeeId = new Map<string, T>();
  const byEmail = new Map<string, T>();

  /** Keep `next` only if the slot is empty, or if it says something the incumbent does not. */
  const better = (incumbent: T | undefined, next: T): boolean =>
    !incumbent || (!normaliseKey(incumbent.designation) && Boolean(normaliseKey(next.designation)));

  for (const rows of sources) {
    for (const row of rows) {
      // Four keys per row: `users.employeeId` has been written from the document id, greytHR's
      // numeric id and the employee number, and the two collections disagree about which is which.
      for (const key of [row.id, row.employeeId, row.employeeNo]) {
        const id = normaliseKey(key);
        if (id && better(byEmployeeId.get(id), row)) byEmployeeId.set(id, row);
      }
      const email = normaliseEmail(row.email);
      if (email && better(byEmail.get(email), row)) byEmail.set(email, row);
    }
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
  /** Same: the posting location, once `attachDesignations` has copied it across. */
  location?: string | null;
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

/**
 * Where the answer came from.
 *
 * `'person'` means the caller had already resolved it (Office Hub and Tour & Travel carry their
 * own); `'record'` means this module read it off greytHR. Deliberately no `'role'` member — the
 * role is not a designation, and a type that could return one would invite the bug back.
 */
export type DesignationSource = 'person' | 'record' | 'none';

/**
 * Everything a person picker puts in a row: who they are, where they sit, and the code HR knows
 * them by. Resolved together because they come from one record and a picker shows them as one line.
 */
export interface ResolvedDesignation {
  /** The job title, or `''` when greytHR has none. Never the role. */
  designation: string;
  source: DesignationSource;
  department: string | null;
  /** Posting location — greytHR's `cat::Location`. */
  location: string | null;
  /**
   * The employee number if there is one, else greytHR's numeric id.
   *
   * The number ("E1597") first because it is the one printed on a card and quoted in a corridor;
   * the numeric id ("313") is an API key that happens to be visible.
   */
  employeeCode: string | null;
}

export function resolveDesignation(
  person: PersonLike | null | undefined,
  index: EmployeeFactsIndex = EMPTY_EMPLOYEE_FACTS_INDEX,
): ResolvedDesignation {
  const facts = employeeFactsFor(person, index);
  const own = normaliseKey(person?.designation);
  const fromRecord = normaliseKey(facts?.designation);
  return {
    designation: own || fromRecord,
    source: own ? 'person' : fromRecord ? 'record' : 'none',
    department: normaliseKey(person?.department) || normaliseKey(facts?.department) || null,
    location: normaliseKey(person?.location) || normaliseKey(facts?.location) || null,
    // `person.employeeNo` first: a directory already through `attachDesignations` carries it, and
    // those callers pass no index.
    employeeCode:
      normaliseKey(person?.employeeNo) || normaliseKey(facts?.employeeNo ?? facts?.employeeId) || null,
  };
}

/**
 * The job title alone, or `''`.
 *
 * Separate from `personSubtitle` because two callers must not accept its fallbacks: E-Approval
 * denormalises a designation onto every step it routes, and "Finance" or an email address stored
 * there would be read back months later as somebody's job title.
 */
export function personJobTitle(
  person: PersonLike | null | undefined,
  index: EmployeeFactsIndex = EMPTY_EMPLOYEE_FACTS_INDEX,
): string {
  return resolveDesignation(person, index).designation;
}

/**
 * The one-line subtitle a person row shows under the name.
 *
 * Designation, then the department, then the email — three facts about the person, in decreasing
 * order of how much they tell you. Never the role. This is the function every picker calls; keeping
 * the order in one place is what stops the application drifting back to labelling people by their
 * access.
 */
export function personSubtitle(
  person: PersonLike | null | undefined,
  index: EmployeeFactsIndex = EMPTY_EMPLOYEE_FACTS_INDEX,
): string {
  const { designation, department } = resolveDesignation(person, index);
  return designation || department || normaliseKey(person?.email);
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
 * types the title, and a filter that only matched name and role would return nothing. The role stays
 * in the haystack even though it is no longer displayed — somebody who knows a colleague is "the
 * Recurring Payments one" should still find them.
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
    // `person.department` first: a directory that has already been through `attachDesignations`
    // carries it, and those callers pass no index.
    person?.department ?? facts?.department,
    person?.location ?? facts?.location,
    person?.employeeNo ?? facts?.employeeNo ?? facts?.employeeId,
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
      location: normaliseKey(facts?.location) || null,
      // Only when there is one: `User.employeeNo` is `string | undefined`, and writing `null` over
      // a code the user document already had would lose it.
      ...(normaliseKey(person.employeeNo) || normaliseKey(facts?.employeeNo)
        ? { employeeNo: normaliseKey(person.employeeNo) || normaliseKey(facts?.employeeNo) }
        : {}),
    } as T;
  });
}
