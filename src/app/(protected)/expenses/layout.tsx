import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import ExpensesLayoutShell from '@/components/expenses/module-layout-shell';

export const metadata: Metadata = {
  title: 'Expenses | SEL Live',
  description: 'Submit, review, and track expense requests across all sites — with consolidated views and detailed reports.',
};

export default function ExpensesLayout({ children }: { children: ReactNode }) {
  return <ExpensesLayoutShell>{children}</ExpensesLayoutShell>;
}
