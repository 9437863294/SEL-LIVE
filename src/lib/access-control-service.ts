'use client';

/**
 * Firestore reads and writes for the additive access layer.
 *
 * Every rule lives in `access-control.ts`; this module only persists the results. The split is the
 * same one `e-approval-policy.ts` / `e-approval-service.ts` uses, and for the same reason: the
 * interesting decisions stay unit-testable without an emulator, and this file stays boring enough
 * that reading it tells you what is stored rather than what is decided.
 *
 * ── What this module will not do ────────────────────────────────────────────────────────────────
 *
 * It never writes `users.role` and it never writes `roles/{doc}.permissions` as part of an
 * assignment. Those two fields are the pre-existing authorisation system, and the entire value of
 * this layer is that they keep meaning exactly what they meant before it shipped. Grants go into
 * `accessGrants/{userId}` and nowhere else; `assertAdditive` runs on every assignment path before
 * the batch is committed, so a regression upstream surfaces as a thrown error rather than as
 * somebody quietly losing access.
 */

import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from './firebase';
import { logUserActivity } from './activity-logger';
import {
  applyAssignmentToGrant,
  assertAdditive,
  countPermissions,
  diffPermissionMaps,
  emptyUserAccessGrant,
  formatBatchId,
  isProtectedRole,
  mergePermissionMaps,
  normalizeUserAccessGrant,
  removeAccessFromGrant,
  resolveEffectiveAccess,
  wouldStrandAdministration,
  // Re-exported below so the access screens keep importing everything they need from this module,
  // while pages that only want the predicate can take it from the pure module and skip the SDK.
  canAssignAccess,
  canManageRoles,
  canOpenAccessManagement,
  canRevokeAccess,
  type AccessAssignmentRequest,
  type AccessAuditAction,
  type AccessAuditEntry,
  type AccessBatchRecord,
  type AccessRemovalRequest,
  type AccessTemplate,
  type EffectiveAccess,
  type PermissionMap,
  type ResolveAccessUser,
  type RoleLike,
  type ScopeGrantConfig,
  type UserAccessGrant,
} from './access-control';
import type { Role, User, UserDeactivation } from './types';
import { deactivationHasLapsed, formatGrantDate } from './access-control';
import { createPlatformUser } from './user-management-client';

export { canAssignAccess, canManageRoles, canOpenAccessManagement, canRevokeAccess };

/* ------------------------------------------------------------------------------------------------
 * Collections
 * ---------------------------------------------------------------------------------------------- */

/**
 * All new. `users` and `roles` appear here only because the resolver reads them — nothing in this
 * module writes to `users`, and the only `roles` writes are the Role Builder's, which is an
 * explicit role-editing action rather than part of any assignment.
 */
export const ACCESS_COLLECTIONS = {
  grants: 'accessGrants',
  scopeGrants: 'accessScopeGrants',
  templates: 'accessTemplates',
  auditLogs: 'accessAuditLogs',
  batches: 'accessBatches',
  users: 'users',
  roles: 'roles',
} as const;

/**
 * Firestore rejects `undefined`; grants are assembled in memory and may carry optional fields.
 *
 * Only **plain** objects are walked. That exclusion is load-bearing rather than defensive: this used
 * to recurse into anything object-shaped, and `serverTimestamp()` is a class instance whose single
 * enumerable property is `_methodName`. Rebuilding it as a plain object produced
 * `{ _methodName: 'serverTimestamp' }` — which Firestore accepts without complaint and stores as a
 * nested map, so every grant document carried a `syncedAt` that was a small object instead of a time.
 * A sentinel has to arrive at `batch.set` as the instance Firestore handed out.
 *
 * `Date` was already excluded by name, which is the same problem noticed once and fixed narrowly.
 */
const stripUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(stripUndefined) as unknown as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      out[key] = stripUndefined(item);
    }
    return out as T;
  }
  return value;
};

/* ------------------------------------------------------------------------------------------------
 * Actor
 * ---------------------------------------------------------------------------------------------- */

export interface AccessActor {
  userId: string;
  userName: string;
  userEmail?: string | null;
  organizationId?: string | null;
}

export const actorFromUser = (user: User | null | undefined): AccessActor | null =>
  user?.id
    ? {
        userId: user.id,
        userName: user.name || user.email || 'User',
        userEmail: user.email ?? null,
        organizationId: user.organizationId ?? null,
      }
    : null;

/** Best-effort device context for the audit record (§27). Never blocks a write. */
const deviceContext = () => {
  if (typeof window === 'undefined') return { userAgent: null, sessionId: null };
  return {
    userAgent: window.navigator?.userAgent ?? null,
    sessionId: window.localStorage?.getItem('sessionId') ?? null,
  };
};

/* ------------------------------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------------------------------- */

export async function listRoles(): Promise<Role[]> {
  const snapshot = await getDocs(collection(db, ACCESS_COLLECTIONS.roles));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as Role);
}

export async function listUsers(): Promise<User[]> {
  const snapshot = await getDocs(collection(db, ACCESS_COLLECTIONS.users));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as User);
}

export async function getUserAccessGrant(userId: string): Promise<UserAccessGrant> {
  const snapshot = await getDoc(doc(db, ACCESS_COLLECTIONS.grants, userId));
  return normalizeUserAccessGrant(userId, snapshot.exists() ? (snapshot.data() as UserAccessGrant) : null);
}

/**
 * Every grant document, keyed by user id.
 *
 * One collection read rather than one per user: the access-management screens all need the whole
 * picture at once (the dashboard counts, the user table's badges, the role library's usage counts),
 * and N reads for N users is what makes an admin screen unusable at a thousand of them.
 */
export async function listUserAccessGrants(): Promise<Record<string, UserAccessGrant>> {
  const snapshot = await getDocs(collection(db, ACCESS_COLLECTIONS.grants));
  const out: Record<string, UserAccessGrant> = {};
  for (const entry of snapshot.docs) {
    out[entry.id] = normalizeUserAccessGrant(entry.id, entry.data() as UserAccessGrant);
  }
  return out;
}

/**
 * Live subscription to one user's additive grants, for `AuthProvider`.
 *
 * `onError` matters more than it looks: if this listener fails — no document, rules denial, offline
 * cold start — the caller must fall back to the base-role permissions it already has rather than
 * render an empty permission set. A user must never lose access because the *additive* layer could
 * not be read.
 */
export function listenToUserAccessGrant(
  userId: string,
  onGrant: (grant: UserAccessGrant) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    doc(db, ACCESS_COLLECTIONS.grants, userId),
    (snapshot) => {
      onGrant(
        normalizeUserAccessGrant(userId, snapshot.exists() ? (snapshot.data() as UserAccessGrant) : null),
      );
    },
    (error) => onError?.(error),
  );
}

export async function listScopeGrants(): Promise<ScopeGrantConfig[]> {
  const snapshot = await getDocs(collection(db, ACCESS_COLLECTIONS.scopeGrants));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as ScopeGrantConfig);
}

export async function listAccessTemplates(): Promise<AccessTemplate[]> {
  const snapshot = await getDocs(collection(db, ACCESS_COLLECTIONS.templates));
  return snapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }) as AccessTemplate)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Everything the access-management screens need, in one round of parallel reads.
 *
 * Returned as a single object so a page can hold one piece of state and every tab reads from it —
 * the alternative is five hooks that each refetch on every tab change.
 */
export interface AccessDirectory {
  users: User[];
  roles: Role[];
  grants: Record<string, UserAccessGrant>;
  scopeGrants: ScopeGrantConfig[];
  templates: AccessTemplate[];
}

export async function loadAccessDirectory(): Promise<AccessDirectory> {
  const [users, roles, grants, scopeGrants, templates] = await Promise.all([
    // Temporary deactivations whose date has passed are lifted on the way in — see
    // `deactivationHasLapsed` for why nothing scheduled does it.
    listUsers().then((loaded) => reactivateLapsedDeactivations(loaded)),
    listRoles(),
    listUserAccessGrants(),
    listScopeGrants().catch(() => [] as ScopeGrantConfig[]),
    listAccessTemplates().catch(() => [] as AccessTemplate[]),
  ]);
  return { users, roles, grants, scopeGrants, templates };
}

/** Resolve one user's effective access against an already-loaded directory. */
export function effectiveAccessFor(
  user: User | ResolveAccessUser,
  directory: Pick<AccessDirectory, 'roles' | 'grants' | 'scopeGrants'>,
  now?: Date | number | string,
): EffectiveAccess {
  return resolveEffectiveAccess({
    user: user as ResolveAccessUser,
    roles: directory.roles as RoleLike[],
    grant: directory.grants[user.id],
    scopeGrants: directory.scopeGrants,
    now,
  });
}

/** Resolve every user at once — the input the dashboard and the reports both need. */
export function effectiveAccessForAll(
  directory: AccessDirectory,
  now?: Date | number | string,
): Record<string, EffectiveAccess> {
  const out: Record<string, EffectiveAccess> = {};
  for (const user of directory.users) out[user.id] = effectiveAccessFor(user, directory, now);
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Batch identifiers
 * ---------------------------------------------------------------------------------------------- */

/**
 * Next `ACCESS-BATCH-YYYYMMDD-NNN` for today.
 *
 * Derived from a count of today's batches rather than a counter document. A collision would
 * duplicate a label, not corrupt anything — the batch document id is what the audit rows actually
 * reference — so the simpler read wins over a transaction on a shared counter.
 */
export async function nextBatchId(now = new Date()): Promise<string> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  try {
    const snapshot = await getDocs(
      query(collection(db, ACCESS_COLLECTIONS.batches), where('performedAt', '>=', dayStart)),
    );
    return formatBatchId(now, snapshot.size + 1);
  } catch {
    return formatBatchId(now, Math.floor(now.getTime() / 1000) % 1000);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Granting access — the operation §5, §13 and §26 are all about
 * ---------------------------------------------------------------------------------------------- */

export interface GrantAccessInput {
  users: User[];
  request: AccessAssignmentRequest;
  directory: Pick<AccessDirectory, 'roles' | 'grants' | 'scopeGrants' | 'templates'>;
  actor: AccessActor;
  reason?: string;
  /** Label for the batch record — "Assign Project Viewer to Finance department". */
  label?: string;
  action?: AccessAuditAction;
}

export interface GrantAccessResult {
  batchId: string;
  usersSelected: number;
  usersUpdated: number;
  usersAlreadyHadAccess: number;
  usersFailed: number;
  permissionsAdded: number;
  /** Always 0. Returned rather than assumed, so the success screen reports a measurement. */
  permissionsRemoved: number;
  roleAssignmentsAdded: number;
  failures: Array<{ userId: string; userName: string; message: string }>;
}

/**
 * Add access to one or many users. Never removes anything.
 *
 * The shape of the operation, in order:
 *
 *   1. project each user's grant document forward with `applyAssignmentToGrant` (pure, append-only)
 *   2. resolve before and after, and refuse the write if anything would be lost
 *   3. commit every grant in one batch, so a bulk assignment is all-or-nothing per chunk
 *   4. write one audit row per affected user and one batch record for the whole operation
 *
 * Step 2 is the one that matters. `applyAssignmentToGrant` cannot express a removal, but checking
 * anyway costs one diff per user and turns a future regression into a failed write rather than into
 * a support ticket about vanished permissions.
 */
export async function grantAccess(input: GrantAccessInput): Promise<GrantAccessResult> {
  const { users, request, directory, actor } = input;
  const batchId = await nextBatchId();
  const changedAt = new Date().toISOString();
  const device = deviceContext();

  // Templates are expanded here as well as in the preview, so a caller that hands us template ids
  // gets the same result the administrator was shown.
  const expanded = expandTemplates(request, directory.templates ?? []);

  const failures: GrantAccessResult['failures'] = [];
  const auditEntries: AccessAuditEntry[] = [];
  const writes: Array<{ userId: string; grant: UserAccessGrant }> = [];

  let usersUpdated = 0;
  let usersAlreadyHadAccess = 0;
  let permissionsAdded = 0;
  let roleAssignmentsAdded = 0;

  for (const user of users) {
    try {
      const current = directory.grants[user.id] ?? emptyUserAccessGrant(user.id);
      const before = resolveEffectiveAccess({
        user: user as ResolveAccessUser,
        roles: directory.roles as RoleLike[],
        grant: current,
        scopeGrants: directory.scopeGrants,
      });

      const next = applyAssignmentToGrant(current, expanded, {
        roles: directory.roles as RoleLike[],
        actor: { userId: actor.userId, userName: actor.userName, batchId },
      });

      const after = resolveEffectiveAccess({
        user: user as ResolveAccessUser,
        roles: directory.roles as RoleLike[],
        grant: next,
        scopeGrants: directory.scopeGrants,
      });

      assertAdditive(before.permissions, after.permissions, `Granting access to ${user.name || user.id}`);

      const diff = diffPermissionMaps(before.permissions, after.permissions);
      const newRoleNames = next.additionalRoles
        .filter((entry) => !current.additionalRoles.some((existing) => existing.roleId === entry.roleId))
        .map((entry) => entry.roleName);
      const newTemporaryNames = next.temporaryAccess
        .filter((entry) => !current.temporaryAccess.some((existing) => existing.id === entry.id))
        .map((entry) => entry.roleName || 'Temporary permissions');

      const changed =
        diff.addedCount > 0 ||
        newRoleNames.length > 0 ||
        newTemporaryNames.length > 0 ||
        next.projectAccess.length !== current.projectAccess.length ||
        next.departmentIds.length !== current.departmentIds.length ||
        next.designations.length !== current.designations.length ||
        next.directPermissions.length !== current.directPermissions.length;

      if (!changed) {
        usersAlreadyHadAccess += 1;
        continue;
      }

      writes.push({ userId: user.id, grant: next });
      usersUpdated += 1;
      permissionsAdded += diff.addedCount;
      roleAssignmentsAdded += newRoleNames.length + newTemporaryNames.length;

      auditEntries.push({
        targetUserId: user.id,
        targetUserName: user.name || user.email || user.id,
        action: input.action ?? (expanded.temporary ? 'Grant Temporary Access' : 'Grant Access'),
        roleNames: [...newRoleNames, ...newTemporaryNames],
        permissionsAdded: diff.added,
        permissionsRemoved: diff.removed,
        permissionsSkipped: diff.unchanged.filter((pair) =>
          requestedPairs(expanded, directory.roles as RoleLike[]).has(pair),
        ),
        sourceKind: expanded.temporary ? 'Temporary' : 'Additional Role',
        changedBy: actor.userId,
        changedByName: actor.userName,
        changedAt,
        reason: input.reason,
        batchId,
        ipAddress: null,
        userAgent: device.userAgent,
        organizationId: actor.organizationId ?? null,
      });
    } catch (error) {
      failures.push({
        userId: user.id,
        userName: user.name || user.id,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  await commitGrants(writes);
  await writeAuditEntries(auditEntries);

  const result: GrantAccessResult = {
    batchId,
    usersSelected: users.length,
    usersUpdated,
    usersAlreadyHadAccess,
    usersFailed: failures.length,
    permissionsAdded,
    permissionsRemoved: 0,
    roleAssignmentsAdded,
    failures,
  };

  await writeBatchRecord({
    id: batchId,
    label: input.label || 'Add access',
    action: input.action ?? 'Grant Access',
    roleNames: uniqueRoleNames(auditEntries),
    performedBy: actor.userId,
    performedByName: actor.userName,
    performedAt: changedAt,
    userCount: users.length,
    successCount: usersUpdated,
    skippedCount: usersAlreadyHadAccess,
    failedCount: failures.length,
    permissionsAdded,
    permissionsRemoved: 0,
    reason: input.reason,
    failures,
    organizationId: actor.organizationId ?? null,
  });

  // Also recorded in the existing activity log, so the Settings → Audit Logs screen an
  // administrator already uses shows access changes alongside everything else.
  void logUserActivity({
    userId: actor.userId,
    userName: actor.userName,
    module: 'Settings',
    action: 'Grant Access',
    recordId: batchId,
    recordRef: batchId,
    sessionId: device.sessionId ?? undefined,
    userAgent: device.userAgent ?? undefined,
    details: {
      usersSelected: users.length,
      usersUpdated,
      alreadyHadAccess: usersAlreadyHadAccess,
      permissionsAdded,
      permissionsRemoved: 0,
      roles: uniqueRoleNames(auditEntries),
      reason: input.reason ?? null,
    },
  });

  return result;
}

/** Turn template ids into the roles, permissions and projects they stand for. */
function expandTemplates(
  request: AccessAssignmentRequest,
  templates: AccessTemplate[],
): AccessAssignmentRequest {
  if (!request.templateIds?.length) return request;

  const roleIds = [...(request.roleIds ?? [])];
  const projectIds = [...(request.projectIds ?? [])];
  let permissions: PermissionMap = { ...(request.directPermissions ?? {}) };

  for (const templateId of request.templateIds) {
    const template = templates.find((entry) => entry.id === templateId);
    if (!template) continue;
    roleIds.push(...(template.roleIds ?? []));
    projectIds.push(...(template.projectIds ?? []));
    permissions = mergePermissionMaps(permissions, template.permissions);
  }

  return { ...request, roleIds, projectIds, directPermissions: permissions, templateIds: [] };
}

/** Every pair the request asked for, so the audit row can say which were already held. */
function requestedPairs(request: AccessAssignmentRequest, roles: RoleLike[]): Set<string> {
  const roleMaps = (request.roleIds ?? [])
    .map((roleId) => roles.find((role) => role.id === roleId)?.permissions)
    .filter(Boolean) as PermissionMap[];
  const merged = mergePermissionMaps(...roleMaps, request.directPermissions);
  const out = new Set<string>();
  for (const [resource, actions] of Object.entries(merged)) {
    for (const action of actions) out.add(`${resource}::${action}`);
  }
  return out;
}

const uniqueRoleNames = (entries: AccessAuditEntry[]): string[] =>
  [...new Set(entries.flatMap((entry) => entry.roleNames))].filter(Boolean);

/** Firestore caps a batch at 500 writes; a thousand-user assignment needs chunking. */
async function commitGrants(writes: Array<{ userId: string; grant: UserAccessGrant }>): Promise<void> {
  const CHUNK = 400;
  for (let index = 0; index < writes.length; index += CHUNK) {
    const batch = writeBatch(db);
    for (const entry of writes.slice(index, index + CHUNK)) {
      batch.set(
        doc(db, ACCESS_COLLECTIONS.grants, entry.userId),
        stripUndefined({ ...entry.grant, syncedAt: serverTimestamp() }),
        { merge: true },
      );
    }
    await batch.commit();
  }
}

/**
 * Audit rows are written after the grants, never inside the same batch.
 *
 * A failed audit write must not roll back a successful grant — the user's access is the fact, and
 * an unlogged change is recoverable from the grant document's own provenance stamps. The reverse
 * (a logged change that did not happen) would be worse.
 */
async function writeAuditEntries(entries: AccessAuditEntry[]): Promise<void> {
  if (!entries.length) return;
  const CHUNK = 400;
  for (let index = 0; index < entries.length; index += CHUNK) {
    try {
      const batch = writeBatch(db);
      for (const entry of entries.slice(index, index + CHUNK)) {
        batch.set(
          doc(collection(db, ACCESS_COLLECTIONS.auditLogs)),
          stripUndefined({ ...entry, createdAt: serverTimestamp() }),
        );
      }
      await batch.commit();
    } catch (error) {
      console.error('[access-control] Failed to write audit entries', error);
    }
  }
}

async function writeBatchRecord(record: AccessBatchRecord): Promise<void> {
  try {
    await setDoc(doc(db, ACCESS_COLLECTIONS.batches, record.id), stripUndefined(record));
  } catch (error) {
    console.error('[access-control] Failed to write batch record', error);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Removing access (§17, §47)
 * ---------------------------------------------------------------------------------------------- */

export interface RevokeAccessInput {
  users: User[];
  request: AccessRemovalRequest;
  directory: Pick<AccessDirectory, 'roles' | 'grants' | 'scopeGrants'>;
  actor: AccessActor;
  /** Required. Removing access without a stated reason is not a supported operation. */
  reason: string;
  label?: string;
}

export interface RevokeAccessResult {
  batchId: string;
  usersUpdated: number;
  permissionsRemoved: number;
  /** Pairs that survived because another source still grants them — the §17 reassurance. */
  permissionsRetained: number;
  failures: Array<{ userId: string; userName: string; message: string }>;
}

/**
 * A deliberately separate workflow from `grantAccess`, as §47 requires.
 *
 * The two operations look symmetrical and are not: granting is additive and safe enough to do in
 * bulk from a filter, while revoking reduces what somebody can do and demands a reason, a
 * confirmation and its own audit trail. Keeping them in separate functions is what stops a UI
 * refactor from accidentally routing "Add Access" through a code path that can subtract.
 */
export async function revokeAccess(input: RevokeAccessInput): Promise<RevokeAccessResult> {
  const { users, request, directory, actor } = input;
  if (!input.reason?.trim()) throw new Error('A reason is required to remove access.');

  const batchId = await nextBatchId();
  const changedAt = new Date().toISOString();
  const device = deviceContext();

  const failures: RevokeAccessResult['failures'] = [];
  const auditEntries: AccessAuditEntry[] = [];
  const writes: Array<{ userId: string; grant: UserAccessGrant }> = [];
  let permissionsRemoved = 0;
  let permissionsRetained = 0;

  for (const user of users) {
    try {
      const current = directory.grants[user.id] ?? emptyUserAccessGrant(user.id);
      const outcome = removeAccessFromGrant(user as ResolveAccessUser, current, request, {
        roles: directory.roles as RoleLike[],
        scopeGrants: directory.scopeGrants,
        actor: { userId: actor.userId, userName: actor.userName, batchId },
      });

      writes.push({ userId: user.id, grant: outcome.grant });
      permissionsRemoved += outcome.permissionsLost.length;
      permissionsRetained += outcome.permissionsRetainedByOtherSources.length;

      auditEntries.push({
        targetUserId: user.id,
        targetUserName: user.name || user.email || user.id,
        action: 'Revoke Access',
        roleNames: current.additionalRoles
          .filter((entry) => (request.roleIds ?? []).includes(entry.roleId))
          .map((entry) => entry.roleName),
        permissionsAdded: [],
        permissionsRemoved: outcome.permissionsLost,
        permissionsSkipped: outcome.permissionsRetainedByOtherSources,
        sourceKind: 'Additional Role',
        changedBy: actor.userId,
        changedByName: actor.userName,
        changedAt,
        reason: input.reason,
        batchId,
        ipAddress: null,
        userAgent: device.userAgent,
        organizationId: actor.organizationId ?? null,
      });
    } catch (error) {
      failures.push({
        userId: user.id,
        userName: user.name || user.id,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  await commitGrants(writes);
  await writeAuditEntries(auditEntries);
  await writeBatchRecord({
    id: batchId,
    label: input.label || 'Remove additional access',
    action: 'Revoke Access',
    roleNames: uniqueRoleNames(auditEntries),
    performedBy: actor.userId,
    performedByName: actor.userName,
    performedAt: changedAt,
    userCount: users.length,
    successCount: writes.length,
    skippedCount: 0,
    failedCount: failures.length,
    permissionsAdded: 0,
    permissionsRemoved,
    reason: input.reason,
    failures,
    organizationId: actor.organizationId ?? null,
  });

  void logUserActivity({
    userId: actor.userId,
    userName: actor.userName,
    module: 'Settings',
    action: 'Revoke Access',
    recordId: batchId,
    recordRef: batchId,
    sessionId: device.sessionId ?? undefined,
    details: {
      users: users.map((user) => user.name || user.id),
      permissionsRemoved,
      permissionsRetainedByOtherSources: permissionsRetained,
      reason: input.reason,
    },
  });

  return { batchId, usersUpdated: writes.length, permissionsRemoved, permissionsRetained, failures };
}

/** Suspend or resume the whole additive layer for one user, leaving their base role alone. */
export async function setAccessLayerStatus(
  user: User,
  status: 'Active' | 'Suspended',
  actor: AccessActor,
  reason: string,
): Promise<void> {
  const current = await getUserAccessGrant(user.id);
  await setDoc(
    doc(db, ACCESS_COLLECTIONS.grants, user.id),
    stripUndefined({
      ...current,
      status,
      updatedBy: actor.userId,
      updatedByName: actor.userName,
      updatedAt: new Date().toISOString(),
    }),
    { merge: true },
  );

  await writeAuditEntries([
    {
      targetUserId: user.id,
      targetUserName: user.name || user.id,
      action: status === 'Suspended' ? 'Suspend Access Layer' : 'Resume Access Layer',
      roleNames: [],
      permissionsAdded: [],
      permissionsRemoved: [],
      permissionsSkipped: [],
      sourceKind: 'System',
      changedBy: actor.userId,
      changedByName: actor.userName,
      changedAt: new Date().toISOString(),
      reason,
      organizationId: actor.organizationId ?? null,
    },
  ]);
}

/* ------------------------------------------------------------------------------------------------
 * Account status — disable a login, for a while or for good
 * ---------------------------------------------------------------------------------------------- */

/** The actor on audit rows nobody wrote — a temporary deactivation reaching its date. */
const SYSTEM_ACTOR: AccessActor = { userId: 'system', userName: 'System — deactivation period ended' };

function accountAuditEntry(
  user: User,
  action: AccessAuditEntry['action'],
  actor: AccessActor,
  reason: string,
  changedAt: string,
): AccessAuditEntry {
  return {
    targetUserId: user.id,
    targetUserName: user.name || user.email || user.id,
    action,
    roleNames: [],
    permissionsAdded: [],
    permissionsRemoved: [],
    permissionsSkipped: [],
    sourceKind: 'System',
    changedBy: actor.userId,
    changedByName: actor.userName,
    changedAt,
    reason,
    organizationId: actor.organizationId ?? null,
  };
}

export interface DeactivateAccountInput {
  user: User;
  /** ISO timestamp after which the account comes back on its own; null (or omitted) for permanent. */
  until?: string | null;
  reason: string;
  actor: AccessActor;
}

/**
 * Deactivate an account: `users/{id}.status = 'Inactive'`, which is what every gate already checks —
 * the AuthProvider signs the user out, the API routes refuse them, and the resolver drops their
 * additive access. Nothing is deleted: roles, grants and history stay, so reactivation restores
 * exactly what they had. A temporary deactivation records `until`; `deactivationHasLapsed` says
 * how it lifts itself.
 */
export async function deactivateUserAccount({ user, until = null, reason, actor }: DeactivateAccountInput): Promise<void> {
  if (user.id === actor.userId) {
    throw new Error("You can't disable your own account. Ask another administrator if it is really needed.");
  }
  const now = new Date().toISOString();
  const deactivation: UserDeactivation = {
    until,
    reason,
    deactivatedBy: actor.userId,
    deactivatedByName: actor.userName,
    deactivatedAt: now,
  };
  await updateDoc(doc(db, ACCESS_COLLECTIONS.users, user.id), { status: 'Inactive', deactivation });

  await writeAuditEntries([
    accountAuditEntry(
      user,
      until ? 'Deactivate Account Temporarily' : 'Deactivate Account',
      actor,
      until ? `${reason} (until ${formatGrantDate(until)})` : reason,
      now,
    ),
  ]);
  void logUserActivity({
    userId: actor.userId,
    userName: actor.userName,
    module: 'Settings',
    action: until ? 'Deactivate User Temporarily' : 'Deactivate User',
    recordId: user.id,
    recordRef: user.name || user.email || user.id,
    details: { until, reason },
  });
}

/** The reverse: the account can sign in again, with everything it had. */
export async function reactivateUserAccount(user: User, actor: AccessActor, reason: string): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(doc(db, ACCESS_COLLECTIONS.users, user.id), { status: 'Active', deactivation: deleteField() });
  await writeAuditEntries([accountAuditEntry(user, 'Reactivate Account', actor, reason, now)]);
  void logUserActivity({
    userId: actor.userId,
    userName: actor.userName,
    module: 'Settings',
    action: 'Reactivate User',
    recordId: user.id,
    recordRef: user.name || user.email || user.id,
    details: { reason },
  });
}

/**
 * Lift every temporary deactivation whose date has passed, and return the users as they now are.
 *
 * Called wherever users are loaded — the directory, the user's own sign-in — because nothing
 * scheduled does it. The audit row is attributed to the system: no administrator made this change.
 */
export async function reactivateLapsedDeactivations(users: User[], now = new Date()): Promise<User[]> {
  const lapsed = users.filter((user) => deactivationHasLapsed(user, now));
  if (!lapsed.length) return users;

  const at = now.toISOString();
  await Promise.all(
    lapsed.map(async (user) => {
      await updateDoc(doc(db, ACCESS_COLLECTIONS.users, user.id), { status: 'Active', deactivation: deleteField() });
      await writeAuditEntries([
        accountAuditEntry(
          user,
          'Reactivate Account',
          SYSTEM_ACTOR,
          `Temporary deactivation until ${formatGrantDate(user.deactivation?.until)} ended.`,
          at,
        ),
      ]);
    }),
  );

  const lifted = new Set(lapsed.map((user) => user.id));
  return users.map((user) =>
    lifted.has(user.id) ? { ...user, status: 'Active' as const, deactivation: null } : user,
  );
}

/* ------------------------------------------------------------------------------------------------
 * Roles (§38, §39)
 * ---------------------------------------------------------------------------------------------- */

export interface SaveRoleInput {
  id?: string;
  name: string;
  description?: string;
  type?: 'System' | 'Custom';
  status?: 'Active' | 'Inactive';
  permissions: PermissionMap;
  duplicatedFrom?: Role | null;
}

/**
 * Create or update a role.
 *
 * The one place in this module that writes `roles/{doc}.permissions`, and it does so only when an
 * administrator is explicitly editing a role in the Role Builder. Assignment never comes through
 * here — which is what keeps "assign a role to somebody" from being able to change what that role
 * means for everybody else holding it.
 */
export async function saveRole(input: SaveRoleInput, actor: AccessActor): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('A role needs a name.');

  const timestamp = new Date().toISOString();
  const payload = stripUndefined({
    name,
    description: input.description?.trim() || '',
    type: input.type ?? 'Custom',
    status: input.status ?? 'Active',
    permissions: input.permissions,
    duplicatedFromRoleId: input.duplicatedFrom?.id,
    duplicatedFromRoleName: input.duplicatedFrom?.name,
    updatedAt: timestamp,
    updatedBy: actor.userId,
    updatedByName: actor.userName,
  });

  let roleId = input.id ?? '';
  if (roleId) {
    await updateDoc(doc(db, ACCESS_COLLECTIONS.roles, roleId), payload);
  } else {
    const existing = await getDocs(
      query(collection(db, ACCESS_COLLECTIONS.roles), where('name', '==', name)),
    );
    if (!existing.empty) throw new Error(`A role named "${name}" already exists.`);
    const created = await addDoc(collection(db, ACCESS_COLLECTIONS.roles), {
      ...payload,
      createdAt: timestamp,
      createdBy: actor.userId,
      createdByName: actor.userName,
    });
    roleId = created.id;
  }

  await writeAuditEntries([
    {
      targetUserId: roleId,
      targetUserName: name,
      action: input.id ? 'Update Role' : input.duplicatedFrom ? 'Duplicate Role' : 'Create Role',
      roleNames: [name],
      permissionsAdded: [],
      permissionsRemoved: [],
      permissionsSkipped: [],
      sourceKind: 'System',
      changedBy: actor.userId,
      changedByName: actor.userName,
      changedAt: timestamp,
      reason: input.duplicatedFrom ? `Duplicated from ${input.duplicatedFrom.name}` : undefined,
      organizationId: actor.organizationId ?? null,
    },
  ]);

  void logUserActivity({
    userId: actor.userId,
    userName: actor.userName,
    module: 'Settings',
    action: input.id ? 'Update Role' : 'Create Role',
    recordId: roleId,
    recordRef: name,
    details: { name, permissionCount: countPermissions(input.permissions) },
  });

  return roleId;
}

/**
 * Disable a role rather than delete it.
 *
 * Deleting would orphan every `users.role` string pointing at it — the User Management screen
 * already warns about users whose role "no longer exists", and this module is not going to create
 * more of them. Disabling stops it granting while leaving the reference resolvable.
 */
export async function setRoleStatus(
  role: Role,
  status: 'Active' | 'Inactive',
  actor: AccessActor,
  reason: string,
): Promise<void> {
  if (status === 'Inactive' && isProtectedRole(role.name)) {
    throw new Error(`"${role.name}" is a protected role and cannot be disabled from this screen.`);
  }
  await updateDoc(doc(db, ACCESS_COLLECTIONS.roles, role.id), {
    status,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.userId,
    updatedByName: actor.userName,
  });
  await writeAuditEntries([
    {
      targetUserId: role.id,
      targetUserName: role.name,
      action: 'Disable Role',
      roleNames: [role.name],
      permissionsAdded: [],
      permissionsRemoved: [],
      permissionsSkipped: [],
      sourceKind: 'System',
      changedBy: actor.userId,
      changedByName: actor.userName,
      changedAt: new Date().toISOString(),
      reason,
      organizationId: actor.organizationId ?? null,
    },
  ]);
}

/**
 * Refuse to disable or revoke the last administrator's access (§31).
 *
 * Called by the UI before it offers the action, and again before it performs it. Expressed over
 * *capability* rather than role name so a system administered through a custom role is protected
 * too, and a system whose only remaining "Super Admin" is deactivated is correctly treated as
 * unprotected.
 */
export function checkAdministrationSurvives(
  directory: Pick<AccessDirectory, 'users' | 'roles' | 'grants' | 'scopeGrants'>,
  removingUserIds: string[],
): { safe: boolean; message?: string } {
  const administrators = directory.users
    .filter((user) => {
      const access = effectiveAccessFor(user, directory);
      return (
        (access.permissions['Settings.User Management'] ?? []).includes('Edit') &&
        (access.permissions['Settings.Role Management'] ?? []).includes('Edit')
      );
    })
    .map((user) => ({ userId: user.id, status: user.status }));

  if (wouldStrandAdministration(administrators, removingUserIds)) {
    return {
      safe: false,
      message:
        'This would leave nobody able to manage users and roles. Grant another active user ' +
        'administrator access first.',
    };
  }
  return { safe: true };
}

/* ------------------------------------------------------------------------------------------------
 * Templates (§24) and scope grants (§21)
 * ---------------------------------------------------------------------------------------------- */

export async function saveAccessTemplate(
  template: Omit<AccessTemplate, 'id'> & { id?: string },
  actor: AccessActor,
): Promise<string> {
  const timestamp = new Date().toISOString();
  const payload = stripUndefined({
    ...template,
    name: template.name.trim(),
    updatedAt: timestamp,
    updatedBy: actor.userId,
  });
  if (template.id) {
    await updateDoc(doc(db, ACCESS_COLLECTIONS.templates, template.id), payload);
    return template.id;
  }
  const created = await addDoc(collection(db, ACCESS_COLLECTIONS.templates), {
    ...payload,
    createdAt: timestamp,
    createdBy: actor.userId,
    createdByName: actor.userName,
  });
  return created.id;
}

export async function deleteAccessTemplate(templateId: string): Promise<void> {
  await updateDoc(doc(db, ACCESS_COLLECTIONS.templates, templateId), { active: false });
}

export async function saveScopeGrant(
  config: Omit<ScopeGrantConfig, 'id'> & { id?: string },
  actor: AccessActor,
): Promise<string> {
  const timestamp = new Date().toISOString();
  const payload = stripUndefined({
    ...config,
    assignedBy: actor.userId,
    assignedByName: actor.userName,
    assignedAt: timestamp,
  });
  // Keyed by scope so a department can only have one configuration — the alternative is two
  // documents for "Finance" that disagree, and no way to tell which is meant.
  const id = config.id || `${config.scopeType}_${config.scopeId}`;
  await setDoc(doc(db, ACCESS_COLLECTIONS.scopeGrants, id), payload, { merge: true });
  return id;
}

/* ------------------------------------------------------------------------------------------------
 * Audit and batch history (§27, §28)
 * ---------------------------------------------------------------------------------------------- */

export interface AuditQuery {
  targetUserId?: string;
  batchId?: string;
  changedBy?: string;
  /** ISO date strings. */
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Read the access audit trail.
 *
 * Filtering is applied in the query where Firestore can index it and in memory otherwise. A
 * composite index on every combination of five filters is not worth maintaining for a screen an
 * administrator opens occasionally, and the collection is bounded by how often permissions change.
 */
export async function listAccessAuditEntries(filter: AuditQuery = {}): Promise<AccessAuditEntry[]> {
  const constraints: QueryConstraint[] = [];
  if (filter.targetUserId) constraints.push(where('targetUserId', '==', filter.targetUserId));
  else if (filter.batchId) constraints.push(where('batchId', '==', filter.batchId));

  constraints.push(orderBy('changedAt', 'desc'));
  constraints.push(fsLimit(filter.limit ?? 200));

  try {
    const snapshot = await getDocs(query(collection(db, ACCESS_COLLECTIONS.auditLogs), ...constraints));
    return snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }) as AccessAuditEntry)
      .filter((entry) => {
        if (filter.changedBy && entry.changedBy !== filter.changedBy) return false;
        if (filter.from && entry.changedAt < filter.from) return false;
        if (filter.to && entry.changedAt > filter.to) return false;
        if (filter.batchId && entry.batchId !== filter.batchId) return false;
        return true;
      });
  } catch (error) {
    // A missing composite index should not blank the screen — fall back to an unordered read and
    // sort in memory, which is correct for the page sizes involved.
    console.warn('[access-control] Falling back to unordered audit read', error);
    const snapshot = await getDocs(collection(db, ACCESS_COLLECTIONS.auditLogs));
    return snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }) as AccessAuditEntry)
      .filter((entry) => {
        if (filter.targetUserId && entry.targetUserId !== filter.targetUserId) return false;
        if (filter.batchId && entry.batchId !== filter.batchId) return false;
        if (filter.changedBy && entry.changedBy !== filter.changedBy) return false;
        if (filter.from && entry.changedAt < filter.from) return false;
        if (filter.to && entry.changedAt > filter.to) return false;
        return true;
      })
      .sort((a, b) => (b.changedAt || '').localeCompare(a.changedAt || ''))
      .slice(0, filter.limit ?? 200);
  }
}

export async function listAccessBatches(max = 100): Promise<AccessBatchRecord[]> {
  try {
    const snapshot = await getDocs(
      query(collection(db, ACCESS_COLLECTIONS.batches), orderBy('performedAt', 'desc'), fsLimit(max)),
    );
    return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as AccessBatchRecord);
  } catch {
    const snapshot = await getDocs(collection(db, ACCESS_COLLECTIONS.batches));
    return snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }) as AccessBatchRecord)
      .sort((a, b) => (b.performedAt || '').localeCompare(a.performedAt || ''))
      .slice(0, max);
  }
}

/* ------------------------------------------------------------------------------------------------
 * User creation from this screen (§14)
 * ---------------------------------------------------------------------------------------------- */

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  mobile?: string;
  /** The legacy single role. Written to `users.role`, exactly as User Management does. */
  baseRole: string;
  status?: 'Active' | 'Inactive';
  additionalRoleIds?: string[];
  departmentIds?: string[];
  designations?: string[];
  projectIds?: string[];
  reportingManagerId?: string;
  location?: string;
  /**
   * The greytHR employee this account belongs to, when it was created by picking one.
   *
   * Written onto the *user* document rather than only the grant, because it is the join the greytHR
   * sync uses to decide whose login a resignation applies to. Email alone is fragile — a changed
   * work address silently breaks the match, and the failure is invisible until somebody's exit does
   * not take effect. See `matchUserForEmployee` in `src/lib/greythr.ts`.
   */
  employeeId?: string;
  employeeNo?: string;
}

/**
 * Create a user without leaving the access screen (§14).
 *
 * Delegates to the same protected API User Management uses. The server verifies Add User and access
 * assignment permissions, creates Firebase Auth without swapping the administrator's session, and
 * commits the profile plus grant as one recoverable workflow.
 *
 * The extra fields this screen collects go into the *grant* document, never onto the user record,
 * so nothing downstream that reads `users` sees a shape it does not expect.
 */
export async function createUserWithAccess(
  input: CreateUserInput,
  _actor: AccessActor,
): Promise<{ userId: string; user: User; welcomeEmailSent: boolean }> {
  const result = await createPlatformUser({
    ...input,
    createAccessGrant: true,
  });
  return { userId: result.user.id, ...result };
}
