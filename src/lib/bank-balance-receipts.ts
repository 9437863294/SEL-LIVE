/**
 * Receipts (Bank Balance › Receipts and New Receipt): a receipt's type, payer and mode, how they
 * are written on its `bankExpenses` Credit, and the list's period arithmetic.
 *
 * Client-bill money belongs to Bill Tracking. Its receipts allocate a payment across bills, are
 * verified there, and post their own Credit here (carrying `billCollectionId`). A Bank Balance
 * receipt never marks a bill collected: New Receipt shows a client's open bills and sends the user
 * to Bill Tracking to record the payment, so the same money is never booked twice.
 *
 * Importless, so `node --test` loads it directly.
 */

export const RECEIPT_TYPES = ['Client bill', 'Retention', 'Security deposit', 'Advance', 'Refund', 'Interest', 'Other'] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];

export const RECEIPT_MODES = ['RTGS', 'NEFT', 'IMPS', 'Cheque', 'DD', 'Internal'] as const;
export type ReceiptMode = (typeof RECEIPT_MODES)[number];

/** Money that settles a client's bill — which Bill Tracking records, allocates and posts. */
export const billTracked = (type: string | undefined) => type === 'Client bill' || type === 'Retention';

/** A cheque or DD carries its number in `paymentRefNo`; anything else its UTR in `utrNumber`. */
export const isInstrumentMode = (mode: string | undefined) => mode === 'Cheque' || mode === 'DD';

/** The reference field's wording for a mode. */
export const refLabelFor = (mode: string | undefined) => (mode === 'Cheque' ? 'Cheque no.' : mode === 'DD' ? 'DD no.' : 'UTR / Ref no.');

/**
 * The Credit's description, as every statement and report shows it: "OPTCL — RA bill 14", unless the
 * description already names the payer. Either part may be empty.
 */
export function receiptDescription(payer: string, description: string): string {
  const who = payer.trim();
  const what = description.trim();
  if (!who) return what;
  if (!what) return who;
  return what.toLowerCase().includes(who.toLowerCase()) ? what : `${who} — ${what}`;
}

/**
 * Who paid. New Receipt records it; a Credit posted by Bill Tracking names its client in the
 * description it builds ("Receipt from <client> · <bills>", bank-posting.ts). Older receipts have
 * neither, and say so with an empty string.
 */
export function payerOf(entry: { payerName?: string; billCollectionId?: string; description?: string }): string {
  const named = (entry.payerName || '').trim();
  if (named) return named;
  if (entry.billCollectionId) {
    const match = /^Receipt from (.+?)(?: · |$)/.exec((entry.description || '').trim());
    if (match) return match[1].trim();
  }
  return '';
}

/** A UTR or cheque number compared as the bank prints it: no spaces, one case. */
export const normRef = (value: string | undefined) => (value || '').replace(/\s+/g, '').toUpperCase();

/** References typed on more than one row of the same batch. */
export function duplicateRefs(rows: Array<{ ref: string }>): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const row of rows) {
    const key = normRef(row.ref);
    if (!key) continue;
    if (seen.has(key)) twice.add(key);
    seen.add(key);
  }
  return twice;
}

/** Two-letter initials for a payer's tile: "Odisha Power Transmission" → "OP", "OPTCL" → "OP". */
export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** The same small number for the same name, to pick its tile colour from a palette. */
export function nameHash(name: string, buckets: number): number {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return buckets > 0 ? hash % buckets : 0;
}

// ── The list's periods ───────────────────────────────────────────────────────────────────────

export type ReceiptPeriod = 'today' | 'week' | 'month' | 'fy' | 'all' | 'custom';

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number) => {
  const at = new Date(Date.UTC(y, m - 1, d));
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
};
const partsOf = (key: string) => key.split('-').map(Number) as [number, number, number];

/** The financial year (April to March) a day falls in: "2026-27". */
export function fyOf(dayKey: string): string {
  const [y, m] = partsOf(dayKey);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${pad((start + 1) % 100)}`;
}

/**
 * A period's first and last day (inclusive, `yyyy-MM-dd`), from today. A week starts on Monday; a
 * period runs to its end, so a receipt dated later in it (Date Control may allow a few days ahead)
 * is in it. `all` is unbounded; `custom` takes the two days given, either of which may be open.
 */
export function periodRange(period: ReceiptPeriod, todayKey: string, custom: { from?: string; to?: string } = {}): { from: string | null; to: string | null } {
  const [y, m, d] = partsOf(todayKey);
  switch (period) {
    case 'today':
      return { from: todayKey, to: todayKey };
    case 'week': {
      const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
      const back = (weekday + 6) % 7;
      return { from: keyOf(y, m, d - back), to: keyOf(y, m, d - back + 6) };
    }
    case 'month':
      return { from: keyOf(y, m, 1), to: keyOf(y, m + 1, 0) };
    case 'fy': {
      const start = m >= 4 ? y : y - 1;
      return { from: keyOf(start, 4, 1), to: keyOf(start + 1, 3, 31) };
    }
    case 'custom': {
      const from = custom.from || null;
      const to = custom.to || null;
      return from && to && from > to ? { from: to, to: from } : { from, to };
    }
    default:
      return { from: null, to: null };
  }
}

/** Whether a day is inside a range from `periodRange`. */
export const inRange = (dayKey: string, range: { from: string | null; to: string | null }) =>
  (!range.from || dayKey >= range.from) && (!range.to || dayKey <= range.to);
