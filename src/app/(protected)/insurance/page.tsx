'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { AccessDenied } from '@/components/insurance/insurance-ui';
import { DashboardSkeleton } from '@/components/insurance/InsuranceDashboard';

/**
 * The module's entry point. Personal and project insurance each have their own dashboard, so this
 * opens the first one the viewer may see — older links and notifications to /insurance still land.
 */
export default function InsuranceHomePage() {
  const router = useRouter();
  const { can, isLoading } = useAuthorization();

  const canViewModule = can('View Module', 'Insurance');
  const target = !canViewModule ? null
    : can('View', 'Insurance.Personal Insurance') ? '/insurance/dashboard/personal'
    : can('View', 'Insurance.Project Insurance') ? '/insurance/dashboard/project'
    : can('View', 'Insurance.My Tasks') ? '/insurance/my-tasks'
    : null;

  useEffect(() => {
    if (!isLoading && target) router.replace(target);
  }, [isLoading, target, router]);

  if (isLoading || target) return <DashboardSkeleton />;
  return <AccessDenied what="access the Insurance module" />;
}
