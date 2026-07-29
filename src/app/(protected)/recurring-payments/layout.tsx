import type { Metadata } from 'next';
import RecurringPaymentsLayoutShell from '@/components/recurring-payments/module-layout-shell';

export const metadata: Metadata = { title: 'Recurring Payments | SEL Live', description: 'Recurring bill and payment management' };
export default function Layout({ children }: { children: React.ReactNode }) { return <RecurringPaymentsLayoutShell>{children}</RecurringPaymentsLayoutShell>; }
