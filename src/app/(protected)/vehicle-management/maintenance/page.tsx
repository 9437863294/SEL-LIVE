'use client';

import { useMemo } from 'react';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useAuthorization } from '@/hooks/useAuthorization';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';

const columns: CrudColumnConfig[] = [
  { key: 'vehicleNumber', label: 'Vehicle Number' },
  { key: 'maintenanceType', label: 'Type' },
  { key: 'serviceDate', label: 'Service Date' },
  { key: 'garageName', label: 'Garage' },
  { key: 'totalCost', label: 'Total Cost' },
  { key: 'vehicleDowntimeDays', label: 'Downtime (Days)' },
  { key: 'nextServiceDate', label: 'Next Service' },
  { key: 'nextServiceDueAlert', label: 'Service Due' },
  { key: 'approvalStatus', label: 'Approval' },
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
          { value: 'Breakdown Repair', label: 'Breakdown Repair' },
          { value: 'Accident Repair', label: 'Accident Repair' },
          { value: 'Tyre Replacement', label: 'Tyre Replacement' },
          { value: 'Battery Replacement', label: 'Battery Replacement' },
          { value: 'Oil Change', label: 'Oil Change' },
          { value: 'Engine Overhaul', label: 'Engine Overhaul' },
          { value: 'Brake Service', label: 'Brake Service' },
          { value: 'AC Repair', label: 'AC Repair' },
          { value: 'Electrical Work', label: 'Electrical Work' },
          { value: 'Body Work', label: 'Body Work' },
          { value: 'Other', label: 'Other' },
        ],
      },
      { key: 'serviceDate', label: 'Service Date', type: 'date', required: true },
      { key: 'serviceDoneDate', label: 'Service Completion Date', type: 'date' },
      { key: 'odometerReadingKm', label: 'Odometer Reading (KM)', type: 'number', required: true, step: '1' },
      { key: 'garageName', label: 'Garage / Workshop Name', type: 'text', required: true },
      { key: 'garageContactNumber', label: 'Garage Contact', type: 'text' },
      { key: 'workDescription', label: 'Work Description', type: 'textarea', required: true },
      { key: 'partsReplaced', label: 'Parts Replaced', type: 'textarea' },
      { key: 'labourCost', label: 'Labour Cost (₹)', type: 'number', required: true },
      { key: 'partsCost', label: 'Parts Cost (₹)', type: 'number', required: true },
      { key: 'otherCharges', label: 'Other Charges (₹)', type: 'number', defaultValue: '0' },
      { key: 'nextServiceDate', label: 'Next Service Due Date', type: 'date' },
      { key: 'nextServiceKm', label: 'Next Service Due KM', type: 'number', step: '1' },
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
        defaultValue: 'Pending',
      },
      { key: 'approvedBy', label: 'Approved By', type: 'text' },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    [vehicleOptions]
  );

  return (
    <GenericCrudPage
      title="Maintenance Management"
      description="Vehicle repair, service history, cost tracking, and approval workflows."
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

        // Compute downtime from service date → completion date
        let vehicleDowntimeDays = 0;
        const serviceDate = String(payload.serviceDate || '');
        const doneDateRaw = String(payload.serviceDoneDate || '');
        if (serviceDate && doneDateRaw) {
          const start = new Date(serviceDate);
          const end = new Date(doneDateRaw);
          const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
          vehicleDowntimeDays = Math.max(0, diff);
        }

        // Next-service due alert
        const nextServiceDate = String(payload.nextServiceDate || '');
        let nextServiceDueAlert = '';
        if (nextServiceDate) {
          const today = new Date();
          const target = new Date(nextServiceDate);
          today.setHours(0, 0, 0, 0);
          target.setHours(0, 0, 0, 0);
          const days = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (days < 0) nextServiceDueAlert = 'Overdue';
          else if (days === 0) nextServiceDueAlert = 'Due Today';
          else if (days <= 7) nextServiceDueAlert = '7 Days';
          else if (days <= 30) nextServiceDueAlert = '30 Days';
          else nextServiceDueAlert = 'Upcoming';
        }

        return {
          ...payload,
          vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
          vehicleType: vehicle?.vehicleType || '',
          totalCost: labourCost + partsCost + otherCharges,
          vehicleDowntimeDays,
          nextServiceDueAlert,
          maintenanceStatus: 'Completed',
        };
      }}
    />
  );
}
