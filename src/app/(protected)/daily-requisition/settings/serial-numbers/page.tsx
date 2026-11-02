'use client';

import { dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import { LEGACY_SERIAL_RESOURCE, SerialNumberSettings } from '@/components/settings/serial-number-page';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';

/** Daily Requisition › Settings › Serial Numbers: the Reception No series. */
export default function DailyRequisitionSerialNumbersPage() {
  const { can, isLoading } = useAuthorization();
  const canEdit = can('Edit Serial Nos', 'Daily Requisition.Settings') || can('Edit', LEGACY_SERIAL_RESOURCE);
  // Settings viewers see the series read-only, as they see Printing Setup.
  const canView = canEdit || can('View', 'Daily Requisition.Settings') || can('View', LEGACY_SERIAL_RESOURCE);

  return (
    <div className={`${dailyPageContainerClass} mx-auto max-w-5xl`}>
      <SerialNumberSettings
        seriesId="daily-requisition"
        permissionsLoading={isLoading}
        canView={canView}
        canEdit={canEdit}
        editRight="Daily Requisition › Settings › Edit Serial Nos"
        activityModule={ACTIVITY_MODULES.DAILY_REQUISITION}
        backFallback="/daily-requisition/settings"
      />
    </div>
  );
}
