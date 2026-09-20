/**
 * Who may see and do what in the Windows Agent module (§36, §37, §17).
 *
 * Built on the existing `access-control.ts` resolver, which has no imports at all, so this module
 * stays runnable under `node --test` and inside the Admin-SDK ingest routes. §36 says to *add*
 * permissions rather than replace any, and that is what this is: a user's Windows Agent access
 * comes from the same role documents, the same additive grants and the same live listener as their
 * access to every other module, so an administrator who grants a role does not have to know this
 * module exists.
 *
 * ── Why the specification's permission names are not the ones used ─────────────────────────────
 *
 * §36 lists `windows_agent.view`, `windows_device.manage`, `windows_activity.team` and so on. Those
 * are not expressible in this application. Every permission check in the codebase — several hundred
 * call sites, Role Management's editor, the access-management grant screens, the Module Hub's card
 * grid — resolves `can(action, "Module.Page")` against a nested map keyed by display names. A
 * snake-case key would be storable but unreachable: no role editor would offer it, no additive
 * grant could target it, and `canAccessModule('Windows Agent')` would return false for a user who
 * held every one of them.
 *
 * So the same distinctions are kept and spelled the way the rest of the application spells them:
 *
 *     windows_activity.self   →  can('View Own',        'Windows Agent.Activity')
 *     windows_activity.team   →  can('View Team',       'Windows Agent.Activity')
 *     windows_activity.all    →  can('View All',        'Windows Agent.Activity')
 *     windows_device.manage   →  can('Edit',            'Windows Agent.Devices')
 *     windows_policy.manage   →  can('Edit',            'Windows Agent.Policies')
 *
 * Nothing is lost and Role Management can administer it on day one.
 *
 * ── Two rules that are not about permissions ───────────────────────────────────────────────────
 *
 *  1. **Seeing your own record is not a privilege.** §52 asks for a system employees can see the
 *     workings of, and §37 offers them their own page. Requiring a granted permission for that
 *     means that on the day monitoring switches on, every employee is measured and none of them
 *     can see what was measured. So `canViewOwnActivity` is satisfied by an *installation setting*
 *     that defaults to on, not by a grant — an organisation can still switch it off, but it has to
 *     decide to.
 *
 *  2. **A scope grant is answered by the narrowest rule that covers the subject.** A department
 *     manager holding `View Department` sees their department and no further, and the filter is
 *     applied in the query rather than in the page, so the data never reaches a browser that is
 *     not entitled to it.
 */

import { hasAnyPermission, hasPermission, type PermissionSubject } from './access-control.ts';

export const WINDOWS_AGENT_PERMISSION_RESOURCE = 'Windows Agent';
export const WINDOWS_AGENT_ACTIVITY_MODULE = 'Windows Agent';
export const WINDOWS_AGENT_BASE_PATH = '/windows-agent';

/** The dotted permission resources this module gates on. One constant per screen. */
export const WINDOWS_AGENT_RESOURCES = {
  module: 'Windows Agent',
  dashboard: 'Windows Agent.Dashboard',
  live: 'Windows Agent.Live Users',
  devices: 'Windows Agent.Devices',
  enrollment: 'Windows Agent.Enrollment Codes',
  sessions: 'Windows Agent.Sessions',
  activity: 'Windows Agent.Activity',
  attendance: 'Windows Agent.Attendance',
  applications: 'Windows Agent.Applications',
  reports: 'Windows Agent.Reports',
  notifications: 'Windows Agent.Notifications',
  policies: 'Windows Agent.Policies',
  versions: 'Windows Agent.Agent Versions',
  audit: 'Windows Agent.Audit Logs',
  monitoringPolicy: 'Windows Agent.Monitoring Policy',
} as const;

/**
 * Who is asking, and where they sit.
 *
 * Assembled once per session from the auth context. Deliberately plain data, so the same object is
 * built by the browser hook and by the API routes and the answers cannot diverge.
 */
export interface WindowsAgentViewer {
  userId: string;
  userName: string;
  permissions: PermissionSubject;
  /** Departments the viewer belongs to, from the additive access layer. */
  departmentIds: string[];
  /** User ids the viewer manages, if the installation models a reporting line. */
  teamUserIds: string[];
  /** Whether the installation lets employees open `/windows-agent/my-activity` (§37). */
  selfViewEnabled: boolean;
}

const can = (viewer: WindowsAgentViewer, resource: string, action: string): boolean =>
  hasPermission(viewer.permissions, resource, action);

/* ------------------------------------------------------------------------------------------------
 * Module and page access
 * ---------------------------------------------------------------------------------------------- */

/**
 * May this person open the module at all?
 *
 * Any single page grant is enough — the layout hides the sections they cannot use. Requiring an
 * explicit `View Module` on top would mean a manager granted only the attendance report could not
 * reach it, which is the failure mode `canAccessModule` exists to avoid elsewhere in the app.
 */
export function canOpenWindowsAgent(viewer: WindowsAgentViewer): boolean {
  if (can(viewer, WINDOWS_AGENT_RESOURCES.module, 'View Module')) return true;
  return hasAnyPermission(viewer.permissions, [
    { resource: WINDOWS_AGENT_RESOURCES.dashboard, action: 'View' },
    { resource: WINDOWS_AGENT_RESOURCES.live, action: 'View' },
    { resource: WINDOWS_AGENT_RESOURCES.devices, action: 'View' },
    { resource: WINDOWS_AGENT_RESOURCES.sessions, action: 'View' },
    { resource: WINDOWS_AGENT_RESOURCES.attendance, action: 'View' },
    { resource: WINDOWS_AGENT_RESOURCES.applications, action: 'View' },
    { resource: WINDOWS_AGENT_RESOURCES.reports, action: 'View' },
    { resource: WINDOWS_AGENT_RESOURCES.notifications, action: 'View' },
    { resource: WINDOWS_AGENT_RESOURCES.policies, action: 'View' },
    { resource: WINDOWS_AGENT_RESOURCES.versions, action: 'View' },
    { resource: WINDOWS_AGENT_RESOURCES.audit, action: 'View' },
    { resource: WINDOWS_AGENT_RESOURCES.activity, action: 'View Team' },
    { resource: WINDOWS_AGENT_RESOURCES.activity, action: 'View Department' },
    { resource: WINDOWS_AGENT_RESOURCES.activity, action: 'View All' },
  ]);
}

/**
 * §17's live board is explicitly not for ordinary users.
 *
 * It shows, in real time, what every colleague currently has on screen. That is the single most
 * sensitive screen in the module, so it takes its own permission and is never implied by any other.
 */
export function canViewLiveBoard(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.live, 'View');
}

export function canViewDevices(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.devices, 'View');
}

export function canManageDevices(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.devices, 'Edit');
}

/** §34's high-impact actions. Each one is separate because each one has a different blast radius. */
export function canBlockDevice(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.devices, 'Block');
}

export function canAssignDeviceUsers(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.devices, 'Assign Users');
}

export function canForceReauth(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.devices, 'Force Re-authentication');
}

export function canSignOutUser(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.devices, 'Sign Out User');
}

export function canManageEnrollmentCodes(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.enrollment, 'Create');
}

export function canManagePolicies(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.policies, 'Edit');
}

export function canViewPolicies(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.policies, 'View') || canManagePolicies(viewer);
}

export function canSendNotifications(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.notifications, 'Send');
}

/**
 * Broadcasting to the whole company is separate from sending to a person or a department.
 *
 * "All Employees" in §38's target list is the one option that cannot be taken back once it has
 * popped up on four hundred screens, so it is nobody's by default even among people who can send.
 */
export function canBroadcastNotifications(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.notifications, 'Send Broadcast');
}

export function canManageVersions(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.versions, 'Publish');
}

export function canTriggerAgentUpdate(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.versions, 'Trigger Update');
}

export function canViewAudit(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.audit, 'View');
}

export function canViewAttendance(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.attendance, 'View');
}

/**
 * §21 allows attendance to be corrected — a session that ended uncleanly, a login recorded against
 * the wrong device. Every such edit is written to the audit trail with both values (§50), and the
 * original machine-recorded figures are never overwritten, only annotated.
 */
export function canEditAttendance(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.attendance, 'Edit');
}

export function canCategoriseApplications(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.applications, 'Categorise');
}

export function canExportReports(viewer: WindowsAgentViewer): boolean {
  return can(viewer, WINDOWS_AGENT_RESOURCES.reports, 'Export');
}

/* ------------------------------------------------------------------------------------------------
 * Activity scope (§36 — "Department managers should see only permitted team members")
 * ---------------------------------------------------------------------------------------------- */

/** How wide a person's view of other people's activity is. */
export type ActivityScope =
  | { kind: 'NONE' }
  | { kind: 'SELF'; userId: string }
  | { kind: 'TEAM'; userIds: string[]; selfUserId: string }
  | { kind: 'DEPARTMENT'; departmentIds: string[]; selfUserId: string }
  | { kind: 'ALL' };

/**
 * The widest scope this viewer holds.
 *
 * Returned as data rather than as a boolean per subject, because the callers that matter are
 * *queries*: the attendance register and the department report have to constrain a Firestore query
 * before it runs, and a per-row predicate applied afterwards would mean shipping every employee's
 * day to a browser entitled to see six of them.
 */
export function resolveActivityScope(viewer: WindowsAgentViewer): ActivityScope {
  if (can(viewer, WINDOWS_AGENT_RESOURCES.activity, 'View All')) return { kind: 'ALL' };
  if (can(viewer, WINDOWS_AGENT_RESOURCES.activity, 'View Department')) {
    return {
      kind: 'DEPARTMENT',
      departmentIds: [...viewer.departmentIds],
      selfUserId: viewer.userId,
    };
  }
  if (can(viewer, WINDOWS_AGENT_RESOURCES.activity, 'View Team')) {
    return {
      kind: 'TEAM',
      // A manager is part of their own team's picture; leaving themselves out of their own report
      // is the kind of gap that gets noticed once and then distrusted forever.
      userIds: Array.from(new Set([...viewer.teamUserIds, viewer.userId])),
      selfUserId: viewer.userId,
    };
  }
  if (canViewOwnActivity(viewer)) return { kind: 'SELF', userId: viewer.userId };
  return { kind: 'NONE' };
}

/** §37. Satisfied by the installation setting, or by any wider grant — see the header. */
export function canViewOwnActivity(viewer: WindowsAgentViewer): boolean {
  if (can(viewer, WINDOWS_AGENT_RESOURCES.activity, 'View Own')) return true;
  if (can(viewer, WINDOWS_AGENT_RESOURCES.activity, 'View Team')) return true;
  if (can(viewer, WINDOWS_AGENT_RESOURCES.activity, 'View Department')) return true;
  if (can(viewer, WINDOWS_AGENT_RESOURCES.activity, 'View All')) return true;
  return viewer.selfViewEnabled;
}

/** Whether this viewer may see one named person's activity. */
export function canViewActivityOf(
  viewer: WindowsAgentViewer,
  subject: { userId: string; departmentId: string | null },
): boolean {
  const scope = resolveActivityScope(viewer);
  switch (scope.kind) {
    case 'ALL':
      return true;
    case 'DEPARTMENT':
      if (subject.userId === scope.selfUserId) return true;
      return Boolean(subject.departmentId) && scope.departmentIds.includes(subject.departmentId as string);
    case 'TEAM':
      return scope.userIds.includes(subject.userId);
    case 'SELF':
      return subject.userId === scope.userId;
    default:
      return false;
  }
}

/**
 * Reduce a list of candidate users to the ones this viewer may see.
 *
 * Used by the pages that already hold a list — the live board and the department report — where
 * re-querying per row would be wasteful. Query-level narrowing still happens first; this is the
 * belt to that pair of braces.
 */
export function filterVisibleSubjects<T extends { userId: string; departmentId: string | null }>(
  viewer: WindowsAgentViewer,
  subjects: readonly T[],
): T[] {
  const scope = resolveActivityScope(viewer);
  if (scope.kind === 'ALL') return [...subjects];
  if (scope.kind === 'NONE') return [];
  return subjects.filter((subject) => canViewActivityOf(viewer, subject));
}

/* ------------------------------------------------------------------------------------------------
 * The sentence a blocked screen shows
 * ---------------------------------------------------------------------------------------------- */

/**
 * Why a page is refusing, in words an administrator can act on.
 *
 * Naming the permission is the whole point: "You do not have access" sends somebody to raise a
 * ticket that nobody can action, whereas "Requires View on Windows Agent.Live Users" is a request
 * a role administrator can grant in thirty seconds.
 */
export function accessMessageFor(resource: string, action = 'View'): string {
  return `You do not have permission to open this page. It requires ${action} on ${resource}.`;
}
