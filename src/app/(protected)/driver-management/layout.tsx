import type { ReactNode } from 'react';
import DriverManagementLayoutShell from '@/components/driver-management/module-layout-shell';

export default function DriverManagementLayout({ children }: { children: ReactNode }) {
  return <DriverManagementLayoutShell>{children}</DriverManagementLayoutShell>;
}
