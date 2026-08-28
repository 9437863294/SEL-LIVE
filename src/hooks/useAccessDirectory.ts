'use client';

/**
 * The one data hook the access-management screens share.
 *
 * Every tab on that page asks the same five questions — who are the users, what roles exist, what
 * has each user been granted, what do departments and designations confer, what templates are
 * there — and answering them per tab would mean five collection reads every time an administrator
 * clicks between Users and Permission Matrix. One hook, one load, one refresh after a write.
 *
 * Effective access for every user is computed here too, memoised on the directory. It is a pure
 * fold over data already in memory, and having it precomputed is what lets the users table render
 * a permission count and a risk badge per row without a resolve-per-render.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Department, Employee, Project } from '@/lib/types';
import {
  buildAccessDashboard,
  countRoleUsage,
  flattenPermissionRegistry,
  type AccessDashboardStats,
  type EffectiveAccess,
  type RegistryNode,
} from '@/lib/access-control';
import { permissionModules } from '@/lib/permissions';
import {
  effectiveAccessForAll,
  listAccessBatches,
  loadAccessDirectory,
  type AccessDirectory,
} from '@/lib/access-control-service';

const EMPTY_DIRECTORY: AccessDirectory = {
  users: [],
  roles: [],
  grants: {},
  scopeGrants: [],
  templates: [],
};

/**
 * The permission registry, flattened once for the whole module.
 *
 * `permissionModules` is a static import, so this is a constant — computing it at module scope
 * rather than in a hook keeps every matrix, tree and search box reading the same array identity and
 * skips ~1,200 object allocations per mount.
 */
export const REGISTRY_NODES: RegistryNode[] = flattenPermissionRegistry(permissionModules);

export interface AccessDirectoryState {
  directory: AccessDirectory;
  /** Effective access per user id, resolved from the directory. */
  accessByUser: Record<string, EffectiveAccess>;
  /** Organisation masters the assignment screens filter and scope by. */
  departments: Department[];
  projects: Project[];
  /** Distinct designations from the employee master, for designation-based access. */
  designations: string[];
  /** Employees, so a user can be matched to a department/designation when picking targets. */
  employees: Employee[];
  registry: RegistryNode[];
  dashboard: AccessDashboardStats;
  roleUsage: Record<string, { base: number; additional: number; total: number }>;
  isLoading: boolean;
  /**
   * A reload after the first load has completed. Split from `isLoading` so the header's Refresh can
   * spin in place — swapping the whole workspace for the page loader would unmount every tab's
   * filter state just to repaint the same screen.
   */
  isRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAccessDirectory(enabled = true): AccessDirectoryState {
  const [directory, setDirectory] = useState<AccessDirectory>(EMPTY_DIRECTORY);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [batchCount, setBatchCount] = useState(0);
  const [inFlight, setInFlight] = useState(false);
  /**
   * Whether a first load has completed.
   *
   * `isLoading` is derived from this rather than being a plain flag, because `enabled` starts false
   * (the caller is still resolving the signed-in user's permissions) and flips true a render later.
   * A plain flag initialised to `false` would leave one render where the screen believes it has
   * loaded and shows "0 users, 0 roles" before the fetch even starts.
   */
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setInFlight(true);
    setError(null);
    try {
      const [nextDirectory, departmentSnap, projectSnap, employeeSnap, batches] = await Promise.all([
        loadAccessDirectory(),
        getDocs(query(collection(db, 'departments'), where('status', '==', 'Active'))),
        getDocs(collection(db, 'projects')),
        // The employee master is the only place department and designation live per person. It is
        // read for filtering and display; nothing here writes to it.
        getDocs(collection(db, 'employees')).catch(() => null),
        listAccessBatches(50).catch(() => []),
      ]);

      setDirectory(nextDirectory);
      setDepartments(
        departmentSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as Department),
      );
      setProjects(
        projectSnap.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }) as Project)
          .filter((project) => project.status !== 'Inactive'),
      );
      setEmployees(
        employeeSnap?.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as Employee) ?? [],
      );
      setBatchCount(batches.length);
    } catch (err) {
      console.error('[access] Failed to load access directory', err);
      setError(err instanceof Error ? err.message : 'Failed to load access data.');
    } finally {
      // Marked loaded even on failure: the caller shows `error` and stops spinning, rather than
      // spinning forever on a permissions problem it cannot resolve by waiting.
      setHasLoaded(true);
      setInFlight(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const accessByUser = useMemo(() => effectiveAccessForAll(directory), [directory]);

  const designations = useMemo(() => {
    const seen = new Set<string>();
    for (const employee of employees) {
      const designation = (employee.designation || '').trim();
      if (designation) seen.add(designation);
    }
    // Designations configured on scope grants but absent from the employee master still need to be
    // offered — otherwise a grant becomes uneditable the moment its last holder leaves.
    for (const grant of directory.scopeGrants) {
      if (grant.scopeType === 'Designation' && grant.scopeId) seen.add(grant.scopeId);
    }
    return [...seen].sort();
  }, [employees, directory.scopeGrants]);

  const dashboard = useMemo(
    () =>
      buildAccessDashboard({
        users: directory.users,
        roles: directory.roles,
        grants: directory.grants,
        accessByUser,
        bulkAssignmentCount: batchCount,
      }),
    [directory, accessByUser, batchCount],
  );

  const roleUsage = useMemo(
    () => countRoleUsage(directory.users, directory.grants),
    [directory.users, directory.grants],
  );

  return {
    directory,
    accessByUser,
    departments,
    projects,
    designations,
    employees,
    registry: REGISTRY_NODES,
    dashboard,
    roleUsage,
    isLoading: enabled && (!hasLoaded || inFlight),
    isRefreshing: enabled && hasLoaded && inFlight,
    error,
    refresh,
  };
}
