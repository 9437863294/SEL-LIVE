import type { Metadata } from 'next';
import HrLayoutShell from '@/components/hr/module-layout-shell';

export const metadata: Metadata = {
  title: 'HR & Recruitment | SEL Live',
  description: 'Manpower requirements, approvals, recruitment, offers and joining',
};
export default function Layout({ children }: { children: React.ReactNode }) { return <HrLayoutShell>{children}</HrLayoutShell>; }
