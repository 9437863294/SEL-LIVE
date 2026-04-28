'use client';

import { useMemo } from 'react';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useAuthorization } from '@/hooks/useAuthorization';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';

const columns: CrudColumnConfig[] = [
  { key: 'vehicleNumber', label: 'Vehicle Number' },
  { key: 'maintenanceType', label: 'Maintenance Type' },
  { key: 'serviceDate', label: 'Service Date' },
  { key: 'totalCost', label: 'Total Cost' },
  { key: 'nextServiceDate', label: 'Next Service Date' },
  { key: 'approvalStatus', label: 'Approval Status' },
];

export default function MaintenanceManagementPage() {
  const { can } = useAuthorization();
  const { options: vehicleOptions, map: vehicleMap } = useVehicleOptions();
  const canView = can('View', 'Vehicle Management.Maintenance Management');
  const canAdd = can('Add', 'Vehicle Management.Maintenance Management');
  const canEdit = can('Edit', 'Vehicle Management.Maintenance Management');
  const canDelete = can('Delete', 'Vehicle Management.Maintenance Management');
  const canImport = can('Import', 'Vehicle Management.Maintenance Management') || canAdd;
  const canExport = can('Export', 'Vehicle Management.Maintenance Management') || canView;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'vehicleId', label: 'Vehicle Number', type: 'select', required: true, options: vehicleOptions },
      {
        key: 'maintenanceType',
        label: 'Maintenance Type',
        type: 'select',
        required: true,
        options: [
          { value: 'Regular Service', label: 'Regular Service' },
          { value: 'Breakdown', label: 'Breakdown' },
          { value: 'Accident Repair', label: 'Accident Repair' },
          { value: 'Tyre Replacement', label: 'Tyre Replacement' },
          { value: 'Battery Replacement', label: 'Battery Replacement' },
          { value: 'Oil Change', label: 'Oil Change' },
          { value: 'Engine Work', label: 'Engine Work' },
          { value: 'Other', label: 'Other' },
        ],
      },
      { key: 'serviceDate', label: 'Service Date', type: 'date', required: true },
      { key: 'odometerReadingKm', label: 'Odometer Reading (KM)', type: 'number', required: true, step: '1' },
      { key: 'garageName', label: 'Garage Name', type: 'text', required: true },
      { key: 'workDescription', label: 'Work Description', type: 'textarea', required: true },
      { key: 'partsReplaced', label: 'Parts Replaced', type: 'textarea' },
      { key: 'labourCost', label: 'Labour Cost', type: 'number', required: true },
      { key: 'partsCost', label: 'Parts Cost', type: 'number', required: true },
      { key: 'otherCharges', label: 'Other Charges', type: 'number', defaultValue: '0' },
      { key: 'nextServiceDate', label: 'Next Service Date', type: 'date' },
      { key: 'nextServiceKm', label: 'Next Service KM', type: 'number', step: '1' },
      { key: 'invoiceNumber', label: 'Invoice Number', type: 'text' },
      { key: 'jobCardNumber', label: 'Job Card Number', type: 'text' },
      { key: 'invoiceDocumentUrl', label: 'Invoice Upload', type: 'file', required: true, accept: '.pdf,.jpg,.jpeg,.png,.webp' },
      {
        key: 'approvalStatus',
        label: 'Approval Status',
        type: 'select',
        options: [
          { value: 'Pending', label: 'Pending' },
          { value: 'Under Review', label: 'Under Review' },
          { value: 'Approved', label: 'Approved' },
          { value: 'Rejected', label: 'Rejected' },
          { value: 'Cancelled', label: 'Cancelled' },
        ],
      },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    [vehicleOptions]
  );

  return (
    <GenericCrudPage
      title="Maintenance Management"
      description="Vehicle repair/service history and cost tracking."
      itemName="Maintenance Record"
      collectionName={VEHICLE_COLLECTIONS.maintenance}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="maintenance-management"
      defaultSort={{ key: 'serviceDate', direction: 'desc' }}
      onBeforeSave={(payload) => {
        const vehicle = vehicleMap[String(payload.vehicleId)];
        const labourCost = Number(payload.labourCost || 0);
        const partsCost = Number(payload.partsCost || 0);
        const otherCharges = Number(payload.otherCharges || 0);
        return {
          ...payload,
          vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
          totalCost: labourCost + partsCost + otherCharges,
          maintenanceStatus: 'Completed',
          vehicleDowntimeDays: '',
        };
      }}
    />
  );
}
