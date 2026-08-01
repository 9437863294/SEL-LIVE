import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import FixedDepositLayoutShell from '@/components/fixed-deposit/module-layout-shell';

export const metadata: Metadata = {
  title: 'Fixed Deposit Management | SEL Live',
  description: 'Manage fixed deposits, availability, BG/LC assignments, maturities, and interest.',
};

export default function FixedDepositLayout({ children }: { children: ReactNode }) {
  return <FixedDepositLayoutShell>{children}</FixedDepositLayoutShell>;
}
