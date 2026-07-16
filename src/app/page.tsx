'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import AppShell from '@/components/app/AppShell';

const ModuleDashboard = dynamic(() => import('@/components/module-hub/ModuleDashboard'), {
  ssr: false,
  loading: () => (
    <div className="p-3 sm:p-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, idx) => (
          <Skeleton key={idx} className="h-24 sm:h-28 rounded-xl" />
        ))}
      </div>
    </div>
  ),
});

const ElectricBackdrop = dynamic(
  () => import('@/components/effects/ElectricBackdrop').then((m) => m.ElectricBackdrop),
  { ssr: false }
);

export default function DashboardPage() {
  return (
    <AppShell>
      <div className="relative min-h-[calc(100vh-4rem)] w-full overflow-hidden bg-[#020617]">
        <ElectricBackdrop />
        <div className="relative z-10">
          <ModuleDashboard />
        </div>
      </div>
    </AppShell>
  );
}
