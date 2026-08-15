'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
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
      <div className="flex items-center gap-2">
        <Link href="/recurring-payments/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">{meta.title}</h1>
          <p className="text-sm text-muted-foreground">{meta.description}</p>
        </div>
      </div>
      <RecurringPaymentSettingsPanel organizationId={user?.organizationId || 'default'} section={tab} />
      {tab === 'automation' && <AutomationOperations />}
    </div>
  );
}
