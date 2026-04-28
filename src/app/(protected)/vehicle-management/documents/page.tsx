'use client';

import { useMemo } from 'react';
import { syncVehicleComplianceStatus } from '@/components/vehicle-management/compliance-sync';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useAuthorization } from '@/hooks/useAuthorization';
import { computeRenewalMeta, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';

const columns: CrudColumnConfig[] = [
  { key: 'vehicleNumber', label: 'Vehicle Number' },
  { key: 'documentType', label: 'Document Type' },
  { key: 'documentNumber', label: 'Document Number' },
  { key: 'expiryDate', label: 'Expiry Date' },
  { key: 'alertStage', label: 'Alert' },
  { key: 'status', label: 'Status' },
];

export default function DocumentManagementPage() {
  const { can } = useAuthorization();
  const { options: vehicleOptions, map: vehicleMap } = useVehicleOptions();
  const canView = can('View', 'Vehicle Management.Document Management');
  const canAdd = can('Add', 'Vehicle Management.Document Management');
  const canEdit = can('Edit', 'Vehicle Management.Document Management');
  const canDelete = can('Delete', 'Vehicle Management.Document Management');
  const canImport = can('Import', 'Vehicle Management.Document Management') || canAdd;
  const canExport = can('Export', 'Vehicle Management.Document Management') || canView;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'vehicleId', label: 'Vehicle Number', type: 'select', required: true, options: vehicleOptions },
      {
        key: 'documentType',
        label: 'Document Type',
        type: 'select',
        required: true,
        options: [
          { value: 'RC Book', label: 'RC Book' },
          { value: 'Insurance', label: 'Insurance' },
          { value: 'PUC', label: 'PUC' },
          { value: 'Fitness', label: 'Fitness' },
          { value: 'Road Tax', label: 'Road Tax' },
          { value: 'Permit', label: 'Permit' },
          { value: 'Service Invoice', label: 'Service Invoice' },
          { value: 'Fuel Bills', label: 'Fuel Bills' },
          { value: 'Accident Reports', label: 'Accident Reports' },
          { value: 'Other', label: 'Other' },
        ],
      },
      { key: 'documentNumber', label: 'Document Number', type: 'text', required: true },
      { key: 'issueDate', label: 'Issue Date', type: 'date' },
      { key: 'expiryDate', label: 'Expiry Date', type: 'date' },
      { key: 'fileUrl', label: 'Document Upload', type: 'file', required: true, accept: '.pdf,.jpg,.jpeg,.png,.webp' },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        options: [
          { value: 'Valid', label: 'Valid' },
          { value: 'Due Soon', label: 'Due Soon' },
          { value: 'Expired', label: 'Expired' },
          { value: 'Missing', label: 'Missing' },
        ],
      },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    [vehicleOptions]
  );

  return (
    <GenericCrudPage
      title="Document Management"
      description="Vehicle-wise document folder records and validity tracking."
      itemName="Document"
      collectionName={VEHICLE_COLLECTIONS.documents}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="document-management"
      defaultSort={{ key: 'expiryDate', direction: 'asc' }}
      onBeforeSave={(payload) => {
        const vehicle = vehicleMap[String(payload.vehicleId)];
        const meta = computeRenewalMeta(String(payload.expiryDate || ''));
        return {
          ...payload,
          vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
          folderPath: `${payload.vehicleId}/${payload.documentType}`,
          status: payload.status || meta.complianceStatus,
          alertStage: meta.alertStage,
        };
      }}
      onAfterSave={async ({ payload }) => {
        const vehicleId = String(payload.vehicleId || '');
        if (vehicleId) await syncVehicleComplianceStatus(vehicleId);
      }}
    />
  );
}
