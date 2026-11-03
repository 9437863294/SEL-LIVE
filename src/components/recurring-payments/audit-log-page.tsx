'use client';

import { History, Loader2, ShieldAlert } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { ModuleAuditLog, type AuditLogEntry } from '@/components/shared/module-audit-log';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';

const DESCRIPTION =
  'Every action in Recurring Payments — generation, workflow steps, payments, masters, vendors and settings — who did it, when, and what changed.';

/**
 * Where an audit row's record opens. The module's actions name what they touched ("Archive Master",
 * "Update Vendor", "Workflow: Approve"), and `recordId` is that record's id; settings-level rows
 * (approval rules, categories, workflow, automation runs) have no page of their own.
 */
function recordHrefFor(log: AuditLogEntry): string | null {
  const id = log.recordId;
  if (!id) return null;
  const action = log.action || '';
  if (/Master/.test(action)) return `/recurring-payments/masters/${encodeURIComponent(id)}`;
  if (/Vendor/.test(action)) return `/recurring-payments/vendors/${encodeURIComponent(id)}`;
  if (/Rule|Category|Settings|Workflow$|Automation/.test(action)) return null;
  return `/recurring-payments/payments/${encodeURIComponent(id)}`;
}

/**
 * The module's own view of the app-wide audit trail (`userLogs`), the same rows Settings › Audit
 * Logs shows, narrowed to Recurring Payments — so a module administrator can review it without
 * the system-wide Audit Logs permission.
 */
export default function RecurringPaymentsAuditLogPage() {
  const { can, isLoading } = useAuthorization();
  // Settings › Audit Logs already sees every module's trail, so it sees this one too.
  const isGlobalAuditor = can('View', 'Settings.Audit Logs');
  const canView = isGlobalAuditor || can('View', 'Recurring Payments.Settings');
  const canExport = isGlobalAuditor || can('Edit', 'Recurring Payments.Settings');

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="space-y-5">
        <PageHeader icon={History} title="Audit Log" description={DESCRIPTION} backHref="/recurring-payments/settings" backLabel="Back to settings" />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" /> Access denied
            </CardTitle>
            <CardDescription>
              You need View on Recurring Payments › Settings, or on Settings › Audit Logs, to see this trail.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={History} title="Audit Log" description={DESCRIPTION} backHref="/recurring-payments/settings" backLabel="Back to settings" />
      <ModuleAuditLog module={ACTIVITY_MODULES.RECURRING_PAYMENTS} recordHref={recordHrefFor} canExport={canExport} />
    </div>
  );
}
