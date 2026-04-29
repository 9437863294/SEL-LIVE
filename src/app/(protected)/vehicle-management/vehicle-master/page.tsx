'use client';

import { useMemo } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import {
  useDepartmentOptions,
  useDriverOptions,
  useProjectOptions,
} from '@/components/vehicle-management/hooks';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import {
  getVehicleComplianceRequirements,
  VEHICLE_COLLECTIONS,
  toVehicleCode,
} from '@/lib/vehicle-management';

const columns: CrudColumnConfig[] = [
  { key: 'vehicleId', label: 'Vehicle ID' },
  { key: 'vehicleNumber', label: 'Vehicle Number' },
  { key: 'vehicleType', label: 'Type' },
  { key: 'assignedDepartmentName', label: 'Department' },
  { key: 'assignedProjectName', label: 'Project' },
  { key: 'assignedDriverName', label: 'Driver' },
  { key: 'fuelType', label: 'Fuel' },
  { key: 'documentHealthStatus', label: 'Docs Health' },
  { key: 'documentAlertCount', label: 'Doc Alerts' },
  { key: 'ownershipType', label: 'Ownership' },
  { key: 'vehicleStatus', label: 'Status' },
];

export default function VehicleMasterPage() {
  const { can } = useAuthorization();
  const { options: departmentOptions, map: departmentMap } = useDepartmentOptions();
  const { options: projectOptions, map: projectMap } = useProjectOptions();
  const { options: driverOptions, map: driverMap } = useDriverOptions();
  const canView = can('View', 'Vehicle Management.Vehicle Master');
  const canAdd = can('Add', 'Vehicle Management.Vehicle Master');
  const canEdit = can('Edit', 'Vehicle Management.Vehicle Master');
  const canDelete = can('Delete', 'Vehicle Management.Vehicle Master');
  const canImport = can('Import', 'Vehicle Management.Vehicle Master') || canAdd;
  const canExport = can('Export', 'Vehicle Management.Vehicle Master') || canView;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'vehicleNumber', label: 'Vehicle Number', type: 'text', required: true, placeholder: 'WB12AB1234' },
      {
        key: 'vehicleType',
        label: 'Vehicle Type',
        type: 'select',
        required: true,
        options: [
          { value: 'Truck', label: 'Truck' },
          { value: 'Car', label: 'Car' },
          { value: 'Bus', label: 'Bus' },
          { value: 'Van', label: 'Van' },
          { value: 'Pickup', label: 'Pickup' },
          { value: 'Tanker', label: 'Tanker' },
          { value: 'Trailer', label: 'Trailer' },
          { value: 'Two Wheeler', label: 'Two Wheeler' },
          { value: 'Other', label: 'Other' },
        ],
      },
      {
        key: 'vehicleCategory',
        label: 'Vehicle Category',
        type: 'select',
        required: true,
        options: [
          { value: 'Commercial', label: 'Commercial' },
          { value: 'Passenger', label: 'Passenger' },
          { value: 'Light', label: 'Light' },
          { value: 'Medium', label: 'Medium' },
          { value: 'Heavy', label: 'Heavy' },
          { value: 'Special Purpose', label: 'Special Purpose' },
          { value: 'Other', label: 'Other' },
        ],
      },
      { key: 'brand', label: 'Brand', type: 'text', required: true },
      { key: 'model', label: 'Model', type: 'text', required: true },
      { key: 'yearOfManufacture', label: 'Year of Manufacture', type: 'number', required: true, step: '1' },
      {
        key: 'fuelType',
        label: 'Fuel Type',
        type: 'select',
        required: true,
        options: [
          { value: 'Diesel', label: 'Diesel' },
          { value: 'Petrol', label: 'Petrol' },
          { value: 'CNG', label: 'CNG' },
          { value: 'Electric', label: 'Electric' },
          { value: 'Hybrid', label: 'Hybrid' },
          { value: 'Other', label: 'Other' },
        ],
      },
      { key: 'chassisNumber', label: 'Chassis Number', type: 'text', required: true },
      { key: 'engineNumber', label: 'Engine Number', type: 'text', required: true },
      {
        key: 'ownershipType',
        label: 'Ownership Type',
        type: 'select',
        required: true,
        options: [
          { value: 'Owned', label: 'Owned' },
          { value: 'Leased', label: 'Leased' },
          { value: 'Rented', label: 'Rented' },
          { value: 'Attached', label: 'Attached' },
        ],
      },
      { key: 'purchaseDate', label: 'Purchase Date', type: 'date' },
      { key: 'purchaseValue', label: 'Purchase Value', type: 'number' },
      {
        key: 'currentStatus',
        label: 'Current Status',
        type: 'select',
        options: [
          { value: 'In Operation', label: 'In Operation' },
          { value: 'Idle', label: 'Idle' },
          { value: 'On Trip', label: 'On Trip' },
          { value: 'Under Check', label: 'Under Check' },
        ],
        defaultValue: 'In Operation',
      },
      {
        key: 'assignedDepartmentId',
        label: 'Assigned Department',
        type: 'select',
        options: departmentOptions,
      },
      {
        key: 'assignedProjectId',
        label: 'Assigned Project',
        type: 'select',
        options: projectOptions,
      },
      {
        key: 'assignedDriverId',
        label: 'Assigned Driver',
        type: 'select',
        options: driverOptions,
      },
      { key: 'currentOdometerKm', label: 'Current Odometer (KM)', type: 'number', required: true, step: '1' },
      {
        key: 'complianceRuleMode',
        label: 'Compliance Rule Mode',
        type: 'select',
        required: true,
        defaultValue: 'Auto',
        options: [
          { value: 'Auto', label: 'Auto (By Vehicle Type/Fuel)' },
          { value: 'Manual', label: 'Manual (Set Required Docs)' },
        ],
      },
      {
        key: 'requireInsurance',
        label: 'Insurance Required',
        type: 'select',
        options: [
          { value: 'Yes', label: 'Yes' },
          { value: 'No', label: 'No' },
        ],
        showWhen: ({ formState }) => String(formState.complianceRuleMode || 'Auto') === 'Manual',
      },
      {
        key: 'requirePuc',
        label: 'PUC Required',
        type: 'select',
        options: [
          { value: 'Yes', label: 'Yes' },
          { value: 'No', label: 'No' },
        ],
        showWhen: ({ formState }) => String(formState.complianceRuleMode || 'Auto') === 'Manual',
      },
      {
        key: 'requireFitness',
        label: 'Fitness Required',
        type: 'select',
        options: [
          { value: 'Yes', label: 'Yes' },
          { value: 'No', label: 'No' },
        ],
        showWhen: ({ formState }) => String(formState.complianceRuleMode || 'Auto') === 'Manual',
      },
      {
        key: 'requireRoadTax',
        label: 'Road Tax Required',
        type: 'select',
        options: [
          { value: 'Yes', label: 'Yes' },
          { value: 'No', label: 'No' },
        ],
        showWhen: ({ formState }) => String(formState.complianceRuleMode || 'Auto') === 'Manual',
      },
      {
        key: 'requirePermit',
        label: 'Permit Required',
        type: 'select',
        options: [
          { value: 'Yes', label: 'Yes' },
          { value: 'No', label: 'No' },
        ],
        showWhen: ({ formState }) => String(formState.complianceRuleMode || 'Auto') === 'Manual',
      },
      {
        key: 'vehicleStatus',
        label: 'Vehicle Status',
        type: 'select',
        required: true,
        options: [
          { value: 'Active', label: 'Active' },
          { value: 'Inactive', label: 'Inactive' },
          { value: 'Under Maintenance', label: 'Under Maintenance' },
          { value: 'Sold', label: 'Sold' },
          { value: 'Scrapped', label: 'Scrapped' },
          { value: 'Rented', label: 'Rented' },
          { value: 'Expired Documents', label: 'Expired Documents' },
        ],
      },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    [departmentOptions, driverOptions, projectOptions]
  );

  return (
    <GenericCrudPage
      title="Vehicle Master"
      description="Complete vehicle profile and assignment details."
      itemName="Vehicle"
      collectionName={VEHICLE_COLLECTIONS.vehicleMaster}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="vehicle-master"
      defaultSort={{ key: 'vehicleNumber', direction: 'asc' }}
      onBeforeSave={(payload, currentRow) => {
        const next = { ...payload };
        next.vehicleNumber = String(next.vehicleNumber || '').toUpperCase().replace(/\s+/g, '');
        next.chassisNumber = String(next.chassisNumber || '').toUpperCase().trim();
        next.engineNumber = String(next.engineNumber || '').toUpperCase().trim();
        next.assignedDepartmentName = departmentMap[String(next.assignedDepartmentId)]?.name || '';
        next.assignedProjectName = projectMap[String(next.assignedProjectId)]?.projectName || '';
        next.assignedDriverName = driverMap[String(next.assignedDriverId)]?.driverName || '';
        next.currentStatus = String(next.currentStatus || 'In Operation');

        const mode = String(next.complianceRuleMode || 'Auto');
        next.complianceRuleMode = mode;
        const requirements = getVehicleComplianceRequirements(next);
        next.requireInsurance = requirements.insurance ? 'Yes' : 'No';
        next.requirePuc = requirements.puc ? 'Yes' : 'No';
        next.requireFitness = requirements.fitness ? 'Yes' : 'No';
        next.requireRoadTax = requirements.roadTax ? 'Yes' : 'No';
        next.requirePermit = requirements.permit ? 'Yes' : 'No';

        if (!currentRow) {
          const seed = Date.now() % 1000000;
          next.vehicleId = toVehicleCode(seed);
        } else {
          next.vehicleId = currentRow.vehicleId;
        }
        return next;
      }}
      onAfterSave={async ({ id, payload, previousRow }) => {
        const nextDriverId = String(payload.assignedDriverId || '');
        const previousDriverId = String(previousRow?.assignedDriverId || '');
        const vehicleNumber = String(payload.vehicleNumber || '');

        if (previousDriverId && previousDriverId !== nextDriverId) {
          await updateDoc(doc(db, VEHICLE_COLLECTIONS.driver, previousDriverId), {
            assignedVehicleId: '',
            assignedVehicleNumber: '',
          });
        }

        if (nextDriverId) {
          await updateDoc(doc(db, VEHICLE_COLLECTIONS.driver, nextDriverId), {
            assignedVehicleId: id,
            assignedVehicleNumber: vehicleNumber,
          });
        }
      }}
    />
  );
}
