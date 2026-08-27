import 'server-only';

/**
 * Server-side authorisation over the additive access layer (§30).
 *
 * The UI deciding what to render is a convenience, not a control. Anybody can call an API route
 * directly, so every route that matters resolves the caller's *effective* permissions here — from
 * the same resolver the browser uses, over the same documents — and refuses what they do not hold.
 *
 * ── Why this exists as a shared module ──────────────────────────────────────────────────────────
 *
 * Each API route in this codebase currently hand-rolls the same twenty lines: read the bearer
 * token, verify it, look the user up by uid then by email, load the role by name, pull the
 * permission array out. That was fine when there was one source of permissions. With seven, a
 * route that forgets to consult the additive layer would quietly deny access somebody legitimately
 * has — so the lookup belongs in one place that every route can call.
 *
 * Existing routes are not obliged to migrate. `authenticateAccess` returns a superset of what their
 * own `authenticate()` computes (base role ∪ additions), so adopting it can only widen what a route
 * accepts, never narrow it.
 */

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from './firebase-admin';
import {
  canAccessModule,
  canAssignAccess,
  canManageRoles,
  canOpenAccessManagement,
  canRevokeAccess,
  checkerFor,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  normalizeUserAccessGrant,
  resolveEffectiveAccess,
  type EffectiveAccess,
  type PermissionMap,
  type PermissionRef,
  type RoleLike,
  type ScopeGrantConfig,
} from './access-control';

export class AccessDeniedError extends Error {
  constructor(
    message: string,
    readonly status: number = 403,
  ) {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

export interface AccessRequestContext {
  userId: string;
  userName: string;
  userEmail: string | null;
  /** The legacy single role name, unchanged. */
  role: string;
  organizationId: string;
  access: EffectiveAccess;
  permissions: PermissionMap;
  /** Base role plus every additional and in-force temporary role. */
  roleNames: string[];
  projectIds: string[];
  departmentIds: string[];
}

/**
 * Verify the caller and resolve everything they can do.
 *
 * Four reads: the user document (by uid, falling back to email exactly as `AuthProvider` does — a
 * user whose Firestore id is not their Firebase uid is a real state in this database), every role,
 * the caller's grant document, and the scope-grant configuration. Roles are read whole because the
 * resolver needs to look up additional roles by id and the base role by name, and the collection is
 * small.
 */
export async function authenticateAccess(request: Request): Promise<AccessRequestContext> {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new AccessDeniedError('Authentication required.', 401);

  const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
  const firestore = getFirebaseAdminFirestore();

  let userSnapshot = await firestore.collection('users').doc(decoded.uid).get();
  if (!userSnapshot.exists && decoded.email) {
    const byEmail = await firestore
      .collection('users')
      .where('email', '==', decoded.email.toLowerCase())
      .limit(1)
      .get();
    if (!byEmail.empty) userSnapshot = byEmail.docs[0];
  }
  if (!userSnapshot.exists) throw new AccessDeniedError('The signed-in user is not registered.');

  const userData = userSnapshot.data() || {};
  if (userData.status === 'Inactive') throw new AccessDeniedError('This user account is inactive.');

  const userId = userSnapshot.id;

  const [rolesSnapshot, grantSnapshot, scopeSnapshot] = await Promise.all([
    firestore.collection('roles').get(),
    firestore.collection('accessGrants').doc(userId).get(),
    // Optional configuration: an installation that has never opened Access Management has none,
    // and a permissions error reading it must not turn into a failed request.
    firestore
      .collection('accessScopeGrants')
      .get()
      .catch(() => null),
  ]);

  const roles = rolesSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as RoleLike);
  const grant = normalizeUserAccessGrant(
    userId,
    grantSnapshot.exists ? (grantSnapshot.data() as Record<string, unknown>) : null,
  );
  const scopeGrants =
    scopeSnapshot?.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as ScopeGrantConfig) ?? [];

  const access = resolveEffectiveAccess({
    user: {
      id: userId,
      name: String(userData.name || ''),
      email: String(userData.email || ''),
      role: String(userData.role || ''),
      status: String(userData.status || 'Active'),
    },
    roles,
    grant,
    scopeGrants,
  });

  return {
    userId,
    userName: String(userData.name || userData.email || 'User'),
    userEmail: userData.email ? String(userData.email) : null,
    role: String(userData.role || ''),
    organizationId: String(userData.organizationId || 'default'),
    access,
    permissions: access.permissions,
    roleNames: access.effectiveRoleNames,
    projectIds: access.projectIds,
    departmentIds: access.departmentIds,
  };
}

/** Throw unless the caller holds `action` on `resource`. The one-liner routes should use. */
export function requireAccess(
  context: AccessRequestContext,
  resource: string,
  action: string,
  scope?: string,
): void {
  if (!hasPermission(context.access, resource, action, scope)) {
    throw new AccessDeniedError(
      `${action} permission on ${resource}${scope ? ` for ${scope}` : ''} is required.`,
    );
  }
}

export function requireAnyAccess(context: AccessRequestContext, refs: PermissionRef[]): void {
  if (!hasAnyPermission(context.access, refs)) {
    throw new AccessDeniedError(
      `One of the following permissions is required: ${refs
        .map((ref) => `${ref.action} on ${ref.resource}`)
        .join(', ')}.`,
    );
  }
}

export function requireAllAccess(context: AccessRequestContext, refs: PermissionRef[]): void {
  if (!hasAllPermissions(context.access, refs)) {
    throw new AccessDeniedError(
      `All of the following permissions are required: ${refs
        .map((ref) => `${ref.action} on ${ref.resource}`)
        .join(', ')}.`,
    );
  }
}

export function requireModuleAccess(context: AccessRequestContext, moduleName: string): void {
  if (!canAccessModule(context.access, moduleName)) {
    throw new AccessDeniedError(`Access to ${moduleName} is required.`);
  }
}

/**
 * Throw unless the caller may administer access.
 *
 * Delegates to the same four predicates the UI uses, rather than restating them: a server-side rule
 * that drifts from the client's is worse than either rule alone, because the screen would offer an
 * action the API then refuses.
 */
export function requireAccessAdministrator(
  context: AccessRequestContext,
  capability: 'view' | 'assign' | 'revoke' | 'roles' = 'assign',
): void {
  const can = checkerFor(context.access);
  const allowed =
    capability === 'view'
      ? canOpenAccessManagement(can)
      : capability === 'revoke'
        ? canRevokeAccess(can)
        : capability === 'roles'
          ? canManageRoles(can)
          : canAssignAccess(can);

  if (!allowed) {
    throw new AccessDeniedError(`Managing access requires administrator permission (${capability}).`);
  }
}

/** Whether the caller may act within a project, honouring project-scoped grants. */
export function canActOnProject(
  context: AccessRequestContext,
  projectId: string,
  resource: string,
  action: string,
): boolean {
  if (hasPermission(context.access, resource, action, projectId)) return true;
  // An unscoped grant covers every project — somebody who can view all projects can view this one.
  return hasPermission(context.access, resource, action);
}

/**
 * Turn an error into the status and message a route should return.
 *
 * Three cases, and the middle one exists because of a real failure: a missing Firebase
 * service-account key was being reported to the browser as "Something went wrong", which is
 * undiagnosable. A missing credential is an *operator* problem, not a security-sensitive detail —
 * telling the operator which variable to set costs nothing and saves them reading server logs.
 *
 * Genuine authorisation failures still say only what the caller is entitled to know.
 */
export function accessErrorResponse(error: unknown): { message: string; status: number } {
  if (error instanceof AccessDeniedError) return { message: error.message, status: error.status };

  const message = error instanceof Error ? error.message : '';

  // The Admin SDK could not initialise. Normal in local development, a deployment fault in
  // production — either way the fix is a configuration change, so say so.
  if (/FIREBASE_PRIVATE_KEY|service-account|applicationDefault|Application Default Credentials|Could not load the default credentials/i.test(message)) {
    return {
      message:
        'The server cannot reach Firebase Admin. Configure the service-account variables, or use ' +
        'keyless local credentials by running `gcloud auth application-default login` and setting ' +
        'FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS=true. This feature needs the Admin SDK.',
      status: 503,
    };
  }

  const code = (error as { errorInfo?: { code?: string }; code?: string })?.errorInfo?.code ??
    (error as { code?: string })?.code;
  if (typeof code === 'string' && code.startsWith('auth/')) {
    return { message: 'Your session has expired. Sign in again.', status: 401 };
  }

  console.error('[access-control-server] Unexpected error', error);
  return { message: 'Something went wrong.', status: 500 };
}
