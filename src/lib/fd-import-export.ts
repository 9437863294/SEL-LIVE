/**
 * Shared field catalogue, cell coercion and workbook helpers behind the Fixed Deposit
 * import wizard and the FD export centre.
 *
 * Both sides read the same FD_IMPORT_FIELDS list, which is what makes the round trip
 * work: the export centre can emit a sheet in exactly the template's column order, a
 * user edits it, and the importer maps it back with no manual column mapping. Keeping
 * the catalogue here (rather than inline in the workspace, as every other import page
 * in this codebase does) is also what lets the template, the mapping step, the
 * validation step and the Instructions sheet stay in agreement — previously the FD
 * importer hard-coded its 15 headers in three separate places.
 */
import { Timestamp } from "firebase/firestore";
import {
  FD_PURPOSES,
  FD_STATUSES,
  FD_TYPES,
  INTEREST_FREQUENCIES,
  INTEREST_METHODS,
  SOURCE_OF_FUNDS,
  toDate,
  type FixedDeposit,
} from "./fixed-deposit";

/* ── enum catalogues ─────────────────────────────────────────────────────────
 * The FD forms hardcode these two lists inline; the importer needs them as data
 * so it can validate a cell against them and print the accepted values. */
export const FD_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"] as const;
export const FD_HOLDER_TYPES = [
  "Organization",
  "Individual",
  "Joint",
  "Project",
] as const;

export interface EnumOption {
  value: string;
  label: string;
}

const fromPairs = (
  pairs: readonly (readonly [string, string])[],
): EnumOption[] => pairs.map(([value, label]) => ({ value, label }));

const fromValues = (values: readonly string[]): EnumOption[] =>
  values.map((value) => ({ value, label: value.replaceAll("_", " ") }));

/* ── field catalogue ─────────────────────────────────────────────────────── */

export type ImportFieldType =
  | "text"
  | "number"
  | "percentage"
  | "date"
  | "yesno"
  | "enum";

export type ImportFieldGroup =
  | "Identity"
  | "Holder"
  | "Classification"
  | "Deposit"
  | "Interest"
  | "Utilisation"
  | "Lien"
  | "Status"
  | "Contact";

export interface ImportField {
  /** The `FixedDeposit` property this column feeds. */
  key: string;
  /** Column header written to the template and shown in the mapping step. */
  label: string;
  type: ImportFieldType;
  group: ImportFieldGroup;
  required?: boolean;
  /** Alternate spellings accepted by auto-mapping, e.g. a bank's own export headers. */
  aliases?: string[];
  options?: EnumOption[];
  /** Applied to parsed numbers so 7.2500000001 does not reach Firestore. */
  decimals?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  patternMessage?: string;
  /** Value used when the column is unmapped or the cell is blank. */
  fallback?: string | number | boolean;
  hint?: string;
  sample?: string | number;
}

export const FD_IMPORT_FIELDS: ImportField[] = [
  /* Identity */
  {
    key: "fdNumber",
    label: "FD Number",
    type: "text",
    group: "Identity",
    required: true,
    aliases: [
      "fd no",
      "fdr number",
      "fdr no",
      "deposit number",
      "deposit no",
      "receipt number",
      "receipt no",
      "account number",
    ],
    hint: "Bank-issued FD / FDR number. Format the column as Text so leading zeroes survive.",
    sample: "001234567890",
  },
  {
    key: "bankName",
    label: "Bank",
    type: "text",
    group: "Identity",
    required: true,
    aliases: ["bank name", "issuing bank", "banker", "financial institution"],
    hint: "Must match an Active bank account in Bank Master (name, short name or account number).",
    sample: "HDFC Bank",
  },
  {
    key: "branchName",
    label: "Branch",
    type: "text",
    group: "Identity",
    aliases: ["branch name", "bank branch"],
    hint: "Informational. Taken from Bank Master when the bank resolves.",
    sample: "Main Branch",
  },
  {
    key: "projectName",
    label: "Project",
    type: "text",
    group: "Identity",
    aliases: ["project name", "site", "site name"],
    hint: "Optional. Matched against Active projects; unmatched names import as free text.",
    sample: "",
  },
  {
    key: "referenceNumber",
    label: "FD Reference Number",
    type: "text",
    group: "Identity",
    aliases: ["reference number", "reference", "fd reference", "system reference"],
    hint: "Leave blank to let the system allocate from the FD counter (recommended).",
    sample: "",
  },

  /* Holder */
  {
    key: "holderName",
    label: "FD Holder",
    type: "text",
    group: "Holder",
    required: true,
    aliases: ["holder", "holder name", "depositor", "depositor name", "account holder"],
    sample: "SEL Limited",
  },
  {
    key: "holderType",
    label: "Holder Type",
    type: "enum",
    group: "Holder",
    options: fromValues(FD_HOLDER_TYPES),
    fallback: "Organization",
    aliases: ["type of holder", "ownership"],
    sample: "Organization",
  },
  {
    key: "jointHolderName",
    label: "Joint Holder Name",
    type: "text",
    group: "Holder",
    aliases: ["joint holder", "second holder"],
    sample: "",
  },
  {
    key: "nomineeName",
    label: "Nominee Name",
    type: "text",
    group: "Holder",
    aliases: ["nominee"],
    sample: "",
  },
  {
    key: "pan",
    label: "PAN",
    type: "text",
    group: "Holder",
    aliases: ["pan number", "pan no", "permanent account number"],
    pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    patternMessage: "PAN should be 5 letters, 4 digits, 1 letter (e.g. AAACS1234F).",
    sample: "AAACS1234F",
  },
  {
    key: "beneficialOwner",
    label: "Beneficial Owner",
    type: "text",
    group: "Holder",
    aliases: ["ultimate beneficiary", "beneficiary"],
    sample: "",
  },

  /* Classification */
  {
    key: "fdType",
    label: "FD Type",
    type: "enum",
    group: "Classification",
    options: fromPairs(FD_TYPES),
    fallback: "REGULAR",
    aliases: ["type", "deposit type", "fd category"],
    sample: "REGULAR",
  },
  {
    key: "purpose",
    label: "Purpose",
    type: "enum",
    group: "Classification",
    options: fromPairs(FD_PURPOSES),
    fallback: "GENERAL_INVESTMENT",
    aliases: ["fd purpose", "reason", "purpose of deposit"],
    sample: "GENERAL_INVESTMENT",
  },
  {
    key: "depositCategory",
    label: "Deposit Category",
    type: "text",
    group: "Classification",
    aliases: ["category"],
    sample: "",
  },
  {
    key: "sourceOfFunds",
    label: "Source of Funds",
    type: "enum",
    group: "Classification",
    options: fromValues(SOURCE_OF_FUNDS),
    fallback: "Other",
    aliases: ["fund source", "funded from"],
    sample: "Current Account",
  },
  {
    key: "currency",
    label: "Currency",
    type: "enum",
    group: "Classification",
    options: fromValues(FD_CURRENCIES),
    fallback: "INR",
    aliases: ["ccy"],
    sample: "INR",
  },

  /* Deposit */
  {
    key: "principalAmount",
    label: "Principal Amount",
    type: "number",
    group: "Deposit",
    required: true,
    decimals: 2,
    min: 0.01,
    aliases: [
      "principal",
      "deposit amount",
      "fd amount",
      "amount",
      "invested amount",
      "face value",
    ],
    sample: 1000000,
  },
  {
    key: "creationDate",
    label: "Creation Date",
    type: "date",
    group: "Deposit",
    aliases: ["booking date", "issue date", "created on"],
    hint: "Defaults to the value date when blank.",
    sample: "2024-04-01",
  },
  {
    key: "valueDate",
    label: "Value Date",
    type: "date",
    group: "Deposit",
    required: true,
    aliases: ["deposit date", "start date", "from date", "date of deposit"],
    sample: "2024-04-01",
  },
  {
    key: "maturityDate",
    label: "Maturity Date",
    type: "date",
    group: "Deposit",
    required: true,
    aliases: ["due date", "to date", "end date", "date of maturity"],
    sample: "2025-04-01",
  },
  {
    key: "tenureDays",
    label: "Tenure (Days)",
    type: "number",
    group: "Deposit",
    decimals: 0,
    min: 0,
    aliases: ["tenure days", "days", "period days"],
    hint: "Optional. Derived from the dates when blank; days take precedence over months.",
    sample: "",
  },
  {
    key: "tenureMonths",
    label: "Tenure (Months)",
    type: "number",
    group: "Deposit",
    decimals: 0,
    min: 0,
    aliases: ["tenure months", "months", "period months", "tenor"],
    sample: 12,
  },

  /* Interest */
  {
    key: "interestRate",
    label: "Interest Rate",
    type: "percentage",
    group: "Interest",
    required: true,
    decimals: 4,
    min: 0,
    max: 100,
    aliases: ["rate", "roi", "rate of interest", "interest %", "interest rate %"],
    sample: 7.25,
  },
  {
    key: "interestCalculationMethod",
    label: "Interest Calculation Method",
    type: "enum",
    group: "Interest",
    options: fromValues(INTEREST_METHODS),
    fallback: "BANK_PROVIDED",
    aliases: ["calculation method", "interest method", "compounding"],
    sample: "BANK_PROVIDED",
  },
  {
    key: "interestPaymentFrequency",
    label: "Interest Payment Frequency",
    type: "enum",
    group: "Interest",
    options: fromValues(INTEREST_FREQUENCIES),
    fallback: "On maturity",
    aliases: ["frequency", "payout frequency", "interest frequency"],
    sample: "On maturity",
  },
  {
    key: "maturityAmount",
    label: "Maturity Amount",
    type: "number",
    group: "Interest",
    decimals: 2,
    min: 0,
    aliases: ["maturity value", "amount on maturity", "gross maturity"],
    hint: "Bank-advised maturity value. Recomputed from the rate when blank.",
    sample: 1072500,
  },
  {
    key: "interestReceived",
    label: "Interest Received",
    type: "number",
    group: "Interest",
    decimals: 2,
    min: 0,
    aliases: ["interest credited", "interest paid"],
    hint: "For part-paid non-cumulative deposits being migrated mid-term.",
    sample: 0,
  },
  {
    key: "prematureClosurePenalty",
    label: "Premature Closure Penalty %",
    type: "percentage",
    group: "Interest",
    decimals: 2,
    min: 0,
    max: 100,
    aliases: ["penalty", "penalty %", "premature penalty"],
    sample: 1,
  },

  /* Utilisation */
  {
    key: "eligibleMarginPercentage",
    label: "Eligible Margin %",
    type: "percentage",
    group: "Utilisation",
    decimals: 2,
    min: 0,
    max: 100,
    fallback: 100,
    aliases: ["eligibility %", "margin %", "haircut", "eligible %"],
    hint: "Share of principal assignable to BG/LC margin. Defaults to 100.",
    sample: 100,
  },
  {
    key: "bgUtilizedAmount",
    label: "BG Utilised Amount",
    type: "number",
    group: "Utilisation",
    decimals: 2,
    min: 0,
    fallback: 0,
    aliases: ["bg utilised", "bg utilized", "bg margin", "bg lien amount"],
    hint: "Opening BG margin already carved out of this FD.",
    sample: 0,
  },
  {
    key: "lcUtilizedAmount",
    label: "LC Utilised Amount",
    type: "number",
    group: "Utilisation",
    decimals: 2,
    min: 0,
    fallback: 0,
    aliases: ["lc utilised", "lc utilized", "lc margin", "lc lien amount"],
    hint: "Opening LC margin already carved out of this FD.",
    sample: 0,
  },

  /* Lien */
  {
    key: "lienMarked",
    label: "Lien Marked",
    type: "yesno",
    group: "Lien",
    fallback: false,
    aliases: ["lien", "under lien", "lien flag"],
    sample: "No",
  },
  {
    key: "lienHolder",
    label: "Lien Holder",
    type: "text",
    group: "Lien",
    aliases: ["lien in favour of", "lien favouring"],
    sample: "",
  },
  {
    key: "lienDate",
    label: "Lien Date",
    type: "date",
    group: "Lien",
    aliases: ["date of lien"],
    sample: "",
  },
  {
    key: "lienAmount",
    label: "Lien Amount",
    type: "number",
    group: "Lien",
    decimals: 2,
    min: 0,
    aliases: ["amount under lien"],
    sample: "",
  },
  {
    key: "lienPurpose",
    label: "Lien Purpose",
    type: "text",
    group: "Lien",
    sample: "",
  },
  {
    key: "bankConfirmationReference",
    label: "Bank Confirmation Reference",
    type: "text",
    group: "Lien",
    aliases: ["bank confirmation", "confirmation ref", "lien confirmation"],
    sample: "",
  },

  /* Status */
  {
    key: "status",
    label: "Status",
    type: "enum",
    group: "Status",
    options: fromValues(FD_STATUSES),
    fallback: "ACTIVE",
    aliases: ["fd status", "current status"],
    hint: "Live deposits should be ACTIVE. Utilisation-derived statuses are recalculated after import.",
    sample: "ACTIVE",
  },
  {
    key: "autoRenewal",
    label: "Auto Renewal",
    type: "yesno",
    group: "Status",
    fallback: false,
    aliases: ["auto renew", "auto-renewal", "renewal instruction"],
    sample: "No",
  },
  {
    key: "remarks",
    label: "Remarks",
    type: "text",
    group: "Status",
    aliases: ["notes", "narration", "comments", "description"],
    sample: "Opening migration",
  },

  /* Contact */
  {
    key: "relationshipManager",
    label: "Relationship Manager",
    type: "text",
    group: "Contact",
    aliases: ["rm", "rm name", "relationship manager name"],
    sample: "",
  },
  {
    key: "relationshipManagerPhone",
    label: "RM Phone",
    type: "text",
    group: "Contact",
    aliases: ["rm contact", "rm mobile", "rm phone number"],
    pattern: /^[0-9+\-\s()]{6,20}$/,
    patternMessage: "RM phone should contain only digits, spaces, +, - or ().",
    sample: "",
  },
  {
    key: "relationshipManagerEmail",
    label: "RM Email",
    type: "text",
    group: "Contact",
    aliases: ["rm email id", "rm mail"],
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
    patternMessage: "RM email is not a valid address.",
    sample: "",
  },
];

export const FD_IMPORT_FIELD_GROUPS: ImportFieldGroup[] = [
  "Identity",
  "Holder",
  "Classification",
  "Deposit",
  "Interest",
  "Utilisation",
  "Lien",
  "Status",
  "Contact",
];

export const FD_TEMPLATE_HEADERS = FD_IMPORT_FIELDS.map((field) => field.label);

/* ── cell coercion ───────────────────────────────────────────────────────── */

/** Header/enum comparison key: case, spacing and punctuation insensitive. */
export const normalizeToken = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * Flattens every shape an exceljs cell can hold into a trimmed string. Formula
 * cells carry `{ result }`, hyperlinks carry `{ text }`, and styled cells carry
 * `{ richText }` — reading `.value` alone yields "[object Object]" for all three.
 */
export const cellValueToString = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const cell = value as {
      richText?: Array<{ text?: string }>;
      text?: string;
      result?: unknown;
      hyperlink?: string;
      error?: string;
    };
    if (Array.isArray(cell.richText))
      return cell.richText.map((part) => part.text ?? "").join("").trim();
    if (cell.error) return "";
    if (cell.result !== undefined && cell.result !== null)
      return cellValueToString(cell.result);
    if (typeof cell.text === "string") return cell.text.trim();
    return "";
  }
  return String(value).trim();
};

export const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export interface ParsedNumber {
  value: number;
  empty: boolean;
  valid: boolean;
}

/** Tolerates currency symbols, thousands separators, trailing %, and (1,000) negatives. */
export const parseNumber = (raw: unknown): ParsedNumber => {
  if (typeof raw === "number" && Number.isFinite(raw))
    return { value: raw, empty: false, valid: true };
  const text = cellValueToString(raw);
  if (!text) return { value: 0, empty: true, valid: true };
  const negative = /^\(.*\)$/.test(text);
  const cleaned = text
    .replace(/[()]/g, "")
    .replace(/[₹$€£]|inr|rs\.?|aed|usd|eur|gbp/gi, "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/\s/g, "");
  if (!cleaned) return { value: 0, empty: true, valid: true };
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return { value: 0, empty: false, valid: false };
  return { value: negative ? -parsed : parsed, empty: false, valid: true };
};

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/** Excel's day 1 is 1900-01-01 but it also believes 1900 was a leap year. */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

const atNoon = (year: number, month: number, day: number) => {
  const date = new Date(year, month, day, 12, 0, 0, 0);
  // Reject 31/02 style overflow rather than silently rolling into March.
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day)
    return null;
  return date;
};

/**
 * Parses a date cell to local noon — the same normalisation the FD forms apply, so an
 * imported deposit and a hand-keyed one land on the same calendar day regardless of
 * the browser's timezone offset.
 */
export const parseDateCell = (raw: unknown): Date | null => {
  if (raw instanceof Date)
    return atNoon(raw.getFullYear(), raw.getMonth(), raw.getDate());
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const shifted = new Date(EXCEL_EPOCH + Math.round(raw) * 86_400_000);
    return atNoon(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    );
  }
  const text = cellValueToString(raw);
  if (!text) return null;

  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return atNoon(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    const year = Number(dmy[3]);
    return atNoon(
      year < 100 ? 2000 + year : year,
      Number(dmy[2]) - 1,
      Number(dmy[1]),
    );
  }

  const named = text.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{2,4})$/);
  if (named) {
    const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase());
    const year = Number(named[3]);
    if (month >= 0)
      return atNoon(year < 100 ? 2000 + year : year, month, Number(named[1]));
  }

  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 0 && serial < 100_000)
    return parseDateCell(serial);

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime())
    ? null
    : atNoon(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
};

const TRUE_TOKENS = new Set(["yes", "y", "true", "1", "marked", "applicable", "enabled"]);
const FALSE_TOKENS = new Set(["no", "n", "false", "0", "notmarked", "na", "nil", "disabled"]);

/** `null` means "present but unrecognised" so the caller can raise an error. */
export const parseYesNo = (raw: unknown): boolean | null | undefined => {
  if (typeof raw === "boolean") return raw;
  const token = normalizeToken(raw);
  if (!token) return undefined;
  if (TRUE_TOKENS.has(token)) return true;
  if (FALSE_TOKENS.has(token)) return false;
  return null;
};

export interface EnumMatch {
  value: string;
  matched: boolean;
}

/** Accepts the stored code, the human label, or any case/punctuation variant of either. */
export const matchEnumOption = (
  raw: unknown,
  options: EnumOption[],
): EnumMatch => {
  const token = normalizeToken(raw);
  if (!token) return { value: "", matched: true };
  const exact = options.find(
    (option) =>
      normalizeToken(option.value) === token ||
      normalizeToken(option.label) === token,
  );
  if (exact) return { value: exact.value, matched: true };
  const partial = options.find((option) => {
    const valueToken = normalizeToken(option.value);
    const labelToken = normalizeToken(option.label);
    return (
      (token.length >= 4 && (valueToken.includes(token) || labelToken.includes(token))) ||
      (valueToken.length >= 4 && token.includes(valueToken))
    );
  });
  if (partial) return { value: partial.value, matched: true };
  return { value: cellValueToString(raw), matched: false };
};

/* ── worksheet reading ───────────────────────────────────────────────────── */

export interface SheetRow {
  /** 1-based worksheet row number, for error messages that match what the user sees. */
  excelRow: number;
  cells: Record<string, unknown>;
}

export interface SheetRead {
  headerRow: number;
  headers: string[];
  rows: SheetRow[];
}

/** Minimal structural view of an exceljs worksheet, so this module needs no exceljs types. */
export interface ReadableSheet {
  rowCount: number;
  columnCount: number;
  getRow: (index: number) => { getCell: (index: number) => { value: unknown } };
}

/**
 * Finds the header row rather than assuming row 1: bank statements and downloaded
 * registers routinely carry a title, an "as on" date and a blank line above the
 * real headers.
 */
export const detectHeaderRow = (sheet: ReadableSheet, limit = 15) => {
  let best = { row: 1, filled: -1 };
  const lastRow = Math.min(sheet.rowCount || 1, limit);
  for (let index = 1; index <= lastRow; index += 1) {
    const row = sheet.getRow(index);
    let filled = 0;
    for (let column = 1; column <= (sheet.columnCount || 0); column += 1) {
      if (cellValueToString(row.getCell(column).value)) filled += 1;
    }
    // A later row only wins if it is strictly wider, so a genuine header beats a
    // one-cell title but a totals row further down cannot hijack the detection.
    if (filled > best.filled) best = { row: index, filled };
    if (filled >= 3 && filled >= best.filled) break;
  }
  return best.row;
};

/**
 * Reads a worksheet into plain records keyed by header text. Repeated headers are
 * suffixed (`Amount (2)`) so a duplicated column is still addressable instead of
 * silently shadowing the first one.
 */
export const worksheetToRows = (
  sheet: ReadableSheet,
  headerRowIndex?: number,
): SheetRead => {
  const headerRow = headerRowIndex ?? detectHeaderRow(sheet);
  const headers: string[] = [];
  const columnByHeader = new Map<string, number>();
  const seen = new Map<string, number>();

  for (let column = 1; column <= (sheet.columnCount || 0); column += 1) {
    const raw = cellValueToString(sheet.getRow(headerRow).getCell(column).value);
    if (!raw) continue;
    const count = (seen.get(raw) || 0) + 1;
    seen.set(raw, count);
    const header = count === 1 ? raw : `${raw} (${count})`;
    headers.push(header);
    columnByHeader.set(header, column);
  }

  const rows: SheetRow[] = [];
  for (let index = headerRow + 1; index <= (sheet.rowCount || 0); index += 1) {
    const worksheetRow = sheet.getRow(index);
    const cells: Record<string, unknown> = {};
    let hasValue = false;
    headers.forEach((header) => {
      const value = worksheetRow.getCell(columnByHeader.get(header) as number).value;
      cells[header] = value;
      if (cellValueToString(value)) hasValue = true;
    });
    if (hasValue) rows.push({ excelRow: index, cells });
  }

  return { headerRow, headers, rows };
};

/**
 * Maps source columns onto fields by exact normalised header, then declared alias,
 * then containment. Each source column is consumed once so "Bank" cannot satisfy
 * both `bankName` and `bankConfirmationReference`.
 */
export const autoMapColumns = (
  fields: ImportField[],
  headers: string[],
): Record<string, string> => {
  const mapping: Record<string, string> = {};
  const available = new Set(headers);
  const take = (field: ImportField, header: string) => {
    mapping[field.key] = header;
    available.delete(header);
  };

  const find = (predicate: (headerToken: string, header: string) => boolean) =>
    Array.from(available).find((header) => predicate(normalizeToken(header), header));

  // Three passes so a weak containment match never steals a column an exact match
  // needs: exact label, declared alias, then containment.
  fields.forEach((field) => {
    const labelToken = normalizeToken(field.label);
    const header = find((headerToken) => headerToken === labelToken);
    if (header) take(field, header);
  });

  fields.forEach((field) => {
    if (mapping[field.key]) return;
    const aliasTokens = (field.aliases || []).map(normalizeToken);
    const header = find((headerToken) => aliasTokens.includes(headerToken));
    if (header) take(field, header);
  });

  fields.forEach((field) => {
    if (mapping[field.key]) return;
    const candidates = [field.label, ...(field.aliases || [])]
      .map(normalizeToken)
      .filter((token) => token.length >= 5);
    const header = find(
      (headerToken) =>
        headerToken.length >= 4 &&
        candidates.some(
          (token) => headerToken.includes(token) || token.includes(headerToken),
        ),
    );
    if (header) take(field, header);
  });

  return mapping;
};

/* ── workbook writing ────────────────────────────────────────────────────── */

export const downloadBlob = (blob: Blob, fileName: string) => {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
};

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const downloadWorkbook = async (
  workbook: { xlsx: { writeBuffer: () => Promise<ArrayBuffer> } },
  fileName: string,
) => {
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: XLSX_MIME }), fileName);
};

interface StyleableSheet {
  getRow: (index: number) => { font: unknown; fill: unknown; height?: number };
  views: unknown[];
  autoFilter?: unknown;
  columnCount: number;
}

/** Frozen, filtered, white-on-teal header row — matches `exportWorkbook` in report-excel.ts. */
export const styleHeaderRow = (
  sheet: StyleableSheet,
  argb = "FF0F9D74",
  rowIndex = 1,
) => {
  const header = sheet.getRow(rowIndex);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  header.height = 22;
  sheet.views = [{ state: "frozen", ySplit: rowIndex }];
  sheet.autoFilter = {
    from: { row: rowIndex, column: 1 },
    to: { row: rowIndex, column: sheet.columnCount || 1 },
  };
};

export const columnWidthFor = (label: string) =>
  Math.min(42, Math.max(14, label.length + 4));

/* ── template ────────────────────────────────────────────────────────────── */

export interface TemplateOptions {
  includeSamples?: boolean;
  /** Written to the Master Data sheet so users paste values that resolve on import. */
  bankNames?: string[];
  projectNames?: string[];
  fileName?: string;
}

const requirementLabel = (field: ImportField) => {
  if (field.required) return "Mandatory";
  if (field.fallback !== undefined) return `Optional (defaults to ${String(field.fallback) || "blank"})`;
  return "Optional";
};

/**
 * How many template rows get Excel dropdowns. The wizard validates every row it reads
 * regardless — the in-sheet validation is a typo guard while filling, so a generous but
 * bounded window keeps the template small and fast to open.
 */
const VALIDATION_ROWS = 200;

/**
 * exceljs coalesces identical neighbouring validations by walking addresses in
 * *lexicographic* order, which sorts "E10" before "E2". A single row-2-to-201 run
 * therefore emits two overlapping sqrefs (`E2:E201` and `E10:E201`), and Excel's writer
 * never produces overlaps. Splitting the window at the 9→10 digit boundary and giving
 * each band a distinct message (the trailing space is invisible to the user but makes
 * the coalescer's deep-equality check fail across the boundary) yields exactly two
 * clean, non-overlapping ranges per column.
 */
const VALIDATION_BANDS = [
  { from: 2, to: 9, marker: '' },
  { from: 10, to: VALIDATION_ROWS + 1, marker: ' ' },
];

/**
 * In-sheet validation for the columns where a picker actually prevents mistakes: the
 * enums and the percentages. Free-form numbers are deliberately left alone so pasted
 * formulas and currency-formatted cells are not rejected by Excel before import.
 */
const dataValidationFor = (field: ImportField, marker: string) => {
  if (field.type === 'enum' || field.type === 'yesno') {
    const values = field.type === 'yesno' ? ['Yes', 'No'] : (field.options || []).map((option) => option.value);
    const formula = `"${values.join(',')}"`;
    // Excel caps an inline list formula at 255 characters; longer lists are documented on
    // the Instructions sheet instead of silently producing a corrupt dropdown.
    if (formula.length > 255) return null;
    return {
      type: 'list',
      allowBlank: true,
      formulae: [formula],
      showErrorMessage: true,
      errorTitle: field.label,
      error: `Choose one of: ${values.join(', ')}${marker}`,
    };
  }
  if (field.type === 'percentage') {
    return {
      type: 'decimal',
      operator: 'between',
      allowBlank: true,
      formulae: [field.min ?? 0, field.max ?? 100],
      showErrorMessage: true,
      errorTitle: field.label,
      error: `Enter a percentage between ${field.min ?? 0} and ${field.max ?? 100}.${marker}`,
    };
  }
  return null;
};

const acceptedValues = (field: ImportField) => {
  if (field.type === "enum")
    return (field.options || []).map((option) => option.value).join(", ");
  if (field.type === "yesno") return "Yes / No";
  if (field.type === "date") return "DD-MM-YYYY, DD-MMM-YYYY or YYYY-MM-DD";
  if (field.type === "percentage")
    return `Number 0–${field.max ?? 100} (percent, not a fraction)`;
  if (field.type === "number") {
    const bounds = [
      field.min !== undefined ? `min ${field.min}` : "",
      field.decimals !== undefined ? `${field.decimals} decimals` : "",
    ].filter(Boolean);
    return bounds.length ? `Number (${bounds.join(", ")})` : "Number";
  }
  return field.pattern ? field.patternMessage || "Text" : "Text";
};

/**
 * Builds the three-sheet import template: the data sheet (typed, validated,
 * pre-filtered), an Instructions sheet documenting every column, and a Master Data
 * sheet listing the exact bank and project names that will resolve on import.
 */
export const buildTemplateWorkbook = async (options: TemplateOptions = {}) => {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SEL Live";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Fixed Deposits");
  sheet.columns = FD_IMPORT_FIELDS.map((field) => ({
    header: field.label,
    key: field.key,
    width: columnWidthFor(field.label),
  }));

  if (options.includeSamples) {
    const sample: Record<string, unknown> = {};
    FD_IMPORT_FIELDS.forEach((field) => {
      sample[field.key] = field.sample ?? "";
    });
    const row = sheet.addRow(sample);
    row.font = { italic: true, color: { argb: "FF64748B" } };
  }

  styleHeaderRow(sheet as unknown as StyleableSheet);

  FD_IMPORT_FIELDS.forEach((field, index) => {
    const column = sheet.getColumn(index + 1);
    // FD numbers and PANs are text: without '@' Excel strips leading zeroes and
    // reformats long digit strings into scientific notation.
    if (field.key === "fdNumber" || field.key === "pan") column.numFmt = "@";
    if (field.type === "date") column.numFmt = "dd-mm-yyyy";
    if (field.type === "number" && field.decimals === 2) column.numFmt = "#,##0.00";
    if (field.type === "percentage") column.numFmt = "0.00";
  });

  // Registered cell by cell: exceljs 3.x keys its validation model on single addresses
  // and coalesces identical neighbours into ranges when it writes. Handing it a range
  // key instead throws inside its own serializer.
  VALIDATION_BANDS.forEach((band) => {
    FD_IMPORT_FIELDS.forEach((field, index) => {
      const validation = dataValidationFor(field, band.marker);
      if (!validation) return;
      for (let row = band.from; row <= band.to; row += 1) {
        sheet.getCell(row, index + 1).dataValidation = validation as never;
      }
    });
  });

  const guide = workbook.addWorksheet("Instructions");
  guide.columns = [
    { header: "Column", key: "column", width: 32 },
    { header: "Group", key: "group", width: 16 },
    { header: "Requirement", key: "requirement", width: 34 },
    { header: "Accepted Values", key: "accepted", width: 62 },
    { header: "Notes", key: "notes", width: 70 },
  ];
  FD_IMPORT_FIELDS.forEach((field) => {
    guide.addRow({
      column: field.label,
      group: field.group,
      requirement: requirementLabel(field),
      accepted: acceptedValues(field),
      notes: field.hint || "",
    });
  });
  styleHeaderRow(guide as unknown as StyleableSheet, "FF0F766E");
  guide.getColumn("notes").alignment = { wrapText: true, vertical: "top" };
  guide.getColumn("accepted").alignment = { wrapText: true, vertical: "top" };

  const masters = workbook.addWorksheet("Master Data");
  masters.columns = [
    { header: "Bank (paste into Bank column)", key: "bank", width: 46 },
    { header: "Project (paste into Project column)", key: "project", width: 46 },
  ];
  const banks = options.bankNames || [];
  const projects = options.projectNames || [];
  for (let index = 0; index < Math.max(banks.length, projects.length); index += 1) {
    masters.addRow({ bank: banks[index] || "", project: projects[index] || "" });
  }
  if (!banks.length && !projects.length)
    masters.addRow({ bank: "No Active bank accounts found", project: "" });
  styleHeaderRow(masters as unknown as StyleableSheet, "FF1D4ED8");

  return workbook;
};

export const downloadImportTemplate = async (options: TemplateOptions = {}) => {
  const workbook = await buildTemplateWorkbook(options);
  await downloadWorkbook(
    workbook as unknown as { xlsx: { writeBuffer: () => Promise<ArrayBuffer> } },
    options.fileName ||
      (options.includeSamples
        ? "fd-import-sample.xlsx"
        : "fd-import-template.xlsx"),
  );
};

/* ── export column catalogue ─────────────────────────────────────────────── */

/** A register row with utilisation recomputed from live assignments. */
export type FdExportRow = FixedDeposit & {
  computedStatus: string;
  computedEligible: number;
  computedBg: number;
  computedLc: number;
  computedReserved: number;
  computedAvailable: number;
  computedUtilised: number;
  daysToMaturity: number | null;
  financialYear: string;
  assignmentCount: number;
  instrumentNumbers: string;
};

export type ExportColumnKind = "text" | "number" | "amount" | "date" | "percent";

export interface FdExportColumn {
  key: string;
  header: string;
  width: number;
  kind: ExportColumnKind;
  group:
    | "Identity"
    | "Holder"
    | "Classification"
    | "Financial"
    | "Utilisation"
    | "Lien"
    | "Workflow"
    | "Audit";
  value: (row: FdExportRow) => unknown;
}

const dateOnly = (value: Parameters<typeof toDate>[0]) => {
  const parsed = toDate(value);
  if (!parsed) return "";
  return new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    12,
  );
};

export const FD_EXPORT_COLUMNS: FdExportColumn[] = [
  { key: "referenceNumber", header: "FD Reference Number", width: 26, kind: "text", group: "Identity", value: (row) => row.referenceNumber },
  { key: "fdNumber", header: "FD Number", width: 22, kind: "text", group: "Identity", value: (row) => row.fdNumber },
  { key: "organizationName", header: "Organization", width: 26, kind: "text", group: "Identity", value: (row) => row.organizationName || row.organizationId },
  { key: "bankName", header: "Bank", width: 26, kind: "text", group: "Identity", value: (row) => row.bankName },
  { key: "branchName", header: "Branch", width: 22, kind: "text", group: "Identity", value: (row) => row.branchName || "" },
  { key: "ifsc", header: "IFSC", width: 14, kind: "text", group: "Identity", value: (row) => row.ifsc || "" },
  { key: "sourceAccountNumber", header: "Source Account", width: 22, kind: "text", group: "Identity", value: (row) => row.sourceAccountNumber || "" },
  { key: "projectName", header: "Project", width: 26, kind: "text", group: "Identity", value: (row) => row.projectName || "" },

  { key: "holderName", header: "FD Holder", width: 26, kind: "text", group: "Holder", value: (row) => row.holderName },
  { key: "holderType", header: "Holder Type", width: 16, kind: "text", group: "Holder", value: (row) => row.holderType || "" },
  { key: "jointHolderName", header: "Joint Holder Name", width: 24, kind: "text", group: "Holder", value: (row) => row.jointHolderName || "" },
  { key: "nomineeName", header: "Nominee Name", width: 22, kind: "text", group: "Holder", value: (row) => row.nomineeName || "" },
  { key: "pan", header: "PAN", width: 14, kind: "text", group: "Holder", value: (row) => row.pan || "" },
  { key: "beneficialOwner", header: "Beneficial Owner", width: 24, kind: "text", group: "Holder", value: (row) => row.beneficialOwner || "" },

  { key: "fdType", header: "FD Type", width: 18, kind: "text", group: "Classification", value: (row) => row.fdType },
  { key: "purpose", header: "Purpose", width: 22, kind: "text", group: "Classification", value: (row) => row.purpose },
  { key: "depositCategory", header: "Deposit Category", width: 20, kind: "text", group: "Classification", value: (row) => row.depositCategory || "" },
  { key: "sourceOfFunds", header: "Source of Funds", width: 20, kind: "text", group: "Classification", value: (row) => row.sourceOfFunds || "" },
  { key: "currency", header: "Currency", width: 12, kind: "text", group: "Classification", value: (row) => row.currency || "INR" },
  { key: "financialYear", header: "Financial Year", width: 15, kind: "text", group: "Classification", value: (row) => row.financialYear },

  { key: "principalAmount", header: "Principal Amount", width: 18, kind: "amount", group: "Financial", value: (row) => row.principalAmount },
  { key: "interestRate", header: "Interest Rate", width: 14, kind: "percent", group: "Financial", value: (row) => row.interestRate },
  { key: "interestCalculationMethod", header: "Interest Calculation Method", width: 26, kind: "text", group: "Financial", value: (row) => row.interestCalculationMethod },
  { key: "interestPaymentFrequency", header: "Interest Payment Frequency", width: 26, kind: "text", group: "Financial", value: (row) => row.interestPaymentFrequency },
  { key: "tenureDays", header: "Tenure (Days)", width: 14, kind: "number", group: "Financial", value: (row) => row.tenureDays || "" },
  { key: "tenureMonths", header: "Tenure (Months)", width: 16, kind: "number", group: "Financial", value: (row) => row.tenureMonths || "" },
  { key: "creationDate", header: "Creation Date", width: 15, kind: "date", group: "Financial", value: (row) => dateOnly(row.creationDate) },
  { key: "valueDate", header: "Value Date", width: 15, kind: "date", group: "Financial", value: (row) => dateOnly(row.valueDate) },
  { key: "maturityDate", header: "Maturity Date", width: 15, kind: "date", group: "Financial", value: (row) => dateOnly(row.maturityDate) },
  { key: "daysToMaturity", header: "Days to Maturity", width: 16, kind: "number", group: "Financial", value: (row) => row.daysToMaturity ?? "" },
  { key: "expectedInterest", header: "Expected Interest", width: 18, kind: "amount", group: "Financial", value: (row) => row.expectedInterest },
  { key: "maturityAmount", header: "Maturity Amount", width: 18, kind: "amount", group: "Financial", value: (row) => row.maturityAmount },
  { key: "expectedTds", header: "Expected TDS", width: 16, kind: "amount", group: "Financial", value: (row) => row.expectedTds },
  { key: "expectedNetProceeds", header: "Expected Net Proceeds", width: 20, kind: "amount", group: "Financial", value: (row) => row.expectedNetProceeds },
  { key: "interestReceived", header: "Interest Received", width: 18, kind: "amount", group: "Financial", value: (row) => row.interestReceived || 0 },
  { key: "prematureClosurePenalty", header: "Premature Closure Penalty %", width: 24, kind: "percent", group: "Financial", value: (row) => row.prematureClosurePenalty || 0 },

  { key: "eligibleMarginPercentage", header: "Eligible Margin %", width: 17, kind: "percent", group: "Utilisation", value: (row) => row.eligibleMarginPercentage },
  { key: "computedEligible", header: "Eligible Value", width: 18, kind: "amount", group: "Utilisation", value: (row) => row.computedEligible },
  { key: "computedBg", header: "BG Utilised", width: 16, kind: "amount", group: "Utilisation", value: (row) => row.computedBg },
  { key: "computedLc", header: "LC Utilised", width: 16, kind: "amount", group: "Utilisation", value: (row) => row.computedLc },
  { key: "computedReserved", header: "Reserved", width: 16, kind: "amount", group: "Utilisation", value: (row) => row.computedReserved },
  { key: "computedUtilised", header: "Total Utilised", width: 16, kind: "amount", group: "Utilisation", value: (row) => row.computedUtilised },
  { key: "computedAvailable", header: "Available Balance", width: 18, kind: "amount", group: "Utilisation", value: (row) => row.computedAvailable },
  { key: "assignmentCount", header: "Active Assignments", width: 18, kind: "number", group: "Utilisation", value: (row) => row.assignmentCount },
  { key: "instrumentNumbers", header: "Linked BG / LC", width: 34, kind: "text", group: "Utilisation", value: (row) => row.instrumentNumbers },

  { key: "lienMarked", header: "Lien Marked", width: 14, kind: "text", group: "Lien", value: (row) => (row.lienMarked ? "Yes" : "No") },
  { key: "lienHolder", header: "Lien Holder", width: 24, kind: "text", group: "Lien", value: (row) => row.lienHolder || "" },
  { key: "lienDate", header: "Lien Date", width: 15, kind: "date", group: "Lien", value: (row) => dateOnly(row.lienDate) },
  { key: "lienAmount", header: "Lien Amount", width: 16, kind: "amount", group: "Lien", value: (row) => row.lienAmount || 0 },
  { key: "lienPurpose", header: "Lien Purpose", width: 24, kind: "text", group: "Lien", value: (row) => row.lienPurpose || "" },
  { key: "bankConfirmationReference", header: "Bank Confirmation Reference", width: 26, kind: "text", group: "Lien", value: (row) => row.bankConfirmationReference || "" },

  { key: "status", header: "Stored Status", width: 20, kind: "text", group: "Workflow", value: (row) => row.status },
  { key: "computedStatus", header: "Operational Status", width: 22, kind: "text", group: "Workflow", value: (row) => row.computedStatus },
  { key: "approvalStatus", header: "Approval Status", width: 16, kind: "text", group: "Workflow", value: (row) => row.approvalStatus },
  { key: "workflowStage", header: "Workflow Stage", width: 22, kind: "text", group: "Workflow", value: (row) => row.workflowStage || "" },
  { key: "autoRenewal", header: "Auto Renewal", width: 14, kind: "text", group: "Workflow", value: (row) => (row.autoRenewal ? "Yes" : "No") },
  { key: "documentComplete", header: "Documents Complete", width: 19, kind: "text", group: "Workflow", value: (row) => (row.documentComplete ? "Yes" : "No") },
  { key: "remarks", header: "Remarks", width: 40, kind: "text", group: "Workflow", value: (row) => row.remarks || "" },

  { key: "relationshipManager", header: "Relationship Manager", width: 24, kind: "text", group: "Audit", value: (row) => row.relationshipManager || "" },
  { key: "relationshipManagerPhone", header: "RM Phone", width: 18, kind: "text", group: "Audit", value: (row) => row.relationshipManagerPhone || "" },
  { key: "relationshipManagerEmail", header: "RM Email", width: 26, kind: "text", group: "Audit", value: (row) => row.relationshipManagerEmail || "" },
  { key: "createdByName", header: "Created By", width: 22, kind: "text", group: "Audit", value: (row) => row.createdByName || "" },
  { key: "createdAt", header: "Created On", width: 15, kind: "date", group: "Audit", value: (row) => dateOnly(row.createdAt) },
  { key: "approvedByName", header: "Approved By", width: 22, kind: "text", group: "Audit", value: (row) => row.approvedByName || "" },
  { key: "approvedAt", header: "Approved On", width: 15, kind: "date", group: "Audit", value: (row) => dateOnly(row.approvedAt) },
  { key: "updatedByName", header: "Last Updated By", width: 22, kind: "text", group: "Audit", value: (row) => row.updatedByName || "" },
  { key: "updatedAt", header: "Last Updated On", width: 16, kind: "date", group: "Audit", value: (row) => dateOnly(row.updatedAt) },
];

export const FD_EXPORT_COLUMN_GROUPS = Array.from(
  new Set(FD_EXPORT_COLUMNS.map((column) => column.group)),
);

/** Named column sets, so the common exports are one click rather than 60 checkboxes. */
export const FD_EXPORT_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  keys: string[] | "all";
}> = [
  {
    id: "standard",
    label: "Standard Register",
    description: "Identity, principal, utilisation and maturity — the everyday register view.",
    keys: [
      "referenceNumber",
      "fdNumber",
      "bankName",
      "branchName",
      "holderName",
      "fdType",
      "purpose",
      "currency",
      "principalAmount",
      "interestRate",
      "valueDate",
      "maturityDate",
      "daysToMaturity",
      "computedEligible",
      "computedBg",
      "computedLc",
      "computedReserved",
      "computedAvailable",
      "computedStatus",
    ],
  },
  {
    id: "financial",
    label: "Financial & Interest",
    description: "Interest projection, TDS and net proceeds for treasury reconciliation.",
    keys: [
      "referenceNumber",
      "fdNumber",
      "bankName",
      "currency",
      "principalAmount",
      "interestRate",
      "interestCalculationMethod",
      "interestPaymentFrequency",
      "tenureDays",
      "tenureMonths",
      "valueDate",
      "maturityDate",
      "expectedInterest",
      "maturityAmount",
      "expectedTds",
      "expectedNetProceeds",
      "interestReceived",
      "financialYear",
    ],
  },
  {
    id: "utilisation",
    label: "Utilisation & Assignments",
    description: "Eligible value against BG/LC utilisation, with linked instrument numbers.",
    keys: [
      "referenceNumber",
      "fdNumber",
      "bankName",
      "holderName",
      "principalAmount",
      "eligibleMarginPercentage",
      "computedEligible",
      "computedBg",
      "computedLc",
      "computedReserved",
      "computedUtilised",
      "computedAvailable",
      "assignmentCount",
      "instrumentNumbers",
      "computedStatus",
      "maturityDate",
    ],
  },
  {
    id: "compliance",
    label: "Lien & Compliance",
    description: "Lien marking, bank confirmation, documents and approval trail.",
    keys: [
      "referenceNumber",
      "fdNumber",
      "bankName",
      "holderName",
      "pan",
      "principalAmount",
      "lienMarked",
      "lienHolder",
      "lienDate",
      "lienAmount",
      "lienPurpose",
      "bankConfirmationReference",
      "documentComplete",
      "approvalStatus",
      "approvedByName",
      "approvedAt",
    ],
  },
  {
    id: "all",
    label: "Complete Data Dump",
    description: "Every stored and computed field. Use for backups and offline analysis.",
    keys: "all",
  },
];

/**
 * Renders a register row into the import template's own column order, so an export
 * can be edited offline and re-imported without touching the mapping step.
 */
export const toImportShapedRow = (row: FdExportRow): Record<string, unknown> => {
  const record: Record<string, unknown> = {};
  FD_IMPORT_FIELDS.forEach((field) => {
    switch (field.key) {
      case "bgUtilizedAmount":
        record[field.key] = row.computedBg;
        break;
      case "lcUtilizedAmount":
        record[field.key] = row.computedLc;
        break;
      case "lienMarked":
        record[field.key] = row.lienMarked ? "Yes" : "No";
        break;
      case "autoRenewal":
        record[field.key] = row.autoRenewal ? "Yes" : "No";
        break;
      case "status":
        record[field.key] = row.computedStatus;
        break;
      default: {
        const value = (row as unknown as Record<string, unknown>)[field.key];
        if (field.type === "date") record[field.key] = dateOnly(value as never);
        else if (value instanceof Timestamp)
          record[field.key] = dateOnly(value as never);
        else record[field.key] = value ?? "";
      }
    }
  });
  return record;
};

export const numberFormatFor = (kind: ExportColumnKind) => {
  if (kind === "amount") return "#,##0.00";
  if (kind === "percent") return "0.00";
  if (kind === "date") return "dd-mm-yyyy";
  return undefined;
};
