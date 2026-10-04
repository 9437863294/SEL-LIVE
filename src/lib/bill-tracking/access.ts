/**
 * Who may do what, and on which projects, in Bill Tracking — as pure functions over the resolved
 * access, so the server context and the test suite apply exactly the same rules.
 *
 * - Module: `Bill Tracking · View Module` (or `Bills · View`) opens the module at all.
 * - Scope: `All Projects · View` sees every project. Anyone else sees only the projects granted to
 *   them in Access Management. No grants means no projects — never "all".
 * - Actions: `can(resource, action, projectId)` needs the project in scope *and* the permission,
 *   either granted for that project or held unscoped.
 */

import { hasPermission, type PermissionSubject } from '../access-control.ts';

export const BT_MODULE = 'Bill Tracking';

export type BtResource = 'All Projects' | 'Dashboard' | 'Bills' | 'Collections' | 'Retention' | 'Follow-ups' | 'Targets' | 'Import' | 'Reports' | 'Settings';

export interface BtAccess {
  hasModule: boolean;
  /** `null` = every project. */
  scope: string[] | null;
  inScope: (projectId: string) => boolean;
  can: (resource: BtResource, action: string, projectId?: string) => boolean;
}

export function resolveBtAccess(access: PermissionSubject, grantedProjectIds: readonly string[]): BtAccess {
  const allProjects = hasPermission(access, `${BT_MODULE}.All Projects`, 'View');
  const scope = allProjects ? null : [...new Set(grantedProjectIds)];
  const inScope = (projectId: string) => scope === null || scope.includes(projectId);
  return {
    hasModule: hasPermission(access, BT_MODULE, 'View Module') || hasPermission(access, `${BT_MODULE}.Bills`, 'View'),
    scope,
    inScope,
    can: (resource, action, projectId) => {
      const key = `${BT_MODULE}.${resource}`;
      if (projectId === undefined) return hasPermission(access, key, action);
      return inScope(projectId) && (hasPermission(access, key, action, projectId) || hasPermission(access, key, action));
    },
  };
}
