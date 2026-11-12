/**
 * Bank charges (Bank Balance › Bank Charges): what the bank debits on its own — RTGS/NEFT/IMPS
 * charges, cheque books, returns, SMS alerts, maintenance and processing fees — with the GST it adds
 * and any other levy.
 *
 * A charge is a payment out of the account: one `bankExpenses` Debit (not a transfer leg) whose
 * amount is the whole debit, charge + GST + other. So it lowers the balance like any payment, is
 * listed in Payments (grouped under the method "Bank Charges"), and is checked by Date Control and
 * Month Closure as a payment. The breakdown rides on the same document for the accounts team.
 *
 * Importless, so `node --test` loads it directly.
 */

/** The `paymentMethod` every bank charge carries — the group it lands in on the Payments page. */
export const BANK_CHARGES_METHOD = 'Bank Charges';

export const CHARGE_TYPES = [
  'RTGS',
  'NEFT',
  'IMPS',
  'Cheque book',
  'Cheque return',
  'DD / Pay order',
  'SMS alerts',
  'Account maintenance',
  'Processing fee',
  'Other',
] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

/** GST on bank services is 18%; the others are there for the odd exempt or differently taxed item. */
export const GST_RATES = [18, 12, 5, 0] as const;
export const DEFAULT_GST_RATE = 18;

/** CGST + SGST when the bank's branch is in the same state as the registration billed, IGST otherwise. */
export const GST_SPLITS = ['CGST + SGST', 'IGST'] as const;
export type GstSplit = (typeof GST_SPLITS)[number];

export const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

/** GST on a charge at a rate, rounded to the paisa as banks print it. */
export const gstOn = (charge: number, rate: number) => round2(((Number(charge) || 0) * (Number(rate) || 0)) / 100);

/** The two halves of an intra-state GST; any odd paisa goes to SGST, so they always add up. */
export function splitGst(gst: number, split: GstSplit): { cgst: number; sgst: number; igst: number } {
  const total = round2(gst);
  if (split === 'IGST') return { cgst: 0, sgst: 0, igst: total };
  const cgst = round2(Math.floor(total * 50) / 100);
  return { cgst, sgst: round2(total - cgst), igst: 0 };
}

/** What the bank debits in all. */
export const chargeTotal = (charge: number, gst: number, other: number) => round2((Number(charge) || 0) + (Number(gst) || 0) + (Number(other) || 0));

/** "RTGS charges", "Cheque book charges", a typed name for Other ("Locker rent"). */
export function chargeName(type: string, otherName = ''): string {
  if (type === 'Other') return otherName.trim() || 'Bank charges';
  return /charges?$|fee$/i.test(type) ? type : `${type} charges`;
}

const money = (value: number) => `₹${round2(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The Debit's description, as statements and reports show it:
 * "RTGS charges ₹25.00 + GST 18% ₹4.50 + Stamp duty ₹1.00 — UTR SBIN2611…".
 */
export function chargeDescription(input: {
  type: string;
  otherName?: string;
  charge: number;
  gst: number;
  gstRate: number;
  other?: number;
  otherLabel?: string;
  note?: string;
}): string {
  const parts = [`${chargeName(input.type, input.otherName)} ${money(input.charge)}`];
  if (round2(input.gst) > 0) parts.push(`GST ${input.gstRate}% ${money(input.gst)}`);
  if (round2(input.other ?? 0) > 0) parts.push(`${(input.otherLabel || '').trim() || 'Other'} ${money(input.other ?? 0)}`);
  const note = (input.note || '').trim();
  return `${parts.join(' + ')}${note ? ` — ${note}` : ''}`;
}

/** The fields a saved charge carries besides the Debit itself (amount, date, account, description). */
export interface ChargeFields {
  chargeType?: string;
  chargeAmount?: number;
  gstRate?: number;
  gstAmount?: number;
  gstSplit?: string;
  otherChargeAmount?: number;
  otherChargeLabel?: string;
}

/**
 * The last charge of this type on this account, newest first in `history` — to suggest the amount
 * and GST again (an RTGS charge is the same ₹25 + GST every time).
 */
export function lastChargeLike<T extends ChargeFields & { accountId: string; entryKind?: string; at: Date }>(
  history: T[],
  accountId: string,
  type: string,
): T | undefined {
  const same = (item: T) => item.entryKind === 'bankCharge' && item.chargeType === type;
  return history.find((item) => same(item) && item.accountId === accountId) ?? history.find(same);
}
