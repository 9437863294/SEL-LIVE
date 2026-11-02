'use client';

import { LEGACY_SERIAL_RESOURCE, SerialNumberSettings } from '@/components/settings/serial-number-page';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';

/** Site Fund Requisition 2 › Settings › Serial Numbers: the requisition number series. */
export default function SiteFundRequisitionSerialNumbersPage() {
  const { can, isLoading } = useAuthorization();
  const canEdit = can('Edit', 'Site Fund Requisition 2.Settings') || can('Edit', LEGACY_SERIAL_RESOURCE);
  const canView = canEdit || can('View', 'Site Fund Requisition 2.Settings') || can('View', LEGACY_SERIAL_RESOURCE);

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
      <SerialNumberSettings
        seriesId="site-fund-requisition"
        permissionsLoading={isLoading}
        canView={canView}
        canEdit={canEdit}
        editRight="Site Fund Requisition 2 › Settings › Edit"
        activityModule={ACTIVITY_MODULES.SITE_FUND_REQUISITION}
        backFallback="/site-fund-requisition-2/settings"
      />
    </div>
  );
}
