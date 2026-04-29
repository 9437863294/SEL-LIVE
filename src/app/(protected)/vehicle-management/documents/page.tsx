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
  { key: 'issuingAuthority', label: 'Issued By' },
  { key: 'issueDate', label: 'Issue Date' },
  { key: 'expiryDate', label: 'Expiry Date' },
  { key: 'alertStage', label: 'Alert' },
  { key: 'complianceStatus', label: 'Compliance' },
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
          { value: 'RC Book', label: 'RC Book (Registration Certificate)' },
          { value: 'Insurance', label: 'Insurance Policy' },
          { value: 'PUC', label: 'PUC Certificate' },
          { value: 'Fitness', label: 'Fitness Certificate' },
          { value: 'Road Tax', label: 'Road Tax Receipt' },
          { value: 'Permit', label: 'Permit' },
          { value: 'Hypothecation NOC', label: 'Hypothecation NOC' },
          { value: 'Service Invoice', label: 'Service Invoice' },
          { value: 'Fuel Bill', label: 'Fuel Bill' },
          { value: 'Accident Report', label: 'Accident Report' },
          { value: 'Delivery Challan', label: 'Delivery Challan' },
          { value: 'Load Permission', label: 'Load Permission' },
          { value: 'Other', label: 'Other' },
        ],
      },
      { key: 'documentNumber', label: 'Document Number', type: 'text', required: true },
      { key: 'issuingAuthority', label: 'Issuing Authority', type: 'text' },
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
          { value: 'Not Applicable', label: 'Not Applicable' },
        ],
      },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    [vehicleOptions]
  );

  return (
    <GenericCrudPage
      title="Document Management"
      description="Vehicle-wise document folder, validity tracking, and compliance status."
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
        const hasExpiry = Boolean(payload.expiryDate);
        return {
          ...payload,
          vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
          folderPath: `${payload.vehicleId}/${payload.documentType}`,
          status: payload.status || (hasExpiry ? meta.complianceStatus : 'Valid'),
          alertStage: hasExpiry ? meta.alertStage : 'Not Applicable',
          complianceStatus: hasExpiry ? meta.complianceStatus : 'Not Applicable',
        };
      }}
      onAfterSave={async ({ payload }) => {
        const vehicleId = String(payload.vehicleId || '');
        if (vehicleId) await syncVehicleComplianceStatus(vehicleId);
      }}
    />
  );
}
