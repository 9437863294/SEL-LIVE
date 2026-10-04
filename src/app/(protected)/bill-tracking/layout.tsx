import type { Metadata } from 'next';

import BillTrackingLayoutShell from '@/components/bill-tracking/module-layout-shell';

export const metadata: Metadata = {
  title: 'Bill Tracking | SEL Live',
  description: 'Client bills, deductions, collections, retention, ageing and outstanding receivables.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <BillTrackingLayoutShell>{children}</BillTrackingLayoutShell>;
}
