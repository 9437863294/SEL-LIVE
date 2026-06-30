// The sidebar layout logic lives in [project]/layout.tsx to prevent nested layouts.

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Subcontractors Management | SEL Live',
  description: 'Manage subcontractor contracts, work orders, billing, and payment tracking across all projects.',
};

export default function SubcontractorsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
