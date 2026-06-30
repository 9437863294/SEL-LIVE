import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import LoanLayoutShell from '@/components/loan/module-layout-shell';

export const metadata: Metadata = {
  title: 'Loan Management | SEL Live',
  description: 'Track loans, manage EMI schedules, monitor repayments, and generate loan reports for the organisation.',
};

export default function LoanLayout({ children }: { children: ReactNode }) {
  return <LoanLayoutShell>{children}</LoanLayoutShell>;
}
