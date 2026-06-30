import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import LcManagementLayoutShell from '@/components/lc-management/module-layout-shell';

export const metadata: Metadata = {
  title: 'LC Management | SEL Live',
  description: 'Manage Letters of Credit — track issuance, amendments, utilisation, and expiry across all projects.',
};

export default function LcManagementLayout({ children }: { children: ReactNode }) {
  return <LcManagementLayoutShell>{children}</LcManagementLayoutShell>;
}

