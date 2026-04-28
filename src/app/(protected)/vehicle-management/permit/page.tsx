'use client';

import { useMemo } from 'react';
import { syncVehicleComplianceStatus } from '@/components/vehicle-management/compliance-sync';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useAuthorization } from '@/hooks/useAuthorization';
import { computeRenewalMeta, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';

const columns: CrudColumnConfig[] = [
  { key: 'vehicleNumber', label: 'Vehicle Number' },
  { key: 'permitType', label: 'Permit Type' },
  { key: 'permitNumber', label: 'Permit Number' },
  { key: 'validTill', label: 'Valid Till' },
  { key: 'alertStage', label: 'Alert' },
  { key: 'permitStatus', label: 'Status' },
  { key: 'complianceStatus', label: 'Compliance' },
];

export default function PermitManagementPage() {
  const { can } = useAuthorization();
  const { options: vehicleOptions, map: vehicleMap } = useVehicleOptions();
  const canView = can('View', 'Vehicle Management.Permit Management');
  const canAdd = can('Add', 'Vehicle Management.Permit Management');
  const canEdit = can('Edit', 'Vehicle Management.Permit Management');
  const canDelete = can('Delete', 'Vehicle Management.Permit Management');
  const canImport = can('Import', 'Vehicle Management.Permit Management') || canAdd;
  const canExport = can('Export', 'Vehicle Management.Permit Management') || canView;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'vehicleId', label: 'Vehicle Number', type: 'select', required: true, options: vehicleOptions },
      {
        key: 'isMandatory',
        label: 'Mandatory for Vehicle',
        type: 'select',
        defaultValue: 'Yes',
        options: [
          { value: 'Yes', label: 'Yes' },
          { value: 'No', label: 'No' },
        ],
      },
      {
        key: 'permitType',
        label: 'Permit Type',
        type: 'select',
        required: true,
        options: [
          { value: 'National Permit', label: 'National Permit' },
          { value: 'State Permit', label: 'State Permit' },
          { value: 'Local Permit', label: 'Local Permit' },
          { value: 'Goods Carrier', label: 'Goods Carrier' },
          { value: 'Passenger Carrier', label: 'Passenger Carrier' },
          { value: 'Tourist Permit', label: 'Tourist Permit' },
          { value: 'Contract Carriage', label: 'Contract Carriage' },
          { value: 'Other', label: 'Other' },
        ],
      },
      { key: 'permitNumber', label: 'Permit Number', type: 'text', required: true },
      { key: 'validFrom', label: 'Valid From', type: 'date', required: true },
      { key: 'validTill', label: 'Valid Till', type: 'date', required: true },
      { key: 'issuingAuthority', label: 'Issuing Authority', type: 'text', required: true },
      { key: 'amountPaid', label: 'Amount Paid', type: 'number', required: true },
      { key: 'permitDocumentUrl', label: 'Document Upload', type: 'file', required: true, accept: '.pdf,.jpg,.jpeg,.png,.webp' },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    [vehicleOptions]
  );

  return (
    <GenericCrudPage
      title="Permit Management"
      description="Permit validity and renewal for commercial/transport vehicles."
      itemName="Permit Record"
      collectionName={VEHICLE_COLLECTIONS.permit}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="permit-management"
      defaultSort={{ key: 'validTill', direction: 'asc' }}
      onBeforeSave={(payload) => {
        const vehicle = vehicleMap[String(payload.vehicleId)];
        const mandatory = String(payload.isMandatory || 'Yes') === 'Yes';
        const meta = mandatory ? computeRenewalMeta(String(payload.validTill || '')) : { alertStage: 'Not Applicable', complianceStatus: 'Not Applicable' };
        return {
          ...payload,
          permitNumber: String(payload.permitNumber || '').toUpperCase().trim(),
          vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
          permitStatus: mandatory ? (meta.complianceStatus === 'Expired' ? 'Expired' : 'Valid') : 'Not Applicable',
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
