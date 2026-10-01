/**
 * Who acts on what in the Expenses module, and who stands in for them.
 *
 * Roles stay global (Settings › Access Management). This is the module's own answer to three
 * questions an administrator asks about Expenses alone:
 *   - **who will act** on each of the module's actions,
 *   - **what** each person acts on (every action is named, and some are scoped by department or
 *     by amount, so "who raises a request" can differ per department or above a threshold),
 *   - **who are the alternatives** when the first person is away.
 *
 * How much authority an assignment carries is itself a setting, per action (`ActionMode`):
 *   - `roles-only`  — the assignment is a record of responsibility; who may act is unchanged. The
 *                     default, so adding an assignment never quietly changes access.
 *   - `assigned-too` — the assignee and the alternates may act **as well as** anyone holding the
 *                     role permission. Widens access, deliberately.
 *   - `assigned-only` — only the assignee and the alternates may act. Narrows access; a role
 *                     permission on its own is no longer enough.
 *
 * Note this module's authority is otherwise a plain lookup over the merged permission map
 * (`useAuthorization`), which knows nothing of assignment — so every gate has to consult `mayAct`
 * for the two non-default modes to mean anything.
 *
 * Pure (no imports) so it runs under plain node for tests.
 */

/* ── the actions ────────────────────────────────────────────────────────────────────────────── */

export type ExpensesActionKey =
  | 'raise-request'
  | 'edit-request'
  | 'import-requests'
  | 'manage-accounts'
  | 'manage-serials'
  | 'field-control'
  | 'data-control'
  | 'gst-registrations'
  | 'view-reports'
  | 'export-reports'
  | 'view-audit';

export interface ExpensesActionDef {
  key: ExpensesActionKey;
  title: string;
  hint: string;
  /** The permission this action is gated by today, so the screen can say what a role alone allows. */
  permission: { action: string; section: string };
  /** Grouping on the settings screen. */
  group: 'Requests' | 'Masters' | 'Controls' | 'Reporting';
  /** Whether the assignment may differ per department. */
  departmentScoped: boolean;
  /** Whether the assignment may differ by the request's amount. */
  amountAware: boolean;
}

export const EXPENSES_ACTIONS: readonly ExpensesActionDef[] = [
  {
    key: 'raise-request',
    title: 'Raise an expense request',
    hint: 'Create a new request in a department.',
    permission: { action: 'Create', section: 'Expenses.Departments' },
    group: 'Requests',
    departmentScoped: true,
    amountAware: true,
  },
  {
    key: 'edit-request',
    title: 'Edit an expense request',
    hint: 'Change a request already raised.',
    permission: { action: 'Edit', section: 'Expenses.Departments' },
    group: 'Requests',
    departmentScoped: true,
    amountAware: true,
  },
  {
    key: 'import-requests',
    title: 'Import requests from Excel',
    hint: 'Bring a sheet of requests into a department register.',
    permission: { action: 'Create', section: 'Expenses.Departments' },
    group: 'Requests',
    departmentScoped: true,
    amountAware: false,
  },
  {
    key: 'manage-accounts',
    title: 'Manage Head / Sub-Head of A/c',
    hint: 'The account heads every request is booked under.',
    permission: { action: 'Manage Accounts', section: 'Expenses.Settings' },
    group: 'Masters',
    departmentScoped: false,
    amountAware: false,
  },
  {
    key: 'manage-serials',
    title: 'Set department serial numbers',
    hint: 'The request-number series each department draws from.',
    permission: { action: 'Edit Serial Nos', section: 'Expenses.Settings' },
    group: 'Masters',
    departmentScoped: true,
    amountAware: false,
  },
  {
    key: 'field-control',
    title: 'Change Field Control',
    hint: 'Which fields are shown, required and what they are called.',
    permission: { action: 'Edit', section: 'Expenses.Field Control' },
    group: 'Controls',
    departmentScoped: false,
    amountAware: false,
  },
  {
    key: 'data-control',
    title: 'Change Data Control',
    hint: 'Date windows, limits, duplicate warnings and import rules.',
    permission: { action: 'Edit', section: 'Expenses.Data Control' },
    group: 'Controls',
    departmentScoped: false,
    amountAware: false,
  },
  {
    key: 'gst-registrations',
    title: 'Change GST registrations',
    hint: "The company's GSTINs and how a bill is attributed to one.",
    permission: { action: 'Edit', section: 'Expenses.GST Registrations' },
    group: 'Controls',
    departmentScoped: false,
    amountAware: false,
  },
  {
    key: 'view-reports',
    title: 'View reports',
    hint: 'The Expenses report centre.',
    permission: { action: 'View', section: 'Expenses.Reports' },
    group: 'Reporting',
    departmentScoped: false,
    amountAware: false,
  },
  {
    key: 'export-reports',
    title: 'Export a report',
    hint: 'Download a report as Excel.',
    permission: { action: 'Export', section: 'Expenses.Reports' },
    group: 'Reporting',
    departmentScoped: false,
    amountAware: false,
  },
  {
    key: 'view-audit',
    title: 'View the audit log',
    hint: 'Who changed what in Expenses.',
    permission: { action: 'View', section: 'Expenses.Audit Log' },
    group: 'Reporting',
    departmentScoped: false,
    amountAware: false,
  },
] as const;

export const EXPENSES_ACTION_KEYS = EXPENSES_ACTIONS.map((action) => action.key);

export const expensesAction = (key: string): ExpensesActionDef | undefined =>
  EXPENSES_ACTIONS.find((action) => action.key === key);

export const EXPENSES_ACTION_GROUPS = ['Requests', 'Masters', 'Controls', 'Reporting'] as const;

/* ── who acts ───────────────────────────────────────────────────────────────────────────────── */

export type AssignmentType = 'users' | 'roles' | 'department' | 'amount';

export const ASSIGNMENT_LABELS: Record<AssignmentType, { title: string; hint: string }> = {
  users: { title: 'Named people', hint: 'The same people whatever the request.' },
  roles: { title: 'By role', hint: 'Whoever holds a role, with named people as the alternatives.' },
  department: { title: 'By department', hint: 'A different person per department.' },
  amount: { title: 'By amount', hint: 'A different person above or below a threshold.' },
};

export type ActionMode = 'roles-only' | 'assigned-too' | 'assigned-only';

export const MODE_LABELS: Record<ActionMode, { title: string; hint: string }> = {
  'roles-only': {
    title: 'Roles decide',
    hint: 'The assignment is recorded for reference only — who may act does not change.',
  },
  'assigned-too': {
    title: 'Assigned people too',
    hint: 'The assignee and the alternatives may act as well as anyone holding the role permission.',
  },
  'assigned-only': {
    title: 'Only assigned people',
    hint: 'Only the assignee and the alternatives may act. The role permission alone is not enough.',
  },
};

/** One primary / alternatives pair. Alternatives act when a primary cannot. */
export interface ActorPair {
  primary: string[];
  alternates: string[];
}

export const emptyPair = (): ActorPair => ({ primary: [], alternates: [] });

export interface AmountBand {
  id: string;
  /** Inclusive floor; null for "no floor". */
  from: number | null;
  /** Inclusive ceiling; null for "no ceiling". */
  to: number | null;
  primary: string[];
  alternates: string[];
}

export interface ExpensesActionAssignment {
  mode: ActionMode;
  type: AssignmentType;
  /** `type: 'users'`. */
  users: ActorPair;
  /** `type: 'roles'` — role ids as the primary, named people as the alternatives. */
  roles: ActorPair;
  /** `type: 'department'`, keyed by department id. */
  byDepartment: Record<string, ActorPair>;
  /** `type: 'amount'`, first matching band wins. */
  bands: AmountBand[];
}

export const emptyAssignment = (): ExpensesActionAssignment => ({
  mode: 'roles-only',
  type: 'users',
  users: emptyPair(),
  roles: emptyPair(),
  byDepartment: {},
  bands: [],
});

export interface ExpensesRolesDoc {
  actions: Record<string, ExpensesActionAssignment>;
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];

const asPair = (value: unknown): ActorPair => {
  const pair = (value ?? {}) as Partial<ActorPair>;
  return { primary: asStrings(pair.primary), alternates: asStrings(pair.alternates) };
};

const asNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** A stored document read back safely: unknown actions dropped, missing parts defaulted. */
export function resolveExpensesRolesDoc(raw: unknown): ExpensesRolesDoc {
  const stored = ((raw ?? {}) as Partial<ExpensesRolesDoc>).actions ?? {};
  const actions: Record<string, ExpensesActionAssignment> = {};
  for (const def of EXPENSES_ACTIONS) {
    const held = (stored as Record<string, unknown>)[def.key];
    const partial = (held ?? {}) as Partial<ExpensesActionAssignment>;
    const type: AssignmentType =
      partial.type === 'roles' || partial.type === 'department' || partial.type === 'amount' ? partial.type : 'users';
    actions[def.key] = {
      mode:
        partial.mode === 'assigned-too' || partial.mode === 'assigned-only' ? partial.mode : 'roles-only',
      // An action that cannot differ by department or amount can never hold that type.
      type:
        (type === 'department' && !def.departmentScoped) || (type === 'amount' && !def.amountAware) ? 'users' : type,
      users: asPair(partial.users),
      roles: asPair(partial.roles),
      byDepartment: Object.fromEntries(
        Object.entries((partial.byDepartment ?? {}) as Record<string, unknown>).map(([id, pair]) => [id, asPair(pair)]),
      ),
      bands: Array.isArray(partial.bands)
        ? partial.bands
            .filter((band): band is AmountBand => Boolean(band && typeof (band as AmountBand).id === 'string'))
            .map((band) => ({
              id: band.id,
              from: asNumberOrNull(band.from),
              to: asNumberOrNull(band.to),
              primary: asStrings(band.primary),
              alternates: asStrings(band.alternates),
            }))
        : [],
    };
  }
  return { actions };
}

export const assignmentFor = (doc: ExpensesRolesDoc, key: ExpensesActionKey): ExpensesActionAssignment =>
  doc.actions[key] ?? emptyAssignment();

/* ── resolving ──────────────────────────────────────────────────────────────────────────────── */

export interface ActionContext {
  /** The department the request belongs to. */
  departmentId?: string;
  /** The request's amount, for an amount-banded assignment. */
  amount?: number;
}

export const bandMatches = (band: AmountBand, amount: number): boolean =>
  (band.from === null || amount >= band.from) && (band.to === null || amount <= band.to);

/**
 * Who acts on an action in this context. `roleIds` is filled only for a by-role assignment, where
 * the primary is a role rather than a person.
 */
export function actorsFor(
  assignment: ExpensesActionAssignment,
  context: ActionContext = {},
): { primary: string[]; alternates: string[]; roleIds: string[]; band?: AmountBand } {
  switch (assignment.type) {
    case 'roles':
      return { primary: [], alternates: assignment.roles.alternates, roleIds: assignment.roles.primary };
    case 'department': {
      const pair = (context.departmentId ? assignment.byDepartment[context.departmentId] : undefined) ?? emptyPair();
      return { primary: pair.primary, alternates: pair.alternates, roleIds: [] };
    }
    case 'amount': {
      const amount = Number(context.amount) || 0;
      const band = assignment.bands.find((candidate) => bandMatches(candidate, amount));
      return { primary: band?.primary ?? [], alternates: band?.alternates ?? [], roleIds: [], band };
    }
    default:
      return { primary: assignment.users.primary, alternates: assignment.users.alternates, roleIds: [] };
  }
}

/** Whether an assignment names anybody at all in this context. */
export function hasActors(assignment: ExpensesActionAssignment, context: ActionContext = {}): boolean {
  const actors = actorsFor(assignment, context);
  return actors.primary.length > 0 || actors.alternates.length > 0 || actors.roleIds.length > 0;
}

export type ActionBasis = 'role' | 'primary' | 'alternate' | 'assigned-role' | 'none';

export interface ActionDecision {
  allowed: boolean;
  basis: ActionBasis;
  mode: ActionMode;
  /** Why, in words — for a tooltip or a refusal. */
  reason: string;
}

export interface Actor {
  userId: string;
  /** The role ids the user holds, for a by-role assignment. */
  roleIds?: string[];
}

/**
 * Whether this person may perform this action.
 *
 * `hasPermission` is what the role/permission map already says (`can(action, section)`), passed in
 * so this stays pure. The mode then decides whether the assignment widens that, narrows it, or
 * leaves it alone. An action set to `assigned-only` with nobody assigned falls back to the
 * permission rather than locking the action out of the app entirely.
 */
export function mayAct(
  assignment: ExpensesActionAssignment,
  actor: Actor,
  hasPermission: boolean,
  context: ActionContext = {},
): ActionDecision {
  const actors = actorsFor(assignment, context);
  const roleIds = actor.roleIds ?? [];
  const isPrimary = actors.primary.includes(actor.userId);
  const isAlternate = actors.alternates.includes(actor.userId);
  const byAssignedRole = actors.roleIds.some((roleId) => roleIds.includes(roleId));
  const named: ActionBasis = isPrimary ? 'primary' : isAlternate ? 'alternate' : byAssignedRole ? 'assigned-role' : 'none';
  const namedReason =
    named === 'primary'
      ? 'Assigned to you'
      : named === 'alternate'
        ? 'You are the alternative for this'
        : 'Your role allows it';

  switch (assignment.mode) {
    case 'assigned-too':
      if (named !== 'none') return { allowed: true, basis: named, mode: assignment.mode, reason: namedReason };
      return {
        allowed: hasPermission,
        basis: hasPermission ? 'role' : 'none',
        mode: assignment.mode,
        reason: hasPermission ? 'Your role allows it' : 'Not assigned to you, and your role does not allow it',
      };

    case 'assigned-only': {
      if (!hasActors(assignment, context)) {
        return {
          allowed: hasPermission,
          basis: hasPermission ? 'role' : 'none',
          mode: assignment.mode,
          // Nobody named: narrowing to nobody would take the action away from everyone.
          reason: hasPermission ? 'Nobody is assigned, so your role decides' : 'Your role does not allow it',
        };
      }
      if (named !== 'none') return { allowed: true, basis: named, mode: assignment.mode, reason: namedReason };
      return {
        allowed: false,
        basis: 'none',
        mode: assignment.mode,
        reason: 'This action is restricted to the people assigned to it',
      };
    }

    default:
      return {
        allowed: hasPermission,
        basis: hasPermission ? 'role' : 'none',
        mode: 'roles-only',
        reason: hasPermission ? 'Your role allows it' : 'Your role does not allow it',
      };
  }
}

/* ── checking the set-up ────────────────────────────────────────────────────────────────────── */

export interface RolesIssue {
  severity: 'error' | 'warning';
  /** The action it concerns, or `''` for the whole set-up. */
  actionKey: string;
  message: string;
}

/**
 * What is wrong or risky about the assignments. `knownUserIds` and `knownRoleIds`, when given, catch
 * an assignment left pointing at someone who has since gone.
 */
export function validateExpensesRoles(
  doc: ExpensesRolesDoc,
  known: { userIds?: readonly string[]; roleIds?: readonly string[]; departmentIds?: readonly string[] } = {},
): RolesIssue[] {
  const issues: RolesIssue[] = [];
  const users = known.userIds ? new Set(known.userIds) : null;
  const roles = known.roleIds ? new Set(known.roleIds) : null;

  for (const def of EXPENSES_ACTIONS) {
    const assignment = assignmentFor(doc, def.key);
    const enforced = assignment.mode !== 'roles-only';
    const actors = actorsFor(assignment, {});

    if (enforced && assignment.type === 'users' && actors.primary.length === 0) {
      issues.push({
        severity: 'error',
        actionKey: def.key,
        message: `${def.title}: nobody is assigned, but the assignment is being enforced.`,
      });
    }
    if (enforced && assignment.type === 'roles' && assignment.roles.primary.length === 0) {
      issues.push({ severity: 'error', actionKey: def.key, message: `${def.title}: no role is assigned.` });
    }
    if (enforced && assignment.type === 'department' && Object.keys(assignment.byDepartment).length === 0) {
      issues.push({ severity: 'error', actionKey: def.key, message: `${def.title}: no department is mapped.` });
    }
    if (assignment.type === 'amount') {
      if (enforced && assignment.bands.length === 0) {
        issues.push({ severity: 'error', actionKey: def.key, message: `${def.title}: no amount band is set.` });
      }
      // A gap at the top means a large request matches nothing and silently falls through.
      if (assignment.bands.length > 0 && !assignment.bands.some((band) => band.to === null)) {
        issues.push({
          severity: 'warning',
          actionKey: def.key,
          message: `${def.title}: no band covers the largest amounts — add one with no ceiling.`,
        });
      }
      for (const band of assignment.bands) {
        if (band.from !== null && band.to !== null && band.from > band.to) {
          issues.push({ severity: 'error', actionKey: def.key, message: `${def.title}: a band's floor is above its ceiling.` });
        }
        if (enforced && band.primary.length === 0) {
          issues.push({ severity: 'warning', actionKey: def.key, message: `${def.title}: an amount band has nobody assigned.` });
        }
      }
    }
    if (assignment.mode !== 'roles-only' && !hasActors(assignment, {}) && assignment.type !== 'department' && assignment.type !== 'amount') {
      // Covered by the errors above; nothing further to add.
    }

    // People and roles that no longer exist.
    const everyUser = [
      ...assignment.users.primary,
      ...assignment.users.alternates,
      ...assignment.roles.alternates,
      ...Object.values(assignment.byDepartment).flatMap((pair) => [...pair.primary, ...pair.alternates]),
      ...assignment.bands.flatMap((band) => [...band.primary, ...band.alternates]),
    ];
    if (users) {
      for (const userId of [...new Set(everyUser)]) {
        if (!users.has(userId)) {
          issues.push({ severity: 'warning', actionKey: def.key, message: `${def.title}: a person assigned no longer exists.` });
          break;
        }
      }
    }
    if (roles) {
      for (const roleId of assignment.roles.primary) {
        if (!roles.has(roleId)) {
          issues.push({ severity: 'warning', actionKey: def.key, message: `${def.title}: a role assigned no longer exists.` });
          break;
        }
      }
    }
    if (enforced && actors.primary.length > 0 && actors.alternates.length === 0 && assignment.type === 'users') {
      issues.push({
        severity: 'warning',
        actionKey: def.key,
        message: `${def.title}: no alternative, so nobody can act while the assignee is away.`,
      });
    }
  }
  return issues;
}

/** A flat, readable shape for the audit log's before/after. */
export function flattenExpensesRoles(
  doc: ExpensesRolesDoc,
  nameOf: (id: string) => string,
  departmentName: (id: string) => string,
): Record<string, string> {
  const flat: Record<string, string> = {};
  const list = (ids: readonly string[]) => (ids.length ? ids.map(nameOf).join(', ') : '—');
  for (const def of EXPENSES_ACTIONS) {
    const assignment = assignmentFor(doc, def.key);
    flat[`${def.title} · authority`] = MODE_LABELS[assignment.mode].title;
    flat[`${def.title} · assigned by`] = ASSIGNMENT_LABELS[assignment.type].title;
    switch (assignment.type) {
      case 'roles':
        flat[`${def.title} · roles`] = list(assignment.roles.primary);
        flat[`${def.title} · alternatives`] = list(assignment.roles.alternates);
        break;
      case 'department':
        for (const [departmentId, pair] of Object.entries(assignment.byDepartment)) {
          flat[`${def.title} · ${departmentName(departmentId)}`] = `${list(pair.primary)} (alt ${list(pair.alternates)})`;
        }
        break;
      case 'amount':
        for (const band of assignment.bands) {
          const range = `${band.from === null ? 'any' : band.from} – ${band.to === null ? 'any' : band.to}`;
          flat[`${def.title} · ${range}`] = `${list(band.primary)} (alt ${list(band.alternates)})`;
        }
        break;
      default:
        flat[`${def.title} · people`] = list(assignment.users.primary);
        flat[`${def.title} · alternatives`] = list(assignment.users.alternates);
    }
  }
  return flat;
}
