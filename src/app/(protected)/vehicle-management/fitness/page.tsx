'use client';

import { useMemo } from 'react';
import { syncVehicleComplianceStatus } from '@/components/vehicle-management/compliance-sync';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useAuthorization } from '@/hooks/useAuthorization';
import { computeRenewalMeta, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';

const columns: CrudColumnConfig[] = [
  { key: 'vehicleNumber', label: 'Vehicle Number' },
  { key: 'fitnessCertificateNumber', label: 'Certificate Number' },
  { key: 'rtoName', label: 'RTO Name' },
  { key: 'expiryDate', label: 'Expiry Date' },
  { key: 'alertStage', label: 'Alert' },
  { key: 'fitnessStatus', label: 'Status' },
  { key: 'complianceStatus', label: 'Compliance' },
];

export default function FitnessManagementPage() {
  const { can } = useAuthorization();
  const { options: vehicleOptions, map: vehicleMap } = useVehicleOptions();
  const canView = can('View', 'Vehicle Management.Fitness Certificate Management');
  const canAdd = can('Add', 'Vehicle Management.Fitness Certificate Management');
  const canEdit = can('Edit', 'Vehicle Management.Fitness Certificate Management');
  const canDelete = can('Delete', 'Vehicle Management.Fitness Certificate Management');
  const canImport = can('Import', 'Vehicle Management.Fitness Certificate Management') || canAdd;
  const canExport = can('Export', 'Vehicle Management.Fitness Certificate Management') || canView;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'vehicleId', label: 'Vehicle Number', type: 'select', required: true, options: vehicleOptions },
      {
        key: 'isMandatory',
        label: 'Mandatory for Vehicle',
        type: 'select',
        options: [
          { value: 'Yes', label: 'Yes' },
          { value: 'No', label: 'No' },
        ],
        defaultValue: 'Yes',
      },
      { key: 'fitnessCertificateNumber', label: 'Fitness Certificate Number', type: 'text', required: true },
      { key: 'issueDate', label: 'Issue Date', type: 'date', required: true },
      { key: 'expiryDate', label: 'Expiry Date', type: 'date', required: true },
      { key: 'rtoName', label: 'RTO Name', type: 'text', required: true },
      { key: 'amountPaid', label: 'Amount Paid', type: 'number', required: true },
      { key: 'certificateDocumentUrl', label: 'Document Upload', type: 'file', required: true, accept: '.pdf,.jpg,.jpeg,.png,.webp' },
      {
        key: 'fitnessStatus',
        label: 'Status',
        type: 'select',
        options: [
          { value: 'Valid', label: 'Valid' },
          { value: 'Due Soon', label: 'Due Soon' },
          { value: 'Expired', label: 'Expired' },
          { value: 'Renewed', label: 'Renewed' },
          { value: 'Not Applicable', label: 'Not Applicable' },
        ],
      },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    [vehicleOptions]
  );

  return (
    <GenericCrudPage
      title="Fitness Certificate Management"
      description="Fitness validity tracking for commercial/transport vehicles."
      itemName="Fitness Record"
      collectionName={VEHICLE_COLLECTIONS.fitness}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="fitness-management"
      defaultSort={{ key: 'expiryDate', direction: 'asc' }}
      onBeforeSave={(payload) => {
        const vehicle = vehicleMap[String(payload.vehicleId)];
        const mandatory = String(payload.isMandatory || 'Yes') === 'Yes';
        const meta = mandatory ? computeRenewalMeta(String(payload.expiryDate || '')) : { alertStage: 'Not Applicable', complianceStatus: 'Not Applicable' };
        return {
          ...payload,
          vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
          fitnessStatus: mandatory ? payload.fitnessStatus || (meta.complianceStatus === 'Valid' ? 'Valid' : 'Due Soon') : 'Not Applicable',
          alertStage: meta.alertStage,
          complianceStatus: meta.complianceStatus,
        };
      }}
      onAfterSave={async ({ payload }) => {
        const vehicleId = String(payload.vehicleId || '');
        if (vehicleId) await syncVehicleComplianceStatus(vehicleId);
      }}
    />
  );
}
