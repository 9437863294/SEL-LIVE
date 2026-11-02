/**
 * The arithmetic behind New Internal Transfer: what kind of transfer a row is, what a batch does to
 * each account, the amount in words, and the per-mode limits worth warning about.
 *
 * Importless, so `node --test` loads it directly (tests/bank-balance-transfer.test.mjs).
 */

export type AccountKind = 'Cash Credit' | 'Current Account';

export type TransferKind = 'draw' | 'repay' | 'cc' | 'move';

export const TRANSFER_KIND_LABEL: Record<TransferKind, string> = {
  draw: 'Drawing from cash credit',
  repay: 'Repaying cash credit',
  cc: 'Cash credit to cash credit',
  move: 'Between current accounts',
};

/** What a transfer from one kind of account to another amounts to. */
export function transferKind(from: AccountKind | undefined, to: AccountKind | undefined): TransferKind | null {
  if (!from || !to) return null;
  if (from === 'Cash Credit') return to === 'Cash Credit' ? 'cc' : 'draw';
  return to === 'Cash Credit' ? 'repay' : 'move';
}

export interface TransferRowFigures {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
}

/**
 * Each account's net movement across the batch: money in positive, money out negative. Rows
 * without two different accounts or an amount move nothing.
 */
export function batchEffects(rows: TransferRowFigures[]): Map<string, number> {
  const effects = new Map<string, number>();
  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    if (!(amount > 0) || !row.fromAccountId || !row.toAccountId || row.fromAccountId === row.toAccountId) continue;
    effects.set(row.fromAccountId, (effects.get(row.fromAccountId) ?? 0) - amount);
    effects.set(row.toAccountId, (effects.get(row.toAccountId) ?? 0) + amount);
  }
  return effects;
}

/** What a typed amount reads as: digits and one decimal point, commas and spaces ignored. */
export function parseAmountInput(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
}

export const TRANSFER_MODES = ['Internal', 'NEFT', 'RTGS', 'IMPS', 'Cheque'] as const;
export type TransferMode = (typeof TRANSFER_MODES)[number];

export const IMPS_LIMIT = 500000;
export const RTGS_MINIMUM = 200000;

/** The payment-system limits a mode carries, as a warning — the bank refuses, not this form. */
export function modeWarning(mode: string, amount: number): string | null {
  if (mode === 'IMPS' && amount > IMPS_LIMIT) return 'IMPS is capped at ₹5 lakh per transfer — use NEFT or RTGS for this amount.';
  if (mode === 'RTGS' && amount > 0 && amount < RTGS_MINIMUM) return 'RTGS is for ₹2 lakh and above — use NEFT or IMPS for a smaller amount.';
  return null;
}

// ── Amount in words, the Indian way (lakh, crore) ───────────────────────────────────────────

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const twoDigits = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`);
const threeDigits = (n: number) => [Math.floor(n / 100) ? `${ONES[Math.floor(n / 100)]} hundred` : '', n % 100 ? twoDigits(n % 100) : ''].filter(Boolean).join(' ');

function integerWords(value: number): string {
  let n = Math.floor(value);
  if (n === 0) return '';
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  return [
    crore ? `${crore >= 1000 ? integerWords(crore) : threeDigits(crore)} crore` : '',
    lakh ? `${twoDigits(lakh)} lakh` : '',
    thousand ? `${twoDigits(thousand)} thousand` : '',
    n ? threeDigits(n) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** "One lakh twenty-five thousand rupees only"; '' for nothing. */
export function rupeesInWords(value: number): string {
  const amount = Math.abs(Number(value) || 0);
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  if (!rupees && !paise) return '';
  const parts = [
    rupees ? `${integerWords(rupees)} ${rupees === 1 ? 'rupee' : 'rupees'}` : '',
    paise ? `${twoDigits(paise)} paise` : '',
  ].filter(Boolean);
  const text = `${parts.join(' and ')} only`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
