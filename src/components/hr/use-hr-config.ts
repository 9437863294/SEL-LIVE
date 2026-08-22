'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { HR_PERMISSION_MODULE } from './module-layout-shell';
import { DEFAULT_HR_SETTINGS, type HrSettings } from '@/lib/hr-requirement';
import { loadHrSettings, type HrActor } from '@/lib/hr-requirement-service';
import type { Department, Employee, Project, User } from '@/lib/types';

/**
 * The reference data every HR screen needs: settings, masters, departments, projects, users and the
 * employee master.
 *
 * Loaded once here rather than per screen because the requirement wizard, the approval inbox, the
 * selection desk and the joining screen all need the same six collections, and six screens each
 * running their own listeners is what makes navigating this module feel slow. Departments, projects
 * and users are small, stable collections read across the whole app; the employee master is only
 * fetched when a screen asks for it, since it is the large one.
 */

export interface HrConfig {
  loading: boolean;
  settings: HrSettings;
  departments: Department[];
  projects: Project[];
  users: User[];
  /** userId → role name, for `resolveStageApprovers` on Role-based stages. */
  roleByUserId: Record<string, string>;
  actor: HrActor | null;
  /** Reloads the settings document after the settings screen saves. */
  refreshSettings: () => Promise<void>;
}

export function useHrConfig(): HrConfig {
  const { user } = useAuth();
  const organizationId = user?.organizationId || '';

  const [settings, setSettings] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  /**
   * `loaded` rather than `loading`, so the "no organisation yet" case is *derived* instead of being
   * pushed into state by the effect. Setting state synchronously inside an effect body causes a
   * cascading render, which is exactly what the repo's React rules forbid.
   */
  const [loaded, setLoaded] = useState(false);
  const loading = Boolean(organizationId) && !loaded;

  const refreshSettings = useCallback(async () => {
    if (!organizationId) return;
    setSettings(await loadHrSettings(organizationId));
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return;

    let cancelled = false;
    (async () => {
      const [hrSettings, departmentSnapshot, projectSnapshot, userSnapshot] = await Promise.all([
        loadHrSettings(organizationId),
        getDocs(collection(db, 'departments')),
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'users')),
      ]);
      if (cancelled) return;

      setSettings(hrSettings);
      setDepartments(
        departmentSnapshot.docs
          .map(entry => ({ id: entry.id, ...entry.data() }) as Department)
          .filter(row => row.status !== 'Inactive')
          .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
      );
      setProjects(
        projectSnapshot.docs
          .map(entry => ({ id: entry.id, ...entry.data() }) as Project)
          .filter(row => row.status !== 'Inactive')
          .sort((a, b) => (a.projectName || '').localeCompare(b.projectName || '')),
      );
      setUsers(
        userSnapshot.docs
          .map(entry => ({ id: entry.id, ...entry.data() }) as User)
          .filter(row => row.status !== 'Inactive')
          .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
      );
      setLoaded(true);
    })().catch(() => {
      // A failed read still ends the loading state; the screens render empty rather than spinning.
      if (!cancelled) setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const roleByUserId = useMemo(
    () => Object.fromEntries(users.map(row => [row.id, row.role || ''])),
    [users],
  );

  const actor = useMemo<HrActor | null>(() => {
    if (!user?.id || !organizationId) return null;
    return {
      userId: user.id,
      userName: user.name || user.email || 'User',
      userEmail: user.email || null,
      organizationId,
      organizationName: user.organizationName,
    };
  }, [user, organizationId]);

  return { loading, settings, departments, projects, users, roleByUserId, actor, refreshSettings };
}

/**
 * Permission helpers scoped to this module, so screens read `hr.can('Approve', 'Approvals')` instead
 * of repeating the module name at forty call sites.
 */
export function useHrPermissions() {
  const { can, isLoading } = useAuthorization();

  return useMemo(
    () => ({
      isLoading,
      can: (action: string, resource: string) => can(action, `${HR_PERMISSION_MODULE}.${resource}`),
      /** Control rule 63.12 — CTC figures render only for holders of this permission. */
      canViewSalary:
        can('View Sensitive Data', `${HR_PERMISSION_MODULE}.Reports`) ||
        can('View Sensitive Data', `${HR_PERMISSION_MODULE}.Selection`) ||
        can('View Financial Values', `${HR_PERMISSION_MODULE}.Dashboard`),
    }),
    [can, isLoading],
  );
}

/**
 * The employee master, loaded on demand.
 *
 * Used by the replacement picker (spec section 6), the referral form (section 46) and the reporting
 * manager selector. Separated from `useHrConfig` because it is the one collection here that grows
 * with headcount, and most screens never touch it.
 */
export function useEmployees(enabled = true) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loaded, setLoaded] = useState(false);
  const loading = enabled && !loaded;

  useEffect(() => {
    if (!enabled) return;
    const stop = onSnapshot(
      collection(db, 'employees'),
      snapshot => {
        setEmployees(
          snapshot.docs
            .map(entry => ({ id: entry.id, ...entry.data() }) as Employee)
            .filter(row => row.status !== 'Inactive')
            .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
        );
        setLoaded(true);
      },
      () => setLoaded(true),
    );
    return stop;
  }, [enabled]);

  return { employees, loading };
}

/**
 * A live, organisation-scoped collection — the workhorse of every HR screen.
 *
 * One listener per collection per screen. The screens then filter and aggregate in memory, which is
 * what lets the register carry eleven independent filters without a composite index per combination.
 */
export function useHrCollection<T>(collectionName: string, enabled = true) {
  const { user } = useAuth();
  const organizationId = user?.organizationId || '';
  const [rows, setRows] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Derived, not set from inside the effect — see the note on `useHrConfig`.
  const loading = enabled && Boolean(organizationId) && !loaded;

  useEffect(() => {
    if (!enabled || !organizationId) return;
    const stop = onSnapshot(
      query(collection(db, collectionName), where('organizationId', '==', organizationId)),
      snapshot => {
        setRows(snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as T));
        setLoaded(true);
      },
      () => setLoaded(true),
    );
    return stop;
  }, [collectionName, organizationId, enabled]);

  return { rows, loading };
}
