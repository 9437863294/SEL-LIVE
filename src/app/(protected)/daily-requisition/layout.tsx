import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import DailyRequisitionLayoutShell from '@/components/daily-requisition/module-layout-shell';

export const metadata: Metadata = {
  title: 'Daily Requisition | SEL Live',
  description: 'Record daily requisitions and follow them from receiving at finance through verification to payment.',
};

export default function DailyRequisitionLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The shared module shell: the sidebar, the phone's header and bottom bar. Print routes get the page alone.
  return <DailyRequisitionLayoutShell>{children}</DailyRequisitionLayoutShell>;
}
