import SubcontractorsScreen from '@/app/(protected)/subcontractors-management/[project]/work-order/[workOrderId]/page';

/**
 * Subcontractors › Work Order, inside Billing Recon. The same screen and records as
 * /subcontractors-management/[project]/work-order/[workOrderId]; its links stay in Billing Recon (see
 * src/components/subcontractors-management/paths.tsx).
 */
export default function BillingReconSubcontractorsPage() {
  return <SubcontractorsScreen />;
}
