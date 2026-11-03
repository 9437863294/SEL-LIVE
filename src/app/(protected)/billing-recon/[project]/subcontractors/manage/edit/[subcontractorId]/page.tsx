import SubcontractorsScreen from '@/app/(protected)/subcontractors-management/[project]/manage/edit/[subcontractorId]/page';

/**
 * Subcontractors › Edit Subcontractor, inside Billing Recon. The same screen and records as
 * /subcontractors-management/[project]/manage/edit/[subcontractorId]; its links stay in Billing Recon (see
 * src/components/subcontractors-management/paths.tsx).
 */
export default function BillingReconSubcontractorsPage() {
  return <SubcontractorsScreen />;
}
