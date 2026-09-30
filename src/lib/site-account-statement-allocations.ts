/**
 * Monthly budget allocations — the maker-checker ledger behind a month's budget figure.
 *
 * A monthly budget used to be one number on one document: set it, and spending was measured against
 * it immediately. That does not match how the money actually arrives. Head Office sanctions a site
 * in instalments — ₹2L now, ₹1.5L when the next bill clears — and each instalment has its own
 * sanction letter. One field could hold only the latest total, so the note that authorised it lived
 * in somebody's inbox and the running figure had no audit trail.
 *
 * An allocation is one of those instalments. It is recorded by whoever tracks the transfers, and
 * counts for nothing until a second person opens it, reads the attached approval, and verifies it.
 * That separation is the point: the person who types the amount must not be the only person who
 * blesses it, and an amount with no document behind it must not silently raise what a site is
 * allowed to spend.
 *
 * Importless on purpose, like the other SAS domain modules: `node --test` loads this directly, so
 * the status rules and the arithmetic that decides a site's spending ceiling are tested without a
 * browser or Firestore.
 */

/** Matches `SASAttachment` structurally; declared here so this module keeps no imports. */
export interface AllocationAttachment {
  name: string;
  url: string;
  storagePath: string;
  size: number;
  type: string;
  /**
   * The file belongs to another record — a payment receipt it was carried across from — and this
   * allocation only points at it. Replacing or deleting the allocation must leave it alone, or
   * approving a budget would silently destroy the receipt's own document.
   */
  shared?: boolean;
}

/** True when deleting the allocation may also delete the file behind its approval. */
export function ownsApprovalFile(
  allocation: Pick<SASBudgetAllocation, 'approval'>,
): boolean {
  return Boolean(allocation.approval?.storagePath) && allocation.approval?.shared !== true;
}

/**
 * Where an allocation sits.
 *
 * `rejected` is kept rather than deleted. "This ₹2L was proposed and turned down" is a different
 * fact from "this ₹2L was never proposed", and only the first survives an audit.
 */
export type SASAllocationStatus = 'pending' | 'approved' | 'rejected';

export interface SASBudgetAllocation {
  id: string;
  projectId: string;
  projectName: string;
  /** `YYYY-MM` — the month this allocation funds. */
  period: string;
  amount: number;
  /** When the sanction or transfer happened, `YYYY-MM-DD`. Not the date it was typed in. */
  allocationDate: string;
  referenceNo?: string;
  notes?: string;
  status: SASAllocationStatus;
  /** The sanction letter. Required before an allocation can be verified. */
  approval?: AllocationAttachment | null;

  /**
   * The receipt this allocation was raised from, when it came from one.
   *
   * An allocation is a claim that money arrived; the payments ledger is the record that it did.
   * Carrying the receipt id lets the dialog show which receipts have already been turned into
   * budget and which are still sitting unclaimed, so the same ₹2L transfer cannot quietly be
   * allocated twice.
   */
  paymentId?: string;

  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  verifiedAt?: unknown;
  verifiedBy?: string;
  verifiedByName?: string;
  rejectedReason?: string;
}

/**
 * A payment receipt, as the allocation ledger needs to see one.
 *
 * Declared structurally rather than imported from the domain file, so this module stays importless
 * and `node --test` can load it. It matches the fields of `SASPayment` that matter here.
 */
export interface AllocationReceipt {
  id: string;
  receiptDate: string;
  receivedAmount: number;
  paymentMode?: string;
  referenceNo?: string;
  receivedBy?: string;
  remarks?: string;
  attachments?: AllocationAttachment[];
}

/** A row being composed in the dialog, before it becomes a document. */
export interface AllocationDraft {
  amount: string;
  allocationDate: string;
  referenceNo: string;
  notes: string;
}

export const ALLOCATION_STATUS_LABEL: Record<SASAllocationStatus, string> = {
  pending: 'Awaiting review',
  approved: 'Verified',
  rejected: 'Rejected',
};

/** Only approved allocations raise what a site may spend. */
export function countsTowardBudget(allocation: Pick<SASBudgetAllocation, 'status'>): boolean {
  return allocation.status === 'approved';
}

export interface AllocationSummary {
  /** Sum of verified allocations — the part that is real budget. */
  approved: number;
  /** Sum of allocations still waiting on a reviewer. Deliberately not spendable. */
  pending: number;
  rejected: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  total: number;
}

export function summariseAllocations(allocations: SASBudgetAllocation[]): AllocationSummary {
  const summary: AllocationSummary = {
    approved: 0, pending: 0, rejected: 0,
    approvedCount: 0, pendingCount: 0, rejectedCount: 0,
    total: 0,
  };
  for (const allocation of allocations) {
    const amount = Number(allocation.amount) || 0;
    if (allocation.status === 'approved')      { summary.approved += amount; summary.approvedCount++; }
    else if (allocation.status === 'pending')  { summary.pending  += amount; summary.pendingCount++;  }
    else                                        { summary.rejected += amount; summary.rejectedCount++; }
  }
  summary.total = summary.approved + summary.pending;
  return summary;
}

/**
 * A month's spendable budget.
 *
 * `legacyAmount` is the single figure from the old `siteAccountBudgets` monthly document. Existing
 * installations have those, and dropping them the day allocations ship would silently zero every
 * budget already in use — so it is added, not replaced, and the UI lists it as its own row. An
 * administrator who wants it inside the ledger deletes it and re-enters it as an allocation; until
 * then nothing moves under them.
 */
export function effectiveMonthlyBudget(
  legacyAmount: number | null | undefined,
  allocations: SASBudgetAllocation[],
): number {
  const legacy = Number(legacyAmount) || 0;
  return legacy + summariseAllocations(allocations).approved;
}

export interface AllocationCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Whether an allocation may be verified.
 *
 * The attachment requirement is the whole mechanism, not a nicety: verifying is what turns a typed
 * number into money a site may spend, and the approval is the only evidence that somebody with the
 * authority to sanction it actually did.
 */
export function canVerifyAllocation(allocation: Pick<SASBudgetAllocation, 'status' | 'approval'>): AllocationCheck {
  if (allocation.status === 'approved') return { ok: false, reason: 'This allocation is already verified.' };
  if (!allocation.approval?.url) {
    return {
      ok: false,
      reason: 'Attach the approval document before verifying. An allocation cannot raise a budget on its own.',
    };
  }
  return { ok: true };
}

/** Whether an allocation may be sent back. A verified one is reopened, not rejected outright. */
export function canRejectAllocation(allocation: Pick<SASBudgetAllocation, 'status'>): AllocationCheck {
  if (allocation.status === 'rejected') return { ok: false, reason: 'This allocation is already rejected.' };
  return { ok: true };
}

/**
 * Whether an allocation may still be edited or removed.
 *
 * Once verified it is part of the audited figure, so it is reopened first — an edit in place would
 * change what a reviewer signed off without anyone seeing that it moved.
 */
export function canAmendAllocation(allocation: Pick<SASBudgetAllocation, 'status'>): AllocationCheck {
  if (allocation.status === 'approved') {
    return { ok: false, reason: 'Verified allocations cannot be changed. Reopen it for review first.' };
  }
  return { ok: true };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates a draft. Returns the first problem in the order a person reads the form. */
export function validateAllocationDraft(draft: AllocationDraft, period: string): AllocationCheck {
  const amount = Number(draft.amount);
  if (!draft.amount.trim()) return { ok: false, reason: 'Enter the allocation amount.' };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'Amount must be greater than zero.' };

  if (!draft.allocationDate) return { ok: false, reason: 'Enter the date the amount was sanctioned.' };
  if (!DATE_RE.test(draft.allocationDate)) return { ok: false, reason: 'Date must be in YYYY-MM-DD format.' };

  /*
   * The date may fall outside the month being funded — a sanction signed on 28 March can fund
   * April, and that is normal. What it may not do is precede the month by more than a quarter or
   * follow it by more than one, which in practice means the wrong month was picked in the dialog.
   */
  const allocationPeriod = draft.allocationDate.slice(0, 7);
  const distance = periodDistance(allocationPeriod, period);
  if (distance !== null && (distance < -3 || distance > 1)) {
    return {
      ok: false,
      reason: `That date is ${Math.abs(distance)} months from the month being funded. Check the month is right.`,
    };
  }

  return { ok: true };
}

/** Whole months from `from` to `to`; null when either is unparseable. */
export function periodDistance(from: string, to: string): number | null {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return null;
  return (ty * 12 + tm) - (fy * 12 + fm);
}

/**
 * Newest sanction first, with pending rows pulled to the top.
 *
 * What a reviewer opens this list to do is find the rows waiting on them; making them scan a
 * date-ordered list for them is busywork.
 */
export function sortAllocations(allocations: SASBudgetAllocation[]): SASBudgetAllocation[] {
  const rank: Record<SASAllocationStatus, number> = { pending: 0, approved: 1, rejected: 2 };
  return [...allocations].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return (b.allocationDate || '').localeCompare(a.allocationDate || '');
  });
}

// ── Receipts → budget ─────────────────────────────────────────────────────────
//
// Where the money a site may spend actually comes from. Head Office transfers land in the payments
// ledger, and an allocation is the act of saying "this transfer is September's budget". Deriving
// the list from the receipts rather than asking somebody to retype the figures is the difference
// between a ledger that reconciles and one that drifts.

/** Receipts recorded against one project inside one month, newest first. */
export function receiptsForPeriod<T extends { projectId: string; receiptDate?: string }>(
  payments: T[],
  projectId: string,
  period: string,
): T[] {
  return payments
    .filter(p => p.projectId === projectId && (p.receiptDate || '').startsWith(period))
    .sort((a, b) => (b.receiptDate || '').localeCompare(a.receiptDate || ''));
}

/**
 * The allocation raised from a given receipt, if there is a live one.
 *
 * Rejected allocations are skipped: a receipt whose allocation was turned down is available again,
 * which is the whole reason rejection is a status rather than a deletion.
 */
export function allocationForPayment(
  allocations: SASBudgetAllocation[],
  paymentId: string | undefined,
): SASBudgetAllocation | null {
  // Both sides must actually hold an id. Allocations recorded by hand store no payment id, so a
  // plain equality test would have matched every one of them against a missing lookup id and
  // reported unrelated receipts as already claimed.
  if (!paymentId) return null;
  return allocations.find(a => Boolean(a.paymentId) && a.paymentId === paymentId && a.status !== 'rejected') ?? null;
}

export interface ReceiptSummary {
  /** Everything the project received this month, per the payments ledger. */
  received: number;
  /** The part of it that has been raised as an allocation, verified or not. */
  allocated: number;
  /** Money that arrived but has not been claimed as budget by anyone. */
  unallocated: number;
  receiptCount: number;
  unallocatedCount: number;
}

export function summariseReceipts(
  receipts: AllocationReceipt[],
  allocations: SASBudgetAllocation[],
): ReceiptSummary {
  let received = 0, allocated = 0, unallocatedCount = 0;
  for (const receipt of receipts) {
    const amount = Number(receipt.receivedAmount) || 0;
    received += amount;
    if (allocationForPayment(allocations, receipt.id)) allocated += amount;
    else unallocatedCount++;
  }
  return {
    received,
    allocated,
    unallocated: received - allocated,
    receiptCount: receipts.length,
    unallocatedCount,
  };
}

/**
 * Pre-fills the allocation form from a receipt.
 *
 * The amount and date are left editable rather than locked, because a single transfer is sometimes
 * split across two months and the person doing the work knows that; what matters is that they
 * start from the recorded figure instead of keying it in again.
 */
export function draftFromReceipt(receipt: AllocationReceipt): AllocationDraft {
  const parts = [
    receipt.paymentMode ? `received by ${receipt.paymentMode}` : '',
    receipt.receivedBy ? `via ${receipt.receivedBy}` : '',
  ].filter(Boolean).join(' ');
  return {
    amount: String(Number(receipt.receivedAmount) || 0),
    allocationDate: receipt.receiptDate,
    referenceNo: receipt.referenceNo || '',
    notes: parts ? `From receipt dated ${receipt.receiptDate} (${parts}).` : `From receipt dated ${receipt.receiptDate}.`,
  };
}

/** Allocations for one project and month. */
export function allocationsFor(
  allocations: SASBudgetAllocation[],
  projectId: string,
  period: string,
): SASBudgetAllocation[] {
  return allocations.filter(a => a.projectId === projectId && a.period === period);
}
