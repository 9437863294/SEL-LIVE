'use client';

import AppShell from '@/components/app/AppShell';
import ModuleDashboard from '@/components/module-hub/ModuleDashboard';

export default function DashboardPage() {
  return (
    <AppShell>
      <ModuleDashboard />
    </AppShell>
  );
}
