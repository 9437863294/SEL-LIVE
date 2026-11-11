/**
 * Who may do what, and on which drawing lists, in the Master Drawing List — pure functions over the
 * resolved access, so the API and the tests apply the same rules.
 *
 * - Module: `Master Drawing List · View Module` (or `Drawings · View`) opens the module.
 * - Scope: `All Projects · View` sees every drawing list. Anyone else sees the lists linked to an ERP
 *   project granted to them in Access Management. A list not linked to an ERP project yet is seen by
 *   All Projects holders only — an empty scope is never widened to "all".
 * - Actions: `can(resource, action, project)` needs the list in scope *and* the permission, granted
 *   for that ERP project or held unscoped.
 */

import { hasPermission, type PermissionSubject } from '../access-control.ts';
import type { MdlProject } from './types.ts';

export const MDL_MODULE = 'Master Drawing List';

export type MdlResource = 'All Projects' | 'Drawings' | 'Submissions' | 'Approval' | 'Import' | 'Settings';

/** Every action the module checks, by resource — the lookups report which of these the user holds. */
export const MDL_ACTIONS: Record<MdlResource, readonly string[]> = {
  'All Projects': ['View'],
  Drawings: ['View', 'Add', 'Edit', 'Export'],
  Submissions: ['Record'],
  Approval: ['Record'],
  Import: ['View', 'Import'],
  Settings: ['View', 'Manage'],
};

type ScopedProject = Pick<MdlProject, 'projectId'>;

export interface MdlAccess {
  hasModule: boolean;
  allProjects: boolean;
  inScope: (project: ScopedProject) => boolean;
  can: (resource: MdlResource, action: string, project?: ScopedProject) => boolean;
}

export function resolveMdlAccess(access: PermissionSubject, grantedProjectIds: readonly string[]): MdlAccess {
  const allProjects = hasPermission(access, `${MDL_MODULE}.All Projects`, 'View');
  const granted = new Set(grantedProjectIds);
  const inScope = (project: ScopedProject) => allProjects || Boolean(project.projectId && granted.has(project.projectId));
  return {
    hasModule: hasPermission(access, MDL_MODULE, 'View Module') || hasPermission(access, `${MDL_MODULE}.Drawings`, 'View'),
    allProjects,
    inScope,
    can: (resource, action, project) => {
      const key = `${MDL_MODULE}.${resource}`;
      if (!project) return hasPermission(access, key, action);
      // `hasPermission` with a scope also accepts the permission held unscoped.
      return inScope(project) && hasPermission(access, key, action, project.projectId ?? undefined);
    },
  };
}
