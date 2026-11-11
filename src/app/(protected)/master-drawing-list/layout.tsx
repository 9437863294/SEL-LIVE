import type { Metadata } from 'next';

import MdlLayoutShell from '@/components/master-drawing-list/module-layout-shell';

export const metadata: Metadata = {
  title: 'Master Drawing List | SEL Live',
  description: 'Drawings and documents submitted to the client for approval: revisions, comments, approvals and what is pending with whom.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <MdlLayoutShell>{children}</MdlLayoutShell>;
}
