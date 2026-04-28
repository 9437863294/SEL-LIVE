'use client';

import { useMemo } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useUserOptions, useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { computeRenewalMeta, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';

const columns: CrudColumnConfig[] = [
  { key: 'driverName', label: 'Driver Name' },
  { key: 'mobileNumber', label: 'Mobile' },
  { key: 'linkedUserName', label: 'Linked User' },
  { key: 'licenseNumber', label: 'License Number' },
  { key: 'licenseExpiryDate', label: 'License Expiry' },
  { key: 'licenseAlertStage', label: 'Alert' },
  { key: 'assignedVehicleNumber', label: 'Assigned Vehicle' },
  { key: 'status', label: 'Status' },
];

export default function DriverManagementPage() {
  const { can } = useAuthorization();
  const { options: vehicleOptions, map: vehicleMap } = useVehicleOptions();
  const { options: userOptions, map: userMap, mobileToUserId } = useUserOptions();
  const canView = can('View', 'Vehicle Management.Driver Management');
  const canAdd = can('Add', 'Vehicle Management.Driver Management');
  const canEdit = can('Edit', 'Vehicle Management.Driver Management');
  const canDelete = can('Delete', 'Vehicle Management.Driver Management');
  const canImport = can('Import', 'Vehicle Management.Driver Management') || canAdd;
  const canExport = can('Export', 'Vehicle Management.Driver Management') || canView;

  const normalizeMobile = (value?: string) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length > 10) return digits.slice(-10);
    return digits;
  };

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'driverName', label: 'Driver Name', type: 'text', required: true },
      {
        key: 'linkedUserId',
        label: 'Linked App User',
        type: 'select',
        options: userOptions,
        placeholder: 'Select app user (optional)',
      },
      { key: 'mobileNumber', label: 'Mobile Number', type: 'text', required: true },
      { key: 'licenseNumber', label: 'License Number', type: 'text', required: true },
      { key: 'licenseExpiryDate', label: 'License Expiry Date', type: 'date', required: true },
      { key: 'address', label: 'Address', type: 'textarea', required: true },
      { key: 'assignedVehicleId', label: 'Assigned Vehicle', type: 'select', options: vehicleOptions },
      { key: 'joiningDate', label: 'Joining Date', type: 'date', required: true },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        required: true,
        options: [
          { value: 'Active', label: 'Active' },
          { value: 'On Leave', label: 'On Leave' },
          { value: 'Inactive', label: 'Inactive' },
          { value: 'Blacklisted', label: 'Blacklisted' },
        ],
      },
      { key: 'licenseDocumentUrl', label: 'License Upload', type: 'file', required: true, accept: '.pdf,.jpg,.jpeg,.png,.webp' },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    [userOptions, vehicleOptions]
  );

  return (
    <GenericCrudPage
      title="Driver Management"
      description="Driver records, license tracking, and vehicle assignment."
      itemName="Driver"
      collectionName={VEHICLE_COLLECTIONS.driver}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="driver-management"
      defaultSort={{ key: 'driverName', direction: 'asc' }}
      onBeforeSave={(payload) => {
        const vehicle = vehicleMap[String(payload.assignedVehicleId)];
        const meta = computeRenewalMeta(String(payload.licenseExpiryDate || ''));
        const mobileKey = normalizeMobile(String(payload.mobileNumber || ''));
        let linkedUserId = String(payload.linkedUserId || '').trim();
        if (!linkedUserId && mobileKey) {
          linkedUserId = mobileToUserId[mobileKey] || '';
        }

        const linkedUser = userMap[linkedUserId] || null;
        return {
          ...payload,
          linkedUserId,
          linkedUserName: linkedUser?.name || '',
          linkedUserEmail: linkedUser?.email || '',
          assignedVehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
          licenseAlertStage: meta.alertStage,
          licenseComplianceStatus: meta.complianceStatus,
        };
      }}
      onAfterSave={async ({ id, payload, previousRow }) => {
        const nextVehicleId = String(payload.assignedVehicleId || '');
        const previousVehicleId = String(previousRow?.assignedVehicleId || '');
        const driverName = String(payload.driverName || '');

        if (previousVehicleId && previousVehicleId !== nextVehicleId) {
          await updateDoc(doc(db, VEHICLE_COLLECTIONS.vehicleMaster, previousVehicleId), {
            assignedDriverId: '',
            assignedDriverName: '',
          });
        }

        if (nextVehicleId) {
          await updateDoc(doc(db, VEHICLE_COLLECTIONS.vehicleMaster, nextVehicleId), {
            assignedDriverId: id,
            assignedDriverName: driverName,
          });
        }
      }}
    />
  );
}
