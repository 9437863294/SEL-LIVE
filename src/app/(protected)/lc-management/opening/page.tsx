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
} from '@/lib/lc-management';

const columns: CrudColumnConfig[] = [
  { key: 'lcNo', label: 'LC No' },
  { key: 'bankName', label: 'Bank' },
  { key: 'bankLcReferenceNo', label: 'Bank LC Ref' },
  { key: 'openingDate', label: 'Opening Date' },
  { key: 'expiryDate', label: 'Expiry Date' },
  { key: 'lcAmount', label: 'LC Amount' },
  { key: 'marginAmount', label: 'Margin Amount' },
  { key: 'bankCharges', label: 'Bank Charges' },
  { key: 'status', label: 'Status' },
];

export default function LcOpeningPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'LC Management.LC Opening');
  const canAdd = can('Add', 'LC Management.LC Opening');
  const canEdit = can('Edit', 'LC Management.LC Opening');
  const canDelete = can('Delete', 'LC Management.LC Opening');
  const canImport = can('Import', 'LC Management.LC Opening') || canAdd;
  const canExport = can('Export', 'LC Management.LC Opening') || canView;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'lcNo', label: 'LC No.', type: 'text', required: true },
      {
        key: 'lcType',
        label: 'LC Type',
        type: 'select',
        required: true,
        options: LC_TYPES.map((item) => ({ value: item.value, label: item.label })),
      },
      { key: 'supplierName', label: 'Supplier Name', type: 'text', required: true },
      { key: 'purchaseOrderNo', label: 'Purchase Order No.', type: 'text', required: true },
      { key: 'bankName', label: 'Bank Name', type: 'text', required: true },
      { key: 'bankLcReferenceNo', label: 'Bank LC Reference No.', type: 'text', required: true },
      { key: 'openingDate', label: 'LC Opening Date', type: 'date', required: true },
      { key: 'expiryDate', label: 'LC Expiry Date', type: 'date', required: true },
      { key: 'dueDate', label: 'Expected Payment Date', type: 'date', required: true },
      { key: 'lcAmount', label: 'Final LC Amount', type: 'number', required: true },
      {
        key: 'currency',
        label: 'Currency',
        type: 'select',
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
      { key: 'lcCopyUrl', label: 'Bank LC Copy', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx' },
      {
        key: 'status',
        label: 'LC Status',
        type: 'select',
        defaultValue: 'Sent to Bank',
        options: LC_STATUS_FLOW.map((item) => ({ value: item, label: item })),
      },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    []
  );

  return (
    <GenericCrudPage
      title="LC Opening"
      description="Update bank opening details, reference number, margin money, and bank charges."
      itemName="LC Opening"
      collectionName={LC_COLLECTIONS.master}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="lc-opening"
      defaultSort={{ key: 'openingDate', direction: 'desc' }}
      onBeforeSave={(payload) => {
        const next = { ...payload };
        if (!isFutureOrToday(String(next.expiryDate || ''))) {
          throw new Error('LC expiry date must be today or future date.');
        }
        if (!String(next.bankName || '').trim()) {
          throw new Error('Bank Name is required before LC can be opened.');
        }
        if (!String(next.bankLcReferenceNo || '').trim()) {
          throw new Error('Bank LC Reference No. is required.');
        }

        const lcAmount = Number(next.lcAmount || 0);
        const marginPercent = Number(next.marginPercent || 0);
        next.marginAmount = calculateMarginAmount(lcAmount, marginPercent);
        next.outstandingAmount = Number((lcAmount - Number(next.settledAmount || 0)).toFixed(2));

        if (next.bankLcReferenceNo && next.lcCopyUrl) {
          next.status = 'LC Opened';
        } else if (!String(next.status || '').trim()) {
          next.status = 'Sent to Bank';
        }
        next.updatedFrom = 'LC Opening';
        return next;
      }}
    />
  );
}

