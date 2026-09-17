import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import ExpensesLayoutShell from '@/components/expenses/module-layout-shell';

export const metadata: Metadata = {
  title: 'Expenses | SEL Live',
  description: 'Submit, review, and track expense requests across all sites — with consolidated views and detailed reports.',
};

export default function ExpensesLayout({ children }: { children: ReactNode }) {
  // The shell reads `?report=` to mark the open report in the nav, and `useSearchParams` needs a
  // boundary above it or the build refuses to prerender anything under this layout.
  return (
    <Suspense fallback={<div className="p-6">{children}</div>}>
      <ExpensesLayoutShell>{children}</ExpensesLayoutShell>
    </Suspense>
  );
}
