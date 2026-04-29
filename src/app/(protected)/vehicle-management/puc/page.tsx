'use client';

import { useMemo } from 'react';
import { syncVehicleComplianceStatus } from '@/components/vehicle-management/compliance-sync';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useRenewalPrefill } from '@/components/vehicle-management/use-renewal-prefill';
import { useAuthorization } from '@/hooks/useAuthorization';
import { computeRenewalMeta, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';

const columns: CrudColumnConfig[] = [
  { key: 'vehicleNumber', label: 'Vehicle Number' },
  { key: 'pucCertificateNumber', label: 'Certificate Number' },
  { key: 'testingCenterName', label: 'Testing Center' },
  { key: 'expiryDate', label: 'Expiry Date' },
  { key: 'alertStage', label: 'Alert' },
  { key: 'pucStatus', label: 'Status' },
  { key: 'complianceStatus', label: 'Compliance' },
];

export default function PucManagementPage() {
  const { can } = useAuthorization();
  const { options: vehicleOptions, map: vehicleMap } = useVehicleOptions();
  const { prefill, renewingFromId } = useRenewalPrefill();
  const canView = can('View', 'Vehicle Management.PUC Management');
  const canAdd = can('Add', 'Vehicle Management.PUC Management');
  const canEdit = can('Edit', 'Vehicle Management.PUC Management');
  const canDelete = can('Delete', 'Vehicle Management.PUC Management');
  const canImport = can('Import', 'Vehicle Management.PUC Management') || canAdd;
  const canExport = can('Export', 'Vehicle Management.PUC Management') || canView;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'vehicleId', label: 'Vehicle Number', type: 'select', required: true, options: vehicleOptions },
      { key: 'pucCertificateNumber', label: 'PUC Certificate Number', type: 'text', required: true },
      { key: 'issueDate', label: 'Issue Date', type: 'date', required: true },
      { key: 'expiryDate', label: 'Expiry Date', type: 'date', required: true },
      { key: 'testingCenterName', label: 'Testing Center Name', type: 'text', required: true },
      { key: 'amountPaid', label: 'Amount Paid', type: 'number', required: true },
      { key: 'certificateDocumentUrl', label: 'Certificate Upload', type: 'file', required: true, accept: '.pdf,.jpg,.jpeg,.png,.webp' },
      {
        key: 'pucStatus',
        label: 'Status',
        type: 'select',
        options: [
          { value: 'Valid', label: 'Valid' },
          { value: 'Due Soon', label: 'Due Soon' },
          { value: 'Expired', label: 'Expired' },
          { value: 'Renewed', label: 'Renewed' },
        ],
      },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    [vehicleOptions]
  );

  return (
    <GenericCrudPage
      title="PUC Management"
      description="Pollution certificate details, expiry, and compliance."
      itemName="PUC Record"
      collectionName={VEHICLE_COLLECTIONS.puc}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="puc-management"
      defaultSort={{ key: 'expiryDate', direction: 'asc' }}
      initialPrefill={prefill}
      renewingFromId={renewingFromId}
      onBeforeSave={(payload) => {
        const vehicle = vehicleMap[String(payload.vehicleId)];
        const meta = computeRenewalMeta(String(payload.expiryDate || ''));
        return {
          ...payload,
          vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
          pucStatus: payload.pucStatus || (meta.complianceStatus === 'Valid' ? 'Valid' : 'Due Soon'),
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
