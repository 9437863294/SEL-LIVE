'use client';

import { useMemo } from 'react';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  calculateMarginAmount,
  isFutureOrToday,
  LC_COLLECTIONS,
  LC_CURRENCIES,
  LC_PAYMENT_TERMS,
  LC_STATUS_FLOW,
  LC_TYPES,
  toLcCode,
} from '@/lib/lc-management';

const columns: CrudColumnConfig[] = [
  { key: 'lcNo', label: 'LC No' },
  { key: 'supplierName', label: 'Supplier' },
  { key: 'purchaseOrderNo', label: 'PO No' },
  { key: 'bankName', label: 'Bank' },
  { key: 'lcAmount', label: 'LC Amount' },
  { key: 'currency', label: 'Currency' },
  { key: 'expiryDate', label: 'Expiry Date' },
  { key: 'dueDate', label: 'Payment Due Date' },
  { key: 'status', label: 'Status' },
];

export default function LcRequestPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'LC Management.LC Request');
  const canAdd = can('Add', 'LC Management.LC Request');
  const canEdit = can('Edit', 'LC Management.LC Request');
  const canDelete = can('Delete', 'LC Management.LC Request');
  const canImport = can('Import', 'LC Management.LC Request') || canAdd;
  const canExport = can('Export', 'LC Management.LC Request') || canView;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'lcNo', label: 'LC No.', type: 'text', placeholder: 'LC/2026/001' },
      {
        key: 'lcType',
        label: 'LC Type',
        type: 'select',
        required: true,
        defaultValue: LC_TYPES[0].value,
        options: LC_TYPES.map((item) => ({ value: item.value, label: item.label })),
      },
      { key: 'supplierName', label: 'Supplier Name', type: 'text', required: true },
      { key: 'purchaseOrderNo', label: 'Purchase Order No.', type: 'text', required: true },
      { key: 'purchaseOrderAmount', label: 'PO Amount', type: 'number', required: true },
      { key: 'purchaseOrderPendingAmount', label: 'PO Pending Amount', type: 'number' },
      { key: 'poSupplierName', label: 'PO Supplier Name', type: 'text' },
      {
        key: 'paymentMode',
        label: 'Payment Mode',
        type: 'select',
        required: true,
        defaultValue: 'LC',
        options: [
          { value: 'LC', label: 'LC' },
          { value: 'Advance', label: 'Advance' },
          { value: 'Credit', label: 'Credit' },
          { value: 'Cash', label: 'Cash' },
        ],
      },
      {
        key: 'lcRequired',
        label: 'LC Required',
        type: 'select',
        required: true,
        defaultValue: 'Yes',
        options: [
          { value: 'Yes', label: 'Yes' },
          { value: 'No', label: 'No' },
        ],
      },
      { key: 'bankName', label: 'Bank Name', type: 'text' },
      { key: 'lcAmount', label: 'LC Amount', type: 'number', required: true },
      {
        key: 'currency',
        label: 'Currency',
        type: 'select',
        required: true,
        defaultValue: 'INR',
        options: LC_CURRENCIES.map((item) => ({ value: item, label: item })),
      },
      { key: 'marginPercent', label: 'Margin %', type: 'number', defaultValue: '0' },
      { key: 'marginAmount', label: 'Margin Amount', type: 'number' },
      { key: 'bankCharges', label: 'Bank Charges', type: 'number' },
      {
        key: 'paymentTerms',
        label: 'Payment Terms',
        type: 'select',
        defaultValue: LC_PAYMENT_TERMS[0],
        options: LC_PAYMENT_TERMS.map((item) => ({ value: item, label: item })),
      },
      { key: 'openingDate', label: 'LC Opening Date', type: 'date' },
      { key: 'expiryDate', label: 'LC Expiry Date', type: 'date', required: true },
      { key: 'dueDate', label: 'Expected Payment Date', type: 'date', required: true },
      {
        key: 'status',
        label: 'LC Status',
        type: 'select',
        required: true,
        defaultValue: 'Draft',
        options: LC_STATUS_FLOW.map((item) => ({ value: item, label: item })),
      },
      { key: 'approvalBy', label: 'Approved By', type: 'text' },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    []
  );

  return (
    <GenericCrudPage
      title="LC Request"
      description="Create LC request against approved PO, with validations and approval-ready fields."
      itemName="LC Request"
      collectionName={LC_COLLECTIONS.master}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="lc-request"
      defaultSort={{ key: 'lcNo', direction: 'desc' }}
      onBeforeSave={(payload, currentRow) => {
        const next = { ...payload };
        next.paymentMode = 'LC';
        next.lcRequired = 'Yes';
        next.lcNo = String(next.lcNo || currentRow?.lcNo || '').trim();
        if (!next.lcNo) {
          next.lcNo = toLcCode(Date.now() % 10000);
        }

        const poAmount = Number(next.purchaseOrderAmount || 0);
        const poPending = Number(next.purchaseOrderPendingAmount || 0);
        const lcAmount = Number(next.lcAmount || 0);
        const compareBase = poPending > 0 ? poPending : poAmount;
        if (compareBase > 0 && lcAmount > compareBase) {
          throw new Error('LC amount cannot exceed PO amount / pending amount.');
        }

        const supplier = String(next.supplierName || '').trim().toLowerCase();
        const poSupplier = String(next.poSupplierName || '').trim().toLowerCase();
        if (poSupplier && supplier && poSupplier !== supplier) {
          throw new Error('Supplier must match PO supplier.');
        }

        if (!isFutureOrToday(String(next.expiryDate || ''))) {
          throw new Error('LC expiry date must be today or a future date.');
        }

        const status = String(next.status || 'Draft');
        if (['Sent to Bank', 'LC Opened'].includes(status) && !String(next.bankName || '').trim()) {
          throw new Error('Bank is mandatory before sending LC to bank/opening.');
        }

        const marginPercent = Number(next.marginPercent || 0);
        next.marginAmount = calculateMarginAmount(lcAmount, marginPercent);
        next.outstandingAmount = Number((lcAmount - Number(currentRow?.settledAmount || 0)).toFixed(2));
        next.updatedFrom = 'LC Request';
        return next;
      }}
    />
  );
}

