import type { ReactNode } from 'react';
import SiteAccountStatementShell from '@/components/site-account-statement/module-layout-shell';

export default function SiteAccountStatementLayout({ children }: { children: ReactNode }) {
  return <SiteAccountStatementShell>{children}</SiteAccountStatementShell>;
}
