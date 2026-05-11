'use client';

import { useMemo } from 'react';
import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import GenericCrudPage, { CrudColumnConfig, CrudFieldConfig } from '@/components/vehicle-management/generic-crud-page';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import {
  getMandatoryDocumentNames,
  LC_COLLECTIONS,
  LC_IMPORT_ADDITIONAL_DOCUMENTS,
  LC_REQUIRED_DOCUMENTS,
} from '@/lib/lc-management';

const columns: CrudColumnConfig[] = [
  { key: 'lcNo', label: 'LC No' },
  { key: 'documentName', label: 'Document' },
  { key: 'receivedStatus', label: 'Received' },
  { key: 'verifiedStatus', label: 'Verified' },
  { key: 'uploadedBy', label: 'Uploaded By' },
  { key: 'uploadedDate', label: 'Upload Date' },
  { key: 'verifiedBy', label: 'Verified By' },
  { key: 'verificationDate', label: 'Verification Date' },
];

const documentOptions = [
  ...LC_REQUIRED_DOCUMENTS,
  ...LC_IMPORT_ADDITIONAL_DOCUMENTS,
  'Insurance Copy',
].map((item) => ({ value: item, label: item }));

export default function LcDocumentsPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'LC Management.LC Documents');
  const canAdd = can('Add', 'LC Management.LC Documents');
  const canEdit = can('Edit', 'LC Management.LC Documents');
  const canDelete = can('Delete', 'LC Management.LC Documents');
  const canImport = can('Import', 'LC Management.LC Documents') || canAdd;
  const canExport = can('Export', 'LC Management.LC Documents') || canView;

  const fields = useMemo<CrudFieldConfig[]>(
    () => [
      { key: 'lcNo', label: 'LC No.', type: 'text', required: true },
      { key: 'supplierName', label: 'Supplier Name', type: 'text' },
      {
        key: 'lcType',
        label: 'LC Type',
        type: 'select',
        defaultValue: 'Inland',
        options: [
          { value: 'Inland', label: 'Inland' },
          { value: 'Import', label: 'Import' },
        ],
      },
      {
        key: 'documentName',
        label: 'Document Name',
        type: 'select',
        required: true,
        options: documentOptions,
      },
      {
        key: 'receivedStatus',
        label: 'Received',
        type: 'select',
        required: true,
        defaultValue: 'Yes',
        options: [
          { value: 'Yes', label: 'Yes' },
          { value: 'No', label: 'No' },
        ],
      },
      { key: 'fileUrl', label: 'Document Upload', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx' },
      { key: 'uploadedBy', label: 'Uploaded By', type: 'text' },
      { key: 'uploadedDate', label: 'Upload Date', type: 'date' },
      {
        key: 'verifiedStatus',
        label: 'Verified Status',
        type: 'select',
        defaultValue: 'Pending',
        options: [
          { value: 'Pending', label: 'Pending' },
          { value: 'Verified', label: 'Verified' },
          { value: 'Rejected', label: 'Rejected' },
        ],
      },
      { key: 'verifiedBy', label: 'Verified By', type: 'text' },
      { key: 'verificationDate', label: 'Verification Date', type: 'date' },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    []
  );

  return (
    <GenericCrudPage
      title="LC Documents"
      description="Upload and verify LC document checklist. Payment is blocked until mandatory documents are verified."
      itemName="LC Document"
      collectionName={LC_COLLECTIONS.documents}
      fields={fields}
      columns={columns}
      canView={canView}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      exportFileName="lc-documents"
      defaultSort={{ key: 'uploadedDate', direction: 'desc' }}
      onBeforeSave={(payload) => {
        const next = { ...payload };
        if (!next.uploadedDate) {
          next.uploadedDate = new Date().toISOString().slice(0, 10);
        }
        if (String(next.verifiedStatus || '').toLowerCase() === 'verified') {
          if (!next.verificationDate) {
            next.verificationDate = new Date().toISOString().slice(0, 10);
          }
        } else {
          next.verifiedBy = '';
          next.verificationDate = '';
        }
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
        const masterData = masterDoc.data() as Record<string, any>;
        const lcType = String(masterData.lcType || payload.lcType || 'Inland');
        const requiredDocs = getMandatoryDocumentNames(lcType);

        const docsSnap = await getDocs(
          query(collection(db, LC_COLLECTIONS.documents), where('lcNo', '==', lcNo))
        );
        const verifiedDocs = new Set(
          docsSnap.docs
            .map((d) => d.data() as Record<string, any>)
            .filter((row) => String(row.verifiedStatus || '').toLowerCase() === 'verified')
            .map((row) => String(row.documentName || '').trim())
        );

        const verifiedCount = requiredDocs.filter((name) => verifiedDocs.has(name)).length;
        const allVerified = verifiedCount === requiredDocs.length;
        const verificationPercent =
          requiredDocs.length > 0
            ? Number(((verifiedCount / requiredDocs.length) * 100).toFixed(2))
            : 0;

        await updateDoc(doc(db, LC_COLLECTIONS.master, masterDoc.id), {
          status: allVerified ? 'Documents Verified' : 'Documents Received',
          mandatoryDocCount: requiredDocs.length,
          verifiedDocCount: verifiedCount,
          documentVerificationPercent: verificationPercent,
        });
      }}
    />
  );
}

