/**
 * Payment vouchers — how Bank Balance pays out, the way treasury desks do it.
 *
 * A voucher is ONE instrument drawn on ONE bank account: a cheque, an e-cheque, an RTGS/NEFT
 * batch, a demand draft. It carries any number of payee lines, each usually settling (all or part
 * of) a Daily Requisition. Saving a voucher writes, in one transaction:
 *
 *   bankPayments/{id}          the voucher itself (mode, instrument no./date, lines, status)
 *   bankExpenses/{…}           one Debit per line, dated on the INSTRUMENT date — so a post-dated
 *                              cheque touches the balance only from the date written on it
 *   dailyRequisitions/{…}      paidAmount += line amount, a `payments[]` entry, and status
 *                              'Partially Paid' or 'Paid'
 *
 * Cancelling or recording a bounce reverses all three. Clearing only stamps the voucher.
 *
 * Pure — no Firebase or React — so it runs under plain node for tests.
 */

export type PaymentModeKind = 'cheque' | 'transfer' | 'draft';

export interface PaymentModeConfig {
  mode: string;
  kind: PaymentModeKind;
  /** What the instrument number is called on this mode. */
  instrumentLabel: string;
  /** Cheques carry a number that must be entered; transfers may use a batch reference. */
  instrumentRequired: boolean;
  /** Only cheques can be dated ahead (post-dated). */
  allowsFutureDate: boolean;
  /** Transfers get a UTR per beneficiary line. */
  utrPerLine: boolean;
}

export const STANDARD_MODES: PaymentModeConfig[] = [
  { mode: 'Cheque', kind: 'cheque', instrumentLabel: 'Cheque No.', instrumentRequired: true, allowsFutureDate: true, utrPerLine: false },
  { mode: 'e-Cheque', kind: 'cheque', instrumentLabel: 'e-Cheque No.', instrumentRequired: true, allowsFutureDate: true, utrPerLine: false },
  { mode: 'RTGS', kind: 'transfer', instrumentLabel: 'Batch / Reference No.', instrumentRequired: false, allowsFutureDate: false, utrPerLine: true },
  { mode: 'NEFT', kind: 'transfer', instrumentLabel: 'Batch / Reference No.', instrumentRequired: false, allowsFutureDate: false, utrPerLine: true },
  { mode: 'IMPS', kind: 'transfer', instrumentLabel: 'Reference No.', instrumentRequired: false, allowsFutureDate: false, utrPerLine: true },
  { mode: 'Fund Transfer', kind: 'transfer', instrumentLabel: 'Reference No.', instrumentRequired: false, allowsFutureDate: false, utrPerLine: true },
  { mode: 'Demand Draft', kind: 'draft', instrumentLabel: 'DD No.', instrumentRequired: true, allowsFutureDate: false, utrPerLine: false },
];

/**
 * The modes offered: the standard ones, plus any method configured under Payment Entry Settings
 * that is not one of them (treated as a transfer with a reference per line).
 */
export function paymentModes(customNames: string[] = []): PaymentModeConfig[] {
  const known = new Set(STANDARD_MODES.map((m) => m.mode.toLowerCase()));
  const extra = customNames
    .map((name) => name.trim())
    .filter((name, index, all) => name && !known.has(name.toLowerCase()) && all.findIndex((n) => n.toLowerCase() === name.toLowerCase()) === index)
    .map<PaymentModeConfig>((mode) => ({ mode, kind: 'transfer', instrumentLabel: 'Reference No.', instrumentRequired: false, allowsFutureDate: false, utrPerLine: true }));
  return [...STANDARD_MODES, ...extra];
}

export const modeConfig = (mode: string, modes: PaymentModeConfig[] = STANDARD_MODES): PaymentModeConfig =>
  modes.find((m) => m.mode === mode) ?? { mode, kind: 'transfer', instrumentLabel: 'Reference No.', instrumentRequired: false, allowsFutureDate: false, utrPerLine: true };

export type VoucherStatus = 'Issued' | 'Cleared' | 'Cancelled' | 'Bounced';
/** What the register shows: an issued cheque dated after today reads as post-dated. */
export type VoucherDisplayStatus = VoucherStatus | 'Post-dated';

export interface VoucherLine {
  lineId: string;
  /** The Daily Requisition this line settles, if any. */
  requisitionId?: string;
  receptionNo?: string;
  partyName: string;
  projectId?: string;
  projectName?: string;
  description: string;
  amount: number;
  utrNumber?: string;
  approvalCopyUrl?: string;
  /** The bankExpenses document written for this line. */
  expenseId: string;
}

export interface BankPaymentVoucher {
  id: string;
  voucherNo: string;
  mode: string;
  accountId: string;
  instrumentNo: string;
  /** yyyy-MM-dd — the date on the cheque / of the transfer; the balance moves on this day. */
  instrumentDate: string;
  /** yyyy-MM-dd — the day the voucher was entered. */
  issueDate: string;
  lines: VoucherLine[];
  total: number;
  status: VoucherStatus;
  transferCopyUrl?: string;
  remarks?: string;
  createdById?: string;
  createdByName?: string;
  clearedDate?: string;
  closedReason?: string;
  closedAt?: string;
}

export function displayStatus(voucher: Pick<BankPaymentVoucher, 'status' | 'instrumentDate'>, todayKey: string): VoucherDisplayStatus {
  if (voucher.status === 'Issued' && voucher.instrumentDate > todayKey) return 'Post-dated';
  return voucher.status;
}

/** Indian financial year of a yyyy-MM-dd date, e.g. 2026-09-29 → "2026-27". */
export function financialYear(dayKey: string): string {
  const [y, m] = dayKey.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The next voucher number from the stored counter, restarting at 1 each financial year. */
export function nextVoucherNo(counter: { fy?: string; next?: number } | undefined, dayKey: string): { voucherNo: string; counter: { fy: string; next: number } } {
  const fy = financialYear(dayKey);
  const n = counter?.fy === fy && counter.next && counter.next > 0 ? counter.next : 1;
  return { voucherNo: `BP/${fy}/${String(n).padStart(4, '0')}`, counter: { fy, next: n + 1 } };
}

export type RequisitionPayStatus = 'Received for Payment' | 'Partially Paid' | 'Paid';

export interface RequisitionPaymentRef {
  bankPaymentId: string;
  voucherNo: string;
  lineId: string;
  amount: number;
  mode: string;
  instrumentNo: string;
  instrumentDate: string;
  accountId: string;
}

export interface PayableRequisition {
  netAmount: number;
  paidAmount?: number;
  payments?: RequisitionPaymentRef[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const requisitionBalance = (req: PayableRequisition) => round2(Math.max(0, (Number(req.netAmount) || 0) - (Number(req.paidAmount) || 0)));

/** Status for a paid total: nothing paid, part paid, or settled (a paisa of rounding tolerated). */
export function statusForPaid(netAmount: number, paidAmount: number): RequisitionPayStatus {
  if (paidAmount <= 0.004) return 'Received for Payment';
  return paidAmount + 0.01 >= netAmount ? 'Paid' : 'Partially Paid';
}

/** The requisition fields after paying `ref.amount` of it. Throws if that exceeds the balance. */
export function applyPayment(req: PayableRequisition, ref: RequisitionPaymentRef) {
  const balance = requisitionBalance(req);
  if (ref.amount <= 0) throw new Error('Payment amount must be above zero.');
  if (ref.amount > balance + 0.01) throw new Error(`Only ${balance.toFixed(2)} is still due on this requisition.`);
  const paidAmount = round2((Number(req.paidAmount) || 0) + ref.amount);
  return {
    paidAmount,
    payments: [...(req.payments ?? []), ref],
    status: statusForPaid(Number(req.netAmount) || 0, paidAmount),
  };
}

/** The requisition fields after a voucher's line is cancelled or bounced. */
export function reversePayment(req: PayableRequisition, bankPaymentId: string, lineId: string) {
  const payments = req.payments ?? [];
  const removed = payments.filter((p) => p.bankPaymentId === bankPaymentId && p.lineId === lineId);
  const kept = payments.filter((p) => !(p.bankPaymentId === bankPaymentId && p.lineId === lineId));
  const paidAmount = round2(Math.max(0, (Number(req.paidAmount) || 0) - removed.reduce((sum, p) => sum + p.amount, 0)));
  return { paidAmount, payments: kept, status: statusForPaid(Number(req.netAmount) || 0, paidAmount) };
}
