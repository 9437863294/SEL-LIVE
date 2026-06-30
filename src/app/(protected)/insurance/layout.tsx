import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import InsuranceLayoutShell from '@/components/insurance/module-layout-shell';

export const metadata: Metadata = {
  title: 'Insurance | SEL Live',
  description: 'Manage personal and project insurance policies — track premiums, maturity dates, renewals, and compliance tasks.',
};

export default function InsuranceLayout({ children }: { children: ReactNode }) {
  return <InsuranceLayoutShell>{children}</InsuranceLayoutShell>;
}
