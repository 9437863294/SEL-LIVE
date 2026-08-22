import type { ReactNode } from 'react';
import EApprovalLayoutShell from '@/components/e-approval/module-layout-shell';

export default function EApprovalLayout({ children }: { children: ReactNode }) {
  return <EApprovalLayoutShell>{children}</EApprovalLayoutShell>;
}
