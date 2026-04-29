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
  { key: 'insuranceCompany', label: 'Insurance Company' },
  { key: 'policyNumber', label: 'Policy Number' },
  { key: 'expiryDate', label: 'Expiry Date' },
  { key: 'alertStage', label: 'Alert' },
  { key: 'renewalStatus', label: 'Renewal Status' },
  { key: 'complianceStatus', label: 'Compliance' },
];

export default function InsuranceManagementPage() {
  const { can } = useAuthorization();
  const { options: vehicleOptions, map: vehicleMap } = useVehicleOptions();
  const { prefill, renewingFromId } = useRenewalPrefill();
  const canView = can('View', 'Vehicle Management.Insurance Management');
  const canAdd = can('Add', 'Vehicle Management.Insurance Management');
  const canEdit = can('Edit', 'Vehicle Management.Insurance Management');
  const canDelete = can('Delete', 'Vehicle Management.Insurance Management');
  const canImport = can('Import', 'Vehicle Management.Insurance Management') || canAdd;
  const canExport = can('Export', 'Vehicle Management.Insurance Management') || canView;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'vehicleId', label: 'Vehicle Number', type: 'select', required: true, options: vehicleOptions },
      { key: 'insuranceCompany', label: 'Insurance Company', type: 'text', required: true },
      { key: 'policyNumber', label: 'Policy Number', type: 'text', required: true },
      {
        key: 'policyType',
        label: 'Policy Type',
        type: 'select',
        required: true,
        options: [
          { value: 'Comprehensive', label: 'Comprehensive' },
          { value: 'Third-Party', label: 'Third-Party' },
          { value: 'Own-Damage', label: 'Own-Damage' },
          { value: 'Zero-Dep', label: 'Zero-Dep' },
          { value: 'Commercial Package', label: 'Commercial Package' },
        ],
      },
      { key: 'startDate', label: 'Start Date', type: 'date', required: true },
      { key: 'expiryDate', label: 'Expiry Date', type: 'date', required: true },
      { key: 'premiumAmount', label: 'Premium Amount', type: 'number', required: true },
      { key: 'idvValue', label: 'IDV Value', type: 'number' },
      { key: 'agentName', label: 'Agent Name', type: 'text' },
      { key: 'agentContact', label: 'Agent Contact', type: 'text' },
      { key: 'policyDocumentUrl', label: 'Document Upload', type: 'file', required: true, accept: '.pdf,.jpg,.jpeg,.png,.webp' },
      {
        key: 'renewalStatus',
        label: 'Renewal Status',
        type: 'select',
        options: [
          { value: 'Not Due', label: 'Not Due' },
          { value: 'Due Soon', label: 'Due Soon' },
          { value: 'Overdue', label: 'Overdue' },
          { value: 'In Process', label: 'In Process' },
          { value: 'Renewed', label: 'Renewed' },
        ],
      },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    [vehicleOptions]
  );

  return (
    <GenericCrudPage
      title="Insurance Management"
      description="Insurance details, expiry alerts, and renewal tracking."
      itemName="Insurance Record"
      collectionName={VEHICLE_COLLECTIONS.insurance}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="insurance-management"
      defaultSort={{ key: 'expiryDate', direction: 'asc' }}
      initialPrefill={prefill}
      renewingFromId={renewingFromId}
      onBeforeSave={(payload) => {
        const vehicle = vehicleMap[String(payload.vehicleId)];
        const meta = computeRenewalMeta(String(payload.expiryDate || ''));
        return {
          ...payload,
          vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
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
