import type { ReactNode } from 'react';
import OfficeHubLayoutShell from '@/components/office-hub/module-layout-shell';

export default function OfficeHubLayout({ children }: { children: ReactNode }) {
  return <OfficeHubLayoutShell>{children}</OfficeHubLayoutShell>;
}
