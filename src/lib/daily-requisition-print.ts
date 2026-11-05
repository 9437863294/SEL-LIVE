/**
 * Daily Requisition's print setup (`settings/printing`): how the payment checklist prints —
 * paper and margins, copies, type size, the letterhead's alignment and the document title, which
 * sections appear, the footer and a watermark.
 *
 * Read by the checklist print page (`(public)/daily-requisition/entry-sheet/[id]/print`) and edited
 * on Settings › Printing Setup, which previews the same sheet. A stored document is merged over the
 * defaults rather than trusted wholesale, so a setting added later appears instead of vanishing and
 * the original document (paper, orientation, margins, unit, header text) keeps working.
 *
 * Pure and importless, so `node --experimental-strip-types --test` loads it directly
 * (tests/daily-requisition-print.test.mjs).
 */

export type PaperSize = 'a4' | 'a5' | 'letter' | 'legal';
export type MarginUnit = 'mm' | 'cm' | 'in';
export type FontScale = 'small' | 'normal' | 'large';
export type LetterheadAlign = 'profile' | 'left' | 'center';
export type WatermarkMode = 'none' | 'status' | 'copy';

export interface PrintSections {
  /** Reception No and date, DEP No, project. */
  details: boolean;
  /** Party, gross and net amount. */
  amounts: boolean;
  /** Head and sub-head of account. */
  accounts: boolean;
  description: boolean;
  /** The net amount in words (Indian numbering). */
  amountInWords: boolean;
  /** Who received, verified and paid it, and what happened at Verification steps. */
  trail: boolean;
  signatures: boolean;
}

export interface DRPrintSettings {
  paperSize: PaperSize;
  orientation: 'portrait' | 'landscape';
  /** As typed, in `marginUnit` — strings, as the original document stored them. */
  margins: { top: string; bottom: string; left: string; right: string };
  marginUnit: MarginUnit;
  /** From the original document; kept as stored. The letterhead comes from Company Profile. */
  headerText: string;
  copies: 1 | 2 | 3;
  fontScale: FontScale;
  letterheadAlign: LetterheadAlign;
  documentTitle: string;
  sections: PrintSections;
  /** Captions under the signature lines; empty = the shipped six. */
  signatureLabels: string[];
  footer: { printedBy: boolean; sheetNumbers: boolean; note: string };
  watermark: WatermarkMode;
}

export const PRINT_SETTINGS_DOC = { collection: 'settings', doc: 'printing' } as const;

/** Where Printing Setup leaves the settings it is editing for its test print (this browser's storage). */
export const PRINT_DRAFT_STORAGE_KEY = 'daily-requisition:print-draft';

export const DEFAULT_DOCUMENT_TITLE = 'Check List for Payment';

/** The checklist's signature captions as shipped. */
export const DEFAULT_SIGNATURE_LABELS = ['Prepared by', 'Authorised by', 'Checked by', 'Approved by', 'Verified by', 'A/c Dept'];

export const PAPER_SIZES: Record<PaperSize, { label: string; width: number; height: number; note: string }> = {
  a4: { label: 'A4', width: 210, height: 297, note: '210 × 297 mm' },
  a5: { label: 'A5', width: 148, height: 210, note: '148 × 210 mm' },
  letter: { label: 'Letter', width: 215.9, height: 279.4, note: '8.5 × 11 in' },
  legal: { label: 'Legal', width: 215.9, height: 355.6, note: '8.5 × 14 in' },
};

export const FONT_SCALE: Record<FontScale, number> = { small: 0.9, normal: 1, large: 1.12 };

/** The checklist's margin as it has always printed. */
export const DEFAULT_MARGIN_MM = 14;

/** Closer than this to the edge, most office printers clip. */
export const PRINTER_SAFE_MM = 6;

export function defaultPrintSettings(): DRPrintSettings {
  return {
    paperSize: 'a4',
    orientation: 'portrait',
    margins: { top: '14', bottom: '14', left: '14', right: '14' },
    marginUnit: 'mm',
    headerText: '',
    copies: 1,
    fontScale: 'normal',
    letterheadAlign: 'profile',
    documentTitle: DEFAULT_DOCUMENT_TITLE,
    sections: { details: true, amounts: true, accounts: true, description: true, amountInWords: false, trail: false, signatures: true },
    signatureLabels: [],
    footer: { printedBy: true, sheetNumbers: false, note: '' },
    watermark: 'none',
  };
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
const marginText = (value: unknown, fallback: string) => {
  const n = Number(value);
  return value !== '' && value !== null && value !== undefined && Number.isFinite(n) && n >= 0 ? String(value) : fallback;
};

/** A stored document, merged over the defaults: anything missing or malformed takes the default. */
export function resolvePrintSettings(raw: unknown): DRPrintSettings {
  const d = defaultPrintSettings();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const m = (r.margins && typeof r.margins === 'object' ? r.margins : {}) as Record<string, unknown>;
  const s = (r.sections && typeof r.sections === 'object' ? r.sections : {}) as Record<string, unknown>;
  const f = (r.footer && typeof r.footer === 'object' ? r.footer : {}) as Record<string, unknown>;
  const copies = Number(r.copies);
  const marginUnit = pick(r.marginUnit, ['mm', 'cm', 'in'] as const, d.marginUnit);
  // A missing side takes the default 14 mm, written in the document's own unit.
  const fallback = fromMm(DEFAULT_MARGIN_MM, marginUnit);
  return {
    paperSize: pick(String(r.paperSize ?? '').toLowerCase(), ['a4', 'a5', 'letter', 'legal'] as const, d.paperSize),
    orientation: pick(r.orientation, ['portrait', 'landscape'] as const, d.orientation),
    margins: {
      top: marginText(m.top, fallback),
      bottom: marginText(m.bottom, fallback),
      left: marginText(m.left, fallback),
      right: marginText(m.right, fallback),
    },
    marginUnit,
    headerText: text(r.headerText, d.headerText),
    copies: copies === 2 || copies === 3 ? copies : 1,
    fontScale: pick(r.fontScale, ['small', 'normal', 'large'] as const, d.fontScale),
    letterheadAlign: pick(r.letterheadAlign, ['profile', 'left', 'center'] as const, d.letterheadAlign),
    documentTitle: text(r.documentTitle, d.documentTitle).trim() ? text(r.documentTitle, d.documentTitle) : d.documentTitle,
    sections: {
      details: bool(s.details, d.sections.details),
      amounts: bool(s.amounts, d.sections.amounts),
      accounts: bool(s.accounts, d.sections.accounts),
      description: bool(s.description, d.sections.description),
      amountInWords: bool(s.amountInWords, d.sections.amountInWords),
      trail: bool(s.trail, d.sections.trail),
      signatures: bool(s.signatures, d.sections.signatures),
    },
    signatureLabels: Array.isArray(r.signatureLabels)
      ? r.signatureLabels.filter((label: unknown): label is string => typeof label === 'string' && label.trim() !== '').slice(0, 8)
      : d.signatureLabels,
    footer: {
      printedBy: bool(f.printedBy, d.footer.printedBy),
      sheetNumbers: bool(f.sheetNumbers, d.footer.sheetNumbers),
      note: text(f.note, d.footer.note),
    },
    watermark: pick(r.watermark, ['none', 'status', 'copy'] as const, d.watermark),
  };
}

/* ── measurements ────────────────────────────────────────────────────────── */

const MM_PER: Record<MarginUnit, number> = { mm: 1, cm: 10, in: 25.4 };

export function toMm(value: string | number, unit: MarginUnit): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n * MM_PER[unit] : 0;
}

/** Millimetres in `unit`, rounded for an input. */
export function fromMm(mm: number, unit: MarginUnit): string {
  const v = mm / MM_PER[unit];
  return String(Number(v.toFixed(unit === 'in' ? 2 : 1)));
}

export function marginsMm(s: DRPrintSettings) {
  return {
    top: toMm(s.margins.top, s.marginUnit),
    bottom: toMm(s.margins.bottom, s.marginUnit),
    left: toMm(s.margins.left, s.marginUnit),
    right: toMm(s.margins.right, s.marginUnit),
  };
}

/** The sheet in millimetres, turned for landscape. */
export function pageSizeMm(s: Pick<DRPrintSettings, 'paperSize' | 'orientation'>): { width: number; height: number } {
  const paper = PAPER_SIZES[s.paperSize];
  return s.orientation === 'landscape' ? { width: paper.height, height: paper.width } : { width: paper.width, height: paper.height };
}

/** What is left inside the margins, and its share of the page. */
export function printableArea(s: DRPrintSettings): { width: number; height: number; share: number } {
  const page = pageSizeMm(s);
  const m = marginsMm(s);
  const width = Math.max(0, page.width - m.left - m.right);
  const height = Math.max(0, page.height - m.top - m.bottom);
  return { width, height, share: (width * height) / (page.width * page.height) };
}

const mm = (n: number) => `${Number(n.toFixed(2))}mm`;

/** The `@page` rule the print page uses. */
export function pageCss(s: DRPrintSettings): string {
  const page = pageSizeMm(s);
  const m = marginsMm(s);
  return `@page { size: ${mm(page.width)} ${mm(page.height)}; margin: ${mm(m.top)} ${mm(m.right)} ${mm(m.bottom)} ${mm(m.left)}; }`;
}

/* ── what goes on the sheet ──────────────────────────────────────────────── */

/** "Office copy", "Site copy", "Accounts copy" — only when more than one copy prints. */
export function copyLabel(index: number, copies: number): string | null {
  if (copies <= 1) return null;
  return ['Office copy', 'Site copy', 'Accounts copy'][index] ?? `Copy ${index + 1}`;
}

/**
 * The watermark for a requisition. By status: DRAFT until GST & TDS Verification has verified it,
 * PAID or PART PAID once money has gone out, CANCELLED when cancelled; nothing in between.
 */
export function watermarkFor(mode: WatermarkMode, status: string | undefined): string | null {
  if (mode === 'copy') return 'COPY';
  if (mode !== 'status') return null;
  switch (status || 'Pending') {
    case 'Pending':
    case 'Received':
    case 'Needs Review':
      return 'DRAFT';
    case 'Partially Paid':
      return 'PART PAID';
    case 'Paid':
      return 'PAID';
    case 'Cancelled':
      return 'CANCELLED';
    default:
      return null;
  }
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

/** A whole number in words, Indian style: crore, lakh, thousand. */
function wholeInWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${wholeInWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' ');
}

/** "Rupees Twenty-Seven Thousand Five Hundred and Fifty Paise Only". */
export function amountInWords(amount: number): string {
  const value = Math.round(Math.abs(Number(amount) || 0) * 100);
  const rupees = Math.floor(value / 100);
  const paise = value % 100;
  const words = `Rupees ${wholeInWords(rupees)}${paise ? ` and ${belowHundred(paise)} Paise` : ''} Only`;
  return amount < 0 ? `Minus ${words}` : words;
}

/** One flat row per setting, so the audit log's `changes` names "marginTop" rather than a whole object. */
export function flattenPrintSettings(s: DRPrintSettings | null): Record<string, string | number | boolean> | null {
  if (!s) return null;
  return {
    paperSize: s.paperSize,
    orientation: s.orientation,
    marginTop: s.margins.top,
    marginBottom: s.margins.bottom,
    marginLeft: s.margins.left,
    marginRight: s.margins.right,
    marginUnit: s.marginUnit,
    copies: s.copies,
    fontScale: s.fontScale,
    letterheadAlign: s.letterheadAlign,
    documentTitle: s.documentTitle,
    ...Object.fromEntries(Object.entries(s.sections).map(([key, on]) => [`section:${key}`, on])),
    signatureLabels: s.signatureLabels.join(', '),
    footerPrintedBy: s.footer.printedBy,
    footerSheetNumbers: s.footer.sheetNumbers,
    footerNote: s.footer.note,
    watermark: s.watermark,
  };
}
