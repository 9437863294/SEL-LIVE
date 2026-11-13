/**
 * Retention bills.
 *
 * A retention bill claims back retention the client already deducted from earlier bills. That
 * retention was billed — and taxed — on those bills, so the retention bill is not a new supply: it
 * carries no taxable value and no GST, and adds nothing to the taxable or GST totals. Its amount is
 * `retentionClaimed`; it is paid that less whatever the client deducts on it (`deriveBillTotals`).
 *
 * The retention it claims stays *held* until money comes in: a receipt on the bill releases its share
 * of the claim (`releasedByReceipt`, written by the receipt), so nothing is counted off twice.
 *
 * A bill that charges new value under a "retention" name — the rest of the contract value with GST —
 * is an invoice: its sub category must not be marked as a retention bill (Settings → Bill categories).
 *
 * The old workbook wrote a retention bill as taxable 0 with a *negative* retention line. That line is
 * the claim: `splitLegacyClaim` reads it out, and the import and the totals script store it as
 * `retentionClaimed` instead — read as a deduction it lowered the retention held, and the receipts on
 * the bill then released the same retention again.
 *
 * Pure: the server, the browser and the test suite use the same rules.
 */

import { roundMoney, sumBy, sumMoney, toPaise } from './money.ts';
import { RETENTION_DEDUCTION_KINDS, type BillCertification, type DeductionKind } from './types.ts';

/** A bill is a retention bill when entered as one or when its sub category is marked as one. */
export const isRetentionBillOf = (transactionType: string | undefined, billType?: { isRetentionBill?: boolean } | null): boolean =>
  transactionType === 'retention_bill' || Boolean(billType?.isRetentionBill);

/** The claim a bill is paid on: the client's certified claim once certified, else the raised one. */
export const effectiveRetentionClaim = (bill: { retentionClaimed?: number | null; certification?: Pick<BillCertification, 'retentionClaimed'> | null }): number =>
  roundMoney((bill.certification ? (bill.certification.retentionClaimed ?? bill.retentionClaimed) : bill.retentionClaimed) ?? 0);

/**
 * The legacy layout read as a claim: retention lines that together come to less than zero are the
 * retention claimed, and the other lines stay. Anything else is left as it is (`claim` 0).
 */
export function splitLegacyClaim<T extends { amount: number }>(lines: readonly T[], isRetention: (line: T) => boolean): { claim: number; lines: T[] } {
  const retention = lines.filter(isRetention);
  const total = sumBy(retention, (line) => line.amount);
  if (!retention.length || toPaise(total) >= 0) return { claim: 0, lines: [...lines] };
  return { claim: roundMoney(-total), lines: lines.filter((line) => !isRetention(line)) };
}

export const isRetentionDeductionKind = (kind: DeductionKind | undefined): boolean => Boolean(kind && RETENTION_DEDUCTION_KINDS.includes(kind));

/**
 * A retention bill's claim, read from what it was saved with: its own claim; else — saved before
 * retention bills had one — the workbook's negative retention line, or a taxable typed for the
 * retention. `lines` are its deductions less any line read as the claim; `from` says which it was.
 * Ask it only of a retention bill (`isRetentionBillOf`).
 */
export function claimOfRetentionBill<T extends { amount: number; kind?: DeductionKind }>(bill: {
  retentionClaimed?: number | null;
  taxableAmount: number;
  deductions?: readonly T[] | null;
}): { claim: number | undefined; lines: T[]; from: 'claim' | 'lines' | 'taxable' | null } {
  const lines = [...(bill.deductions ?? [])];
  if (bill.retentionClaimed !== undefined && bill.retentionClaimed !== null) return { claim: bill.retentionClaimed, lines, from: 'claim' };
  const legacy = splitLegacyClaim(lines, (line) => isRetentionDeductionKind(line.kind));
  if (legacy.claim > 0) return { claim: legacy.claim, lines: legacy.lines, from: 'lines' };
  return toPaise(bill.taxableAmount) > 0 ? { claim: roundMoney(bill.taxableAmount), lines, from: 'taxable' } : { claim: undefined, lines, from: null };
}

/**
 * What a retention bill may not carry, or null. Lines are those it deducts, with their head's name and
 * kind. A certification may certify a nil claim (`allowNil`): the client releases nothing.
 */
export function retentionBillProblem(
  bill: {
    taxableAmount: number;
    gstAmount: number;
    retentionClaimed?: number;
    deductions: readonly { kind?: DeductionKind; name?: string }[];
  },
  options: { allowNil?: boolean } = {},
): string | null {
  if (toPaise(bill.taxableAmount) !== 0 || toPaise(bill.gstAmount) !== 0) {
    return 'A retention bill carries no taxable value or GST: the retention it claims was billed and taxed on the original invoices. Enter the amount as Retention claimed. If this bill charges new value with GST (the rest of the contract value), choose a sub category that is not a retention bill — Settings → Bill categories.';
  }
  const claim = toPaise(bill.retentionClaimed ?? 0);
  if (claim < 0 || (claim === 0 && !options.allowNil)) return 'Enter the retention this bill claims back (Retention claimed), above zero.';
  const retention = bill.deductions.find((line) => isRetentionDeductionKind(line.kind));
  if (retention) return `A retention bill claims retention back — it cannot deduct retention. Remove the ${retention.name ?? 'retention'} line; the amount claimed goes in Retention claimed.`;
  return null;
}

/**
 * The retention a receipt on a retention bill releases: its share of the claim. The bill is paid its
 * claim less what the client deducts on it, so a bill paid in full releases the whole claim. A bill
 * without a claim (or with nothing to pay) releases what was received.
 */
export function releasedByReceipt(bill: { retentionClaimed?: number | null; certification?: Pick<BillCertification, 'retentionClaimed'> | null; netReceivable: number }, amount: number): number {
  const claim = effectiveRetentionClaim(bill);
  if (!(toPaise(claim) > 0) || !(toPaise(bill.netReceivable) > 0) || toPaise(claim) === toPaise(bill.netReceivable)) return roundMoney(amount);
  return roundMoney((amount * claim) / bill.netReceivable);
}

/** Gross plus the claim: what a bill's deductions come off. */
export const claimedGross = (gross: number, claim: number): number => sumMoney([gross, claim]);
