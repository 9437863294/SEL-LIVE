'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { PageHeader } from '@/components/shared/page-header';
import RecurringPaymentSettingsPanel from '@/components/recurring-payments/settings-panel';
import AutomationOperations from '@/components/recurring-payments/automation-operations';

type SettingsSection = 'approvals' | 'notifications' | 'automation' | 'organization';

const SECTION_META: Record<SettingsSection, { title: string; description: string }> = {
  approvals: {
    title: 'Approval Rules',
    description: 'Decide who approves a payment, based on its amount, category and project.',
  },
  notifications: {
    title: 'Notifications',
    description: 'Configure reminder channels and the schedule for due-date and overdue alerts.',
  },
  automation: {
    title: 'Automation',
    description: 'Control automatic payment generation, or trigger a run manually.',
  },
  organization: {
    title: 'Organization Controls',
    description: 'Data isolation and payment-control policy for this organization.',
  },
};

export default function RecurringSettingsRoutePage({ tab }: { tab: SettingsSection }) {
  const { user } = useAuth();
  const meta = SECTION_META[tab];
  return (
    <div className="space-y-5">
      <PageHeader
        className="mb-0 sm:mb-0"
        backHref="/recurring-payments/settings"
        backLabel="Back to settings"
        title={meta.title}
        description={meta.description}
      />
      <RecurringPaymentSettingsPanel organizationId={user?.organizationId || 'default'} section={tab} />
      {tab === 'automation' && <AutomationOperations />}
    </div>
  );
}
