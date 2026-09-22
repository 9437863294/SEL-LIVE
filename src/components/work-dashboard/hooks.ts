'use client';

/**
 * Identity resolution and the fan-out, for the central dashboard.
 *
 * The viewer's own facts are not enough to query with. Two of the sources route by department
 * (E-Approval's department inbox) and one routes by role name, and `User` carries `role` but no
 * department membership — so the context is assembled from `useAuth` plus
 * `loadEApprovalActorContext`, which is the one place in the codebase that already resolves a user
 * to their departments, projects and delegations. Reusing it means the dashboard's idea of "your
 * departments" cannot drift from the E-Approval inbox's.
 *
 * That resolution is allowed to fail. If it does, the dashboard runs with no departments rather than
 * refusing to load: everything assigned to the viewer by name — which is the great majority of what
 * this screen is for — is unaffected, and the department queue is skipped. The same fallback, for
 * the same reason, as `useEApprovalActorStandalone`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { loadEApprovalActorContext } from '@/lib/e-approval-service';
import {
  dropLowerLaneDuplicates,
  groupWorkItems,
  summarizeWork,
  type WorkLanes,
  type WorkSummary,
} from '@/lib/work-dashboard';
import { loadWorkItems, type WorkContext, type WorkLoadResult } from '@/lib/work-dashboard-sources';
import { resetProjectWorkLookups } from '@/lib/work-dashboard-project-sources';

/** Today, as an ISO calendar date in the viewer's own timezone. */
function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export interface WorkDashboardState {
  lanes: WorkLanes;
  summary: WorkSummary;
  /** Sources that could not be read. Surfaced, never swallowed. */
  failures: WorkLoadResult['failures'];
  today: string;
  isLoading: boolean;
  /** True on a background refresh, so the screen can stay readable instead of flashing a skeleton. */
  isRefreshing: boolean;
  refresh: () => void;
}

const EMPTY_LANES: WorkLanes = { action: [], shared: [], meeting: [], watching: [] };

export function useWorkDashboard(): WorkDashboardState {
  const { user, loading: authLoading } = useAuth();
  const { can, isLoading: permissionsLoading } = useAuthorization();

  const [lanes, setLanes] = useState<WorkLanes>(EMPTY_LANES);
  const [failures, setFailures] = useState<WorkLoadResult['failures']>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [today, setToday] = useState(localToday);

  const mounted = useRef(true);
  /** Whether anything has been shown yet — a refresh must not drop back to the skeleton. */
  const hasLoaded = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    // The cached project and workflow lookups would otherwise survive a manual refresh for up to a
    // minute, which makes the button look broken to somebody who just added a project.
    resetProjectWorkLookups();
    setToday(localToday());
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (authLoading || permissionsLoading) return;
    if (!user?.id) {
      setLanes(EMPTY_LANES);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    if (hasLoaded.current) setIsRefreshing(true);
    else setIsLoading(true);

    void (async () => {
      // Departments come from the E-Approval actor context; a failure here costs the department
      // queue and nothing else, so it is caught rather than propagated.
      let departmentIds: string[] = [];
      try {
        const actorContext = await loadEApprovalActorContext({
          userId: user.id,
          userName: user.name || user.email || 'User',
          userEmail: user.email ?? null,
          designation: user.role,
          role: user.role,
          organizationId: user.organizationId,
        });
        departmentIds = actorContext?.departmentIds ?? [];
      } catch {
        departmentIds = [];
      }
      if (cancelled || !mounted.current) return;

      const context: WorkContext = {
        userId: user.id,
        userName: user.name || user.email || 'User',
        role: user.role || '',
        organizationId: user.organizationId,
        departmentIds,
        today,
        can,
      };

      const result = await loadWorkItems(context);
      if (cancelled || !mounted.current) return;

      // Collapse before grouping: a file that names the viewer *and* their department should appear
      // once, under the heading that says they are accountable for it.
      setLanes(groupWorkItems(dropLowerLaneDuplicates(result.items), today));
      setFailures(result.failures);
      hasLoaded.current = true;
      setIsLoading(false);
      setIsRefreshing(false);
    })();

    return () => {
      cancelled = true;
    };
    // `can` is memoised on the permission set, so this re-runs when permissions arrive — which is
    // what makes the board fill in rather than staying empty for a user whose role loaded late.
  }, [authLoading, permissionsLoading, user, can, today, nonce]);

  const summary = useMemo(() => summarizeWork(lanes, today), [lanes, today]);

  return { lanes, summary, failures, today, isLoading, isRefreshing, refresh };
}
