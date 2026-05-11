import type { ReactNode } from 'react';
import LcManagementLayoutShell from '@/components/lc-management/module-layout-shell';

export default function LcManagementLayout({ children }: { children: ReactNode }) {
  return <LcManagementLayoutShell>{children}</LcManagementLayoutShell>;
}

