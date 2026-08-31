'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { Department, Project, User } from '@/lib/types';
import {
  E_APPROVAL_PERMISSION_RESOURCE,
  type EApprovalActor,
  type EApprovalRequest,
  type EApprovalSettingsRecord,
  type EApprovalType,
} from '@/lib/e-approval';
import {
  loadEApprovalActorContext,
  loadEApprovalSettings,
  listEApprovalTypes,
  subscribeEApprovalWorkload,
  type EApprovalServiceActor,
} from '@/lib/e-approval-service';

/**
 * The signed-in user in the two shapes this module needs.
 *
 * `serviceActor` is what every write takes (identity plus organisation, for audit stamps and
 * scoping). `engineActor` is what the rules take, and additionally carries the departments the user
 * acts for, whether they head one, and the delegations pointed at them — three facts that come from
 * this module's own configuration rather than from the auth session, so they need a read.
 *
 * The engine actor is loaded once and cached in state: every action dialog and every inbox row asks
 * "can I act on this?", and doing that against a fresh Firestore read each time would make the
 * detail screen unusable.
 */
export function useEApprovalActorStandalone(enabled = true) {
  const { user, loading } = useAuth();
  const [engineActor, setEngineActor] = useState<EApprovalActor | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const mounted = useRef(true);

  const serviceActor = useMemo<EApprovalServiceActor | null>(
    () =>
      user?.id
        ? {
            userId: user.id,
            userName: user.name || user.email || 'User',
            userEmail: user.email ?? null,
            designation: user.role,
            role: user.role,
            organizationId: user.organizationId,
          }
        : null,
    [user],
  );

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (!serviceActor) {
      setEngineActor(null);
      setContextLoading(false);
      return;
    }
    setContextLoading(true);
    try {
      const context = await loadEApprovalActorContext(serviceActor);
      if (mounted.current) setEngineActor(context);
    } catch (error) {
      console.error('[e-approval] Failed to load actor context', error);
      // Fall back to the session's own facts rather than blocking the screen: the user can still see
      // and act on anything assigned to them directly, which is the common case.
      if (mounted.current) {
        setEngineActor({
          userId: serviceActor.userId,
          userName: serviceActor.userName,
          role: serviceActor.role,
          departmentIds: [],
          delegations: [],
        });
      }
    } finally {
      if (mounted.current) setContextLoading(false);
    }
  }, [serviceActor, enabled]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  return {
    user,
    serviceActor,
    engineActor,
    isLoading: loading || contextLoading,
    refreshActor: refresh,
  };
}

/** Module settings, loaded once per screen. */
export function useEApprovalSettingsStandalone(enabled = true) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<EApprovalSettingsRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    try {
      setSettings(await loadEApprovalSettings(user?.organizationId));
    } catch (error) {
      console.error('[e-approval] Failed to load settings', error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.organizationId, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { settings, isLoading, refreshSettings: refresh };
}

export interface EApprovalDirectory {
  users: User[];
  departments: Department[];
  projects: Project[];
  roles: string[];
  types: EApprovalType[];
  userById: Map<string, User>;
  departmentById: Map<string, Department>;
}

/**
 * Users, departments, projects, roles and approval types — everything the pickers need.
 *
 * One hook rather than a fetch per picker: the create form and every action dialog offer the same
 * choices, and three dialogs each loading the user list is three copies of it in memory.
 */
export function useEApprovalDirectoryStandalone(enabled = true) {
  const { users, user } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [types, setTypes] = useState<EApprovalType[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    try {
      const [departmentSnap, projectSnap, roleSnap, typeRows] = await Promise.all([
        getDocs(collection(db, 'departments')),
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'roles')),
        listEApprovalTypes(user?.organizationId),
      ]);
      setDepartments(
        departmentSnap.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }) as Department)
          .filter((row) => row.status !== 'Inactive')
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      );
      setProjects(
        projectSnap.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }) as Project)
          .filter((row) => row.status !== 'Inactive')
          .sort((a, b) => String(a.projectName).localeCompare(String(b.projectName))),
      );
      setRoles(
        roleSnap.docs
          .map((entry) => String((entry.data() as { name?: string }).name || entry.id))
          .sort((a, b) => a.localeCompare(b)),
      );
      setTypes(typeRows.filter((row) => row.active !== false));
    } catch (error) {
      console.error('[e-approval] Failed to load directory', error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.organizationId, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeUsers = useMemo(
    () => (users ?? []).filter((row) => row.status !== 'Inactive'),
    [users],
  );

  const directory: EApprovalDirectory = useMemo(
    () => ({
      users: activeUsers,
      departments,
      projects,
      roles,
      types,
      userById: new Map(activeUsers.map((row) => [row.id, row])),
      departmentById: new Map(departments.map((row) => [row.id, row])),
    }),
    [activeUsers, departments, projects, roles, types],
  );

  return { directory, isLoading, refreshDirectory: refresh };
}

/* ------------------------------------------------------------------------------------------------
 * Shared module context
 *
 * The module has eleven route groups and every one of them called `useEApprovalActor`,
 * `useEApprovalSettings` and `useEApprovalDirectory` independently — three Firestore round trips
 * repeated on every navigation, for data that changes rarely mid-session (who you are, the
 * organisation's approval settings, the user/department/project/type lists).
 *
 * `EApprovalModuleProvider`, mounted once by the layout shell, loads all three exactly once and
 * hands them down through context. Every hook below keeps its original name and return shape — no
 * consumer needs to change — and falls back to loading its own copy when no provider is mounted
 * (a page rendered in isolation, a test). The standalone hook is still *called* unconditionally
 * (satisfying the rules of hooks); its `enabled` flag only decides whether it does any work.
 * ---------------------------------------------------------------------------------------------- */

interface EApprovalModuleContextValue {
  actor: ReturnType<typeof useEApprovalActorStandalone>;
  settings: ReturnType<typeof useEApprovalSettingsStandalone>;
  directory: ReturnType<typeof useEApprovalDirectoryStandalone>;
}

const EApprovalModuleContext = createContext<EApprovalModuleContextValue | null>(null);

export function EApprovalModuleProvider({ children }: { children: ReactNode }) {
  const actor = useEApprovalActorStandalone();
  const settings = useEApprovalSettingsStandalone();
  const directory = useEApprovalDirectoryStandalone();
  const value = useMemo(() => ({ actor, settings, directory }), [actor, settings, directory]);
  return <EApprovalModuleContext.Provider value={value}>{children}</EApprovalModuleContext.Provider>;
}

export function useEApprovalActor() {
  const shared = useContext(EApprovalModuleContext);
  const standalone = useEApprovalActorStandalone(!shared);
  return shared ? shared.actor : standalone;
}

export function useEApprovalSettings() {
  const shared = useContext(EApprovalModuleContext);
  const standalone = useEApprovalSettingsStandalone(!shared);
  return shared ? shared.settings : standalone;
}

export function useEApprovalDirectory() {
  const shared = useContext(EApprovalModuleContext);
  const standalone = useEApprovalDirectoryStandalone(!shared);
  return shared ? shared.directory : standalone;
}

/**
 * Every open approval the actor is involved in — mine to act on, my department's, my role's, and
 * mine as requester — kept live.
 *
 * Replaces a one-shot `loadEApprovalWorkload` + a Refresh button with four standing Firestore
 * listeners (`subscribeEApprovalWorkload`). A file somebody else acts on while this is open moves out
 * of the inbox on its own, rather than sitting there stale until the next manual refresh — which is
 * how an approver comes to act on a file a colleague has already forwarded.
 */
export function useEApprovalWorkload() {
  const { serviceActor, engineActor, isLoading: actorLoading } = useEApprovalActor();
  const [rows, setRows] = useState<EApprovalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!serviceActor || !engineActor) return;
    setIsLoading(true);
    const unsubscribe = subscribeEApprovalWorkload(
      engineActor,
      serviceActor.organizationId,
      (nextRows) => {
        setRows(nextRows);
        setLastUpdated(new Date());
        setHasLoadedOnce(true);
        setIsLoading(false);
        setError(null);
      },
      (err) => {
        setError(err);
        setIsLoading(false);
      },
    );
    return unsubscribe;
    // `engineActor` is reloaded as a new object on every actor-context refresh even when its content
    // is unchanged; resubscribing then is one extra round trip, not a correctness issue, so it is not
    // worth memoising just to avoid it here.
  }, [serviceActor, engineActor]);

  return {
    rows,
    engineActor,
    serviceActor,
    isLoading: isLoading || actorLoading,
    hasLoadedOnce,
    /** True once there is data on screen and a live update is refreshing it, for a dimmed re-render rather than a skeleton. */
    isRevalidating: (isLoading || actorLoading) && hasLoadedOnce,
    lastUpdated,
    error,
  };
}

/**
 * Permission helpers for the module, so no screen spells the resource string out by hand.
 *
 * Deliberately does *not* cover approving, verifying or returning: those are governed by step
 * assignment, not by role (see the note on the "E-Approval" entry in `permissions.ts`).
 */
export function useEApprovalPermissions() {
  const { can, isLoading } = useAuthorization();
  const resource = E_APPROVAL_PERMISSION_RESOURCE;
  return useMemo(
    () => ({
      isLoading,
      canViewModule:
        can('View Module', resource) ||
        can('View', `${resource}.Dashboard`) ||
        can('View', `${resource}.Inbox`),
      canCreate: can('Create', `${resource}.Requests`),
      canEdit: can('Edit', `${resource}.Requests`),
      canDeleteDraft: can('Delete Draft', `${resource}.Requests`),
      canCancel: can('Cancel', `${resource}.Requests`),
      canViewAll: can('View All', `${resource}.Requests`),
      canViewDepartment: can('View Department', `${resource}.Requests`),
      canViewConfidential: can('View Confidential', `${resource}.Requests`),
      canExport: can('Export', `${resource}.Requests`),
      canPrint: can('Print', `${resource}.Requests`),
      canComment: can('Add', `${resource}.Comments`),
      canUpload: can('Upload', `${resource}.Attachments`),
      canViewAudit: can('View', `${resource}.Audit Trail`),
      /** Reversing another person's completed action. Recall is not gated on a permission. */
      canReverse: can('Reverse Any', `${resource}.Reversals`),
      canViewReports: can('View', `${resource}.Reports`),
      canManageDelegations: can('Add', `${resource}.Delegations`) || can('Edit', `${resource}.Delegations`),
      canViewDelegations: can('View', `${resource}.Delegations`) || can('Add', `${resource}.Delegations`),
      canManageSettings:
        can('View', `${resource}.Settings`) ||
        can('Edit', `${resource}.Settings.Policies`) ||
        can('View', `${resource}.Settings.Approval Types`) ||
        can('View', `${resource}.Settings.Workflow Templates`) ||
        can('View', `${resource}.Settings.Approval Matrix`),
      can,
    }),
    [can, isLoading, resource],
  );
}

/** ₹2,50,000 — the Indian grouping every other money field in the app uses. */
export const formatEApprovalAmount = (amount: number | null | undefined): string =>
  amount == null
    ? '—'
    : `₹${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** "22 Aug 2026, 11:25 am" from the engine's ISO strings. */
export const formatEApprovalDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

export const formatEApprovalDate = (value: string | null | undefined): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-IN', { dateStyle: 'medium' });
};
