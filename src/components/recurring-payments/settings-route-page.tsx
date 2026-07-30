'use client';
import { useAuth } from '@/components/auth/AuthProvider';
import RecurringPaymentSettingsPanel from '@/components/recurring-payments/settings-panel';
import AutomationOperations from '@/components/recurring-payments/automation-operations';
export default function RecurringSettingsRoutePage({tab}:{tab:'approvals'|'notifications'|'automation'|'organization'}){const {user}=useAuth();return <div className="space-y-5"><RecurringPaymentSettingsPanel organizationId={user?.organizationId||'default'} initialTab={tab}/>{tab==='automation'&&<AutomationOperations/>}</div>}
