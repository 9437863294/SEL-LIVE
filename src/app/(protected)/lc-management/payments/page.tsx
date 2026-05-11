'use client';

import { useMemo } from 'react';
import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { getMandatoryDocumentNames, LC_COLLECTIONS } from '@/lib/lc-management';

const columns: CrudColumnConfig[] = [
  { key: 'lcNo', label: 'LC No' },
  { key: 'paymentDate', label: 'Payment Date' },
  { key: 'paymentAmount', label: 'Amount' },
  { key: 'bankReference', label: 'Bank Reference' },
  { key: 'paymentType', label: 'Payment Type' },
  { key: 'debitAccount', label: 'Debit Account' },
  { key: 'creditAccount', label: 'Credit Account' },
  { key: 'status', label: 'Status' },
];

export default function LcPaymentsPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'LC Management.LC Payments');
  const canAdd = can('Add', 'LC Management.LC Payments');
  const canEdit = can('Edit', 'LC Management.LC Payments');
  const canDelete = can('Delete', 'LC Management.LC Payments');
  const canImport = can('Import', 'LC Management.LC Payments') || canAdd;
  const canExport = can('Export', 'LC Management.LC Payments') || canView;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'lcNo', label: 'LC No.', type: 'text', required: true },
      { key: 'supplierName', label: 'Supplier Name', type: 'text' },
      { key: 'paymentDate', label: 'Payment Date', type: 'date', required: true },
      { key: 'paymentAmount', label: 'Payment Amount', type: 'number', required: true },
      { key: 'bankReference', label: 'Bank Reference', type: 'text', required: true },
      {
        key: 'paymentType',
        label: 'Payment Type',
        type: 'select',
        defaultValue: 'LC Settlement',
        options: [
          { value: 'LC Settlement', label: 'LC Settlement' },
          { value: 'Partial Settlement', label: 'Partial Settlement' },
          { value: 'Usance Settlement', label: 'Usance Settlement' },
        ],
      },
      { key: 'debitAccount', label: 'Debit Account', type: 'text', required: true, placeholder: 'Supplier Payable' },
      { key: 'creditAccount', label: 'Credit Account', type: 'text', required: true, placeholder: 'LC Bank Liability / Bank' },
      { key: 'remarks', label: 'Settlement Remarks', type: 'textarea' },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        defaultValue: 'Payment Settled',
        options: [
          { value: 'Payment Due', label: 'Payment Due' },
          { value: 'Payment Settled', label: 'Payment Settled' },
        ],
      },
    ],
    []
  );

  return (
    <GenericCrudPage
      title="LC Payments"
      description="Record bank settlement against LC. Save is blocked until mandatory documents are uploaded and verified."
      itemName="LC Payment"
      collectionName={LC_COLLECTIONS.payments}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="lc-payments"
      defaultSort={{ key: 'paymentDate', direction: 'desc' }}
      onBeforeSave={async (payload, currentRow) => {
        const next = { ...payload };
        const lcNo = String(next.lcNo || '').trim();
        if (!lcNo) {
          throw new Error('LC No is required.');
        }

        const masterSnap = await getDocs(
          query(collection(db, LC_COLLECTIONS.master), where('lcNo', '==', lcNo))
        );
        if (masterSnap.empty) {
          throw new Error('No LC request found for this LC No.');
        }

        const masterDoc = masterSnap.docs[0];
        const master = masterDoc.data() as Record<string, any>;
        const lcAmount = Number(master.lcAmount || 0);
        const lcType = String(master.lcType || 'Inland');
        const requiredDocs = getMandatoryDocumentNames(lcType);

        const docsSnap = await getDocs(
          query(collection(db, LC_COLLECTIONS.documents), where('lcNo', '==', lcNo))
        );
        const verifiedDocs = new Set(
          docsSnap.docs
            .map((entry) => entry.data() as Record<string, any>)
            .filter((row) => String(row.verifiedStatus || '').toLowerCase() === 'verified')
            .map((row) => String(row.documentName || '').trim())
        );
        const missingMandatory = requiredDocs.filter((name) => !verifiedDocs.has(name));
        if (missingMandatory.length > 0) {
          throw new Error(`Payment blocked. Verify mandatory documents: ${missingMandatory.join(', ')}`);
        }

        const paymentSnap = await getDocs(
          query(collection(db, LC_COLLECTIONS.payments), where('lcNo', '==', lcNo))
        );
        const alreadySettled = paymentSnap.docs
          .filter((entry) => entry.id !== String(currentRow?.id || ''))
          .reduce((sum, entry) => sum + Number((entry.data() as Record<string, any>).paymentAmount || 0), 0);

        const paymentAmount = Number(next.paymentAmount || 0);
        if (paymentAmount <= 0) {
          throw new Error('Payment amount must be greater than zero.');
        }
        if (alreadySettled + paymentAmount > lcAmount) {
          throw new Error('Payment amount exceeds outstanding LC amount.');
        }

        next.lcId = masterDoc.id;
        next.lcAmount = lcAmount;
        next.currency = String(master.currency || 'INR');
        next.status = 'Payment Settled';
        next.outstandingAfter = Number((lcAmount - alreadySettled - paymentAmount).toFixed(2));
        return next;
      }}
      onAfterSave={async ({ payload }) => {
        const lcNo = String(payload.lcNo || '').trim();
        if (!lcNo) return;
        const masterSnap = await getDocs(
          query(collection(db, LC_COLLECTIONS.master), where('lcNo', '==', lcNo))
        );
        if (masterSnap.empty) return;

        const masterDoc = masterSnap.docs[0];
        const master = masterDoc.data() as Record<string, any>;
        const lcAmount = Number(master.lcAmount || 0);

        const paymentsSnap = await getDocs(
          query(collection(db, LC_COLLECTIONS.payments), where('lcNo', '==', lcNo))
        );
        const settledAmount = paymentsSnap.docs.reduce(
          (sum, entry) => sum + Number((entry.data() as Record<string, any>).paymentAmount || 0),
          0
        );
        const outstanding = Number((lcAmount - settledAmount).toFixed(2));
        const isClosed = outstanding <= 0;

        await updateDoc(doc(db, LC_COLLECTIONS.master, masterDoc.id), {
          settledAmount: Number(settledAmount.toFixed(2)),
          outstandingAmount: outstanding,
          status: isClosed ? 'Payment Settled' : 'Payment Due',
          closureDate: isClosed ? String(payload.paymentDate || '') : '',
        });
      }}
    />
  );
}

