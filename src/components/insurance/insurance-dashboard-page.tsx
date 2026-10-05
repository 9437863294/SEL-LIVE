'use client';

import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { InsurancePolicy, InsuranceTask, ProjectInsurancePolicy } from '@/lib/types';
import { INSURANCE_TASKS, PERSONAL_POLICIES, PROJECT_POLICIES } from '@/lib/insurance-service';
import { AccessDenied } from '@/components/insurance/insurance-ui';
import { DashboardSkeleton, InsuranceDashboard, type DashboardScope } from '@/components/insurance/InsuranceDashboard';

/**
 * Loads one book — personal or project — and its tasks for that book's dashboard. Personal and
 * project insurance each have their own dashboard page; neither reads the other's policies.
 */
export function InsuranceDashboardPage({ scope }: { scope: DashboardScope }) {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();

  const isPersonal = scope === 'personal';
  const resource = isPersonal ? 'Insurance.Personal Insurance' : 'Insurance.Project Insurance';
  const canViewModule = can('View Module', 'Insurance');
  const canViewBook = can('View', resource);
  const canAdd = can('Add', resource);
  const canViewTasks = can('View', 'Insurance.My Tasks');
  const canViewReports = can('View Reports', 'Insurance.Reports') || can('View', 'Insurance.Reports');

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [personalPolicies, setPersonal] = useState<InsurancePolicy[]>([]);
  const [projectPolicies, setProject] = useState<ProjectInsurancePolicy[]>([]);
  const [tasks, setTasks] = useState<InsuranceTask[]>([]);

  const load = useCallback(async (refresh = false) => {
    if (!canViewBook) { setIsLoading(false); return; }
    // A refresh keeps the current figures on screen, dimmed, instead of flashing skeletons.
    if (refresh) setIsRefreshing(true); else setIsLoading(true);
    try {
      const [policies, taskSnap] = await Promise.all([
        getDocs(collection(db, isPersonal ? PERSONAL_POLICIES : PROJECT_POLICIES)),
        canViewTasks ? getDocs(collection(db, INSURANCE_TASKS)) : null,
      ]);
      if (isPersonal) setPersonal(policies.docs.map((d) => ({ id: d.id, ...d.data() } as InsurancePolicy)));
      else setProject(policies.docs.map((d) => ({ id: d.id, ...d.data() } as ProjectInsurancePolicy)));
      // Tasks raised before policyKind was stored were all personal.
      setTasks(taskSnap
        ? taskSnap.docs.map((d) => ({ id: d.id, ...d.data() } as InsuranceTask)).filter((t) => (t.policyKind ?? 'personal') === scope)
        : []);
      setLoadedAt(new Date());
    } catch (err) {
      console.error('Insurance dashboard load error', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [canViewBook, canViewTasks, isPersonal, scope]);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  if (authLoading || isLoading) return <DashboardSkeleton />;
  if (!canViewModule || !canViewBook) {
    return <AccessDenied what={isPersonal ? 'view the personal insurance dashboard' : 'view the project insurance dashboard'} />;
  }

  return (
    <InsuranceDashboard
      scope={scope}
      personalPolicies={personalPolicies}
      projectPolicies={projectPolicies}
      tasks={tasks}
      userId={user?.id ?? ''}
      access={{
        personal: isPersonal,
        project: !isPersonal,
        tasks: canViewTasks,
        reports: canViewReports,
        addPersonal: isPersonal && canAdd,
        addProject: !isPersonal && canAdd,
      }}
      loadedAt={loadedAt}
      isRefreshing={isRefreshing}
      onRefresh={() => load(true)}
    />
  );
}
