'use client';
export const dynamic = 'force-dynamic';

import { RegisterReports } from '@/components/billing-recon/desk/register-reports';

/** Billing Recon › MVAC › Reports. */
export default function MvacReportsPage() {
  return <RegisterReports kind="MVAC" />;
}
