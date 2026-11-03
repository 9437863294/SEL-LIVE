import type { ReactNode } from 'react';
import { PmInModuleShell } from '@/components/project-management/pm-shell';
import { SubcontractorsHost } from '@/components/subcontractors-management/paths';

/**
 * Subcontractors Management's screens, mounted inside Billing Recon's frame (its sidebar and project
 * switcher come from the module layout above).
 *
 * The screens are Subcontractors Management's own, over its own records — the subcontractor register,
 * work orders, bills, proforma and retention bills — so a bill raised here is the same bill in
 * Subcontractors Management, and Billing Recon's registers (BOQ, JMC, MVAC, RA bills) are untouched.
 * The host tells every link to stay under /billing-recon/[project]/subcontractors, and PmInModuleShell
 * tells the screens' content area that the shell already pads it.
 */
export default function BillingReconSubcontractorsLayout({ children }: { children: ReactNode }) {
  return (
    <SubcontractorsHost module="billing-recon">
      <PmInModuleShell>{children}</PmInModuleShell>
    </SubcontractorsHost>
  );
}
