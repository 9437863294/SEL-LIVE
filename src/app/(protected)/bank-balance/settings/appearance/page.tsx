'use client';

import { Palette } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { BANK_PAGE, BankAccessDenied, BankPageSkeleton } from '@/components/bank-balance/page-kit';
import { DashboardDesignPicker } from '@/components/bank-balance/dashboard-design-picker';
import { useAuthorization } from '@/hooks/useAuthorization';

/**
 * Bank Balance › Settings › Appearance: which design the dashboard opens in, for everyone. Opened
 * from its card on the Settings hub rather than laid out on the hub itself.
 */
export default function BankAppearancePage() {
  const { can, isLoading } = useAuthorization();
  if (isLoading) return <BankPageSkeleton kpis={0} blocks={1} />;
  if (!can('View Module', 'Bank Balance')) {
    return <BankAccessDenied title="Appearance" backHref="/bank-balance/settings" backLabel="Back to settings" what="Appearance" />;
  }
  return (
    <div className={`${BANK_PAGE} pb-28`}>
      <PageHeader
        title="Appearance"
        description="How the Bank Balance dashboard is laid out for everyone. Every design shows the same figures from the ledger."
        icon={Palette}
        backHref="/bank-balance/settings"
        backLabel="Back to settings"
      />
      {/* The module's settings right: the same one that edits the rest of bankBalanceSettings. */}
      <DashboardDesignPicker canEdit={can('Edit', 'Bank Balance.Payment Entry Settings')} />
    </div>
  );
}
