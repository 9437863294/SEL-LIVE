'use client';

import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { InsurancePolicy, InsuranceTask, ProjectInsurancePolicy } from '@/lib/types';
import { INSURANCE_TASKS, PERSONAL_POLICIES, PROJECT_POLICIES } from '@/lib/insurance-service';
import { AccessDenied } from '@/components/insurance/insurance-ui';
import { DashboardSkeleton, InsuranceDashboard } from '@/components/insurance/InsuranceDashboard';

export default function InsuranceDashboardPage() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();

  const canViewModule   = can('View Module', 'Insurance');
  const canViewPersonal = can('View', 'Insurance.Personal Insurance');
  const canViewProject  = can('View', 'Insurance.Project Insurance');
  const canViewTasks    = can('View', 'Insurance.My Tasks');
  const canViewReports  = can('View Reports', 'Insurance.Reports') || can('View', 'Insurance.Reports');
  const canAddPersonal  = can('Add', 'Insurance.Personal Insurance');
  const canAddProject   = can('Add', 'Insurance.Project Insurance');

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [personalPolicies, setPersonal] = useState<InsurancePolicy[]>([]);
  const [projectPolicies, setProject] = useState<ProjectInsurancePolicy[]>([]);
  const [tasks, setTasks] = useState<InsuranceTask[]>([]);

  const load = useCallback(async (refresh = false) => {
    // A refresh keeps the current figures on screen, dimmed, instead of flashing skeletons.
    if (refresh) setIsRefreshing(true); else setIsLoading(true);
    try {
      const [personal, project, taskSnap] = await Promise.all([
        canViewPersonal ? getDocs(collection(db, PERSONAL_POLICIES)) : null,
        canViewProject ? getDocs(collection(db, PROJECT_POLICIES)) : null,
        canViewTasks ? getDocs(collection(db, INSURANCE_TASKS)) : null,
      ]);
      setPersonal(personal ? personal.docs.map((d) => ({ id: d.id, ...d.data() } as InsurancePolicy)) : []);
      setProject(project ? project.docs.map((d) => ({ id: d.id, ...d.data() } as ProjectInsurancePolicy)) : []);
      setTasks(taskSnap ? taskSnap.docs.map((d) => ({ id: d.id, ...d.data() } as InsuranceTask)) : []);
      setLoadedAt(new Date());
    } catch (err) {
      console.error('Insurance dashboard load error', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [canViewPersonal, canViewProject, canViewTasks]);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  if (authLoading || isLoading) return <DashboardSkeleton />;
  if (!canViewModule) return <AccessDenied what="access the Insurance module" />;

  return (
    <InsuranceDashboard
      personalPolicies={personalPolicies}
      projectPolicies={projectPolicies}
      tasks={tasks}
      userId={user?.id ?? ''}
      access={{
        personal: canViewPersonal,
        project: canViewProject,
        tasks: canViewTasks,
        reports: canViewReports,
        addPersonal: canAddPersonal,
        addProject: canAddProject,
      }}
      loadedAt={loadedAt}
      isRefreshing={isRefreshing}
      onRefresh={() => load(true)}
    />
  );
}
