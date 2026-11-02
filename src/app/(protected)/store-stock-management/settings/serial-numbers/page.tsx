'use client';

import { LEGACY_SERIAL_RESOURCE, SerialNumberSettings } from '@/components/settings/serial-number-page';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';

/** Store & Stock › Settings › Serial Numbers: the GRN number series Stock In hands out. */
export default function StoreStockSerialNumbersPage() {
  const { can, isLoading } = useAuthorization();
  const canEdit = can('Edit', 'Store & Stock Management.Settings') || can('Edit', LEGACY_SERIAL_RESOURCE);
  const canView = canEdit || can('View', 'Store & Stock Management.Settings') || can('View', LEGACY_SERIAL_RESOURCE);

  return (
    <SerialNumberSettings
      seriesId="store-stock-grn"
      permissionsLoading={isLoading}
      canView={canView}
      canEdit={canEdit}
      editRight="Store & Stock Management › Settings › Edit"
      activityModule={ACTIVITY_MODULES.STORE_STOCK}
      backFallback="/store-stock-management/settings"
    />
  );
}
