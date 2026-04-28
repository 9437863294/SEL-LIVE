import type { ReactNode } from 'react';
import VehicleManagementLayoutShell from '@/components/vehicle-management/module-layout-shell';

export default function VehicleManagementLayout({ children }: { children: ReactNode }) {
  return <VehicleManagementLayoutShell>{children}</VehicleManagementLayoutShell>;
}

