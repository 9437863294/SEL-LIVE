/**
 * The additive access layer: how a user's effective permissions are computed from every source
 * that can grant them (`docs/access-management.md`).
 *
 * Dependency-free on purpose, exactly as `hr-policy.ts` and `e-approval-policy.ts` are: this module
 * runs in the browser, inside Admin-SDK routes and under `node --test` without a Firestore
 * emulator. Anything that touches Firestore belongs in `access-control-service.ts` (client) or
 * `access-control-server.ts` (Admin SDK); anything that renders belongs in
 * `src/components/access-management`. If a rule can be expressed as "inputs → decision", it goes
 * here.
 *
 * ── The one idea the whole module rests on ──────────────────────────────────────────────────────
 *
 * **Granting is a union, never an assignment.** The pre-existing authorisation system — a single
 * role name on `users.role`, resolved against `roles/{doc}.permissions` — keeps working untouched
 * and keeps being the *base* of every calculation. Everything this module adds is layered on top:
 *
 *     Effective = BaseRole ∪ AdditionalRoles ∪ Direct ∪ Department ∪ Designation
 *                 ∪ Project ∪ Temporary(unexpired)
 *
 * `mergePermissionMaps` is the only way permissions are ever combined, and it is incapable of
 * removing a key. That is not a convention to remember — it is why `assertAdditive` can be called
 * on every write path and never needs a special case.
 *
 * Four other decisions worth knowing before reading on:
 *
 *   1. **Grants are stored, effective permissions are computed.** Nothing writes a flattened
 *      permission array back onto the user. A role edited in Role Management therefore reaches
 *      everybody holding it — additionally-assigned or not — with no re-assignment step, and
 *      removing one source cannot take away what another source still grants (§17).
 *
 *   2. **Every grant carries its own provenance.** `assignedBy`, `assignedAt`, `reason` and
 *      `batchId` live on the grant entry, not in a side table. "Why does this user have Expense
 *      Approve?" is `explainPermission`, a lookup over data already in hand, rather than a
 *      reconstruction from audit logs.
 *
 *   3. **Scoped permissions reuse the convention the app already has.** `useAuthorization`'s
 *      `can(action, resource, scope)` already checks `${resource}.${scope}` — which is how
 *      `Expenses.Departments.<deptId>` works today. Project-scoped grants expand into exactly that
 *      shape, so a project grant is enforceable by the existing checker with no changes to it.
 *
 *   4. **Expiry is evaluated, not swept.** A temporary grant past its expiry contributes nothing to
 *      the effective set from the instant it lapses, with no cron and no deletion — so the audit
 *      history of what somebody once held stays intact (§22).
 */

/* ------------------------------------------------------------------------------------------------
 * Core shapes
 * ---------------------------------------------------------------------------------------------- */

/**
 * A set of granted permissions: dotted resource key → allowed actions.
 *
 * This is the exact shape `roles/{doc}.permissions` has held since the app was written, and the
 * exact shape `AuthProvider` puts into context. Keys look like `"Project Management"`,
 * `"Project Management.Tower Progress"` or `"E-Approval.Settings.Approval Types"`.
 */
export type PermissionMap = Record<string, string[]>;

/** Where a permission came from. The labels §8 of the specification asks to be shown. */
export type AccessSourceKind =
  | 'Existing'
  | 'Base Role'
  | 'Additional Role'
  | 'Direct Permission'
  | 'Department'
  | 'Designation'
  | 'Project'
  | 'Temporary'
  | 'System';

/** One reason a user holds one permission. A permission usually has several. */
export interface PermissionSource {
  kind: AccessSourceKind;
  /** What to show in the badge — a role name, a project name, "Direct". */
  label: string;
  /** Role doc id, project id, department id, template id — whatever identifies the grant. */
  refId?: string;
  assignedBy?: string;
  assignedByName?: string;
  /** ISO timestamp. */
  assignedAt?: string;
  reason?: string;
  batchId?: string;
  /** ISO timestamp, present only on time-boxed grants. */
  expiresAt?: string;
}

/** The minimum of a role document this module needs. Structural, so `Role` from types.ts matches. */
export interface RoleLike {
  id: string;
  name: string;
  permissions?: PermissionMap | null;
  description?: string | null;
  status?: string | null;
  type?: string | null;
}

/** Audit provenance shared by every kind of grant. */
export interface GrantProvenance {
  assignedBy?: string;
  assignedByName?: string;
  /** ISO timestamp. */
  assignedAt?: string;
  reason?: string;
  batchId?: string;
  templateId?: string;
}

/** An additional role assigned on top of whatever the user already had. */
export interface RoleAssignment extends GrantProvenance {
  roleId: string;
  roleName: string;
  /** ISO timestamp; before this the grant is not yet in force. Absent means "in force now". */
  startAt?: string | null;
  /** ISO timestamp; after this the grant lapses. Absent means "does not expire". */
  expiresAt?: string | null;
}

/** A permission granted straight to one person, bypassing roles entirely. */
export interface DirectPermissionGrant extends GrantProvenance {
  /** Dotted resource key, e.g. `"Bank Guarantee Management.Reports"`. */
  resource: string;
  actions: string[];
  startAt?: string | null;
  expiresAt?: string | null;
}

/** Access to one project or site, optionally carrying project-scoped permissions. */
export interface ProjectAccessGrant extends GrantProvenance {
  projectId: string;
  projectName?: string;
  /**
   * Permissions that apply *only* within this project. Expanded at resolve time into the
   * `${resource}.${projectId}` keys `can(action, resource, scope)` already understands.
   */
  permissions?: PermissionMap | null;
  /** Roles whose permissions apply only within this project. */
  roleIds?: string[];
  startAt?: string | null;
  expiresAt?: string | null;
}

/** Time-boxed access — the "Finance approval for 15 days" case of §22. */
export interface TemporaryAccessGrant extends GrantProvenance {
  id: string;
  roleId?: string;
  roleName?: string;
  permissions?: PermissionMap | null;
  /** ISO timestamp. */
  startAt: string;
  /** ISO timestamp. */
  expiresAt: string;
  reason: string;
  requestedBy?: string;
  requestedByName?: string;
  approvedBy?: string;
  approvedByName?: string;
  /** Set when an administrator ended it early. Revoked grants never contribute. */
  revokedAt?: string | null;
  revokedBy?: string;
}

/**
 * The `accessGrants/{userId}` document — everything this layer adds for one person.
 *
 * A user with no document has exactly the permissions their base role gives them, which is every
 * user in the system on the day this ships.
 */
export interface UserAccessGrant {
  userId: string;
  additionalRoles: RoleAssignment[];
  directPermissions: DirectPermissionGrant[];
  departmentIds: string[];
  designations: string[];
  projectAccess: ProjectAccessGrant[];
  temporaryAccess: TemporaryAccessGrant[];
  /**
   * Suspending the additive layer without deleting it. `'Suspended'` drops every additional grant
   * from the effective set; the base role is untouched, so the user keeps their original access.
   */
  status?: 'Active' | 'Suspended';
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: string;
}

/** What a department, designation or project grants to everybody in it (§21). */
export interface ScopeGrantConfig extends GrantProvenance {
  id: string;
  scopeType: 'Department' | 'Designation' | 'Project';
  /** Department doc id, designation name, or project doc id. */
  scopeId: string;
  scopeName?: string;
  roleIds: string[];
  roleNames?: string[];
  permissions?: PermissionMap | null;
  active?: boolean;
}

/** A reusable bundle an administrator can apply to one or many users (§24). */
export interface AccessTemplate extends GrantProvenance {
  id: string;
  name: string;
  description?: string;
  roleIds: string[];
  roleNames?: string[];
  permissions?: PermissionMap | null;
  projectIds?: string[];
  active?: boolean;
  createdAt?: string;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** The computed answer: what this user can actually do, and why. */
export interface EffectiveAccess {
  userId: string;
  permissions: PermissionMap;
  /** `${resource}::${action}` → every reason the user holds it. Never empty for a held action. */
  sources: Record<string, PermissionSource[]>;
  baseRoleName: string | null;
  additionalRoleNames: string[];
  /** Base plus additional plus temporary — every role name that is in force right now. */
  effectiveRoleNames: string[];
  projectIds: string[];
  departmentIds: string[];
  designations: string[];
  /** Top-level module names the user can open at all. */
  modules: string[];
  temporaryActive: TemporaryAccessGrant[];
  temporaryExpired: TemporaryAccessGrant[];
  temporaryUpcoming: TemporaryAccessGrant[];
  /** Total distinct `resource::action` pairs. The number the UI shows as "permissions". */
  permissionCount: number;
}

/* ------------------------------------------------------------------------------------------------
 * Small shared helpers
 * ---------------------------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

/** The separator between a resource and an action in a source key. */
export const PERMISSION_KEY_SEPARATOR = '::';

export const permissionKey = (resource: string, action: string): string =>
  `${resource}${PERMISSION_KEY_SEPARATOR}${action}`;

export const splitPermissionKey = (key: string): { resource: string; action: string } => {
  const at = key.lastIndexOf(PERMISSION_KEY_SEPARATOR);
  if (at < 0) return { resource: key, action: '' };
  return { resource: key.slice(0, at), action: key.slice(at + PERMISSION_KEY_SEPARATOR.length) };
};

/** The module a dotted resource key belongs to. `"A.B.C"` → `"A"`. */
export const moduleOfResource = (resource: string): string => resource.split('.')[0] || resource;

const toTime = (value: Date | number | string | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const nowMs = (now?: Date | number | string): number => toTime(now ?? Date.now()) ?? Date.now();

const uniqueStrings = (values: Iterable<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

/**
 * Normalise whatever a role document actually holds into a `PermissionMap`.
 *
 * Role documents in this codebase are flat dotted-key maps, but `useAuthorization` also walks
 * nested objects, and nothing has ever stopped a role from being written that way. Flattening on
 * read means the resolver has one shape to reason about and a hand-edited nested document cannot
 * silently contribute nothing.
 */
export function normalizePermissionMap(input: unknown, prefix = ''): PermissionMap {
  const out: PermissionMap = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      const actions = uniqueStrings(value.map((item) => (typeof item === 'string' ? item : '')));
      if (actions.length) out[fullKey] = actions;
      continue;
    }
    if (value && typeof value === 'object') {
      Object.assign(out, normalizePermissionMap(value, fullKey));
    }
  }
  return out;
}

/** Deterministic ordering, so two equal permission sets serialise identically in audit records. */
export function sortPermissionMap(map: PermissionMap): PermissionMap {
  const out: PermissionMap = {};
  for (const key of Object.keys(map).sort()) {
    const actions = map[key];
    if (Array.isArray(actions) && actions.length) out[key] = [...actions].sort();
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Merging — the operation the entire layer depends on
 * ---------------------------------------------------------------------------------------------- */

/**
 * Union of any number of permission maps.
 *
 * The single most important function in this module, and deliberately the dullest: it adds keys and
 * adds actions, and there is no code path through it that drops either. §6 and §47 of the
 * specification — "assigning a role must never replace what somebody already had" — are satisfied
 * structurally here rather than by discipline at every call site.
 *
 * Idempotent: merging the same map twice produces the same result, so re-assigning a role somebody
 * already holds is a no-op rather than a duplicate.
 */
export function mergePermissionMaps(...maps: Array<PermissionMap | null | undefined>): PermissionMap {
  const out: PermissionMap = {};
  for (const map of maps) {
    const normalized = normalizePermissionMap(map);
    for (const [resource, actions] of Object.entries(normalized)) {
      const existing = out[resource];
      out[resource] = existing ? uniqueStrings([...existing, ...actions]) : [...actions];
    }
  }
  return sortPermissionMap(out);
}

/** Every `resource::action` pair in a map, as a flat set. */
export function permissionPairs(map: PermissionMap | null | undefined): Set<string> {
  const out = new Set<string>();
  const normalized = normalizePermissionMap(map);
  for (const [resource, actions] of Object.entries(normalized)) {
    for (const action of actions) out.add(permissionKey(resource, action));
  }
  return out;
}

/** How many distinct `resource::action` pairs a map grants. The UI's "43 permissions". */
export const countPermissions = (map: PermissionMap | null | undefined): number =>
  permissionPairs(map).size;

export interface PermissionDiff {
  /** Pairs present in `after` but not `before`. */
  added: string[];
  /** Pairs present in `before` but not `after`. Must be empty for any "Add Access" operation. */
  removed: string[];
  /** Pairs in both — the "Already Assigned" of §16. */
  unchanged: string[];
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
}

/**
 * What changes between two permission sets, as `resource::action` pairs.
 *
 * Powers the pre-save preview (§15), the duplicate detection (§16) and the post-save summary (§34).
 * `removed` existing at all is what lets the UI make the promise it makes — a preview that says
 * "Existing permissions removed: 0" is reading this, not asserting it.
 */
export function diffPermissionMaps(
  before: PermissionMap | null | undefined,
  after: PermissionMap | null | undefined,
): PermissionDiff {
  const beforePairs = permissionPairs(before);
  const afterPairs = permissionPairs(after);

  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  for (const pair of afterPairs) {
    if (beforePairs.has(pair)) unchanged.push(pair);
    else added.push(pair);
  }
  for (const pair of beforePairs) {
    if (!afterPairs.has(pair)) removed.push(pair);
  }

  added.sort();
  removed.sort();
  unchanged.sort();

  return {
    added,
    removed,
    unchanged,
    addedCount: added.length,
    removedCount: removed.length,
    unchangedCount: unchanged.length,
  };
}

/**
 * Guard for every "Add Access" write path: throw rather than let a grant reduce somebody's access.
 *
 * §47 forbids silent permission removal, and the honest way to keep that promise is to check it at
 * the point of writing rather than to trust that the code above computed a union. If this ever
 * throws, the bug is upstream and the user has lost nothing.
 */
export function assertAdditive(
  before: PermissionMap | null | undefined,
  after: PermissionMap | null | undefined,
  context = 'access assignment',
): void {
  const { removed } = diffPermissionMaps(before, after);
  if (removed.length) {
    throw new Error(
      `${context} would remove ${removed.length} existing permission(s): ${removed.slice(0, 5).join(', ')}` +
        `${removed.length > 5 ? ', …' : ''}. Additive operations must never reduce access.`,
    );
  }
}

/**
 * Subtract one map from another. Used only by the explicit removal workflow (§17), never by
 * "Add Access" — which is why it is not called `mergePermissionMaps`'s opposite anywhere in the UI.
 */
export function subtractPermissionMaps(
  base: PermissionMap | null | undefined,
  toRemove: PermissionMap | null | undefined,
): PermissionMap {
  const out = normalizePermissionMap(base);
  const remove = normalizePermissionMap(toRemove);
  for (const [resource, actions] of Object.entries(remove)) {
    const existing = out[resource];
    if (!existing) continue;
    const kept = existing.filter((action) => !actions.includes(action));
    if (kept.length) out[resource] = kept;
    else delete out[resource];
  }
  return sortPermissionMap(out);
}

/** A map holding only the pairs both inputs grant. Powers "6 already available" in the preview. */
export function intersectPermissionMaps(
  a: PermissionMap | null | undefined,
  b: PermissionMap | null | undefined,
): PermissionMap {
  const left = normalizePermissionMap(a);
  const rightPairs = permissionPairs(b);
  const out: PermissionMap = {};
  for (const [resource, actions] of Object.entries(left)) {
    const kept = actions.filter((action) => rightPairs.has(permissionKey(resource, action)));
    if (kept.length) out[resource] = kept;
  }
  return sortPermissionMap(out);
}

/* ------------------------------------------------------------------------------------------------
 * Grant lifecycle
 * ---------------------------------------------------------------------------------------------- */

interface WindowedGrant {
  startAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
}

/**
 * Is this grant in force at `now`?
 *
 * A grant with neither bound is permanent — which is the overwhelmingly common case, and the reason
 * `startAt`/`expiresAt` are optional everywhere rather than defaulted to sentinel dates.
 */
export function isGrantActive(grant: WindowedGrant, now?: Date | number | string): boolean {
  if (grant.revokedAt) return false;
  const at = nowMs(now);
  const start = toTime(grant.startAt);
  const end = toTime(grant.expiresAt);
  if (start !== null && at < start) return false;
  if (end !== null && at > end) return false;
  return true;
}

export type TemporaryGrantState = 'Active' | 'Upcoming' | 'Expired' | 'Revoked';

export function temporaryGrantState(
  grant: TemporaryAccessGrant,
  now?: Date | number | string,
): TemporaryGrantState {
  if (grant.revokedAt) return 'Revoked';
  const at = nowMs(now);
  const start = toTime(grant.startAt);
  const end = toTime(grant.expiresAt);
  if (start !== null && at < start) return 'Upcoming';
  if (end !== null && at > end) return 'Expired';
  return 'Active';
}

/** Whole days until a temporary grant lapses. Negative once it has. Powers "Expiring Soon". */
export function daysUntilExpiry(
  grant: WindowedGrant,
  now?: Date | number | string,
): number | null {
  const end = toTime(grant.expiresAt);
  if (end === null) return null;
  return Math.ceil((end - nowMs(now)) / DAY_MS);
}

/** Temporary grants lapsing within `withinDays`, soonest first. §37's "Access Expiring Soon". */
export function expiringTemporaryGrants(
  grants: TemporaryAccessGrant[],
  withinDays = 7,
  now?: Date | number | string,
): TemporaryAccessGrant[] {
  return grants
    .filter((grant) => {
      if (temporaryGrantState(grant, now) !== 'Active') return false;
      const days = daysUntilExpiry(grant, now);
      return days !== null && days <= withinDays;
    })
    .sort((a, b) => (toTime(a.expiresAt) ?? 0) - (toTime(b.expiresAt) ?? 0));
}

/** An empty grant document, so callers never have to null-check the additive layer. */
export function emptyUserAccessGrant(userId: string): UserAccessGrant {
  return {
    userId,
    additionalRoles: [],
    directPermissions: [],
    departmentIds: [],
    designations: [],
    projectAccess: [],
    temporaryAccess: [],
    status: 'Active',
  };
}

/** Tolerant reader for a Firestore document that may predate any given field. */
export function normalizeUserAccessGrant(
  userId: string,
  raw: Partial<UserAccessGrant> | null | undefined,
): UserAccessGrant {
  const base = emptyUserAccessGrant(userId);
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    userId,
    additionalRoles: Array.isArray(raw.additionalRoles) ? raw.additionalRoles : [],
    directPermissions: Array.isArray(raw.directPermissions) ? raw.directPermissions : [],
    departmentIds: Array.isArray(raw.departmentIds) ? uniqueStrings(raw.departmentIds) : [],
    designations: Array.isArray(raw.designations) ? uniqueStrings(raw.designations) : [],
    projectAccess: Array.isArray(raw.projectAccess) ? raw.projectAccess : [],
    temporaryAccess: Array.isArray(raw.temporaryAccess) ? raw.temporaryAccess : [],
    status: raw.status === 'Suspended' ? 'Suspended' : 'Active',
  };
}

/* ------------------------------------------------------------------------------------------------
 * The resolver
 * ---------------------------------------------------------------------------------------------- */

export interface ResolveAccessUser {
  id: string;
  name?: string | null;
  email?: string | null;
  /** The legacy single-role field. Still the base of everything. */
  role?: string | null;
  status?: string | null;
}

export interface ResolveAccessInput {
  user: ResolveAccessUser;
  /** Every role in the system. Looked up by both id and name — `users.role` holds a name. */
  roles: RoleLike[];
  grant?: Partial<UserAccessGrant> | null;
  /** Department / designation / project grant configuration, if any is set up. */
  scopeGrants?: ScopeGrantConfig[];
  now?: Date | number | string;
}

/**
 * Expand a project-scoped permission map into the `${resource}.${projectId}` keys the existing
 * checker already resolves through `can(action, resource, scope)`.
 *
 * Reusing the convention rather than inventing `project:rayagada:towers.view` means a project grant
 * is enforced by code that shipped years ago and has been exercised by `Expenses.Departments.*`
 * ever since — no checker changes, no second lookup path to keep in sync.
 */
export function scopePermissionMap(map: PermissionMap | null | undefined, scopeId: string): PermissionMap {
  const normalized = normalizePermissionMap(map);
  const out: PermissionMap = {};
  for (const [resource, actions] of Object.entries(normalized)) {
    out[`${resource}.${scopeId}`] = [...actions];
  }
  return sortPermissionMap(out);
}

interface Contribution {
  permissions: PermissionMap;
  source: PermissionSource;
}

/**
 * Compute everything a user can do, and record why for every single action.
 *
 * The order contributions are collected in is the order badges appear in the UI, which is why base
 * role comes first: an administrator troubleshooting access reads the original grant before the
 * additions, and §8's table is laid out that way.
 */
export function resolveEffectiveAccess(input: ResolveAccessInput): EffectiveAccess {
  const { user, roles, scopeGrants = [] } = input;
  const grant = normalizeUserAccessGrant(user.id, input.grant);
  const at = input.now ?? Date.now();

  const rolesById = new Map<string, RoleLike>();
  const rolesByName = new Map<string, RoleLike>();
  for (const role of roles) {
    if (role?.id) rolesById.set(role.id, role);
    if (role?.name) rolesByName.set(role.name, role);
  }
  const roleOf = (idOrName: string | null | undefined): RoleLike | undefined => {
    if (!idOrName) return undefined;
    return rolesById.get(idOrName) ?? rolesByName.get(idOrName);
  };
  /**
   * A disabled role stops granting — but only if it was explicitly disabled. Every role document
   * that exists today has no `status` field at all, and treating "absent" as anything but active
   * would revoke the entire application's permissions on deploy.
   */
  const roleIsActive = (role: RoleLike | undefined): boolean =>
    !!role && role.status !== 'Inactive' && role.status !== 'Disabled';

  const contributions: Contribution[] = [];

  /* ---- 1. Base role: the pre-existing system, untouched ---- */

  const baseRoleName = (user.role || '').trim() || null;
  const baseRole = roleOf(baseRoleName);
  if (baseRole && roleIsActive(baseRole)) {
    contributions.push({
      permissions: normalizePermissionMap(baseRole.permissions),
      source: { kind: 'Base Role', label: baseRole.name, refId: baseRole.id },
    });
  }

  /**
   * A suspended additive layer contributes nothing — but the base role above has already been
   * collected, so suspension removes only what this module added. Suspending must never be able to
   * take away access the user had before this module existed.
   */
  const additiveEnabled = grant.status !== 'Suspended' && user.status !== 'Inactive';

  /* ---- 2. Additional roles ---- */

  const additionalRoleNames: string[] = [];
  if (additiveEnabled) {
    for (const assignment of grant.additionalRoles) {
      if (!isGrantActive(assignment, at)) continue;
      const role = roleOf(assignment.roleId) ?? roleOf(assignment.roleName);
      if (!roleIsActive(role)) continue;
      additionalRoleNames.push(role!.name);
      contributions.push({
        permissions: normalizePermissionMap(role!.permissions),
        source: {
          kind: 'Additional Role',
          label: role!.name,
          refId: role!.id,
          assignedBy: assignment.assignedBy,
          assignedByName: assignment.assignedByName,
          assignedAt: assignment.assignedAt,
          reason: assignment.reason,
          batchId: assignment.batchId,
          expiresAt: assignment.expiresAt ?? undefined,
        },
      });
    }
  }

  /* ---- 3. Direct permissions ---- */

  if (additiveEnabled) {
    for (const direct of grant.directPermissions) {
      if (!direct?.resource || !Array.isArray(direct.actions) || !direct.actions.length) continue;
      if (!isGrantActive(direct, at)) continue;
      contributions.push({
        permissions: { [direct.resource]: uniqueStrings(direct.actions) },
        source: {
          kind: 'Direct Permission',
          label: 'Direct',
          assignedBy: direct.assignedBy,
          assignedByName: direct.assignedByName,
          assignedAt: direct.assignedAt,
          reason: direct.reason,
          batchId: direct.batchId,
          expiresAt: direct.expiresAt ?? undefined,
        },
      });
    }
  }

  /* ---- 4 & 5. Department and designation scope grants ---- */

  const departmentIds = additiveEnabled ? grant.departmentIds : [];
  const designations = additiveEnabled ? grant.designations : [];

  const applyScopeGrants = (
    kind: Extract<AccessSourceKind, 'Department' | 'Designation' | 'Project'>,
    scopeType: ScopeGrantConfig['scopeType'],
    memberOf: string[],
  ) => {
    for (const config of scopeGrants) {
      if (config.scopeType !== scopeType) continue;
      if (config.active === false) continue;
      if (!memberOf.includes(config.scopeId)) continue;

      const roleMaps = (config.roleIds || [])
        .map((roleId) => roleOf(roleId))
        .filter((role): role is RoleLike => roleIsActive(role))
        .map((role) => normalizePermissionMap(role.permissions));

      const combined = mergePermissionMaps(...roleMaps, config.permissions);
      if (!Object.keys(combined).length) continue;

      contributions.push({
        permissions: kind === 'Project' ? scopePermissionMap(combined, config.scopeId) : combined,
        source: {
          kind,
          label: config.scopeName || config.scopeId,
          refId: config.scopeId,
          assignedBy: config.assignedBy,
          assignedByName: config.assignedByName,
          assignedAt: config.assignedAt,
          reason: config.reason,
        },
      });
    }
  };

  if (additiveEnabled) {
    applyScopeGrants('Department', 'Department', departmentIds);
    applyScopeGrants('Designation', 'Designation', designations);
  }

  /* ---- 6. Project / site access ---- */

  const projectIds: string[] = [];
  if (additiveEnabled) {
    for (const project of grant.projectAccess) {
      if (!project?.projectId) continue;
      if (!isGrantActive(project, at)) continue;
      projectIds.push(project.projectId);

      const roleMaps = (project.roleIds || [])
        .map((roleId) => roleOf(roleId))
        .filter((role): role is RoleLike => roleIsActive(role))
        .map((role) => normalizePermissionMap(role.permissions));

      const combined = mergePermissionMaps(...roleMaps, project.permissions);
      if (!Object.keys(combined).length) continue;

      contributions.push({
        permissions: scopePermissionMap(combined, project.projectId),
        source: {
          kind: 'Project',
          label: project.projectName || project.projectId,
          refId: project.projectId,
          assignedBy: project.assignedBy,
          assignedByName: project.assignedByName,
          assignedAt: project.assignedAt,
          reason: project.reason,
          batchId: project.batchId,
          expiresAt: project.expiresAt ?? undefined,
        },
      });
    }
    // Project scope-grant configuration applies to every project the user is assigned to.
    applyScopeGrants('Project', 'Project', projectIds);
  }

  /* ---- 7. Temporary access ---- */

  const temporaryActive: TemporaryAccessGrant[] = [];
  const temporaryExpired: TemporaryAccessGrant[] = [];
  const temporaryUpcoming: TemporaryAccessGrant[] = [];
  const temporaryRoleNames: string[] = [];

  for (const temp of grant.temporaryAccess) {
    if (!temp?.id) continue;
    const state = temporaryGrantState(temp, at);
    if (state === 'Upcoming') temporaryUpcoming.push(temp);
    else if (state === 'Active') temporaryActive.push(temp);
    else temporaryExpired.push(temp);

    if (state !== 'Active' || !additiveEnabled) continue;

    const role = roleOf(temp.roleId) ?? roleOf(temp.roleName);
    const roleMap = roleIsActive(role) ? normalizePermissionMap(role!.permissions) : {};
    if (roleIsActive(role)) temporaryRoleNames.push(role!.name);

    const combined = mergePermissionMaps(roleMap, temp.permissions);
    if (!Object.keys(combined).length) continue;

    contributions.push({
      permissions: combined,
      source: {
        kind: 'Temporary',
        label: temp.roleName || role?.name || 'Temporary access',
        refId: temp.id,
        assignedBy: temp.approvedBy || temp.assignedBy,
        assignedByName: temp.approvedByName || temp.assignedByName,
        assignedAt: temp.startAt,
        reason: temp.reason,
        expiresAt: temp.expiresAt,
      },
    });
  }

  /* ---- Fold ---- */

  const permissions = mergePermissionMaps(...contributions.map((entry) => entry.permissions));
  const sources: Record<string, PermissionSource[]> = {};
  for (const contribution of contributions) {
    for (const [resource, actions] of Object.entries(contribution.permissions)) {
      for (const action of actions) {
        const key = permissionKey(resource, action);
        (sources[key] ||= []).push(contribution.source);
      }
    }
  }

  const modules = uniqueStrings(Object.keys(permissions).map(moduleOfResource)).sort();

  return {
    userId: user.id,
    permissions,
    sources,
    baseRoleName,
    additionalRoleNames: uniqueStrings(additionalRoleNames),
    effectiveRoleNames: uniqueStrings([
      baseRoleName ?? '',
      ...additionalRoleNames,
      ...temporaryRoleNames,
    ]),
    projectIds: uniqueStrings(projectIds),
    departmentIds: uniqueStrings(departmentIds),
    designations: uniqueStrings(designations),
    modules,
    temporaryActive,
    temporaryExpired,
    temporaryUpcoming,
    permissionCount: countPermissions(permissions),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Checking — the vocabulary the whole app should use instead of comparing role names
 * ---------------------------------------------------------------------------------------------- */

/** Either a computed `EffectiveAccess` or the raw permission map from auth context. */
export type PermissionSubject = EffectiveAccess | PermissionMap | null | undefined;

const mapOf = (subject: PermissionSubject): PermissionMap => {
  if (!subject) return {};
  if (typeof subject === 'object' && 'permissions' in subject && subject.permissions) {
    return subject.permissions as PermissionMap;
  }
  return subject as PermissionMap;
};

/**
 * Does this subject hold `action` on `resource`?
 *
 * `scope` mirrors `useAuthorization().can`'s third argument: a project or department id that turns
 * the check into `${resource}.${scope}` first, falling back to the unscoped grant. An unscoped
 * grant deliberately satisfies a scoped question — somebody who can view every project can view
 * this one.
 */
export function hasPermission(
  subject: PermissionSubject,
  resource: string,
  action: string,
  scope?: string,
): boolean {
  const map = mapOf(subject);
  if (scope && map[`${resource}.${scope}`]?.includes(action)) return true;
  if (map[resource]?.includes(action)) return true;
  // `View All` on the module has always meant "every scope" — see useAuthorization.
  if (action === 'View' && scope && map[moduleOfResource(resource)]?.includes('View All')) return true;
  return false;
}

/** A permission expressed as one string, for compact call sites and stored template data. */
export interface PermissionRef {
  resource: string;
  action: string;
  scope?: string;
}

export function hasAnyPermission(subject: PermissionSubject, refs: PermissionRef[]): boolean {
  return refs.some((ref) => hasPermission(subject, ref.resource, ref.action, ref.scope));
}

export function hasAllPermissions(subject: PermissionSubject, refs: PermissionRef[]): boolean {
  return refs.every((ref) => hasPermission(subject, ref.resource, ref.action, ref.scope));
}

/** Can the user open this module at all? The check the Module Hub and every layout shell makes. */
export function canAccessModule(subject: PermissionSubject, moduleName: string): boolean {
  const map = mapOf(subject);
  if (map[moduleName]?.includes('View Module')) return true;
  // A module with any page-level grant is reachable even if nobody ticked "View Module" — the
  // alternative is a user who holds `Projects.Towers.View` and cannot get to the screen.
  return Object.keys(map).some(
    (key) => key === moduleName || (key.startsWith(`${moduleName}.`) && (map[key]?.length ?? 0) > 0),
  );
}

/** Can the user open this page? `resource` is the dotted `Module.Page` key. */
export function canAccessPage(subject: PermissionSubject, resource: string, scope?: string): boolean {
  const map = mapOf(subject);
  if (scope && (map[`${resource}.${scope}`]?.length ?? 0) > 0) return true;
  return (map[resource]?.length ?? 0) > 0;
}

/** Reads better than `hasPermission` at action call sites; identical behaviour. */
export const canPerformAction = hasPermission;

export function getEffectivePermissions(subject: PermissionSubject): PermissionMap {
  return sortPermissionMap(mapOf(subject));
}

/** Every reason the user holds this action. Empty when they do not hold it. */
export function getPermissionSources(
  access: EffectiveAccess | null | undefined,
  resource: string,
  action: string,
): PermissionSource[] {
  if (!access?.sources) return [];
  return access.sources[permissionKey(resource, action)] ?? [];
}

export interface PermissionExplanation {
  resource: string;
  action: string;
  granted: boolean;
  sources: PermissionSource[];
  /** One-line answer for the "Why does this user have this permission?" popover of §44. */
  summary: string;
}

/**
 * The §44 answer: "Expense Approve — granted through Finance Manager Role, assigned by Admin on
 * 20-Aug-2026."
 *
 * Written as a sentence rather than a table because the question is asked when something looks
 * wrong, and a sentence is what gets pasted into the reply to whoever asked.
 */
export function explainPermission(
  access: EffectiveAccess | null | undefined,
  resource: string,
  action: string,
): PermissionExplanation {
  const sources = getPermissionSources(access, resource, action);
  if (!sources.length) {
    return {
      resource,
      action,
      granted: false,
      sources: [],
      summary: `Not granted. No role, direct permission or scope assignment gives ${action} on ${resource}.`,
    };
  }

  const describe = (source: PermissionSource): string => {
    const parts: string[] = [];
    parts.push(source.kind === 'Direct Permission' ? 'a direct permission' : `${source.label} (${source.kind})`);
    if (source.assignedByName) parts.push(`assigned by ${source.assignedByName}`);
    if (source.assignedAt) parts.push(`on ${formatGrantDate(source.assignedAt)}`);
    if (source.expiresAt) parts.push(`expiring ${formatGrantDate(source.expiresAt)}`);
    return parts.join(', ');
  };

  const summary =
    sources.length === 1
      ? `Granted through ${describe(sources[0])}.`
      : `Granted through ${sources.length} sources — ${sources.map((s) => s.label).join(', ')}. ` +
        `Removing one will not revoke it while the others remain.`;

  return { resource, action, granted: true, sources, summary };
}

/** `2026-08-25T…` → `25-Aug-2026`, the format the rest of the app's audit views use. */
export function formatGrantDate(iso: string | null | undefined): string {
  const time = toTime(iso);
  if (time === null) return '—';
  const date = new Date(time);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(date.getDate()).padStart(2, '0')}-${months[date.getMonth()]}-${date.getFullYear()}`;
}

/* ------------------------------------------------------------------------------------------------
 * Assignment planning — what the preview screens show before anything is written
 * ---------------------------------------------------------------------------------------------- */

export interface AccessAssignmentRequest {
  roleIds?: string[];
  /** Ad-hoc permissions granted directly, outside any role. */
  directPermissions?: PermissionMap | null;
  projectIds?: string[];
  departmentIds?: string[];
  designations?: string[];
  templateIds?: string[];
  temporary?: {
    startAt: string;
    expiresAt: string;
    reason: string;
  } | null;
}

export interface UserAssignmentPlan {
  userId: string;
  userName: string;
  /** What the user can do today. */
  before: PermissionMap;
  /** What they would be able to do after. Always a superset of `before`. */
  after: PermissionMap;
  diff: PermissionDiff;
  /** Roles in the request the user does not already hold, by either base or additional grant. */
  rolesToAdd: RoleLike[];
  /** Roles in the request the user already holds. §16's "Already Assigned". */
  rolesAlreadyHeld: RoleLike[];
  projectsToAdd: string[];
  projectsAlreadyHeld: string[];
  /** True when nothing at all would change — the user is counted as "already had access". */
  noop: boolean;
}

export interface AssignmentPreview {
  plans: UserAssignmentPlan[];
  userCount: number;
  /** Users for whom something would actually change. */
  usersAffected: number;
  /** Users who already had everything in the request. */
  usersAlreadyHadAccess: number;
  /** Total `resource::action` pairs added across every user. §26's "444 permission assignments". */
  permissionsAdded: number;
  /** Always 0 for an Add Access operation. Rendered explicitly, because §15 asks for it. */
  permissionsRemoved: number;
  /** Pairs the selected users already held. §16's "6 already available". */
  permissionsAlreadyHeld: number;
  roleAssignmentsAdded: number;
  /** Set when the request itself is unusable — no users, no roles, expiry before start. */
  blockingIssues: string[];
  warnings: string[];
}

const roleNamesHeld = (access: EffectiveAccess): Set<string> =>
  new Set(access.effectiveRoleNames);

/**
 * Simulate an assignment against every selected user without writing anything.
 *
 * The preview (§15), the duplicate detection (§16) and the bulk confirmation (§26) are all this
 * function rendered three ways. Doing the simulation with the same resolver the runtime uses — not
 * an approximation of it — is what makes "Permissions being added: 17" a number an administrator
 * can act on rather than an estimate.
 */
export function previewAssignment(
  subjects: Array<{
    user: ResolveAccessUser;
    grant?: Partial<UserAccessGrant> | null;
  }>,
  request: AccessAssignmentRequest,
  context: {
    roles: RoleLike[];
    scopeGrants?: ScopeGrantConfig[];
    templates?: AccessTemplate[];
    now?: Date | number | string;
  },
): AssignmentPreview {
  const { roles, scopeGrants = [], templates = [], now } = context;
  const rolesById = new Map(roles.map((role) => [role.id, role]));

  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  if (!subjects.length) blockingIssues.push('Select at least one user.');

  // Templates expand into roles, permissions and projects before anything else looks at the request.
  const templateRoleIds: string[] = [];
  const templateProjectIds: string[] = [];
  let templatePermissions: PermissionMap = {};
  for (const templateId of request.templateIds || []) {
    const template = templates.find((entry) => entry.id === templateId);
    if (!template) {
      warnings.push(`Template ${templateId} no longer exists and was skipped.`);
      continue;
    }
    templateRoleIds.push(...(template.roleIds || []));
    templateProjectIds.push(...(template.projectIds || []));
    templatePermissions = mergePermissionMaps(templatePermissions, template.permissions);
  }

  const requestedRoleIds = uniqueStrings([...(request.roleIds || []), ...templateRoleIds]);
  const requestedRoles = requestedRoleIds
    .map((roleId) => rolesById.get(roleId))
    .filter((role): role is RoleLike => !!role);
  const missingRoles = requestedRoleIds.filter((roleId) => !rolesById.has(roleId));
  if (missingRoles.length) warnings.push(`${missingRoles.length} selected role(s) no longer exist and were skipped.`);

  const requestedProjectIds = uniqueStrings([...(request.projectIds || []), ...templateProjectIds]);
  const requestedDirect = mergePermissionMaps(request.directPermissions, templatePermissions);

  const hasSomethingToGrant =
    requestedRoles.length > 0 ||
    Object.keys(requestedDirect).length > 0 ||
    requestedProjectIds.length > 0 ||
    (request.departmentIds || []).length > 0 ||
    (request.designations || []).length > 0;
  if (!hasSomethingToGrant) blockingIssues.push('Select at least one role, permission or project to grant.');

  if (request.temporary) {
    const start = toTime(request.temporary.startAt);
    const end = toTime(request.temporary.expiresAt);
    if (start === null || end === null) blockingIssues.push('Temporary access needs a valid start and expiry date.');
    else if (end <= start) blockingIssues.push('Temporary access expiry must be after its start date.');
    if (!request.temporary.reason?.trim()) blockingIssues.push('Temporary access needs a reason.');
  }

  const plans: UserAssignmentPlan[] = subjects.map(({ user, grant }) => {
    const currentGrant = normalizeUserAccessGrant(user.id, grant);
    const before = resolveEffectiveAccess({ user, roles, grant: currentGrant, scopeGrants, now });
    const heldRoleNames = roleNamesHeld(before);

    const rolesAlreadyHeld = requestedRoles.filter((role) => heldRoleNames.has(role.name));
    const rolesToAdd = requestedRoles.filter((role) => !heldRoleNames.has(role.name));

    const projectsAlreadyHeld = requestedProjectIds.filter((id) => before.projectIds.includes(id));
    const projectsToAdd = requestedProjectIds.filter((id) => !before.projectIds.includes(id));

    const projectedGrant = applyAssignmentToGrant(
      currentGrant,
      {
        ...request,
        roleIds: requestedRoleIds,
        projectIds: requestedProjectIds,
        directPermissions: requestedDirect,
        templateIds: [],
      },
      { roles, actor: { userId: 'preview', userName: 'preview' }, now },
    );

    const after = resolveEffectiveAccess({ user, roles, grant: projectedGrant, scopeGrants, now });
    const diff = diffPermissionMaps(before.permissions, after.permissions);

    return {
      userId: user.id,
      userName: user.name || user.email || user.id,
      before: before.permissions,
      after: after.permissions,
      diff,
      rolesToAdd,
      rolesAlreadyHeld,
      projectsToAdd,
      projectsAlreadyHeld,
      noop: diff.addedCount === 0 && rolesToAdd.length === 0 && projectsToAdd.length === 0,
    };
  });

  const permissionsAdded = plans.reduce((total, plan) => total + plan.diff.addedCount, 0);
  const permissionsRemoved = plans.reduce((total, plan) => total + plan.diff.removedCount, 0);
  const permissionsAlreadyHeld = plans.reduce(
    (total, plan) => total + permissionPairs(intersectPermissionMaps(plan.before, buildRequestedMap(requestedRoles, requestedDirect))).size,
    0,
  );
  const roleAssignmentsAdded = plans.reduce((total, plan) => total + plan.rolesToAdd.length, 0);

  if (permissionsRemoved > 0) {
    // Unreachable through `applyAssignmentToGrant`, which only ever appends. Surfaced rather than
    // swallowed so a future regression shows up in the preview instead of in somebody's access.
    blockingIssues.push(
      `This operation would remove ${permissionsRemoved} existing permission(s). Add Access must never remove access.`,
    );
  }

  return {
    plans,
    userCount: plans.length,
    usersAffected: plans.filter((plan) => !plan.noop).length,
    usersAlreadyHadAccess: plans.filter((plan) => plan.noop).length,
    permissionsAdded,
    permissionsRemoved,
    permissionsAlreadyHeld,
    roleAssignmentsAdded,
    blockingIssues,
    warnings,
  };
}

const buildRequestedMap = (roles: RoleLike[], direct: PermissionMap): PermissionMap =>
  mergePermissionMaps(...roles.map((role) => role.permissions), direct);

/* ------------------------------------------------------------------------------------------------
 * Applying — pure grant-document transformations the service layer persists
 * ---------------------------------------------------------------------------------------------- */

export interface AssignmentActor {
  userId: string;
  userName: string;
  batchId?: string;
}

/**
 * Produce the grant document that results from applying `request` to `current`.
 *
 * Pure and append-only. Every branch either adds an entry or leaves the document alone; none
 * replaces an array. `user.roles = [newRole]` — the exact anti-pattern §6 names — is not something
 * this function can express.
 */
export function applyAssignmentToGrant(
  current: UserAccessGrant,
  request: AccessAssignmentRequest,
  context: { roles: RoleLike[]; actor: AssignmentActor; now?: Date | number | string },
): UserAccessGrant {
  const { roles, actor } = context;
  const assignedAt = new Date(nowMs(context.now)).toISOString();
  const rolesById = new Map(roles.map((role) => [role.id, role]));

  const provenance: GrantProvenance = {
    assignedBy: actor.userId,
    assignedByName: actor.userName,
    assignedAt,
    batchId: actor.batchId,
  };

  const next: UserAccessGrant = {
    ...current,
    additionalRoles: [...current.additionalRoles],
    directPermissions: [...current.directPermissions],
    departmentIds: [...current.departmentIds],
    designations: [...current.designations],
    projectAccess: [...current.projectAccess],
    temporaryAccess: [...current.temporaryAccess],
  };

  const temporary = request.temporary;

  /* Roles */
  for (const roleId of uniqueStrings(request.roleIds || [])) {
    const role = rolesById.get(roleId);
    if (!role) continue;

    if (temporary) {
      // A time-boxed role belongs in temporaryAccess, not additionalRoles: it must lapse on its own
      // and stay visible in the temporary-access report while it is in force.
      const alreadyGranted = next.temporaryAccess.some(
        (entry) => entry.roleId === roleId && entry.expiresAt === temporary.expiresAt && !entry.revokedAt,
      );
      if (alreadyGranted) continue;
      next.temporaryAccess.push({
        ...provenance,
        id: `${roleId}-${Date.parse(temporary.startAt) || Date.now()}`,
        roleId,
        roleName: role.name,
        startAt: temporary.startAt,
        expiresAt: temporary.expiresAt,
        reason: temporary.reason,
        requestedBy: actor.userId,
        requestedByName: actor.userName,
        approvedBy: actor.userId,
        approvedByName: actor.userName,
        revokedAt: null,
      });
      continue;
    }

    // Idempotent: assigning a role somebody already holds additionally changes nothing (§6).
    if (next.additionalRoles.some((entry) => entry.roleId === roleId)) continue;
    next.additionalRoles.push({ ...provenance, roleId, roleName: role.name });
  }

  /* Direct permissions */
  const direct = normalizePermissionMap(request.directPermissions);
  for (const [resource, actions] of Object.entries(direct)) {
    const existing = next.directPermissions.find(
      (entry) => entry.resource === resource && !entry.expiresAt && !temporary,
    );
    if (existing) {
      const merged = uniqueStrings([...existing.actions, ...actions]);
      if (merged.length !== existing.actions.length) existing.actions = merged;
      continue;
    }
    next.directPermissions.push({
      ...provenance,
      resource,
      actions: uniqueStrings(actions),
      startAt: temporary?.startAt ?? null,
      expiresAt: temporary?.expiresAt ?? null,
      reason: temporary?.reason ?? request.temporary?.reason,
    });
  }

  /* Projects */
  for (const projectId of uniqueStrings(request.projectIds || [])) {
    if (next.projectAccess.some((entry) => entry.projectId === projectId)) continue;
    next.projectAccess.push({
      ...provenance,
      projectId,
      startAt: temporary?.startAt ?? null,
      expiresAt: temporary?.expiresAt ?? null,
    });
  }

  /* Departments and designations */
  next.departmentIds = uniqueStrings([...next.departmentIds, ...(request.departmentIds || [])]);
  next.designations = uniqueStrings([...next.designations, ...(request.designations || [])]);

  next.updatedBy = actor.userId;
  next.updatedByName = actor.userName;
  next.updatedAt = assignedAt;
  if (!next.createdAt) {
    next.createdBy = actor.userId;
    next.createdByName = actor.userName;
    next.createdAt = assignedAt;
  }

  return next;
}

export interface AccessRemovalRequest {
  roleIds?: string[];
  /** Direct permissions to revoke, as a map. Only direct grants are touched. */
  directPermissions?: PermissionMap | null;
  projectIds?: string[];
  departmentIds?: string[];
  designations?: string[];
  /** Temporary grant ids to end early. */
  temporaryIds?: string[];
}

export interface RemovalOutcome {
  grant: UserAccessGrant;
  /** Pairs the user genuinely loses. Empty when another source still grants everything. */
  permissionsLost: string[];
  /** Pairs that stay because another source still grants them — the §17 case. */
  permissionsRetainedByOtherSources: string[];
}

/**
 * Remove additional access, source-aware.
 *
 * The rule §17 is built around: a user whose base role grants `projects.view`, and who was later
 * given an additional role that also grants it, keeps `projects.view` when the additional role is
 * removed. That falls out of removing the *grant* and recomputing, rather than subtracting the
 * role's permission list from a flattened array — which is why nothing here calls
 * `subtractPermissionMaps` on the effective set.
 *
 * The base role is never touched. Removing it is a User Management operation, deliberately left
 * where it has always been.
 */
export function removeAccessFromGrant(
  user: ResolveAccessUser,
  current: UserAccessGrant,
  request: AccessRemovalRequest,
  context: {
    roles: RoleLike[];
    scopeGrants?: ScopeGrantConfig[];
    actor: AssignmentActor;
    now?: Date | number | string;
  },
): RemovalOutcome {
  const { roles, scopeGrants = [], actor } = context;
  const at = context.now ?? Date.now();
  const removedAt = new Date(nowMs(at)).toISOString();

  const before = resolveEffectiveAccess({ user, roles, grant: current, scopeGrants, now: at });

  const roleIds = new Set(request.roleIds || []);
  const projectIds = new Set(request.projectIds || []);
  const departmentIds = new Set(request.departmentIds || []);
  const designations = new Set(request.designations || []);
  const temporaryIds = new Set(request.temporaryIds || []);
  const directToRemove = normalizePermissionMap(request.directPermissions);

  const next: UserAccessGrant = {
    ...current,
    additionalRoles: current.additionalRoles.filter((entry) => !roleIds.has(entry.roleId)),
    projectAccess: current.projectAccess.filter((entry) => !projectIds.has(entry.projectId)),
    departmentIds: current.departmentIds.filter((id) => !departmentIds.has(id)),
    designations: current.designations.filter((name) => !designations.has(name)),
    // Revoked rather than deleted: §22 requires the audit history to survive expiry and revocation.
    temporaryAccess: current.temporaryAccess.map((entry) =>
      temporaryIds.has(entry.id) || (entry.roleId && roleIds.has(entry.roleId))
        ? { ...entry, revokedAt: entry.revokedAt ?? removedAt, revokedBy: actor.userId }
        : entry,
    ),
    directPermissions: current.directPermissions
      .map((entry) => {
        const drop = directToRemove[entry.resource];
        if (!drop) return entry;
        const kept = entry.actions.filter((action) => !drop.includes(action));
        return kept.length ? { ...entry, actions: kept } : null;
      })
      .filter((entry): entry is DirectPermissionGrant => entry !== null),
    updatedBy: actor.userId,
    updatedByName: actor.userName,
    updatedAt: removedAt,
  };

  const after = resolveEffectiveAccess({ user, roles, grant: next, scopeGrants, now: at });
  const diff = diffPermissionMaps(before.permissions, after.permissions);

  // What the removed sources granted, minus what the user still has: the permissions that survived
  // because something else grants them too.
  const removedSourceMap = mergePermissionMaps(
    ...current.additionalRoles
      .filter((entry) => roleIds.has(entry.roleId))
      .map((entry) => roles.find((role) => role.id === entry.roleId)?.permissions),
    directToRemove,
  );
  const retained = [...permissionPairs(removedSourceMap)].filter((pair) =>
    permissionPairs(after.permissions).has(pair),
  );

  return {
    grant: next,
    permissionsLost: diff.removed,
    permissionsRetainedByOtherSources: retained.sort(),
  };
}

/**
 * Copy one user's additive access onto another (§23), without removing anything from the target.
 *
 * The source's *base role* is deliberately not copied. Copying it would mean writing `users.role`,
 * which is the pre-existing system's field and the one thing this module does not touch; an
 * administrator who wants the target to have that role can grant it as an additional role, which
 * this does offer through `includeBaseRoleAsAdditional`.
 */
export function buildCopyAccessRequest(
  sourceGrant: UserAccessGrant,
  sourceUser: ResolveAccessUser,
  options: { includeBaseRoleAsAdditional?: boolean; roles: RoleLike[]; now?: Date | number | string } ,
): AccessAssignmentRequest {
  const at = options.now ?? Date.now();
  const roleIds = sourceGrant.additionalRoles
    .filter((entry) => isGrantActive(entry, at))
    .map((entry) => entry.roleId);

  if (options.includeBaseRoleAsAdditional && sourceUser.role) {
    const baseRole = options.roles.find((role) => role.name === sourceUser.role);
    if (baseRole) roleIds.push(baseRole.id);
  }

  const directPermissions = mergePermissionMaps(
    ...sourceGrant.directPermissions
      .filter((entry) => isGrantActive(entry, at))
      .map((entry) => ({ [entry.resource]: entry.actions })),
  );

  return {
    roleIds: uniqueStrings(roleIds),
    directPermissions,
    projectIds: sourceGrant.projectAccess
      .filter((entry) => isGrantActive(entry, at))
      .map((entry) => entry.projectId),
    departmentIds: [...sourceGrant.departmentIds],
    designations: [...sourceGrant.designations],
  };
}

/* ------------------------------------------------------------------------------------------------
 * Who may administer access
 * ---------------------------------------------------------------------------------------------- */

/** The `can(action, resource, scope?)` shape `useAuthorization` exposes. */
export type PermissionChecker = (action: string, resource: string, scope?: string) => boolean;

/**
 * May this user open Access Management at all?
 *
 * The fallback is what makes the feature possible to turn on. On the day this shipped, no role
 * document held `Settings.Access Management` — the permission did not exist when those roles were
 * written — so a check that only accepted it would make the screen unreachable by everybody,
 * including the administrator who has to grant it. Somebody who can already edit both users and
 * roles holds strictly more power than this screen offers, so accepting them adds no privilege.
 *
 * Lives here rather than in the service module so the settings page, the page itself and the
 * Admin-SDK route guard can all apply the same rule without any of them importing a Firestore SDK
 * to evaluate a predicate.
 */
export function canOpenAccessManagement(can: PermissionChecker): boolean {
  if (can('View', 'Settings.Access Management')) return true;
  return can('Edit', 'Settings.User Management') && can('Edit', 'Settings.Role Management');
}

/** Same bootstrapping fallback, for the write paths. */
export function canAssignAccess(can: PermissionChecker): boolean {
  if (can('Assign', 'Settings.Access Management')) return true;
  return can('Edit', 'Settings.User Management') && can('Edit', 'Settings.Role Management');
}

export function canRevokeAccess(can: PermissionChecker): boolean {
  if (can('Revoke', 'Settings.Access Management')) return true;
  return can('Edit', 'Settings.User Management') && can('Edit', 'Settings.Role Management');
}

/** Editing a role changes what it means for everybody holding it, so it keeps its own permission. */
export function canManageRoles(can: PermissionChecker): boolean {
  return can('Administer', 'Settings.Access Management') || can('Edit', 'Settings.Role Management');
}

/** Turn a resolved permission set into the `can` shape the four functions above take. */
export function checkerFor(subject: PermissionSubject): PermissionChecker {
  return (action, resource, scope) => hasPermission(subject, resource, action, scope);
}

/* ------------------------------------------------------------------------------------------------
 * The resource registry — modules, pages and actions, flattened for matrices and trees
 * ---------------------------------------------------------------------------------------------- */

export interface RegistryNode {
  /** Dotted key, e.g. `"E-Approval.Settings.Approval Types"`. */
  resource: string;
  /** Top-level module. */
  module: string;
  /** Leaf label, e.g. `"Approval Types"`. */
  label: string;
  /** 0 for the module itself, 1 for a page, 2 for a nested page. */
  depth: number;
  actions: string[];
}

/**
 * Flatten the nested `permissionModules` registry into a list every UI can index.
 *
 * The registry is authored as nested objects because that is how it reads, but a matrix, a search
 * box and a "select every Approve across all modules" control all want a flat list. Deriving the
 * flat form rather than maintaining it means a new module registers itself by appearing in
 * `permissions.ts` and nothing else — which is what §41 asks for.
 */
export function flattenPermissionRegistry(registry: Record<string, unknown>): RegistryNode[] {
  const nodes: RegistryNode[] = [];

  const walk = (value: unknown, path: string[], moduleName: string) => {
    const resource = path.join('.');
    const depth = path.length - 1;
    const label = path[path.length - 1];

    if (Array.isArray(value)) {
      nodes.push({
        resource,
        module: moduleName,
        label,
        depth,
        actions: uniqueStrings(value.map((item) => String(item))),
      });
      return;
    }

    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      // `"View Module": []` is the registry's way of saying "this node itself is openable".
      const own = entries.find(([key]) => key === 'View Module' || key === 'View');
      const ownActions: string[] = [];
      if (own) ownActions.push(own[0]);

      if (ownActions.length) {
        nodes.push({ resource, module: moduleName, label, depth, actions: ownActions });
      }

      for (const [key, child] of entries) {
        if (key === 'View Module') continue;
        if (key === 'View' && Array.isArray(child) && child.length === 0) continue;
        walk(child, [...path, key], moduleName);
      }
    }
  };

  for (const [moduleName, value] of Object.entries(registry)) {
    walk(value, [moduleName], moduleName);
  }

  return nodes;
}

/** Every distinct action verb in the registry, for the "select an action across modules" control. */
export function registryActions(nodes: RegistryNode[]): string[] {
  return uniqueStrings(nodes.flatMap((node) => node.actions)).sort();
}

/** Total grantable `resource::action` pairs — the denominator in "43 of 1,204 permissions". */
export const registryPermissionCount = (nodes: RegistryNode[]): number =>
  nodes.reduce((total, node) => total + node.actions.length, 0);

/** Full permission map for a set of registry nodes. Powers "Select All" on a module. */
export function registryToPermissionMap(nodes: RegistryNode[]): PermissionMap {
  const out: PermissionMap = {};
  for (const node of nodes) {
    if (node.actions.length) out[node.resource] = [...node.actions];
  }
  return sortPermissionMap(out);
}

/** Case-insensitive search across module, page and action names. */
export function searchRegistry(nodes: RegistryNode[], term: string): RegistryNode[] {
  const query = term.trim().toLowerCase();
  if (!query) return nodes;
  return nodes.filter(
    (node) =>
      node.resource.toLowerCase().includes(query) ||
      node.module.toLowerCase().includes(query) ||
      node.actions.some((action) => action.toLowerCase().includes(query)),
  );
}

/* ------------------------------------------------------------------------------------------------
 * The permission matrix (§11)
 * ---------------------------------------------------------------------------------------------- */

/** The columns §11 asks for. Modules use richer verbs; these are the ones worth comparing across. */
export const MATRIX_ACTIONS = [
  'View',
  'Create',
  'Edit',
  'Delete',
  'Approve',
  'Export',
  'Admin',
] as const;

export type MatrixAction = (typeof MATRIX_ACTIONS)[number];

/**
 * Action verbs that mean the same thing across modules.
 *
 * The registry was written module by module over years, so "create" is spelled `Add` in HR, `Create`
 * in Billing Recon and `Record` in Survey. A matrix that took the words literally would show a
 * checkerboard of blanks that mean nothing. These groupings are for *display and comparison* only —
 * nothing is ever granted through them, so a mis-grouped verb costs a confusing tick, not access.
 */
const MATRIX_ACTION_SYNONYMS: Record<MatrixAction, string[]> = {
  View: ['View', 'View Module', 'View All', 'View Own', 'View Department', 'View Log', 'View Dashboard', 'View Reports', 'View History'],
  Create: ['Create', 'Add', 'Add Manual', 'Record', 'Request', 'Submit', 'Import', 'Upload', 'Refer', 'Generate Manually'],
  Edit: ['Edit', 'Update', 'Update EMI', 'Update Progress', 'Edit Own', 'Reassign', 'Renew', 'Revise Request'],
  Delete: ['Delete', 'Delete Draft', 'Delete Items', 'Clear BOQ', 'Remove', 'Write Off'],
  Approve: ['Approve', 'Approve Request', 'Reject', 'Verify', 'Return', 'Certify', 'Clear', 'Issue', 'Sign', 'Release', 'Approve Transfer', 'Approve Stock Count', 'Bulk Approve', 'Reverse Any'],
  Export: ['Export', 'Download', 'Export Exceptions', 'Print'],
  Admin: ['Edit Settings', 'Manage All', 'Manage Permissions', 'Manage Masters', 'Configure', 'Administer', 'Edit User Rights', 'Manage Field Control', 'Edit Workflow'],
};

export interface MatrixCell {
  /** Whether the subject holds at least one action in this column for this module. */
  granted: boolean;
  /** The concrete actions behind the tick, for the tooltip. */
  actions: string[];
  /** True when the grant comes from something other than a direct/base grant on this module. */
  inherited: boolean;
}

export interface MatrixRow {
  module: string;
  cells: Record<MatrixAction, MatrixCell>;
  /** Distinct pairs held in this module. */
  grantedCount: number;
  /** Distinct pairs the registry offers for this module. */
  totalCount: number;
}

/**
 * Build the §11 matrix for a permission set.
 *
 * One row per module, one column per canonical action. A tick means "holds at least one action in
 * this family somewhere in the module" — deliberately optimistic, because the matrix is a map for
 * finding where to look, and the tooltip carries the exact actions.
 */
export function buildPermissionMatrix(
  subject: PermissionSubject,
  nodes: RegistryNode[],
  options?: { access?: EffectiveAccess | null },
): MatrixRow[] {
  const map = mapOf(subject);
  const access = options?.access ?? null;
  const byModule = new Map<string, RegistryNode[]>();
  for (const node of nodes) {
    const list = byModule.get(node.module) ?? [];
    list.push(node);
    byModule.set(node.module, list);
  }

  const rows: MatrixRow[] = [];
  for (const [moduleName, moduleNodes] of byModule) {
    const cells = {} as Record<MatrixAction, MatrixCell>;
    let grantedCount = 0;
    let totalCount = 0;

    for (const node of moduleNodes) totalCount += node.actions.length;

    for (const column of MATRIX_ACTIONS) {
      const synonyms = MATRIX_ACTION_SYNONYMS[column];
      const matched: string[] = [];
      let inherited = false;

      for (const node of moduleNodes) {
        const held = map[node.resource] || [];
        for (const action of held) {
          if (!synonyms.includes(action)) continue;
          matched.push(`${node.resource} · ${action}`);
          if (access) {
            const sources = getPermissionSources(access, node.resource, action);
            if (sources.length && sources.every((source) => source.kind !== 'Base Role')) inherited = true;
          }
        }
      }

      cells[column] = { granted: matched.length > 0, actions: matched, inherited };
    }

    for (const node of moduleNodes) {
      grantedCount += (map[node.resource] || []).filter((action) => node.actions.includes(action)).length;
    }

    rows.push({ module: moduleName, cells, grantedCount, totalCount });
  }

  return rows.sort((a, b) => a.module.localeCompare(b.module));
}

/* ------------------------------------------------------------------------------------------------
 * Risk detection (§31, §46) and privileged access (§36, §37)
 * ---------------------------------------------------------------------------------------------- */

/** Roles that need a confirmation, a reason and an audit entry before anybody touches them (§31). */
export const PROTECTED_ROLE_NAMES = [
  'Super Admin',
  'Administrator',
  'System Administrator',
  'Director',
  'Executive Director',
];

export const isProtectedRole = (roleName: string | null | undefined): boolean =>
  !!roleName && PROTECTED_ROLE_NAMES.some((name) => name.toLowerCase() === roleName.trim().toLowerCase());

/**
 * Permissions that make somebody a privileged user.
 *
 * Deliberately expressed as resource/action patterns rather than role names: a custom role called
 * "Reports Viewer" that happens to grant user management is exactly the configuration this is meant
 * to surface, and a role-name list would miss it.
 */
export const PRIVILEGED_PERMISSION_PATTERNS: Array<{ resource: RegExp; action: RegExp; label: string }> = [
  { resource: /^Settings\.User Management$/, action: /^(Add|Edit|Delete|Switch User)$/, label: 'Can manage user accounts' },
  { resource: /^Settings\.Role Management$/, action: /^(Add|Edit|Delete)$/, label: 'Can manage roles and permissions' },
  { resource: /^Settings\.Access Management$/, action: /^(Assign|Revoke|Administer)$/, label: 'Can grant access to others' },
  { resource: /^Bank Balance\./, action: /^Delete$/, label: 'Can delete financial records' },
  { resource: /^(Recurring Payments|Tour, Travel & Expense)\.(Approvals|Payments|Payment Processing)$/, action: /^(Approve|Record Payment|Bulk Approve)$/, label: 'Can approve or release payments' },
  { resource: /^(Bank Guarantee Management|Letter of Credit Management|Fixed Deposit Management)\./, action: /^(Approve|Override|Release|Issue)$/, label: 'Can commit bank instruments' },
  { resource: /^Store & Stock Management\.Inventory$/, action: /^(Manage All|Allow Negative Inventory)$/, label: 'Unrestricted inventory control' },
];

export interface PrivilegeFinding {
  label: string;
  pairs: string[];
}

/** Which high-risk capabilities this permission set confers. Empty for an ordinary user. */
export function detectPrivilegedAccess(subject: PermissionSubject): PrivilegeFinding[] {
  const map = mapOf(subject);
  const findings = new Map<string, string[]>();

  for (const [resource, actions] of Object.entries(map)) {
    for (const action of actions) {
      for (const pattern of PRIVILEGED_PERMISSION_PATTERNS) {
        if (pattern.resource.test(resource) && pattern.action.test(action)) {
          const list = findings.get(pattern.label) ?? [];
          list.push(permissionKey(resource, action));
          findings.set(pattern.label, list);
        }
      }
    }
  }

  return [...findings.entries()].map(([label, pairs]) => ({ label, pairs: pairs.sort() }));
}

/**
 * Segregation-of-duties conflicts (§46): one person who can both raise and bless the same thing.
 *
 * Reported, never auto-corrected. The specification is explicit that these are warnings — a small
 * site office where one person genuinely does both jobs is a business decision, and silently
 * stripping a permission would be a worse failure than showing a badge.
 */
export const SOD_RULES: Array<{
  id: string;
  label: string;
  create: PermissionRef;
  approve: PermissionRef;
}> = [
  {
    id: 'payment-create-approve',
    label: 'Can create and approve the same payment',
    create: { resource: 'Recurring Payments.Payments', action: 'Add' },
    approve: { resource: 'Recurring Payments.Approvals', action: 'Approve' },
  },
  {
    id: 'vendor-create-approve',
    label: 'Can create a vendor and award purchase orders to it',
    create: { resource: 'Vendor Management.Vendors', action: 'Add' },
    approve: { resource: 'Project Management.Purchase Orders', action: 'Issue' },
  },
  {
    id: 'requisition-raise-approve',
    label: 'Can raise and approve the same site fund request',
    create: { resource: 'Site Fund Request.Requests', action: 'Add' },
    approve: { resource: 'Site Fund Request.Requests', action: 'Approve' },
  },
  {
    id: 'expense-claim-approve',
    label: 'Can submit and approve the same travel claim',
    create: { resource: 'Tour, Travel & Expense.Claims', action: 'Add' },
    approve: { resource: 'Tour, Travel & Expense.Claims', action: 'Approve' },
  },
  {
    id: 'progress-update-verify',
    label: 'Can record and verify the same tower progress',
    create: { resource: 'Project Management.Tower Progress', action: 'Update Progress' },
    approve: { resource: 'Project Management.Tower Progress', action: 'Verify Progress' },
  },
  {
    id: 'user-create-grant',
    label: 'Can create a user account and grant it access',
    create: { resource: 'Settings.User Management', action: 'Add' },
    approve: { resource: 'Settings.Access Management', action: 'Assign' },
  },
];

export interface SodConflict {
  id: string;
  label: string;
  createPair: string;
  approvePair: string;
}

export function detectSodConflicts(subject: PermissionSubject): SodConflict[] {
  return SOD_RULES.filter(
    (rule) =>
      hasPermission(subject, rule.create.resource, rule.create.action) &&
      hasPermission(subject, rule.approve.resource, rule.approve.action),
  ).map((rule) => ({
    id: rule.id,
    label: rule.label,
    createPair: permissionKey(rule.create.resource, rule.create.action),
    approvePair: permissionKey(rule.approve.resource, rule.approve.action),
  }));
}

/**
 * Would this removal leave the system with nobody who can manage access?
 *
 * §31's "do not allow accidental removal of the final Super Admin", expressed as a capability check
 * rather than a role-name check — a system whose last administrator holds a custom role is still
 * administrable, and one whose remaining "Super Admin" is Inactive is not.
 */
export function wouldStrandAdministration(
  remainingAdministrators: Array<{ userId: string; status?: string | null }>,
  removingUserIds: string[],
): boolean {
  const removing = new Set(removingUserIds);
  return !remainingAdministrators.some(
    (admin) => admin.status !== 'Inactive' && !removing.has(admin.userId),
  );
}

/* ------------------------------------------------------------------------------------------------
 * Reporting aggregates (§36, §37)
 * ---------------------------------------------------------------------------------------------- */

export interface AccessDashboardInput {
  users: Array<{ id: string; status?: string | null; role?: string | null }>;
  roles: RoleLike[];
  grants: Record<string, UserAccessGrant>;
  accessByUser: Record<string, EffectiveAccess>;
  recentChangeCount?: number;
  bulkAssignmentCount?: number;
  now?: Date | number | string;
}

export interface AccessDashboardStats {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  totalRoles: number;
  customRoles: number;
  systemRoles: number;
  totalPermissions: number;
  privilegedUsers: number;
  usersWithoutRoles: number;
  usersWithAdditionalAccess: number;
  temporaryAccessActive: number;
  temporaryAccessExpiringSoon: number;
  recentChangeCount: number;
  bulkAssignmentCount: number;
  usersWithSodConflicts: number;
  inactiveUsersHoldingAccess: number;
}

export function buildAccessDashboard(input: AccessDashboardInput): AccessDashboardStats {
  const { users, roles, grants, accessByUser, now } = input;

  let privilegedUsers = 0;
  let usersWithoutRoles = 0;
  let usersWithAdditionalAccess = 0;
  let temporaryAccessActive = 0;
  let temporaryAccessExpiringSoon = 0;
  let usersWithSodConflicts = 0;
  let inactiveUsersHoldingAccess = 0;

  for (const user of users) {
    const access = accessByUser[user.id];
    const grant = grants[user.id];

    if (!user.role && !(grant?.additionalRoles || []).length) usersWithoutRoles += 1;
    if (grant && (grant.additionalRoles.length || grant.directPermissions.length || grant.projectAccess.length)) {
      usersWithAdditionalAccess += 1;
    }
    if (!access) continue;

    if (detectPrivilegedAccess(access).length) privilegedUsers += 1;
    if (detectSodConflicts(access).length) usersWithSodConflicts += 1;
    temporaryAccessActive += access.temporaryActive.length;
    temporaryAccessExpiringSoon += expiringTemporaryGrants(access.temporaryActive, 7, now).length;
    if (user.status === 'Inactive' && access.permissionCount > 0) inactiveUsersHoldingAccess += 1;
  }

  const totalPermissions = countPermissions(mergePermissionMaps(...roles.map((role) => role.permissions)));

  return {
    totalUsers: users.length,
    activeUsers: users.filter((user) => user.status !== 'Inactive').length,
    inactiveUsers: users.filter((user) => user.status === 'Inactive').length,
    totalRoles: roles.length,
    customRoles: roles.filter((role) => role.type === 'Custom').length,
    systemRoles: roles.filter((role) => role.type !== 'Custom').length,
    totalPermissions,
    privilegedUsers,
    usersWithoutRoles,
    usersWithAdditionalAccess,
    temporaryAccessActive,
    temporaryAccessExpiringSoon,
    recentChangeCount: input.recentChangeCount ?? 0,
    bulkAssignmentCount: input.bulkAssignmentCount ?? 0,
    usersWithSodConflicts,
    inactiveUsersHoldingAccess,
  };
}

/** How many users hold each role, counting both base and additional grants (§4). */
export function countRoleUsage(
  users: Array<{ id: string; role?: string | null }>,
  grants: Record<string, UserAccessGrant | undefined>,
): Record<string, { base: number; additional: number; total: number }> {
  const usage: Record<string, { base: number; additional: number; total: number }> = {};
  const bump = (roleName: string, key: 'base' | 'additional') => {
    const entry = (usage[roleName] ||= { base: 0, additional: 0, total: 0 });
    entry[key] += 1;
    entry.total += 1;
  };

  for (const user of users) {
    if (user.role) bump(user.role, 'base');
    for (const assignment of grants[user.id]?.additionalRoles || []) {
      if (assignment.roleName) bump(assignment.roleName, 'additional');
    }
  }
  return usage;
}

/* ------------------------------------------------------------------------------------------------
 * Audit records (§27, §28)
 * ---------------------------------------------------------------------------------------------- */

export type AccessAuditAction =
  | 'Grant Access'
  | 'Revoke Access'
  | 'Create Role'
  | 'Update Role'
  | 'Duplicate Role'
  | 'Disable Role'
  | 'Create Template'
  | 'Apply Template'
  | 'Copy Access'
  | 'Grant Temporary Access'
  | 'Revoke Temporary Access'
  | 'Suspend Access Layer'
  | 'Resume Access Layer'
  | 'Create User';

export interface AccessAuditEntry {
  id?: string;
  /** The user whose access changed. */
  targetUserId: string;
  targetUserName: string;
  action: AccessAuditAction;
  /** Role names, project names or permission keys involved. */
  roleNames: string[];
  permissionsAdded: string[];
  permissionsRemoved: string[];
  /** Pairs that were requested but the user already had. */
  permissionsSkipped: string[];
  sourceKind: AccessSourceKind;
  changedBy: string;
  changedByName: string;
  /** ISO timestamp. */
  changedAt: string;
  reason?: string;
  batchId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  approvalReference?: string | null;
  organizationId?: string | null;
}

export interface AccessBatchRecord {
  id: string;
  label: string;
  action: AccessAuditAction;
  roleNames: string[];
  performedBy: string;
  performedByName: string;
  performedAt: string;
  userCount: number;
  successCount: number;
  skippedCount: number;
  failedCount: number;
  permissionsAdded: number;
  permissionsRemoved: number;
  reason?: string;
  failures?: Array<{ userId: string; userName: string; message: string }>;
  organizationId?: string | null;
}

/**
 * `ACCESS-BATCH-20260825-001` — the identifier §28 asks for.
 *
 * Date-prefixed and zero-padded so a batch id sorts chronologically as a string, which is what
 * makes the batch list readable without an index on the timestamp.
 */
export function formatBatchId(date: Date, sequence: number): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `ACCESS-BATCH-${year}${month}${day}-${String(sequence).padStart(3, '0')}`;
}

/** Human summary for one audit row, so the timeline reads as prose rather than as fields. */
export function describeAuditEntry(entry: AccessAuditEntry): string {
  const parts: string[] = [];
  if (entry.roleNames.length) {
    parts.push(`${entry.action === 'Revoke Access' ? 'Removed' : 'Added'} ${entry.roleNames.join(', ')}`);
  } else if (entry.permissionsAdded.length) {
    parts.push(`Added ${entry.permissionsAdded.length} permission(s)`);
  } else if (entry.permissionsRemoved.length) {
    parts.push(`Removed ${entry.permissionsRemoved.length} permission(s)`);
  } else {
    parts.push(entry.action);
  }
  parts.push(`for ${entry.targetUserName}`);
  if (entry.action !== 'Revoke Access') {
    parts.push(`— existing permissions removed: ${entry.permissionsRemoved.length}`);
  }
  return parts.join(' ');
}
