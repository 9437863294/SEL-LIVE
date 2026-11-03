import type { ReactNode } from 'react';

/**
 * The project pages' frame now comes from Billing Recon's module shell
 * (`src/components/billing-recon/billing-recon-shell.tsx`, mounted by the module layout one level
 * up), which carries the project switcher and the project's menu. This layout adds nothing.
 */
export default function BillingReconProjectLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
