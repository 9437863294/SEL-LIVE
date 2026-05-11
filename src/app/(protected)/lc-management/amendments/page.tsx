'use client';

import { useMemo } from 'react';
import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { LC_COLLECTIONS } from '@/lib/lc-management';

const columns: CrudColumnConfig[] = [
  { key: 'lcNo', label: 'LC No' },
  { key: 'amendmentType', label: 'Amendment Type' },
  { key: 'oldValue', label: 'Old Value' },
  { key: 'newValue', label: 'New Value' },
  { key: 'bankCharges', label: 'Bank Charges' },
  { key: 'approvalStatus', label: 'Approval Status' },
];

export default function LcAmendmentsPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'LC Management.LC Amendments');
  const canAdd = can('Add', 'LC Management.LC Amendments');
  const canEdit = can('Edit', 'LC Management.LC Amendments');
  const canDelete = can('Delete', 'LC Management.LC Amendments');
  const canImport = can('Import', 'LC Management.LC Amendments') || canAdd;
  const canExport = can('Export', 'LC Management.LC Amendments') || canView;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'lcNo', label: 'LC No.', type: 'text', required: true },
      {
        key: 'amendmentType',
        label: 'Amendment Type',
        type: 'select',
        required: true,
        options: [
          { value: 'Amount', label: 'Amount' },
          { value: 'Date', label: 'Date' },
          { value: 'Terms', label: 'Terms' },
          { value: 'Bank', label: 'Bank' },
          { value: 'Shipment', label: 'Shipment' },
          { value: 'Documents', label: 'Documents' },
        ],
      },
      { key: 'oldValue', label: 'Old Value', type: 'text', required: true },
      { key: 'newValue', label: 'New Value', type: 'text', required: true },
      { key: 'reason', label: 'Reason', type: 'textarea', required: true },
      { key: 'bankCharges', label: 'Bank Charges', type: 'number' },
      {
        key: 'approvalStatus',
        label: 'Approval Status',
        type: 'select',
        defaultValue: 'Draft',
        options: [
          { value: 'Draft', label: 'Draft' },
          { value: 'Approved', label: 'Approved' },
          { value: 'Rejected', label: 'Rejected' },
          { value: 'Sent to Bank', label: 'Sent to Bank' },
          { value: 'Updated', label: 'Updated' },
        ],
      },
      { key: 'createdBy', label: 'Created By', type: 'text' },
      { key: 'approvedBy', label: 'Approved By', type: 'text' },
    ],
    []
  );

  return (
    <GenericCrudPage
      title="LC Amendments"
      description="Track LC amendments with old/new values, approval, and bank update references."
      itemName="LC Amendment"
      collectionName={LC_COLLECTIONS.amendments}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="lc-amendments"
      defaultSort={{ key: 'createdAt', direction: 'desc' }}
      onBeforeSave={(payload) => {
        const next = { ...payload };
        if (String(next.oldValue || '').trim() === String(next.newValue || '').trim()) {
          throw new Error('Old Value and New Value cannot be same.');
        }
        return next;
      }}
      onAfterSave={async ({ payload }) => {
        const lcNo = String(payload.lcNo || '').trim();
        if (!lcNo) return;
        const approvalStatus = String(payload.approvalStatus || '').toLowerCase();
        if (!['approved', 'updated'].includes(approvalStatus)) return;

        const masterSnap = await getDocs(
          query(collection(db, LC_COLLECTIONS.master), where('lcNo', '==', lcNo))
        );
        if (masterSnap.empty) return;
        const masterDoc = masterSnap.docs[0];
        const master = masterDoc.data() as Record<string, any>;

        const amendmentType = String(payload.amendmentType || '');
        const patch: Record<string, any> = {
          status: 'Approved',
        };

        if (amendmentType === 'Amount') {
          const nextAmount = Number(payload.newValue || master.lcAmount || 0);
          patch.lcAmount = nextAmount;
          const settled = Number(master.settledAmount || 0);
          patch.outstandingAmount = Number((nextAmount - settled).toFixed(2));
        }
        if (amendmentType === 'Date') {
          patch.expiryDate = String(payload.newValue || master.expiryDate || '');
        }
        if (amendmentType === 'Terms') {
          patch.paymentTerms = String(payload.newValue || master.paymentTerms || '');
        }
        if (amendmentType === 'Bank') {
          patch.bankName = String(payload.newValue || master.bankName || '');
        }
        if (amendmentType === 'Shipment') {
          patch.status = 'Shipment / Dispatch Done';
        }
        if (amendmentType === 'Documents') {
          patch.status = 'Documents Received';
        }

        await updateDoc(doc(db, LC_COLLECTIONS.master, masterDoc.id), patch);
      }}
    />
  );
}

