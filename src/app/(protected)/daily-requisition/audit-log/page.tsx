'use client';

import { ShieldAlert } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { ModuleAuditLog, type AuditLogEntry } from '@/components/shared/module-audit-log';
import { dailyPageContainerClass, dailySurfaceCardClass } from '@/components/daily-requisition/module-shell';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { requisitionHref } from '@/lib/requisition-progress';

const DESCRIPTION = 'Every action on daily requisitions — who did it, when, and exactly what changed.';

/**
 * A single Reception No opens in the entry sheet. Bulk status moves log a list
 * ("DR-1, DR-2 +3 more"), which no one page can open.
 */
const recordHref = (log: AuditLogEntry) => {
  const ref = log.recordRef?.trim();
  return ref && !/[,+]/.test(ref) ? requisitionHref(ref) : null;
};

export default function DailyRequisitionAuditLogPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  // Settings › Audit Logs already sees every module's trail, so it sees this one too.
  const isGlobalAuditor = can('View', 'Settings.Audit Logs');
  const canView = can('View', 'Daily Requisition.Audit Log') || isGlobalAuditor;
  const canExport = can('Export', 'Daily Requisition.Audit Log') || isGlobalAuditor;

  if (isAuthLoading) {
    return (
      <div className={dailyPageContainerClass}>
        <Skeleton className="mb-6 h-10 w-full max-w-80" />
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className={dailyPageContainerClass}>
        <PageHeader backHref="/daily-requisition" eyebrow="Daily Requisition" title="Audit Log" description={DESCRIPTION} />
        <Card className={dailySurfaceCardClass}>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You need the <strong>Audit Log → View</strong> permission under Daily Requisition. Ask an administrator
              to grant it in Role Management.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={dailyPageContainerClass}>
      <PageHeader backHref="/daily-requisition" eyebrow="Daily Requisition" title="Audit Log" description={DESCRIPTION} />
      <ModuleAuditLog module={ACTIVITY_MODULES.DAILY_REQUISITION} recordHref={recordHref} canExport={canExport} />
    </div>
  );
}
