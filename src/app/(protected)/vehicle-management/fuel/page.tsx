'use client';

import { useMemo } from 'react';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useAuthorization } from '@/hooks/useAuthorization';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useAuth } from '@/components/auth/AuthProvider';

const columns: CrudColumnConfig[] = [
  { key: 'vehicleNumber', label: 'Vehicle Number' },
  { key: 'fuelDate', label: 'Date' },
  { key: 'quantityLiters', label: 'Quantity (L)' },
  { key: 'totalAmount', label: 'Total Amount' },
  { key: 'mileageKmPerLiter', label: 'Mileage (KM/L)' },
  { key: 'costPerKm', label: 'Cost / KM' },
];

export default function FuelManagementPage() {
  const { can } = useAuthorization();
  const { user } = useAuth();
  const { options: vehicleOptions, map: vehicleMap } = useVehicleOptions();
  const canView = can('View', 'Vehicle Management.Fuel Management');
  const canAdd = can('Add', 'Vehicle Management.Fuel Management');
  const canEdit = can('Edit', 'Vehicle Management.Fuel Management');
  const canDelete = can('Delete', 'Vehicle Management.Fuel Management');
  const canImport = can('Import', 'Vehicle Management.Fuel Management') || canAdd;
  const canExport = can('Export', 'Vehicle Management.Fuel Management') || canView;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'vehicleId', label: 'Vehicle Number', type: 'select', required: true, options: vehicleOptions },
      { key: 'fuelDate', label: 'Date', type: 'date', required: true },
      { key: 'quantityLiters', label: 'Quantity', type: 'number', required: true },
      { key: 'ratePerUnit', label: 'Rate Per Unit', type: 'number', required: true },
      { key: 'odometerReadingKm', label: 'Odometer Reading', type: 'number', required: true, step: '1' },
      { key: 'previousOdometerReadingKm', label: 'Previous Odometer', type: 'number', step: '1' },
      { key: 'fuelStationName', label: 'Fuel Station Name', type: 'text', required: true },
      { key: 'billNumber', label: 'Bill Number', type: 'text' },
      { key: 'billUploadUrl', label: 'Bill Upload', type: 'file', required: true, accept: '.pdf,.jpg,.jpeg,.png,.webp' },
      {
        key: 'paymentMode',
        label: 'Payment Mode',
        type: 'select',
        options: [
          { value: 'Cash', label: 'Cash' },
          { value: 'UPI', label: 'UPI' },
          { value: 'Bank Transfer', label: 'Bank Transfer' },
          { value: 'Card', label: 'Card' },
          { value: 'Cheque', label: 'Cheque' },
        ],
      },
      { key: 'transactionReference', label: 'Transaction Reference', type: 'text' },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    [vehicleOptions]
  );

  return (
    <GenericCrudPage
      title="Fuel Management"
      description="Fuel expenses, mileage, and bill tracking."
      itemName="Fuel Record"
      collectionName={VEHICLE_COLLECTIONS.fuel}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="fuel-management"
      defaultSort={{ key: 'fuelDate', direction: 'desc' }}
      onBeforeSave={(payload) => {
        const vehicle = vehicleMap[String(payload.vehicleId)];
        const quantity = Number(payload.quantityLiters || 0);
        const rate = Number(payload.ratePerUnit || 0);
        const currentOdometer = Number(payload.odometerReadingKm || 0);
        const previousOdometer = Number(payload.previousOdometerReadingKm || 0);
        const distance = currentOdometer > previousOdometer ? currentOdometer - previousOdometer : 0;
        const totalAmount = quantity * rate;
        const mileage = quantity > 0 && distance > 0 ? Number((distance / quantity).toFixed(2)) : '';
        const costPerKm = distance > 0 ? Number((totalAmount / distance).toFixed(2)) : '';

        return {
          ...payload,
          vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
          fuelType: String(vehicle?.fuelType || payload.fuelType || 'Other'),
          totalAmount,
          distanceSinceLastFuelKm: distance,
          mileageKmPerLiter: mileage,
          costPerKm,
          enteredByUserId: user?.id || '',
          enteredByName: user?.name || '',
          fuelStatus: 'Submitted',
        };
      }}
    />
  );
}
