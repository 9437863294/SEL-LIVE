/**
 * Legacy workbook import for Bill Tracking.
 *
 * Built against the finance team's real `BILL TRACKING-2026-27.xlsx`. What that file looks like,
 * and what this module therefore has to cope with:
 *
 * - The data sheet is `Bill Tracking`. Row 1 holds the sheet's "today" date and a few stray
 *   cells; the headings are on row 2. Headings carry stray spaces and line breaks
 *   (" Bill Sl No.", "RETENTION AGAINST \nCPBG", "TAXABLE  / ADVANCE"), so matching is case,
 *   spacing and punctuation insensitive.
 * - About 1,000 rows are pre-filled with formulas but only ~150 are real bills. A row is a bill
 *   only if it names a project or carries an amount; formula-only template rows are ignored.
 * - GST, Total Deduction, Net and Shortfall are formulas. Their cached values are what the sheet
 *   showed, and that is what gets compared; a formula with no cached value reads as blank.
 * - Dates arrive as real dates, Excel serials (46133) or typed text.
 * - Amounts can be negative (credit notes, reversals) and deductions can be negative: crop
 *   compensation rows put the compensation in "Mob Adv" as a negative so the net comes out positive.
 * - `GST INVOICE No.` is `NA` on non-GST rows. That is not an error.
 * - `STATUS` is typed by hand and disagrees with the money on about one bill in eight.
 *
 * Nothing here touches Firestore or exceljs. The browser turns the workbook into a grid of plain
 * cells (`ImportCell`) and the server re-runs `parseImportRows` on that grid against the live
 * masters before anything is written, so a tampered preview cannot change what is imported.
 */

import { compareNet, computePaymentStatus, netReceivable, financialYearOf, legacyStatusMismatch, normaliseWeekKey, toDateKey } from './calculations.ts';
import { roundMoney, subtractMoney, sumMoney, toPaise, withinTolerance } from './money.ts';
import { categoryName, inferBillCategory, inferCategoryId, isEnabledForProject } from './categories.ts';
import type {
  BillCategory,
  BillCategoryMaster,
  BillPaymentStatus,
  BillTransactionType,
  BillTypeMaster,
  DeductionTypeMaster,
  ImportReconciliationTotals,
  ProjectNameMapping,
} from './types';

/* ── cells ───────────────────────────────────────────────────────────────── */

/**
 * One spreadsheet cell, already flattened by the browser reader: a number stays a number, a real
 * date becomes `{ date: 'yyyy-MM-dd' }`, a formula with no cached value becomes `{ formula: true }`.
 * Everything else is text.
 */
export type ImportCell = string | number | boolean | null | { date: string } | { formula: true };

export const isDateCell = (cell: ImportCell): cell is { date: string } =>
  typeof cell === 'object' && cell !== null && 'date' in cell;

export const isFormulaCell = (cell: ImportCell): cell is { formula: true } =>
  typeof cell === 'object' && cell !== null && 'formula' in cell;

export const cellText = (cell: ImportCell | undefined): string => {
  if (cell === null || cell === undefined || isFormulaCell(cell)) return '';
  if (isDateCell(cell)) return cell.date;
  return String(cell).trim();
};

/** Heading/value comparison key: case, spacing and punctuation insensitive. */
export const normaliseToken = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Amount parsing. `undefined` = blank, `null` = present but unreadable (an error on the row).
 * Accepts `1,25,00,000`, `12500000`, `₹1,25,00,000`, `-1,25,000`, `(1,25,000)`, `Rs. 500/-`.
 */
export function parseAmount(cell: ImportCell | undefined): number | null | undefined {
  if (cell === null || cell === undefined || isFormulaCell(cell)) return undefined;
  if (typeof cell === 'number') return Number.isFinite(cell) ? roundMoney(cell) : null;
  if (typeof cell === 'boolean' || isDateCell(cell)) return null;
  let text = cell
    .replace(/[₹,\s]/g, '')
    .replace(/\/-$/, '')
    .replace(/^(rs|inr)\.?/i, '')
    .trim();
  if (!text || text === '-' || /^#?n\/?a$/i.test(text)) return undefined;
  // Spreadsheet error values (#REF!, #VALUE!) mean the sheet itself could not compute the cell.
  if (text.startsWith('#')) return null;
  let sign = 1;
  const bracketed = /^\((.*)\)$/.exec(text);
  if (bracketed) {
    sign = -1;
    text = bracketed[1];
  }
  if (/^-?\d*\.?\d+$/.test(text) === false) return null;
  const value = Number(text) * sign;
  return Number.isFinite(value) ? roundMoney(value) : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const buildKey = (year: number, month: number, day: number): string | null => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return toDateKey(date);
};

/**
 * Excel serial → date key. Excel's day 1 is 1900-01-01 and it believes 1900 was a leap year,
 * hence the 1899-12-30 base. Only 1954–2064 is accepted: anything else is far more likely a
 * quantity or an amount sitting in a date column than a date.
 */
export function excelSerialToDateKey(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 60000) return null;
  const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return buildKey(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

/**
 * Date parsing to a `yyyy-MM-dd` key. `undefined` = blank, `null` = unreadable.
 * Accepts real dates, Excel serials, ISO (`2026-04-21`, with or without time), `21-04-2026`,
 * `21/04/2026`, `21.04.26`, `21-Apr-2026`, `Apr 21, 2026`. Day-first, as Indian sheets are.
 */
export function parseDateCell(cell: ImportCell | undefined): string | null | undefined {
  if (cell === null || cell === undefined || isFormulaCell(cell)) return undefined;
  if (isDateCell(cell)) return /^\d{4}-\d{2}-\d{2}$/.test(cell.date) ? cell.date : null;
  if (typeof cell === 'number') return excelSerialToDateKey(cell);
  if (typeof cell === 'boolean') return null;
  const text = cell.trim();
  if (!text || /^#?n\/?a$/i.test(text)) return undefined;

  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (ymd) return buildKey(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s.*)?$/.exec(text);
  if (dmy) {
    const year = Number(dmy[3]);
    return buildKey(year < 100 ? 2000 + year : year, Number(dmy[2]), Number(dmy[1]));
  }

  const named = /^(\d{1,2})[-\s]([a-z]{3,})[-\s,]*(\d{2,4})$/i.exec(text);
  if (named) {
    const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase()) + 1;
    const year = Number(named[3]);
    if (month) return buildKey(year < 100 ? 2000 + year : year, month, Number(named[1]));
  }
  const namedFirst = /^([a-z]{3,})[-\s](\d{1,2})[-\s,]*(\d{2,4})$/i.exec(text);
  if (namedFirst) {
    const month = MONTHS.indexOf(namedFirst[1].slice(0, 3).toLowerCase()) + 1;
    const year = Number(namedFirst[3]);
    if (month) return buildKey(year < 100 ? 2000 + year : year, month, Number(namedFirst[2]));
  }

  if (/^\d{5}(\.\d+)?$/.test(text)) return excelSerialToDateKey(Number(text));
  return null;
}

/** `NA`, `N/A`, `-`, `nil` and blanks all mean "no GST invoice number". */
export const isMissingInvoice = (raw: string): boolean => /^(|na|n\/a|nil|none|-+|0)$/i.test(raw.trim());

/* ── columns ─────────────────────────────────────────────────────────────── */

export type ImportFieldKey =
  | 'legacyTimestamp'
  | 'serialNumber'
  | 'billSerialNumber'
  | 'gstInvoiceNumber'
  | 'billDate'
  | 'project'
  | 'description'
  | 'billType'
  | 'taxableAmount'
  | 'gstAmount'
  | 'buildingCess'
  | 'incomeTds'
  | 'cgstTds'
  | 'sgstTds'
  | 'mobilizationAdvance'
  | 'mobilizationInterest'
  | 'retentionCpbg'
  | 'retentionInvoice'
  | 'retentionTimeExtension'
  | 'lcCommission'
  | 'otherDeduction'
  | 'importedTotalDeduction'
  | 'importedNetAmount'
  | 'importedReceived'
  | 'importedDifference'
  | 'receiptDate'
  | 'legacyStatus'
  | 'targetWeek'
  | 'receivedWeek'
  | 'stage'
  | 'remarks'
  | 'typeV2'
  | 'taxableOrAdvance';

export interface ImportColumn {
  key: ImportFieldKey;
  /** Heading exactly as the legacy workbook writes it — also the template heading. */
  label: string;
  aliases: string[];
  required?: boolean;
  /** Deduction columns name the deduction-type code they post to. */
  deductionCode?: string;
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'legacyTimestamp', label: 'Time Stamp', aliases: ['Timestamp'] },
  { key: 'serialNumber', label: 'Sl. No.', aliases: ['Sl No', 'S No', 'Serial No', 'Sr No'] },
  { key: 'billSerialNumber', label: 'Bill Sl No.', aliases: ['Bill Sl No', 'Bill No', 'Bill Serial No', 'Bill Number'] },
  { key: 'gstInvoiceNumber', label: 'GST INVOICE No.', aliases: ['GST Invoice No', 'Invoice No', 'Invoice Number', 'GST Invoice'] },
  { key: 'billDate', label: 'Date', aliases: ['Bill Date', 'Invoice Date'], required: true },
  { key: 'project', label: 'Project Name', aliases: ['Project', 'Site', 'Site Name'], required: true },
  { key: 'description', label: 'Description', aliases: ['Particulars', 'Narration'] },
  { key: 'billType', label: 'Type of Bill Status', aliases: ['Type of Bill', 'Bill Type', 'Type'] },
  { key: 'taxableAmount', label: 'Taxable Amount', aliases: ['Taxable', 'Basic Amount', 'Taxable Value'] },
  { key: 'gstAmount', label: 'GST Amount', aliases: ['GST', 'Tax Amount'] },
  { key: 'buildingCess', label: 'Building Cess', aliases: ['BOCW Cess', 'Labour Cess', 'Cess'], deductionCode: 'BCESS' },
  { key: 'incomeTds', label: 'Income TDS', aliases: ['TDS', 'IT TDS', 'Income Tax TDS'], deductionCode: 'ITDS' },
  { key: 'cgstTds', label: 'CGST TDS', aliases: [], deductionCode: 'CGSTTDS' },
  { key: 'sgstTds', label: 'SGST TDS', aliases: [], deductionCode: 'SGSTTDS' },
  { key: 'mobilizationAdvance', label: 'Mob Adv', aliases: ['Mobilization Advance', 'Mobilisation Advance', 'Mob Advance'], deductionCode: 'MOBADV' },
  { key: 'mobilizationInterest', label: 'Int. on Mob', aliases: ['Interest on Mob', 'Interest on Mobilization Advance', 'Int on Mob Adv'], deductionCode: 'MOBINT' },
  { key: 'retentionCpbg', label: 'RETENTION AGAINST CPBG', aliases: ['Retention CPBG', 'Retention Against CPBG'], deductionCode: 'RET_CPBG' },
  { key: 'retentionInvoice', label: 'RETENTION AGAINST INVOICE', aliases: ['Retention Invoice', 'Retention Against Invoice'], deductionCode: 'RET_INV' },
  { key: 'retentionTimeExtension', label: 'Ret. Time Ext.', aliases: ['Retention Time Extension', 'Ret Time Ext', 'Retention TE'], deductionCode: 'RET_TE' },
  { key: 'lcCommission', label: 'LC Comm.', aliases: ['LC Commission', 'LC Comm'], deductionCode: 'LCCOMM' },
  { key: 'otherDeduction', label: 'Other', aliases: ['Other Deduction', 'Others'], deductionCode: 'OTHER' },
  { key: 'importedTotalDeduction', label: 'Total Deduction', aliases: ['Total Deductions'] },
  { key: 'importedNetAmount', label: 'Net Amount', aliases: ['Net Receivable', 'Net Amount Receivable'] },
  { key: 'importedReceived', label: 'Net Amount Received', aliases: ['Amount Received', 'Received Amount', 'Received'] },
  {
    key: 'importedDifference',
    label: 'Shortfall/ Surplus (Difference in Net Amount)',
    aliases: ['Shortfall Surplus', 'Shortfall', 'Difference', 'Shortfall/ Surplus'],
  },
  { key: 'receiptDate', label: 'Date of Receipt of Payment', aliases: ['Receipt Date', 'Payment Date', 'Date of Receipt'] },
  { key: 'legacyStatus', label: 'STATUS', aliases: ['Payment Status'] },
  { key: 'targetWeek', label: 'TARGET WEEK', aliases: ['Target Wk'] },
  { key: 'receivedWeek', label: 'RECEIVED WEEK', aliases: ['Received Wk'] },
  { key: 'stage', label: 'STAGES', aliases: ['Stage'] },
  { key: 'remarks', label: 'REMARKS', aliases: ['Remark'] },
  { key: 'typeV2', label: 'TYPE OF V2', aliases: ['Type V2'] },
  { key: 'taxableOrAdvance', label: 'TAXABLE / ADVANCE', aliases: ['Taxable Advance', 'Bill / PI'] },
];

export const DEDUCTION_IMPORT_COLUMNS = IMPORT_COLUMNS.filter((column) => column.deductionCode);

export const importColumn = (key: ImportFieldKey): ImportColumn =>
  IMPORT_COLUMNS.find((column) => column.key === key) as ImportColumn;

/** Template headings — the familiar legacy order. */
export const LEGACY_TEMPLATE_HEADERS = IMPORT_COLUMNS.map((column) => column.label);

/** The simplified template drops the computed and legacy-only columns. */
export const SIMPLIFIED_TEMPLATE_KEYS: ImportFieldKey[] = [
  'billSerialNumber',
  'gstInvoiceNumber',
  'billDate',
  'project',
  'description',
  'billType',
  'taxableAmount',
  'gstAmount',
  'buildingCess',
  'incomeTds',
  'cgstTds',
  'sgstTds',
  'mobilizationAdvance',
  'mobilizationInterest',
  'retentionCpbg',
  'retentionInvoice',
  'retentionTimeExtension',
  'lcCommission',
  'otherDeduction',
  'importedReceived',
  'receiptDate',
  'remarks',
];

export type ImportColumnMap = Partial<Record<ImportFieldKey, number>>;

export interface ImportSheetLayout {
  /** 1-based row the headings sit on. */
  headerRow: number;
  headings: string[];
  columnMap: ImportColumnMap;
  /** Headings with no field, so the mapping step can say what is being ignored. */
  unmapped: string[];
}

/** How many of a row's cells match known headings — the header row is the one that matches most. */
const headingScore = (row: readonly ImportCell[]): number => {
  const tokens = new Set(IMPORT_COLUMNS.flatMap((column) => [column.label, ...column.aliases]).map(normaliseToken));
  return row.filter((cell) => tokens.has(normaliseToken(cellText(cell)))).length;
};

export function detectHeaderRow(grid: readonly (readonly ImportCell[])[], limit = 15): number {
  let best = { row: 1, score: -1 };
  for (let index = 0; index < Math.min(grid.length, limit); index += 1) {
    const score = headingScore(grid[index] ?? []);
    if (score > best.score) best = { row: index + 1, score };
  }
  return best.row;
}

/**
 * Maps headings to fields: exact label, then alias, then containment (≥5 characters, so "Other"
 * cannot swallow "Other Deduction" in reverse). Each heading is consumed once, in column order of
 * `IMPORT_COLUMNS`, so "Net Amount Received" can't satisfy "Net Amount" first: exact matches are
 * all claimed before any alias or containment pass runs.
 */
export function buildColumnMap(headings: readonly string[]): ImportColumnMap {
  const map: ImportColumnMap = {};
  const available = new Map<number, string>();
  headings.forEach((heading, index) => {
    if (heading.trim()) available.set(index, normaliseToken(heading));
  });
  const take = (key: ImportFieldKey, predicate: (token: string) => boolean) => {
    for (const [index, token] of available) {
      if (predicate(token)) {
        map[key] = index;
        available.delete(index);
        return;
      }
    }
  };
  for (const column of IMPORT_COLUMNS) {
    const label = normaliseToken(column.label);
    take(column.key, (token) => token === label);
  }
  for (const column of IMPORT_COLUMNS) {
    if (map[column.key] !== undefined) continue;
    const aliases = column.aliases.map(normaliseToken);
    take(column.key, (token) => aliases.includes(token));
  }
  for (const column of IMPORT_COLUMNS) {
    if (map[column.key] !== undefined) continue;
    const candidates = [column.label, ...column.aliases].map(normaliseToken).filter((token) => token.length >= 5);
    take(column.key, (token) => token.length >= 5 && candidates.some((candidate) => token.startsWith(candidate)));
  }
  return map;
}

export function readSheetLayout(grid: readonly (readonly ImportCell[])[], headerRow?: number): ImportSheetLayout {
  const row = headerRow ?? detectHeaderRow(grid);
  const headings = (grid[row - 1] ?? []).map((cell) => cellText(cell).replace(/\s+/g, ' '));
  const columnMap = buildColumnMap(headings);
  const used = new Set(Object.values(columnMap));
  return {
    headerRow: row,
    headings,
    columnMap,
    unmapped: headings.filter((heading, index) => heading && !used.has(index)),
  };
}

/** Required fields the mapping still lacks. */
export const missingRequiredColumns = (map: ImportColumnMap): ImportColumn[] =>
  IMPORT_COLUMNS.filter((column) => column.required && map[column.key] === undefined);

/* ── master matching ─────────────────────────────────────────────────────── */

export interface ImportProject {
  id: string;
  name: string;
  code?: string;
  clientName?: string;
  dgmOffice?: string;
}

/** Project-name key: upper-case alphanumerics only, so `TPNODL-BARMUNDA` = `TPNODL BARMUNDA`. */
export const projectKey = (name: string): string => normaliseToken(name);

/** Dice coefficient over character bigrams of the normalised names — 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const x = projectKey(a);
  const y = projectKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = (text: string) => {
    const counts = new Map<string, number>();
    for (let index = 0; index < text.length - 1; index += 1) {
      const gram = text.slice(index, index + 2);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    return counts;
  };
  const left = grams(x);
  const right = grams(y);
  let overlap = 0;
  for (const [gram, count] of left) overlap += Math.min(count, right.get(gram) ?? 0);
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

export type ProjectMatchKind = 'exact' | 'remembered' | 'override' | 'fuzzy' | 'unmatched';

export interface ProjectMatch {
  excelName: string;
  kind: ProjectMatchKind;
  project?: ImportProject;
  /** Best candidates for the mapping dropdown, most similar first. */
  candidates: { project: ImportProject; score: number }[];
  score: number;
}

/** Fuzzy suggestions at or above this similarity are offered, but never applied unconfirmed. */
export const FUZZY_THRESHOLD = 0.72;

/**
 * Resolves an Excel project name to the project master. Order: an explicit choice made in this
 * import's mapping step, a remembered mapping from an earlier import, an exact normalised match,
 * then a fuzzy suggestion — which is reported as `fuzzy` and must be confirmed before import.
 */
export function matchProject(
  excelName: string,
  projects: readonly ImportProject[],
  remembered: readonly ProjectNameMapping[] = [],
  overrides: Readonly<Record<string, string>> = {},
): ProjectMatch {
  const key = projectKey(excelName);
  const byId = (id: string) => projects.find((project) => project.id === id);
  const candidates = projects
    .map((project) => ({
      project,
      score: Math.max(nameSimilarity(excelName, project.name), project.code ? nameSimilarity(excelName, project.code) : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const overrideId = overrides[key];
  if (overrideId && byId(overrideId)) return { excelName, kind: 'override', project: byId(overrideId), candidates, score: 1 };

  const memory = remembered.find((entry) => entry.key === key);
  if (memory && byId(memory.projectId)) return { excelName, kind: 'remembered', project: byId(memory.projectId), candidates, score: 1 };

  const exact = projects.find((project) => projectKey(project.name) === key || (project.code && projectKey(project.code) === key));
  if (exact) return { excelName, kind: 'exact', project: exact, candidates, score: 1 };

  const best = candidates[0];
  if (best && best.score >= FUZZY_THRESHOLD) return { excelName, kind: 'fuzzy', project: best.project, candidates, score: best.score };
  return { excelName, kind: 'unmatched', candidates, score: best?.score ?? 0 };
}

export { inferBillCategory };

/**
 * Legacy bill types the month-wise summary counts as retention bills ("RETENTION AMOUNT RAISED").
 * Taken verbatim from the workbook's QUERY formula. `SUPPLY-20%` and `SUPPLY-10%` also appear in
 * its Supply taxable column — the sheet double counts them — so the seeded master marks them as
 * retention bills and finance can flip that in Settings.
 */
export const LEGACY_RETENTION_BILL_TYPES = [
  'SUPPLY-30%',
  'SUPPLY-25%',
  'SUPPLY-20%',
  'SUPPLY-15%',
  'SUPPLY-10%',
  'SUPPLY-10% - F',
  'SUPPLY-5%',
  'ERECTION-20%',
  'ERECTION-10%',
  'ERECTION-10% - F',
  'ERECTION-5%',
  'CIVIL-10%',
  'CIVIL-10% - F',
  'CIVIL-5%',
];

/**
 * The sub category a sheet value names. Several sub categories can share a name when they are
 * enabled for different projects, so one enabled for the row's project wins; otherwise the first
 * match is returned and the row is told it is not enabled there.
 */
export function matchBillType(raw: string, types: readonly BillTypeMaster[], projectId?: string): BillTypeMaster | undefined {
  const key = normaliseToken(raw);
  if (!key) return undefined;
  const matches = types.filter((type) => normaliseToken(type.name) === key || normaliseToken(type.code) === key);
  return matches.find((type) => isEnabledForProject(type, projectId)) ?? matches[0];
}

/** A provisional sub category for a value the workbook uses but Settings does not know yet. */
export function provisionalBillType(name: string, categories: readonly BillCategoryMaster[] = [], projectIds: string[] = []): Omit<BillTypeMaster, 'id'> {
  const clean = name.trim().toUpperCase();
  return {
    name: clean,
    code: clean.replace(/[^A-Z0-9%&]+/g, '-'),
    categoryId: inferCategoryId(clean, categories),
    projectIds,
    isRetentionBill: LEGACY_RETENTION_BILL_TYPES.includes(clean),
    isPriceVariation: /-PV$/.test(clean),
    active: true,
  };
}

/**
 * The invoice a legacy credit/debit note names in its description — the sheet writes
 * "Against Inv No -OD-168/2025-26". `undefined` when the description names none.
 */
export function againstInvoiceFromDescription(description: string | undefined): string | undefined {
  // No bracketed "property:value" class in this pattern: Tailwind scans source files and reads one
  // as an arbitrary CSS property, emitting invalid CSS that breaks every page of the app.
  const match = /against\s+inv(?:oice)?\.?\s*(?:no\.?)?\s*(?:-|:|#)?\s*([A-Za-z0-9][A-Za-z0-9/\-]*[A-Za-z0-9])/i.exec(description ?? '');
  return match?.[1];
}

/* ── row parsing ─────────────────────────────────────────────────────────── */

export type IssueLevel = 'error' | 'warning';

export interface ImportIssue {
  level: IssueLevel;
  field?: ImportFieldKey;
  code: string;
  message: string;
}

export interface ParsedDeduction {
  code: string;
  deductionTypeId?: string;
  name: string;
  amount: number;
}

export interface ParsedImportRow {
  /** 1-based sheet row. */
  row: number;
  raw: Record<string, string>;
  serialNumber?: number;
  billSerialNumber?: string;
  gstInvoiceNumber?: string;
  billDate?: string;
  financialYear?: string;
  projectExcelName: string;
  projectMatch?: ProjectMatch;
  projectId?: string;
  projectName?: string;
  clientName?: string;
  dgmOffice?: string;
  description?: string;
  billTypeName?: string;
  billTypeId?: string;
  billCategory: BillCategory;
  isRetentionBill: boolean;
  transactionType: BillTransactionType;
  taxableAmount: number;
  gstAmount: number;
  deductions: ParsedDeduction[];
  receiptDate?: string;
  legacyStatus?: string;
  legacyTimestamp?: string;
  targetWeek?: string;
  receivedWeek?: string;
  stage?: string;
  remarks?: string;
  typeV2?: string;
  taxableOrAdvance?: string;

  imported: {
    totalDeduction?: number;
    netAmount?: number;
    received?: number;
    difference?: number;
  };
  calculated: {
    gross: number;
    totalDeduction: number;
    net: number;
    received: number;
    outstanding: number;
    status: BillPaymentStatus;
  };
  netMismatch: boolean;
  statusMismatch: boolean;
  fingerprint: string;
  issues: ImportIssue[];
  validation: 'valid' | 'warning' | 'error';
}

export interface ImportMasters {
  projects: readonly ImportProject[];
  billTypes: readonly BillTypeMaster[];
  deductionTypes: readonly DeductionTypeMaster[];
  projectMappings: readonly ProjectNameMapping[];
  tolerance: number;
  roundNetToRupee?: boolean;
  piMarker: string;
  /** Main categories, for placing sub categories the workbook introduces. */
  billCategories?: readonly BillCategoryMaster[];
}

export interface ImportOptions {
  /** Excel project key → chosen project id, from the mapping step. */
  projectOverrides?: Readonly<Record<string, string>>;
  /** Fuzzy matches the user accepted (Excel project keys). */
  confirmedFuzzy?: readonly string[];
}

/** Columns whose values identify a bill or are typed by finance (not computed by the sheet). */
const SOURCE_TEXT_KEYS: ImportFieldKey[] = ['project', 'billSerialNumber', 'gstInvoiceNumber', 'billDate', 'description', 'billType'];
const SOURCE_AMOUNT_KEYS: ImportFieldKey[] = ['taxableAmount', 'gstAmount', 'importedReceived', ...DEDUCTION_IMPORT_COLUMNS.map((c) => c.key)];
/** Computed by sheet formulas — a value here on its own is a stale cached result, not a bill. */
const COMPUTED_AMOUNT_KEYS: ImportFieldKey[] = ['importedTotalDeduction', 'importedNetAmount', 'importedDifference'];

const hasAmount = (row: readonly ImportCell[], map: ImportColumnMap, keys: readonly ImportFieldKey[]) =>
  keys.some((key) => {
    const index = map[key];
    if (index === undefined) return false;
    const value = parseAmount(row[index]);
    return value !== undefined && value !== null && value !== 0;
  });

const hasSourceValue = (row: readonly ImportCell[], map: ImportColumnMap) =>
  SOURCE_TEXT_KEYS.some((key) => map[key] !== undefined && cellText(row[map[key] as number]) !== '') ||
  hasAmount(row, map, SOURCE_AMOUNT_KEYS);

/**
 * A row is a bill only if it carries something finance typed: a project, a bill number, a date, a
 * description, a bill type or a source amount. The legacy sheet keeps ~1,000 formula rows, and
 * rows emptied at the start of a year still hold the cached Net/Shortfall of whatever was there
 * before (₹8.5 lakh across 18 rows in the 2026-27 book) — those are not bills.
 */
export function isBlankRow(row: readonly ImportCell[], map: ImportColumnMap): boolean {
  return !hasSourceValue(row, map);
}

/** A blank row that still shows computed amounts: reported, so finance can see what was skipped. */
export const isStaleFormulaRow = (row: readonly ImportCell[], map: ImportColumnMap): boolean =>
  isBlankRow(row, map) && hasAmount(row, map, COMPUTED_AMOUNT_KEYS);

/**
 * Import fingerprint. The GST invoice alone cannot identify a bill (non-GST rows all say `NA`, and
 * one statement number covers several lines), so it is combined with the project, the legacy
 * Sl. No., the bill number, the date, the bill type, the taxable value and the net. Stored on the
 * bill so a later import of the same workbook recognises every row it already brought in.
 */
export function billFingerprint(input: {
  projectKey: string;
  serialNumber?: number;
  billSerialNumber?: string;
  gstInvoiceNumber?: string;
  billDate?: string;
  billTypeName?: string;
  taxableAmount: number;
  net: number;
}): string {
  return [
    input.projectKey,
    input.serialNumber ?? '',
    normaliseToken(input.billSerialNumber ?? ''),
    normaliseToken(input.gstInvoiceNumber ?? ''),
    input.billDate ?? '',
    normaliseToken(input.billTypeName ?? ''),
    String(toPaise(input.taxableAmount)),
    String(toPaise(input.net)),
  ].join('|');
}

export function parseImportRow(
  cells: readonly ImportCell[],
  rowNumber: number,
  map: ImportColumnMap,
  masters: ImportMasters,
  options: ImportOptions = {},
): ParsedImportRow {
  const issues: ImportIssue[] = [];
  const get = (key: ImportFieldKey): ImportCell | undefined => (map[key] === undefined ? undefined : cells[map[key] as number]);
  const text = (key: ImportFieldKey) => cellText(get(key));
  const raw: Record<string, string> = {};
  for (const column of IMPORT_COLUMNS) {
    if (map[column.key] !== undefined) raw[column.key] = text(column.key);
  }

  const amount = (key: ImportFieldKey): number | undefined => {
    const value = parseAmount(get(key));
    if (value === null) {
      issues.push({ level: 'error', field: key, code: 'non_numeric', message: `${importColumn(key).label} is not a number ("${text(key)}").` });
      return undefined;
    }
    return value;
  };
  const date = (key: ImportFieldKey): string | undefined => {
    const value = parseDateCell(get(key));
    if (value === null) {
      issues.push({ level: 'error', field: key, code: 'invalid_date', message: `${importColumn(key).label} is not a valid date ("${text(key)}").` });
      return undefined;
    }
    return value;
  };

  /* identity */
  const serialRaw = amount('serialNumber');
  const billSerialNumber = text('billSerialNumber') || undefined;
  const invoiceRaw = text('gstInvoiceNumber');
  const gstInvoiceNumber = isMissingInvoice(invoiceRaw) ? undefined : invoiceRaw;
  const billDate = date('billDate');
  if (!billDate && !issues.some((issue) => issue.field === 'billDate')) {
    issues.push({ level: 'error', field: 'billDate', code: 'missing_date', message: 'Bill date is missing.' });
  }

  /* project */
  const projectExcelName = text('project');
  let projectMatch: ProjectMatch | undefined;
  let projectId: string | undefined;
  let projectName: string | undefined;
  if (!projectExcelName) {
    issues.push({ level: 'error', field: 'project', code: 'missing_project', message: 'Project name is missing.' });
  } else {
    projectMatch = matchProject(projectExcelName, masters.projects, masters.projectMappings, options.projectOverrides);
    const confirmed = options.confirmedFuzzy?.includes(projectKey(projectExcelName));
    if (projectMatch.kind === 'unmatched') {
      issues.push({ level: 'error', field: 'project', code: 'project_unmapped', message: `"${projectExcelName}" does not match any SEL LIVE project — map it before importing.` });
    } else if (projectMatch.kind === 'fuzzy' && !confirmed) {
      issues.push({
        level: 'error',
        field: 'project',
        code: 'project_unconfirmed',
        message: `"${projectExcelName}" looks like "${projectMatch.project?.name}" — confirm the mapping before importing.`,
      });
    } else {
      projectId = projectMatch.project?.id;
      projectName = projectMatch.project?.name;
      if (projectMatch.kind === 'fuzzy') {
        issues.push({ level: 'warning', field: 'project', code: 'project_fuzzy', message: `Project matched by similarity to "${projectName}".` });
      }
    }
  }

  /* sub category ("Type of Bill Status") and its main category */
  const categories = masters.billCategories ?? [];
  const billTypeName = text('billType').toUpperCase() || undefined;
  const billType = billTypeName ? matchBillType(billTypeName, masters.billTypes, projectId) : undefined;
  const provisional = billTypeName && !billType ? provisionalBillType(billTypeName, categories) : undefined;
  if (!billTypeName) {
    issues.push({ level: 'warning', field: 'billType', code: 'missing_bill_type', message: 'Sub category (Type of Bill Status) is blank.' });
  } else if (!billType) {
    issues.push({
      level: 'warning',
      field: 'billType',
      code: 'unknown_bill_type',
      message: `Sub category "${billTypeName}" is not in the master; it will be added under ${categoryName(provisional?.categoryId, categories)} for this project.`,
    });
  } else if (projectId && !isEnabledForProject(billType, projectId)) {
    issues.push({ level: 'warning', field: 'billType', code: 'bill_type_not_in_project', message: `Sub category "${billType.name}" is not enabled for ${projectName}; it will be enabled for it on import.` });
  }
  const billCategory = billType?.categoryId ?? provisional?.categoryId ?? 'other';
  const isRetentionBill = billType?.isRetentionBill ?? provisional?.isRetentionBill ?? false;

  /* amounts */
  const taxableAmount = amount('taxableAmount') ?? 0;
  const gstCell = get('gstAmount');
  const gstAmount = amount('gstAmount') ?? 0;
  if (gstCell !== undefined && isFormulaCell(gstCell) && taxableAmount !== 0) {
    issues.push({ level: 'warning', field: 'gstAmount', code: 'formula_no_value', message: 'GST is a formula with no saved value; read as ₹0.' });
  }

  const deductions: ParsedDeduction[] = [];
  for (const column of DEDUCTION_IMPORT_COLUMNS) {
    const value = amount(column.key);
    if (value === undefined || value === 0) continue;
    const type = masters.deductionTypes.find((entry) => entry.code === column.deductionCode);
    deductions.push({ code: column.deductionCode as string, deductionTypeId: type?.id, name: type?.name ?? column.label, amount: value });
  }

  const importedTotalDeduction = amount('importedTotalDeduction');
  const importedNetAmount = amount('importedNetAmount');
  const importedReceived = amount('importedReceived');
  const importedDifference = amount('importedDifference');
  const receiptDate = date('receiptDate');

  const gross = sumMoney([taxableAmount, gstAmount]);
  const calcDeduction = sumMoney(deductions.map((line) => line.amount));
  const net = netReceivable(gross, calcDeduction, masters.roundNetToRupee);
  const received = importedReceived ?? 0;
  const status = computePaymentStatus(net, received, masters.tolerance);
  const outstanding = status === 'received' ? 0 : subtractMoney(net, received);

  /* financial validation */
  let netMismatch = false;
  if (importedTotalDeduction !== undefined && !withinTolerance(importedTotalDeduction, calcDeduction, masters.tolerance)) {
    issues.push({
      level: 'warning',
      field: 'importedTotalDeduction',
      code: 'deduction_mismatch',
      message: `Total Deduction on the sheet (${importedTotalDeduction}) differs from the sum of deduction columns (${calcDeduction}).`,
    });
  }
  if (importedNetAmount !== undefined) {
    const comparison = compareNet(net, importedNetAmount, masters.tolerance);
    if (!comparison.matches) {
      netMismatch = true;
      issues.push({
        level: 'warning',
        field: 'importedNetAmount',
        code: 'net_mismatch',
        message: `Imported net ${importedNetAmount} vs calculated ${net} (difference ${comparison.difference}).`,
      });
    }
  }
  if (importedDifference !== undefined && importedNetAmount !== undefined) {
    const expected = subtractMoney(importedNetAmount, received);
    if (!withinTolerance(expected, importedDifference, masters.tolerance)) {
      issues.push({ level: 'warning', field: 'importedDifference', code: 'difference_mismatch', message: `Shortfall on the sheet (${importedDifference}) ≠ net − received (${expected}).` });
    }
  }
  const legacyStatus = text('legacyStatus') || undefined;
  const statusMismatch = legacyStatusMismatch(legacyStatus, status);
  if (statusMismatch) {
    issues.push({
      level: 'warning',
      field: 'legacyStatus',
      code: 'legacy_status_mismatch',
      message: `Sheet says ${legacyStatus} but ₹${outstanding.toLocaleString('en-IN')} is outstanding (calculated: ${status.replace(/_/g, ' ')}).`,
    });
  }
  if (received !== 0 && !receiptDate) {
    issues.push({ level: 'warning', field: 'receiptDate', code: 'receipt_without_date', message: 'Amount received has no receipt date; the bill date is used for the receipt.' });
  }
  if (receiptDate && received === 0) {
    issues.push({ level: 'warning', field: 'receiptDate', code: 'date_without_receipt', message: 'Receipt date is filled but no amount was received; no receipt is created.' });
  }
  if (!gstInvoiceNumber && gstAmount !== 0) {
    issues.push({ level: 'warning', field: 'gstInvoiceNumber', code: 'missing_invoice', message: 'GST is charged but there is no GST invoice number.' });
  }

  /* classification */
  const taxableOrAdvance = text('taxableOrAdvance').toUpperCase() || undefined;
  const isPi = Boolean(taxableOrAdvance && masters.piMarker && taxableOrAdvance === masters.piMarker.toUpperCase());
  const transactionType: BillTransactionType = isPi
    ? 'advance'
    : isRetentionBill
      ? 'retention_bill'
      : toPaise(gross) < 0
        ? 'credit_note'
        : 'invoice';

  const timestampCell = get('legacyTimestamp');
  const legacyTimestamp = timestampCell === undefined ? undefined : (parseDateCell(timestampCell) ?? (cellText(timestampCell) || undefined));

  const fingerprint = billFingerprint({
    projectKey: projectKey(projectExcelName),
    serialNumber: serialRaw !== undefined && Number.isInteger(serialRaw) ? serialRaw : undefined,
    billSerialNumber,
    gstInvoiceNumber,
    billDate,
    billTypeName,
    taxableAmount,
    net,
  });

  const validation = issues.some((issue) => issue.level === 'error') ? 'error' : issues.length ? 'warning' : 'valid';
  const project = projectId ? masters.projects.find((entry) => entry.id === projectId) : undefined;

  return {
    row: rowNumber,
    raw,
    serialNumber: serialRaw !== undefined && Number.isInteger(serialRaw) ? serialRaw : undefined,
    billSerialNumber,
    gstInvoiceNumber,
    billDate,
    financialYear: billDate ? financialYearOf(billDate) : undefined,
    projectExcelName,
    projectMatch,
    projectId,
    projectName,
    clientName: project?.clientName,
    dgmOffice: project?.dgmOffice,
    description: text('description') || undefined,
    billTypeName,
    billTypeId: billType?.id,
    billCategory,
    isRetentionBill,
    transactionType,
    taxableAmount,
    gstAmount,
    deductions,
    receiptDate,
    legacyStatus,
    legacyTimestamp: typeof legacyTimestamp === 'string' ? legacyTimestamp : undefined,
    targetWeek: billDate ? (normaliseWeekKey(text('targetWeek'), billDate) ?? (text('targetWeek') || undefined)) : text('targetWeek') || undefined,
    receivedWeek: billDate ? (normaliseWeekKey(text('receivedWeek'), billDate) ?? (text('receivedWeek') || undefined)) : text('receivedWeek') || undefined,
    stage: text('stage') || undefined,
    remarks: text('remarks') || undefined,
    typeV2: text('typeV2') || undefined,
    taxableOrAdvance,
    imported: {
      totalDeduction: importedTotalDeduction,
      netAmount: importedNetAmount,
      received: importedReceived,
      difference: importedDifference,
    },
    calculated: { gross, totalDeduction: calcDeduction, net, received, outstanding, status },
    netMismatch,
    statusMismatch,
    fingerprint,
    issues,
    validation,
  };
}

export interface ParsedImport {
  rows: ParsedImportRow[];
  blankRows: number;
  /** Blank rows that still carried cached computed amounts, with the amount the sheet showed. */
  staleRows: { row: number; netAmount: number }[];
  /** Excel project names with how they resolved — the project mapping step's table. */
  projects: ProjectMatch[];
  /** Bill types the workbook uses that the master lacks. */
  unknownBillTypes: string[];
}

export function parseImportRows(
  grid: readonly (readonly ImportCell[])[],
  layout: Pick<ImportSheetLayout, 'headerRow' | 'columnMap'>,
  masters: ImportMasters,
  options: ImportOptions = {},
): ParsedImport {
  const rows: ParsedImportRow[] = [];
  const staleRows: ParsedImport['staleRows'] = [];
  let blankRows = 0;
  for (let index = layout.headerRow; index < grid.length; index += 1) {
    const cells = grid[index] ?? [];
    if (isBlankRow(cells, layout.columnMap)) {
      blankRows += 1;
      if (isStaleFormulaRow(cells, layout.columnMap)) {
        const netIndex = layout.columnMap.importedNetAmount;
        staleRows.push({ row: index + 1, netAmount: (netIndex === undefined ? undefined : parseAmount(cells[netIndex])) ?? 0 });
      }
      continue;
    }
    rows.push(parseImportRow(cells, index + 1, layout.columnMap, masters, options));
  }
  const projects = new Map<string, ProjectMatch>();
  const unknownBillTypes = new Set<string>();
  for (const row of rows) {
    if (row.projectMatch && !projects.has(projectKey(row.projectExcelName))) projects.set(projectKey(row.projectExcelName), row.projectMatch);
    if (row.billTypeName && !row.billTypeId) unknownBillTypes.add(row.billTypeName);
  }
  return { rows, blankRows, staleRows, projects: [...projects.values()], unknownBillTypes: [...unknownBillTypes].sort() };
}

/* ── duplicates ──────────────────────────────────────────────────────────── */

export type DuplicateKind = 'exact' | 'possible' | 'new';

export interface ExistingBillKey {
  id: string;
  projectId: string;
  billSerialNumber?: string;
  gstInvoiceNumber?: string;
  billDate: string;
  billTypeName?: string;
  taxableAmount: number;
  netReceivable: number;
  importFingerprint?: string;
  projectNameSnapshot?: string;
}

export interface DuplicateResult {
  kind: DuplicateKind;
  existingBillId?: string;
  /** Earlier row in the same file this one repeats. */
  duplicateOfRow?: number;
  reason?: string;
}

interface DuplicateKey {
  projectId?: string;
  billSerialNumber?: string;
  gstInvoiceNumber?: string;
  billDate?: string;
  billTypeName?: string;
  taxableAmount: number;
  net: number;
}

const keyOfRow = (row: ParsedImportRow): DuplicateKey => ({
  projectId: row.projectId,
  billSerialNumber: row.billSerialNumber,
  gstInvoiceNumber: row.gstInvoiceNumber,
  billDate: row.billDate,
  billTypeName: row.billTypeName,
  taxableAmount: row.taxableAmount,
  net: row.calculated.net,
});

const keyOfBill = (bill: ExistingBillKey): DuplicateKey => ({
  projectId: bill.projectId,
  billSerialNumber: bill.billSerialNumber,
  gstInvoiceNumber: bill.gstInvoiceNumber,
  billDate: bill.billDate,
  billTypeName: bill.billTypeName,
  taxableAmount: bill.taxableAmount,
  net: bill.netReceivable,
});

const same = (a?: string, b?: string) => normaliseToken(a ?? '') === normaliseToken(b ?? '');

/** Every identifying value equal: the same bill entered twice. */
const isExact = (a: DuplicateKey, b: DuplicateKey) =>
  a.projectId === b.projectId &&
  same(a.billSerialNumber, b.billSerialNumber) &&
  same(a.gstInvoiceNumber, b.gstInvoiceNumber) &&
  a.billDate === b.billDate &&
  same(a.billTypeName, b.billTypeName) &&
  toPaise(a.taxableAmount) === toPaise(b.taxableAmount) &&
  toPaise(a.net) === toPaise(b.net);

/**
 * Same project, same bill type, and the same real invoice or the same bill number — but the date
 * or amounts differ: a corrected re-entry, or a clash. Bill type is part of the test because the
 * legacy book legitimately raises several lines under one statement ("Statement No-12" carries the
 * Supply, Civil and Erection 10% retention claims), and serials restart per series (debit note 01
 * and credit note 01 are different documents).
 */
const isPossible = (a: DuplicateKey, b: DuplicateKey) =>
  a.projectId === b.projectId &&
  same(a.billTypeName, b.billTypeName) &&
  ((Boolean(normaliseToken(a.gstInvoiceNumber ?? '')) && same(a.gstInvoiceNumber, b.gstInvoiceNumber)) ||
    (Boolean(normaliseToken(a.billSerialNumber ?? '')) && same(a.billSerialNumber, b.billSerialNumber) && same(a.gstInvoiceNumber, b.gstInvoiceNumber)));

/**
 * Classifies a parsed row against bills already in SEL LIVE and earlier rows of the same file.
 * A re-import of the same workbook finds every row `exact` through the stored import fingerprint
 * (which includes the legacy Sl. No.) even if finance has since edited the bill.
 */
export function classifyDuplicate(
  row: ParsedImportRow,
  existing: readonly ExistingBillKey[],
  earlierRows: readonly ParsedImportRow[],
): DuplicateResult {
  const key = keyOfRow(row);
  const sameFileExact = earlierRows.find((other) => other.fingerprint === row.fingerprint || isExact(keyOfRow(other), key));
  if (sameFileExact) return { kind: 'exact', duplicateOfRow: sameFileExact.row, reason: `Repeats row ${sameFileExact.row} of this file.` };

  if (row.projectId) {
    const sameProject = existing.filter((bill) => bill.projectId === row.projectId);
    const exact = sameProject.find((bill) => bill.importFingerprint === row.fingerprint || isExact(keyOfBill(bill), key));
    if (exact) return { kind: 'exact', existingBillId: exact.id, reason: 'This bill is already in SEL LIVE.' };
    const possible = sameProject.find((bill) => isPossible(keyOfBill(bill), key));
    if (possible) {
      return { kind: 'possible', existingBillId: possible.id, reason: 'A bill with the same project, type and invoice/bill number exists, but the date or amounts differ.' };
    }
  }

  const sameFilePossible = earlierRows.find((other) => isPossible(keyOfRow(other), key));
  if (sameFilePossible) return { kind: 'possible', duplicateOfRow: sameFilePossible.row, reason: `Same type and invoice/bill number as row ${sameFilePossible.row}.` };

  return { kind: 'new' };
}

/** The default decision per duplicate class; `review` blocks import until the user picks. */
export const defaultRowAction = (kind: DuplicateKind): 'import' | 'skip' | 'review' =>
  kind === 'exact' ? 'skip' : kind === 'possible' ? 'review' : 'import';

/* ── reconciliation ──────────────────────────────────────────────────────── */

export const emptyTotals = (): ImportReconciliationTotals => ({
  bills: 0,
  taxable: 0,
  gst: 0,
  gross: 0,
  deduction: 0,
  net: 0,
  received: 0,
  outstanding: 0,
  retention: 0,
});

const RETENTION_CODES = ['RET_CPBG', 'RET_INV', 'RET_TE'];

/**
 * Totals as the workbook states them. Where the sheet has its own computed column (Total
 * Deduction, Net, Shortfall) that figure is used, not ours — the point of reconciliation is to
 * compare the two.
 */
export function excelTotals(rows: readonly ParsedImportRow[]): ImportReconciliationTotals {
  const totals = emptyTotals();
  const add = (key: keyof ImportReconciliationTotals, value: number) => {
    totals[key] = sumMoney([totals[key], value]);
  };
  for (const row of rows) {
    totals.bills += 1;
    add('taxable', row.taxableAmount);
    add('gst', row.gstAmount);
    add('gross', sumMoney([row.taxableAmount, row.gstAmount]));
    add('deduction', row.imported.totalDeduction ?? row.calculated.totalDeduction);
    const net = row.imported.netAmount ?? row.calculated.net;
    add('net', net);
    add('received', row.imported.received ?? 0);
    add('outstanding', row.imported.difference ?? subtractMoney(net, row.imported.received ?? 0));
    add('retention', sumMoney(row.deductions.filter((line) => RETENTION_CODES.includes(line.code)).map((line) => line.amount)));
  }
  return totals;
}
