/**
 * Billing Recon's own document shapes.
 *
 * An **RA bill abstract** (`projects/{projectId}/billingReconBills/{id}`) records which certified
 * JMC / MVAC quantities have been billed to the client on a running-account bill. It is a
 * *quantity* record: Bill Tracking stays the record of the bill's money (raised vs certified,
 * GST, retention, deductions, collections), and `billTrackingRef` links the two.
 *
 * Line items deliberately carry `boqSlNo`, `scope1`, `scope2` and `billedQty` — the same fields the
 * BOQ view, BOQ item dialog and combined log already match bill lines on — so every billed-quantity
 * total in Billing Recon reads these documents with its existing matching code. Subcontractors'
 * `projects/{id}/bills` (what the company pays) are never read as Billing Recon's billed quantity.
 *
 * Pure types (no Firebase import) so pure helpers and node tests can use them.
 */

export type RaBillStatus = 'Draft' | 'Submitted' | 'Cancelled';

export const RA_BILL_STATUSES: readonly RaBillStatus[] = ['Draft', 'Submitted', 'Cancelled'];

/** Which register a billed line was certified in. */
export type RaBillSource = 'JMC' | 'MVAC';

export interface RaBillItem {
  source: RaBillSource;
  /** The JMC / MVAC entry document id the quantity was certified on. */
  entryId: string;
  /** Its JMC / MVAC number, kept for display and print. */
  entryNo: string;
  /** Position of the line within that entry's `items` array. */
  itemIndex: number;
  boqSlNo: string;
  scope1: string;
  scope2: string;
  description: string;
  unit: string;
  rate: number;
  /** Certified quantity on the entry line when the bill was made. */
  certifiedQty: number;
  /** Quantity of that line already on earlier, non-cancelled bills when this one was made. */
  previouslyBilledQty: number;
  /** Quantity billed on this bill. */
  billedQty: number;
  /** billedQty × rate, rounded to paise. */
  amount: number;
}

/** Firestore Timestamp, kept structural so this file needs no Firebase import. */
export interface TimestampLike {
  toDate(): Date;
  toMillis(): number;
}

export interface RaBill {
  id: string;
  projectId: string;
  projectName: string;
  /** The bill's number, e.g. from the RA bill series in Settings › Serial No. */
  billNo: string;
  /** yyyy-mm-dd */
  billDate: string;
  /** 1 for the 1st RA bill of the project, 2 for the 2nd … (Cancelled bills keep their number). */
  raSequence: number;
  /** Optional measurement period, yyyy-mm-dd. */
  periodFrom?: string;
  periodTo?: string;
  items: RaBillItem[];
  totalAmount: number;
  status: RaBillStatus;
  /** The matching bill's number in Bill Tracking, once it has been raised there. */
  billTrackingRef?: string;
  remarks?: string;
  createdAt: TimestampLike | null;
  createdById: string;
  createdByName: string;
  updatedAt?: TimestampLike | null;
  submittedAt?: string;
  submittedByName?: string;
  cancelledAt?: string;
  cancelledByName?: string;
  cancelReason?: string;
}

/** Bills whose quantities count as billed — everything except cancelled ones. */
export function countsAsBilled(bill: Pick<RaBill, 'status'> | { status?: unknown }): boolean {
  return bill.status !== 'Cancelled';
}
