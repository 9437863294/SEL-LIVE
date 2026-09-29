/**
 * Where a payment request stands across the three modules that handle it:
 *
 *   Expenses (expenseRequests, requestNo)                   — the request is raised
 *     → Daily Requisition (dailyRequisitions, depNo = requestNo) — received, verified, sent for payment
 *       → Bank Balance (bankPayments vouchers)              — paid, in full or in part
 *
 * One reading of a requisition, used by all three so they never disagree: its stage, what has
 * been paid, what is still due, whether payments now lock it, and the links between the modules.
 *
 * Pure (type-only imports) so it runs under plain node for tests.
 */

import type { RequisitionPaymentRef } from './bank-payments';

/** The six status-badge tones of src/lib/status-tone.ts. */
export type ProgressTone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';

export interface ProgressRequisition {
  id?: string;
  receptionNo?: string;
  depNo?: string;
  status?: string;
  netAmount?: number;
  paidAmount?: number;
  payments?: RequisitionPaymentRef[];
  manualPaid?: boolean;
  createdAt?: unknown;
}

export type ProgressStage =
  | 'not-received'
  | 'pending'
  | 'received'
  | 'needs-review'
  | 'verified'
  | 'awaiting-payment'
  | 'part-paid'
  | 'paid'
  | 'cancelled';

export interface RequisitionProgress {
  stage: ProgressStage;
  /** Short label for a badge. */
  label: string;
  tone: ProgressTone;
  net: number;
  paid: number;
  balance: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What has been paid on a requisition. Vouchers record `paidAmount`; a requisition marked Paid
 * without one (by hand, or imported as Paid) counts as paid in full.
 */
export function paidOf(req: Pick<ProgressRequisition, 'status' | 'netAmount' | 'paidAmount'>): number {
  const net = Number(req.netAmount) || 0;
  const paid = Number(req.paidAmount) || 0;
  if (req.status === 'Paid') return round2(Math.max(paid, net));
  return round2(paid);
}

/** What is still due. A cancelled requisition owes nothing. */
export function balanceOf(req: Pick<ProgressRequisition, 'status' | 'netAmount' | 'paidAmount'>): number {
  if (req.status === 'Cancelled') return 0;
  return round2(Math.max(0, (Number(req.netAmount) || 0) - paidOf(req)));
}

/**
 * Once any money has gone out against a requisition, its amounts, party and stage belong to the
 * payment record: it must not be edited, sent back, cancelled or deleted from Daily Requisition
 * (reverse the voucher from the Cheque Register first).
 */
export function isPaymentLocked(req: Pick<ProgressRequisition, 'status' | 'paidAmount' | 'payments'>): boolean {
  return (req.payments?.length ?? 0) > 0 || (Number(req.paidAmount) || 0) > 0 || req.status === 'Partially Paid' || req.status === 'Paid';
}

const STAGES: Record<string, { stage: ProgressStage; label: string; tone: ProgressTone }> = {
  Pending: { stage: 'pending', label: 'At finance', tone: 'neutral' },
  Received: { stage: 'received', label: 'Received', tone: 'info' },
  'Needs Review': { stage: 'needs-review', label: 'Needs review', tone: 'warning' },
  Verified: { stage: 'verified', label: 'Verified', tone: 'info' },
  'Received for Payment': { stage: 'awaiting-payment', label: 'Awaiting payment', tone: 'progress' },
  'Partially Paid': { stage: 'part-paid', label: 'Part paid', tone: 'warning' },
  Paid: { stage: 'paid', label: 'Paid', tone: 'success' },
  Cancelled: { stage: 'cancelled', label: 'Cancelled', tone: 'danger' },
};

/** The stage of a requisition — or of an expense request that has none yet (`undefined`). */
export function requisitionProgress(req: ProgressRequisition | undefined): RequisitionProgress {
  if (!req) return { stage: 'not-received', label: 'Not received', tone: 'neutral', net: 0, paid: 0, balance: 0 };
  const known = STAGES[req.status ?? ''] ?? { stage: 'pending' as const, label: req.status || 'Pending', tone: 'neutral' as const };
  return { ...known, net: round2(Number(req.netAmount) || 0), paid: paidOf(req), balance: balanceOf(req) };
}

const createdMillis = (value: unknown): number => {
  if (!value) return 0;
  if (typeof value === 'string') return Date.parse(value) || 0;
  if (value instanceof Date) return value.getTime();
  const maybe = value as { toMillis?: () => number; seconds?: number };
  if (typeof maybe.toMillis === 'function') return maybe.toMillis();
  if (typeof maybe.seconds === 'number') return maybe.seconds * 1000;
  return 0;
};

/**
 * The requisition each expense request (by requestNo = depNo) turned into. When one request was
 * received more than once, the live one wins over a cancelled one, then the newest.
 */
export function requisitionsByRequestNo<T extends ProgressRequisition>(requisitions: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const req of requisitions) {
    const key = (req.depNo || '').trim();
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, req);
      continue;
    }
    const liveNew = req.status !== 'Cancelled';
    const liveOld = existing.status !== 'Cancelled';
    if (liveNew !== liveOld ? liveNew : createdMillis(req.createdAt) > createdMillis(existing.createdAt)) map.set(key, req);
  }
  return map;
}

/* ── The links between the modules. One definition, so every page points at the same place. ── */

/** A requisition in Daily Requisition's entry sheet, filtered to its Reception No. */
export const requisitionHref = (receptionNo: string) => `/daily-requisition/entry-sheet?q=${encodeURIComponent(receptionNo)}`;

/** A payment voucher in the Bank Balance Cheque Register, opened. */
export const voucherHref = (bankPaymentId: string) => `/bank-balance/cheques?voucher=${encodeURIComponent(bankPaymentId)}`;

/** New Payment with these requisitions already on the voucher. */
export const payRequisitionsHref = (requisitionIds: string[]) =>
  requisitionIds.length ? `/bank-balance/expenses/new?requisitions=${requisitionIds.map(encodeURIComponent).join(',')}` : '/bank-balance/expenses/new';
