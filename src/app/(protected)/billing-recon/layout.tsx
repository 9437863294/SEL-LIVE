import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Billing Reconciliation | SEL Live',
  description: 'Reconcile project billing — manage BOQ, JMC, MVAC entries, proforma bills, and billing logs across all projects.',
};

export default function BillingReconLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
