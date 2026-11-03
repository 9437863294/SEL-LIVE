'use client';
export const dynamic = 'force-dynamic';

import { RegisterReports } from '@/components/billing-recon/desk/register-reports';

/** Billing Recon › JMC › Reports. */
export default function JmcReportsPage() {
  return <RegisterReports kind="JMC" />;
}
