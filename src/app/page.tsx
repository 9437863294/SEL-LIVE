'use client';

import ModuleDashboard from '@/components/ModuleDashboard';
import { ElectricBackdrop } from '@/components/effects/ElectricBackdrop';

export default function DashboardPage() {
  return (
    <div className="relative min-h-[calc(100vh-4rem)] w-full overflow-hidden bg-[#020617]">
      <ElectricBackdrop />
      <div className="relative z-10">
        <ModuleDashboard />
      </div>
    </div>
  );
}
