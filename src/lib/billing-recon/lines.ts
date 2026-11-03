/**
 * Reading and matching Billing Recon's line items — BOQ rows, JMC / MVAC entry lines and RA bill
 * lines — so the RA bill screens and the reconciliation agree with the BOQ view
 * (`billing-recon/[project]/boq/view/page.tsx`) on which lines belong to which BOQ item.
 *
 * ## How a line finds its BOQ item
 *
 * By the composite key `scope 1 / scope 2 / BOQ SL No`, exactly as the BOQ view builds it:
 *  - the scopes are read from whichever key spells "scope 1" / "scope 2" once case, spaces and
 *    dots are ignored (`Scope 1` on a BOQ row, `scope1` on a JMC line, `SCOPE.1` on an import),
 *    trimmed and lower-cased — and here also with inner runs of spaces collapsed, so
 *    "Civil  Works" and "Civil Works" are the same scope;
 *  - the SL No is `BOQ SL No` (any case or spacing, which also covers a line's `boqSlNo`), else
 *    `SL. No.`, trimmed — its case is kept, as the BOQ view keeps it.
 *
 * A line whose key matches no BOQ item is reported as unmatched by the reconciliation rather than
 * dropped, so a typo in a JMC never silently disappears from the totals.
 *
 * Pure (no Firebase, no React) — tests/billing-recon-ra-bill.test.mjs and
 * tests/billing-recon-reconciliation.test.mjs load it with `node --experimental-strip-types`.
 */

/** Quantities closer than this are equal: absorbs float noise such as 0.1 + 0.2. */
export const QTY_TOLERANCE = 1e-6;

/** A number from a stored value: numbers as they are, "1,234.5" as 1234.5, anything else 0. */
export function toNumber(value: unknown): number {
  const parsed = parseNumber(value);
  return parsed === null ? 0 : parsed;
}

/** Like `toNumber`, but `null` when there is no number there at all (blank, text, missing). */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').replace(/\s+/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * A quantity typed into a form: '' is 0, "1,250.5" is 1250.5, and anything that is not a plain
 * decimal number ("12a", "1.2.3", "1e3") is NaN so the form can say so.
 */
export function parseQtyInput(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (value === null || value === undefined) return 0;
  const text = String(value).replace(/,/g, '').trim();
  if (!text) return 0;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return NaN;
  return Number(text);
}

/** Rounds half away from zero to `dp` places, without 1.005 → 1.00 float surprises. */
export function roundTo(value: number, dp: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * factor)) / factor;
}

/** Money to paise. */
export const round2 = (value: number): number => roundTo(value, 2);

/** Quantities to six places: removes float noise, keeps every real decimal. */
export const roundQty = (value: number): number => roundTo(value, 6);

/** `Scope 1`, `scope1`, `SCOPE.1` → "scope1". */
const scopeKeyOf = (key: string) => key.toLowerCase().replace(/\s+|\./g, '');

/** `BOQ SL No`, `boqSlNo`, `boq sl no` → "boqslno"; `SL. No.` → "sl.no.". */
const slKeyOf = (key: string) => key.toLowerCase().replace(/\s+/g, '');

/** Field names compared with everything but letters and digits removed: `Unit Rate` → "unitrate". */
const looseKeyOf = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const textOf = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

/** The first non-blank value among the keys `normalise` maps to `target`, in key order. */
function readByKey(record: Record<string, unknown>, target: string, normalise: (key: string) => string): string {
  for (const key of Object.keys(record)) {
    if (normalise(key) !== target) continue;
    const text = textOf(record[key]);
    if (text) return text;
  }
  return '';
}

/** Scope 1 or 2 of any line or BOQ row, trimmed ('' when absent). */
export function readScope(line: unknown, which: 1 | 2): string {
  const record = asRecord(line);
  if (!record) return '';
  return readByKey(record, `scope${which}`, scopeKeyOf);
}

/** The BOQ SL No of any line or BOQ row, trimmed ('' when absent). */
export function readBoqSlNo(line: unknown): string {
  const record = asRecord(line);
  if (!record) return '';
  return readByKey(record, 'boqslno', slKeyOf) || readByKey(record, 'sl.no.', slKeyOf);
}

/** A scope as the key compares it: trimmed, lower-case, inner spaces collapsed. */
export const normaliseScope = (scope: unknown): string =>
  String(scope ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/** The BOQ view's key: `${scope1}__${scope2}__${slNo}` with the scopes normalised. */
export function compositeKey(scope1: unknown, scope2: unknown, slNo: unknown): string {
  return `${normaliseScope(scope1)}__${normaliseScope(scope2)}__${String(slNo ?? '').trim()}`;
}

/** The composite key of any line or BOQ row. */
export function lineKey(line: unknown): string {
  return compositeKey(readScope(line, 1), readScope(line, 2), readBoqSlNo(line));
}

/** The first value among loosely-matched field names, in the order the names are given. */
export function readField(line: unknown, names: readonly string[]): unknown {
  const record = asRecord(line);
  if (!record) return undefined;
  const keys = Object.keys(record);
  for (const name of names) {
    const target = looseKeyOf(name);
    for (const key of keys) {
      if (looseKeyOf(key) !== target) continue;
      const value = record[key];
      if (value === null || value === undefined || value === '') continue;
      return value;
    }
  }
  return undefined;
}

/** A text field among loosely-matched names ('' when absent). */
export const readText = (line: unknown, names: readonly string[]): string => textOf(readField(line, names));

/** A numeric field among loosely-matched names (0 when absent or not a number). */
export const readNumber = (line: unknown, names: readonly string[]): number => toNumber(readField(line, names));

/** What a JMC / MVAC line carries, read tolerantly. */
export interface EntryLineFields {
  boqSlNo: string;
  scope1: string;
  scope2: string;
  description: string;
  unit: string;
  rate: number;
  executedQty: number;
  certifiedQty: number;
}

export function readEntryLine(line: unknown): EntryLineFields {
  return {
    boqSlNo: readBoqSlNo(line),
    scope1: readScope(line, 1),
    scope2: readScope(line, 2),
    description: readText(line, ['description', 'Item Spec']),
    unit: readText(line, ['unit']),
    rate: readNumber(line, ['rate', 'Unit Rate']),
    executedQty: readNumber(line, ['executedQty']),
    certifiedQty: readNumber(line, ['certifiedQty']),
  };
}

/** The BOQ row fields Billing Recon reconciles against. */
export interface BoqRowFields {
  boqSlNo: string;
  erpSlNo: string;
  scope1: string;
  scope2: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  /** The row's own `Total Amount` when it has one, else qty × rate. */
  amount: number;
}

const BOQ_QTY_NAMES = ['QTY', 'Total Qty', 'Quantity', 'BOQ Qty'];
const BOQ_RATE_NAMES = ['Unit Rate', 'Rate'];
const BOQ_AMOUNT_NAMES = ['Total Amount', 'Amount'];

export function readBoqRow(row: unknown): BoqRowFields {
  const qty = readNumber(row, BOQ_QTY_NAMES);
  const explicitAmount = parseNumber(readField(row, BOQ_AMOUNT_NAMES));
  let rate = readNumber(row, BOQ_RATE_NAMES);
  if (!rate && explicitAmount !== null && qty) rate = explicitAmount / qty;
  const computed = qty * rate;
  // A stored 0 beside a real qty × rate is an import that left the column blank, not a free item.
  const amount = explicitAmount !== null && (explicitAmount !== 0 || computed === 0) ? explicitAmount : computed;
  return {
    boqSlNo: readBoqSlNo(row),
    erpSlNo: readText(row, ['ERP SL NO']),
    scope1: readScope(row, 1),
    scope2: readScope(row, 2),
    description: readText(row, ['Description', 'Item Spec', 'Description of Items']),
    unit: readText(row, ['Unit', 'UOM']),
    qty,
    rate,
    amount: round2(amount),
  };
}

/** True for a JMC / MVAC entry that no longer counts: rejected or cancelled. */
export function entryIsVoid(status: unknown): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'rejected' || s === 'cancelled' || s === 'canceled';
}

/** A stored date (yyyy-mm-dd text, ISO text, Firestore Timestamp, Date) as yyyy-mm-dd, or ''. */
export function toIsoDate(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (match) return match[1];
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : localIsoDate(parsed);
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : localIsoDate(value);
  const record = asRecord(value);
  if (record && typeof record.toDate === 'function') {
    const date = (record.toDate as () => Date)();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? localIsoDate(date) : '';
  }
  if (record && typeof record.seconds === 'number') return localIsoDate(new Date(record.seconds * 1000));
  return '';
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A Date as yyyy-mm-dd in local time (today's date for a bill, not UTC's). */
export function localIsoDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** True for a real calendar date written yyyy-mm-dd. */
export function isIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** yyyy-mm-dd → "03 Nov 2026"; anything else as it was, '' as the fallback. */
export function formatIsoDate(value: unknown, fallback = '—'): string {
  const iso = toIsoDate(value);
  if (!iso) return typeof value === 'string' && value.trim() ? value : fallback;
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

const QTY_FORMAT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const AMOUNT_FORMAT = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A quantity for display: Indian grouping, up to three decimals. */
export function formatQty(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  // −0.0004 would print as "-0".
  return QTY_FORMAT.format(Math.abs(n) < 0.0005 ? 0 : n);
}

/** An amount for display: "₹1,23,456.70". */
export function formatAmount(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  const text = AMOUNT_FORMAT.format(Math.abs(n));
  return `${n < -0.004 ? '-' : ''}₹${text}`;
}

const trimFixed = (value: number) => value.toFixed(2).replace(/\.?0+$/, '');

/** For tiles: "₹12.43 Cr", "₹76.25 L", "₹85,430". The full figure belongs in a title or hint. */
export function formatAmountCompact(value: number): string {
  const n = Number.isFinite(value) ? round2(value) : 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${trimFixed(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trimFixed(abs / 1e5)} L`;
  return `${sign}₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(abs))}`;
}

/** "RA-2" before "RA-10": text compared with numbers read as numbers, ignoring case. */
export function compareNatural(a: unknown, b: unknown): number {
  return String(a ?? '').localeCompare(String(b ?? ''), 'en', { numeric: true, sensitivity: 'base' });
}
