'use client';

import { useMemo } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useUserOptions, useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { computeRenewalMeta, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';

const OWN_VEHICLE_OPTION = '__OWN_VEHICLE__';

const columns: CrudColumnConfig[] = [
  { key: 'driverName', label: 'Driver Name' },
  { key: 'mobileNumber', label: 'Mobile' },
  { key: 'linkedUserName', label: 'Linked User' },
  { key: 'licenseNumber', label: 'License Number' },
  { key: 'licenseExpiryDate', label: 'License Expiry' },
  { key: 'vehicleAssignmentMode', label: 'Vehicle Mode' },
  { key: 'licenseAlertStage', label: 'Alert' },
  { key: 'assignedVehicleNumber', label: 'Assigned Vehicle' },
  { key: 'status', label: 'Status' },
];

export default function DriverManagementPage() {
  const { can } = useAuthorization();
  const { options: vehicleOptionsRaw, map: vehicleMap } = useVehicleOptions();
  const { options: userOptions, map: userMap, mobileToUserId } = useUserOptions();
  const canView =
    can('View', 'Vehicle Management.Driver Management') ||
    can('Add', 'Vehicle Management.Driver Management') ||
    can('Edit', 'Vehicle Management.Driver Management');
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

  const vehicleOptions = useMemo(
    () => [
      ...vehicleOptionsRaw,
      { value: OWN_VEHICLE_OPTION, label: 'Own Vehicle (Employee Personal)' },
    ],
    [vehicleOptionsRaw]
  );

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
      {
        key: 'ownVehicleNumber',
        label: 'Own Vehicle Number',
        type: 'text',
        required: true,
        placeholder: 'Enter own vehicle number',
        showWhen: ({ formState, editingRow }) =>
          String(formState.assignedVehicleId || '') === OWN_VEHICLE_OPTION ||
          (String(formState.assignedVehicleId || '') === '' &&
            String(editingRow?.vehicleAssignmentMode || '') === 'Own Vehicle'),
      },
      {
        key: 'ownVehicleType',
        label: 'Own Vehicle Type',
        type: 'text',
        required: true,
        placeholder: 'Bike / Car / Other',
        showWhen: ({ formState, editingRow }) =>
          String(formState.assignedVehicleId || '') === OWN_VEHICLE_OPTION ||
          (String(formState.assignedVehicleId || '') === '' &&
            String(editingRow?.vehicleAssignmentMode || '') === 'Own Vehicle'),
      },
      {
        key: 'ownFuelType',
        label: 'Own Fuel Type',
        type: 'select',
        required: true,
        options: [
          { value: 'Petrol', label: 'Petrol' },
          { value: 'Diesel', label: 'Diesel' },
          { value: 'CNG', label: 'CNG' },
          { value: 'Electric', label: 'Electric' },
          { value: 'Hybrid', label: 'Hybrid' },
          { value: 'Other', label: 'Other' },
        ],
        showWhen: ({ formState, editingRow }) =>
          String(formState.assignedVehicleId || '') === OWN_VEHICLE_OPTION ||
          (String(formState.assignedVehicleId || '') === '' &&
            String(editingRow?.vehicleAssignmentMode || '') === 'Own Vehicle'),
      },
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
      onBeforeSave={(payload, currentRow) => {
        const rawAssignedVehicleId = String(payload.assignedVehicleId || '');
        const isOwnVehicle =
          rawAssignedVehicleId === OWN_VEHICLE_OPTION ||
          (rawAssignedVehicleId === '' &&
            String(currentRow?.vehicleAssignmentMode || '') === 'Own Vehicle');
        const assignedVehicleId = isOwnVehicle ? OWN_VEHICLE_OPTION : rawAssignedVehicleId;
        const vehicle = vehicleMap[assignedVehicleId];
        const meta = computeRenewalMeta(String(payload.licenseExpiryDate || ''));
        const mobileKey = normalizeMobile(String(payload.mobileNumber || ''));
        let linkedUserId = String(payload.linkedUserId || '').trim();
        if (!linkedUserId && mobileKey) {
          linkedUserId = mobileToUserId[mobileKey] || '';
        }

        const ownVehicleNumberInput = String(payload.ownVehicleNumber || '').trim().toUpperCase();
        const fallbackOwnNumber = `OWN-${mobileKey || String(payload.driverName || 'DRV').replace(/\s+/g, '').toUpperCase()}`;
        const ownVehicleNumber = ownVehicleNumberInput || fallbackOwnNumber;
        const assignedVehicleNumber = isOwnVehicle
          ? ownVehicleNumber
          : vehicle?.vehicleNumber || vehicle?.registrationNo || '';
        const assignedVehicleType = isOwnVehicle
          ? String(payload.ownVehicleType || 'Personal Vehicle')
          : String(vehicle?.vehicleType || '');
        const assignedFuelType = isOwnVehicle
          ? String(payload.ownFuelType || 'Petrol')
          : String(vehicle?.fuelType || '');

        const linkedUser = userMap[linkedUserId] || null;
        return {
          ...payload,
          assignedVehicleId,
          linkedUserId,
          linkedUserName: linkedUser?.name || '',
          linkedUserEmail: linkedUser?.email || '',
          vehicleAssignmentMode: isOwnVehicle ? 'Own Vehicle' : 'Company Vehicle',
          ownVehicleNumber: isOwnVehicle ? ownVehicleNumber : '',
          ownVehicleType: isOwnVehicle ? String(payload.ownVehicleType || '') : '',
          ownFuelType: isOwnVehicle ? String(payload.ownFuelType || '') : '',
          assignedVehicleNumber,
          assignedVehicleType,
          assignedFuelType,
          licenseAlertStage: meta.alertStage,
          licenseComplianceStatus: meta.complianceStatus,
        };
      }}
      onAfterSave={async ({ id, payload, previousRow }) => {
        const nextVehicleIdRaw = String(payload.assignedVehicleId || '');
        const previousVehicleIdRaw = String(previousRow?.assignedVehicleId || '');
        const nextVehicleId = nextVehicleIdRaw === OWN_VEHICLE_OPTION ? '' : nextVehicleIdRaw;
        const previousVehicleId =
          previousVehicleIdRaw === OWN_VEHICLE_OPTION ? '' : previousVehicleIdRaw;
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
