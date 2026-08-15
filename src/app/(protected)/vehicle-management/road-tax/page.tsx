'use client';

import { useCallback, useMemo } from 'react';
import { syncVehicleComplianceStatus } from '@/components/vehicle-management/compliance-sync';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useRenewalPrefill } from '@/components/vehicle-management/use-renewal-prefill';
import { useAuthorization } from '@/hooks/useAuthorization';
import { computeRenewalMeta, getVehicleComplianceRequirements, getVehicleDateRangeError, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';

const columns: CrudColumnConfig[] = [
  { key: 'vehicleNumber', label: 'Vehicle Number' },
  { key: 'taxType', label: 'Tax Type' },
  { key: 'taxPeriod', label: 'Tax Period' },
  { key: 'validTill', label: 'Valid Till' },
  { key: 'alertStage', label: 'Alert' },
  { key: 'totalAmountPaid', label: 'Total Amount' },
  { key: 'roadTaxStatus', label: 'Status' },
  { key: 'complianceStatus', label: 'Compliance' },
];

export default function RoadTaxManagementPage() {
  const { can } = useAuthorization();
  const { options: vehicleOptions, map: vehicleMap } = useVehicleOptions();
  const { prefill, renewingFromId } = useRenewalPrefill();
  const canView = can('View', 'Vehicle Management.Road Tax Management');
  const canAdd = can('Add', 'Vehicle Management.Road Tax Management');
  const canEdit = can('Edit', 'Vehicle Management.Road Tax Management');
  const canDelete = can('Delete', 'Vehicle Management.Road Tax Management');
  const canImport = can('Import', 'Vehicle Management.Road Tax Management') || canAdd;
  const canExport = can('Export', 'Vehicle Management.Road Tax Management') || canView;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'vehicleId', label: 'Vehicle Number', type: 'select', required: true, searchable: true, options: vehicleOptions },
      {
        key: 'taxType',
        label: 'Tax Type',
        type: 'select',
        required: true,
        options: [
          { value: 'Road Tax', label: 'Road Tax' },
          { value: 'Passenger Tax', label: 'Passenger Tax' },
          { value: 'Goods Carriage Tax', label: 'Goods Carriage Tax' },
          { value: 'Green Tax', label: 'Green Tax' },
          { value: 'State Entry Tax', label: 'State Entry Tax' },
          { value: 'Other', label: 'Other' },
        ],
      },
      {
        key: 'taxPeriod',
        label: 'Tax Period',
        type: 'select',
        required: true,
        options: [
          { value: 'Monthly', label: 'Monthly' },
          { value: 'Quarterly', label: 'Quarterly' },
          { value: 'Half-Yearly', label: 'Half-Yearly' },
          { value: 'Yearly', label: 'Yearly' },
          { value: 'Lifetime', label: 'Lifetime' },
        ],
      },
      { key: 'paymentDate', label: 'Payment Date', type: 'date', required: true },
      { key: 'validTill', label: 'Valid Till', type: 'date', required: true },
      { key: 'amountPaid', label: 'Amount Paid', type: 'number', required: true, min: 0 },
      { key: 'penaltyAmount', label: 'Penalty Amount', type: 'number', defaultValue: '0', min: 0 },
      { key: 'receiptNumber', label: 'Receipt Number', type: 'text', required: true },
      { key: 'receiptDocumentUrl', label: 'Receipt Upload', type: 'file', required: true, accept: '.pdf,.jpg,.jpeg,.png,.webp' },
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

  // Every vehicle that requires road tax gets a row, even if it has no receipt on file yet
  // — mirrors the Insurance/PUC "Missing" redesign.
  const buildMissingRow = useCallback((vehicle: Record<string, any>) => ({
    id: `missing::${vehicle.id}`,
    isMissingRecord: true,
    vehicleId: String(vehicle.id),
    vehicleNumber: String(vehicle.vehicleNumber || vehicle.registrationNo || ''),
    taxType: '',
    taxPeriod: '',
    validTill: '',
    totalAmountPaid: '',
    isArchived: false,
    alertStage: 'Missing',
    roadTaxStatus: 'Missing',
    complianceStatus: 'Missing',
  }), []);

  return (
    <GenericCrudPage
      title="Road Tax Management"
      description="Tax dues, validity, and receipt records."
      itemName="Road Tax Record"
      formKey="roadTax"
      collectionName={VEHICLE_COLLECTIONS.roadTax}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="road-tax-management"
      defaultSort={{ key: 'validTill', direction: 'asc' }}
      vehicleRequirementKey="roadTax"
      buildMissingRow={buildMissingRow}
      onAfterFetch={(rows) => rows.map((row) => {
        const vehicle = vehicleMap[String(row.vehicleId || '')];
        // Sold/scrapped vehicles don't need current road tax — stop flagging their old
        // receipts as overdue.
        const vehicleRequires = vehicle ? getVehicleComplianceRequirements(vehicle).roadTax : true;
        if (!vehicleRequires) {
          return { ...row, alertStage: 'Not Applicable', complianceStatus: 'Not Applicable', roadTaxStatus: 'Not Applicable' };
        }
        const meta = computeRenewalMeta(String(row.validTill || ''));
        return { ...row, alertStage: meta.alertStage, complianceStatus: meta.complianceStatus === 'Expired' ? 'Overdue' : meta.complianceStatus, roadTaxStatus: meta.complianceStatus === 'Expired' ? 'Overdue' : 'Paid' };
      })}
      initialPrefill={prefill}
      renewingFromId={renewingFromId}
      onBeforeSave={(payload) => {
        const dateError = getVehicleDateRangeError(payload.paymentDate, payload.validTill, 'Payment date', 'Valid-till date');
        if (dateError) throw new Error(dateError);
        const vehicle = vehicleMap[String(payload.vehicleId)];
        const vehicleRequires = vehicle ? getVehicleComplianceRequirements(vehicle).roadTax : true;
        const meta = vehicleRequires
          ? computeRenewalMeta(String(payload.validTill || ''))
          : { alertStage: 'Not Applicable', complianceStatus: 'Not Applicable' };
        const amountPaid = Number(payload.amountPaid || 0);
        const penaltyAmount = Number(payload.penaltyAmount || 0);
        return {
          ...payload,
          vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
          totalAmountPaid: amountPaid + penaltyAmount,
          roadTaxStatus: !vehicleRequires ? 'Not Applicable' : meta.complianceStatus === 'Expired' ? 'Overdue' : 'Paid',
          alertStage: meta.alertStage,
          complianceStatus: meta.complianceStatus === 'Expired' ? 'Overdue' : meta.complianceStatus,
        };
      }}
      onAfterSave={async ({ payload }) => {
        const vehicleId = String(payload.vehicleId || '');
        if (vehicleId) await syncVehicleComplianceStatus(vehicleId);
      }}
      onAfterDelete={async ({ row }) => {
        const vehicleId = String(row.vehicleId || '');
        if (vehicleId) await syncVehicleComplianceStatus(vehicleId);
      }}
    />
  );
}
