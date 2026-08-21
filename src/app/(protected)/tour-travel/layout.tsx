import type { Metadata } from 'next';
import TourTravelLayoutShell from '@/components/tour-travel/module-layout-shell';

export const metadata: Metadata = { title: 'Tour, Travel & Expense | SEL Live', description: 'Tour requests, travel advances, expense claims and settlements' };
export default function Layout({ children }: { children: React.ReactNode }) { return <TourTravelLayoutShell>{children}</TourTravelLayoutShell>; }
