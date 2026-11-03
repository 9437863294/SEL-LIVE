import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BillingReconShell } from '@/components/billing-recon/billing-recon-shell';

export const metadata: Metadata = {
  title: 'Billing Reconciliation | SEL Live',
  description: 'Reconcile client billing per project — BOQ, JMC, MVAC, certified quantities and RA bills, kept separate from Project Management.',
};

export default function BillingReconLayout({ children }: { children: ReactNode }) {
  return <BillingReconShell>{children}</BillingReconShell>;
}
