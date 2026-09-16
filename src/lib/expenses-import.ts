/**
 * Bulk import of expense requests.
 *
 * Expense registers arrive as spreadsheets — a department's own running sheet, or a year of
 * history being migrated off Excel — so that is the shape this accepts. Column order is not fixed
 * and headings vary ("Particulars", "Narration" and "Description" all mean the same thing), so
 * headings are matched by alias and the caller can override any mapping before validating.
 *
 * The rules here are the same ones the create form enforces: a project that exists, a sub-head that
 * exists (with the head of account derived from it, never taken on trust from the sheet), a
 * non-negative amount, and a party and description that are actually filled in. A row that breaks
 * one of them is reported and skipped rather than imported half-formed — an expense sitting against
 * "Unknown Project" is worse than an expense that was never imported, because nothing in the
 * reports tells you which it was.
 *
 * Request numbers are deliberately not invented here. They come either from the file (migrating
 * history that already has its numbers) or from the department's `departmentSerialConfigs` counter,
 * and `allocateRequestNos` formats a contiguous block from that counter in exactly the way the
 * create form formats a single one.
 *
 * Pure — no Firebase, no exceljs, no DOM — so every rule above is unit-testable with `node --test`.
 * Reading the workbook and writing to Firestore live in the import dialog component.
 */

export type ExpenseImportFieldKey =
  | "requestNo"
  | "date"
  | "projectName"
  | "amount"
  | "subHeadOfAccount"
  | "headOfAccount"
  | "partyName"
  | "description"
  | "remarks"
  | "receptionNo"
  | "receptionDate";

export interface ExpenseImportColumn {
  key: ExpenseImportFieldKey;
  /** Heading written to the template and shown in the mapping step. */
  label: string;
  /** Alternate spellings accepted by auto-mapping, normalised (lower case, no punctuation). */
  aliases: string[];
  /** Rejected when blank, whichever numbering mode is in use. */
  required?: boolean;
  /** Documented on the template's Instructions sheet and under the mapping row. */
  hint: string;
  /** What a valid cell looks like, for the Instructions sheet. */
  accepted: string;
  /** Filled into the template's sample row. */
  sample: string;
}

export const EXPENSE_IMPORT_COLUMNS: ExpenseImportColumn[] = [
  {
    key: "requestNo",
    label: "Request No",
    aliases: ["requestno", "reqno", "requestnumber", "expenseno", "voucherno", "vouchernumber", "billno"],
    hint: "Only read when request numbers come from the file. Leave the column out and SEL Live allocates them from the department's serial configuration.",
    accepted: "Text, unique across the module",
    sample: "ACC/0001",
  },
  {
    key: "date",
    label: "Expense Date",
    aliases: ["date", "expensedate", "requestdate", "timestamp", "createdon", "createdat", "entrydate", "voucherdate"],
    hint: "Blank means the date of the import. Used for the request's timestamp, so reports and date filters place it in the right month.",
    accepted: "DD-MM-YYYY, DD-MMM-YYYY or YYYY-MM-DD",
    sample: "15-07-2026",
  },
  {
    key: "projectName",
    label: "Project Name",
    aliases: ["project", "projectname", "site", "sitename", "projectsite", "sitecode", "projectcode"],
    required: true,
    hint: "Must match a project in SEL Live by name or site code — see the Master Data sheet.",
    accepted: "Project name or site code",
    sample: "Sample Project",
  },
  {
    key: "amount",
    label: "Amount",
    aliases: ["amount", "amountrs", "amountinr", "value", "expenseamount", "totalamount", "total", "debit"],
    required: true,
    hint: "Rupee symbols, thousands separators and a trailing /- are tolerated. Negative amounts are rejected.",
    accepted: "Number, 0 or above",
    sample: "25000",
  },
  {
    key: "subHeadOfAccount",
    label: "Sub-Head of A/c",
    aliases: ["subhead", "subheadofac", "subheadofaccount", "subaccounthead", "subledger", "subheadname"],
    required: true,
    hint: "Must match a sub-head in the chart of accounts — see the Master Data sheet. The head of account is taken from it.",
    accepted: "Sub-head name",
    sample: "Site Consumables",
  },
  {
    key: "headOfAccount",
    label: "Head of A/c",
    aliases: ["head", "headofac", "headofaccount", "accounthead", "majorhead", "ledger"],
    hint: "Optional and never trusted — the head is derived from the sub-head. A value that disagrees is reported as a warning.",
    accepted: "Head name (cross-checked only)",
    sample: "Direct Expenses",
  },
  {
    key: "partyName",
    label: "Name of the Party",
    aliases: ["party", "partyname", "nameoftheparty", "vendor", "vendorname", "supplier", "payee", "beneficiary"],
    required: true,
    hint: "Free text. New parties are added to the party list the create form suggests from.",
    accepted: "Text",
    sample: "ABC Traders",
  },
  {
    key: "description",
    label: "Description",
    aliases: ["description", "particulars", "purpose", "narration", "details", "nature"],
    required: true,
    hint: "What the expense is for.",
    accepted: "Text",
    sample: "Cement and sand for foundation works",
  },
  {
    key: "remarks",
    label: "Remarks",
    aliases: ["remarks", "remark", "note", "notes", "comment", "comments"],
    hint: "Optional.",
    accepted: "Text",
    sample: "Approved verbally by PM",
  },
  {
    key: "receptionNo",
    label: "Reception No",
    aliases: ["receptionno", "recno", "receiptno", "acknowledgementno", "acknowledgmentno"],
    hint: "Optional. A request that carries one is treated as already received and can no longer be edited.",
    accepted: "Text",
    sample: "",
  },
  {
    key: "receptionDate",
    label: "Reception Date",
    aliases: ["receptiondate", "recdate", "receiptdate", "acknowledgementdate", "acknowledgmentdate"],
    hint: "Optional, and expected alongside a Reception No.",
    accepted: "DD-MM-YYYY, DD-MMM-YYYY or YYYY-MM-DD",
    sample: "",
  },
];

export const expenseImportColumn = (key: ExpenseImportFieldKey): ExpenseImportColumn =>
  EXPENSE_IMPORT_COLUMNS.find((column) => column.key === key) as ExpenseImportColumn;

/** The header row a downloaded template carries, in order. */
export const EXPENSE_IMPORT_TEMPLATE_HEADERS = EXPENSE_IMPORT_COLUMNS.map((column) => column.label);

/** A sample row, so the template shows the expected date and amount formats rather than describing them. */
export const EXPENSE_IMPORT_TEMPLATE_SAMPLE = EXPENSE_IMPORT_COLUMNS.map((column) => column.sample);

/** Heading/value comparison key: case, spacing and punctuation insensitive. */
export const normaliseToken = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/* ── sheet reading ───────────────────────────────────────────────────────── */

export interface ExpenseSheetRow {
  /** 1-based row number as it appears in the user's sheet. */
  row: number;
  /** Cell text keyed by heading. */
  cells: Record<string, string>;
}

export interface ExpenseSheet {
  /** 1-based row the headings were found on. */
  headerRow: number;
  headings: string[];
  rows: ExpenseSheetRow[];
}

/**
 * Finds the header row rather than assuming row 1: a department's own register routinely carries a
 * title, a "for the month of" line and a blank row above the real headings.
 */
export const detectHeaderRow = (grid: readonly (readonly string[])[], limit = 15): number => {
  let best = { row: 1, filled: -1 };
  const lastRow = Math.min(grid.length, limit);
  for (let index = 0; index < lastRow; index += 1) {
    const filled = (grid[index] ?? []).filter((cell) => String(cell ?? "").trim()).length;
    // A later row only wins if it is strictly wider, so a real heading row beats a one-cell title
    // but a totals row further down cannot hijack the detection.
    if (filled > best.filled) best = { row: index + 1, filled };
    if (filled >= 3 && filled >= best.filled) break;
  }
  return best.row;
};

/**
 * Turns a grid of cell text into rows keyed by heading. A repeated heading is suffixed
 * (`Amount (2)`) so the second one is still addressable in the mapping step instead of silently
 * shadowing the first.
 */
export function readExpenseSheet(
  grid: readonly (readonly string[])[],
  headerRowIndex?: number,
): ExpenseSheet {
  const headerRow = headerRowIndex ?? detectHeaderRow(grid);
  const headingCells = grid[headerRow - 1] ?? [];

  const headings: string[] = [];
  const columnByHeading = new Map<string, number>();
  const seen = new Map<string, number>();
  headingCells.forEach((raw, columnIndex) => {
    const text = String(raw ?? "").trim();
    if (!text) return;
    const count = (seen.get(text) ?? 0) + 1;
    seen.set(text, count);
    const heading = count === 1 ? text : `${text} (${count})`;
    headings.push(heading);
    columnByHeading.set(heading, columnIndex);
  });

  const rows: ExpenseSheetRow[] = [];
  for (let index = headerRow; index < grid.length; index += 1) {
    const cells: Record<string, string> = {};
    let hasValue = false;
    headings.forEach((heading) => {
      const text = String(grid[index]?.[columnByHeading.get(heading) as number] ?? "").trim();
      cells[heading] = text;
      if (text) hasValue = true;
    });
    if (hasValue) rows.push({ row: index + 1, cells });
  }

  return { headerRow, headings, rows };
}

export type ExpenseColumnMap = Partial<Record<ExpenseImportFieldKey, string>>;

/**
 * Maps source headings onto fields by exact label, then declared alias, then containment. Each
 * heading is consumed once, so "Head of A/c" cannot satisfy both `headOfAccount` and
 * `subHeadOfAccount` — the exact-label pass claims it first and the alias pass then has to look
 * elsewhere for the sub-head.
 */
export function buildExpenseColumnMap(headings: readonly string[]): ExpenseColumnMap {
  const mapping: ExpenseColumnMap = {};
  const available = new Set(headings);
  const take = (key: ExpenseImportFieldKey, heading: string) => {
    mapping[key] = heading;
    available.delete(heading);
  };
  const find = (predicate: (token: string) => boolean) =>
    Array.from(available).find((heading) => predicate(normaliseToken(heading)));

  EXPENSE_IMPORT_COLUMNS.forEach((column) => {
    const labelToken = normaliseToken(column.label);
    const heading = find((token) => token === labelToken);
    if (heading) take(column.key, heading);
  });

  EXPENSE_IMPORT_COLUMNS.forEach((column) => {
    if (mapping[column.key]) return;
    const aliasTokens = column.aliases.map(normaliseToken);
    const heading = find((token) => aliasTokens.includes(token));
    if (heading) take(column.key, heading);
  });

  EXPENSE_IMPORT_COLUMNS.forEach((column) => {
    if (mapping[column.key]) return;
    const candidates = [column.label, ...column.aliases]
      .map(normaliseToken)
      .filter((token) => token.length >= 5);
    const heading = find(
      (token) =>
        token.length >= 4 && candidates.some((candidate) => token.includes(candidate) || candidate.includes(token)),
    );
    if (heading) take(column.key, heading);
  });

  return mapping;
}

/** Headings the mapping does not use, so the preview can say what is being ignored. */
export const unmappedHeadings = (headings: readonly string[], columnMap: ExpenseColumnMap): string[] => {
  const used = new Set(Object.values(columnMap).filter(Boolean));
  return headings.filter((heading) => !used.has(heading));
};

/* ── cell parsing ────────────────────────────────────────────────────────── */

/** `undefined` for blank, `null` for present-but-unreadable so the caller can raise an error. */
export function parseExpenseAmount(raw: string): number | null | undefined {
  const text = String(raw ?? "")
    .replace(/[₹$,\s]/g, "")
    .replace(/\/-$/, "")
    // Anchored, so a party or narration that happens to contain "rs" is not quietly rewritten.
    .replace(/^(rs|inr)\.?/i, "")
    .trim();
  if (!text) return undefined;
  // (1,000) is how accounting exports write a negative; keep the sign so it is rejected as one.
  const bracketed = /^\((.*)\)$/.exec(text);
  const value = Number(bracketed ? `-${bracketed[1]}` : text);
  return Number.isFinite(value) ? value : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Excel's day 1 is 1900-01-01, and it also believes 1900 was a leap year — hence the 1899-12-30 base. */
const fromExcelSerial = (serial: number): Date | null => {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 60000) return null;
  const base = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  const utc = new Date(base);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
};

/**
 * `undefined` for blank, `null` for present-but-unreadable.
 *
 * Built at local midnight rather than parsed as UTC: the module's date filters and the pivot
 * report's month bucket both read `createdAt` in local time, so a UTC-parsed 01-09 lands in August
 * for every user east of Greenwich.
 */
export function parseExpenseDate(raw: string): Date | null | undefined {
  const text = String(raw ?? "").trim();
  if (!text) return undefined;

  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (ymd) return buildDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text);
  if (dmy) {
    const year = Number(dmy[3]);
    return buildDate(year < 100 ? 2000 + year : year, Number(dmy[2]), Number(dmy[1]));
  }

  // 15-Jul-2026, 15 July 2026, Jul 15 2026, July 15, 2026
  const named = /^(\d{1,2})[-\s]([a-z]{3,})[-\s,]*(\d{2,4})$/i.exec(text);
  if (named) {
    const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase()) + 1;
    const year = Number(named[3]);
    if (month) return buildDate(year < 100 ? 2000 + year : year, month, Number(named[1]));
  }
  const namedFirst = /^([a-z]{3,})[-\s](\d{1,2})[-\s,]*(\d{2,4})$/i.exec(text);
  if (namedFirst) {
    const month = MONTHS.indexOf(namedFirst[1].slice(0, 3).toLowerCase()) + 1;
    const year = Number(namedFirst[3]);
    if (month) return buildDate(year < 100 ? 2000 + year : year, month, Number(namedFirst[2]));
  }

  if (/^\d{4,5}(\.\d+)?$/.test(text)) return fromExcelSerial(Number(text));

  return null;
}

const buildDate = (year: number, month: number, day: number): Date | null => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  // Rejects 31-02-2026 rather than letting JavaScript roll it forward into March.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
};

/** `yyyy-MM-dd` in local time — the shape `receptionDate` is stored in. */
export const toDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/* ── master resolution ───────────────────────────────────────────────────── */

export interface ExpenseImportProject {
  id: string;
  projectName: string;
  siteCode?: string;
}

export interface ExpenseImportAccountHead {
  id: string;
  name: string;
}

export interface ExpenseImportSubAccountHead {
  id: string;
  name: string;
  headId: string;
}

export interface ExpenseImportMasters {
  projects: readonly ExpenseImportProject[];
  accountHeads: readonly ExpenseImportAccountHead[];
  subAccountHeads: readonly ExpenseImportSubAccountHead[];
}

/** Accepts the project name, its site code, or the document id — whichever the sheet happens to carry. */
export function resolveProject(
  raw: string,
  projects: readonly ExpenseImportProject[],
): ExpenseImportProject | undefined {
  const token = normaliseToken(raw);
  if (!token) return undefined;
  return (
    projects.find((project) => normaliseToken(project.projectName) === token) ??
    projects.find((project) => project.siteCode && normaliseToken(project.siteCode) === token) ??
    projects.find((project) => project.id === String(raw).trim())
  );
}

export function resolveSubAccountHead(
  raw: string,
  subAccountHeads: readonly ExpenseImportSubAccountHead[],
): ExpenseImportSubAccountHead | undefined {
  const token = normaliseToken(raw);
  if (!token) return undefined;
  return subAccountHeads.find((subHead) => normaliseToken(subHead.name) === token);
}

/* ── validation ──────────────────────────────────────────────────────────── */

export type RequestNoSource = "generate" | "file";

export interface ExpenseImportOptions {
  /**
   * Where request numbers come from. `generate` allocates a block from the department's serial
   * configuration on import; `file` reads the Request No column, for history that already has its
   * numbers.
   */
  requestNoSource?: RequestNoSource;
  /** Request numbers already recorded, so a re-import cannot mint a second request with one. */
  existingRequestNos?: readonly string[];
  /** Fingerprints of requests already recorded for this department — see `expenseFingerprint`. */
  existingFingerprints?: readonly string[];
  /** Stands in for "now": blank dates and the future-date warning both read it. */
  today?: Date;
}

export interface ExpenseImportDraft {
  /** Only set when numbers come from the file; otherwise allocated at import time. */
  requestNo?: string;
  /** ISO timestamp written to `createdAt`. */
  createdAt: string;
  projectId: string;
  /** The resolved project name, for the preview table. */
  projectName: string;
  amount: number;
  headOfAccount: string;
  subHeadOfAccount: string;
  partyName: string;
  description: string;
  remarks: string;
  receptionNo: string;
  receptionDate: string;
}

export interface ExpenseImportRow {
  /** 1-based row number as it appears in the user's sheet. */
  row: number;
  draft: ExpenseImportDraft;
  /** Things worth knowing that are not bad enough to skip the row. */
  warnings: string[];
  fingerprint: string;
}

export interface ExpenseImportIssue {
  row: number;
  /** The heading at fault, when one column is to blame. */
  field?: string;
  message: string;
}

export interface ExpenseImportResult {
  /** Rows that validated, ready to write. */
  rows: ExpenseImportRow[];
  /** Rows rejected, each with the reason. */
  issues: ExpenseImportIssue[];
  /** Rows skipped because they repeat a row in the file or a request already recorded. */
  duplicates: ExpenseImportIssue[];
  columnMap: ExpenseColumnMap;
  unmappedHeadings: string[];
  headerRow: number;
  /** Sum of the rows that will be written, for the confirmation step. */
  totalAmount: number;
}

/**
 * What makes two rows "the same expense".
 *
 * Expense requests carry no natural key — the same party can be paid the same amount twice in a day
 * against the same head — so this is deliberately the whole of what a user typed: project, amount,
 * party, description and date. It catches the case that actually happens, which is the same sheet
 * being imported twice, without blocking two genuinely separate payments that differ in any field.
 */
export const expenseFingerprint = (draft: {
  projectId: string;
  amount: number;
  partyName: string;
  description: string;
  createdAt: string;
}): string =>
  [
    draft.projectId,
    draft.amount.toFixed(2),
    normaliseToken(draft.partyName),
    normaliseToken(draft.description),
    // The *local* calendar day, not the UTC slice of the ISO string. An imported row sits at local
    // midnight and a hand-keyed one at whatever time it was raised, so east of Greenwich the two
    // fall on different UTC dates and a re-import of a day already keyed by hand would not match.
    localDateKeyOf(draft.createdAt),
  ].join("|");

/** `yyyy-MM-dd` of an ISO timestamp in the reader's own timezone; the raw value if it will not parse. */
export const localDateKeyOf = (createdAt: string): string => {
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime()) ? String(createdAt ?? "") : toDateKey(parsed);
};

/**
 * Validates every row of a read sheet against the live masters.
 *
 * `columnMap` is passed in rather than derived so the mapping step's overrides are what gets
 * validated — auto-mapping is a starting point, not a verdict. Call `buildExpenseColumnMap` for
 * that starting point.
 */
export function parseExpenseImportRows(
  sheet: ExpenseSheet,
  columnMap: ExpenseColumnMap,
  masters: ExpenseImportMasters,
  options: ExpenseImportOptions = {},
): ExpenseImportResult {
  const requestNoSource: RequestNoSource = options.requestNoSource ?? "generate";
  const today = options.today ?? new Date();
  const result: ExpenseImportResult = {
    rows: [],
    issues: [],
    duplicates: [],
    columnMap,
    unmappedHeadings: unmappedHeadings(sheet.headings, columnMap),
    headerRow: sheet.headerRow,
    totalAmount: 0,
  };

  const missingRequired = EXPENSE_IMPORT_COLUMNS.filter(
    (column) =>
      (column.required || (column.key === "requestNo" && requestNoSource === "file")) && !columnMap[column.key],
  );
  if (missingRequired.length) {
    result.issues.push({
      row: sheet.headerRow,
      message: `Map a column to ${missingRequired.map((column) => `"${column.label}"`).join(", ")} before importing.`,
    });
    return result;
  }
  if (!sheet.rows.length) {
    result.issues.push({ row: sheet.headerRow, message: "The sheet has headings but no data rows." });
    return result;
  }

  const cell = (row: ExpenseSheetRow, key: ExpenseImportFieldKey): string => {
    const heading = columnMap[key];
    return heading ? (row.cells[heading] ?? "").trim() : "";
  };

  const seenRequestNos = new Set((options.existingRequestNos ?? []).map((value) => normaliseToken(value)));
  const seenFingerprints = new Set(options.existingFingerprints ?? []);
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  sheet.rows.forEach((row) => {
    const warnings: string[] = [];
    const reject = (message: string, field?: ExpenseImportFieldKey) => {
      result.issues.push({ row: row.row, field: field ? columnMap[field] : undefined, message });
    };

    const projectRaw = cell(row, "projectName");
    if (!projectRaw) return reject("Project is blank.", "projectName");
    const project = resolveProject(projectRaw, masters.projects);
    if (!project) return reject(`Project "${projectRaw}" is not in SEL Live.`, "projectName");

    const amountRaw = cell(row, "amount");
    const amount = parseExpenseAmount(amountRaw);
    if (amount === undefined) return reject("Amount is blank.", "amount");
    if (amount === null) return reject(`Amount "${amountRaw}" is not a number.`, "amount");
    if (amount < 0) return reject(`Amount ${amount} is negative.`, "amount");
    if (amount === 0) warnings.push("Amount is zero.");

    const subHeadRaw = cell(row, "subHeadOfAccount");
    if (!subHeadRaw) return reject("Sub-head of account is blank.", "subHeadOfAccount");
    const subHead = resolveSubAccountHead(subHeadRaw, masters.subAccountHeads);
    if (!subHead) return reject(`Sub-head "${subHeadRaw}" is not in the chart of accounts.`, "subHeadOfAccount");
    const head = masters.accountHeads.find((candidate) => candidate.id === subHead.headId);
    if (!head) {
      return reject(
        `Sub-head "${subHead.name}" has no head of account — fix it under Settings › Manage Accounts.`,
        "subHeadOfAccount",
      );
    }
    const headRaw = cell(row, "headOfAccount");
    if (headRaw && normaliseToken(headRaw) !== normaliseToken(head.name)) {
      warnings.push(`Head "${headRaw}" replaced with "${head.name}" from the sub-head.`);
    }

    const partyName = cell(row, "partyName");
    if (!partyName) return reject("Party name is blank.", "partyName");

    const description = cell(row, "description");
    if (!description) return reject("Description is blank.", "description");

    const dateRaw = cell(row, "date");
    const parsedDate = parseExpenseDate(dateRaw);
    if (parsedDate === null) return reject(`Expense date "${dateRaw}" is not a date.`, "date");
    if (parsedDate && parsedDate > endOfToday) warnings.push("Expense date is in the future.");
    const createdAt = (parsedDate ?? today).toISOString();

    const receptionNo = cell(row, "receptionNo");
    const receptionDateRaw = cell(row, "receptionDate");
    const receptionDate = parseExpenseDate(receptionDateRaw);
    if (receptionDate === null) return reject(`Reception date "${receptionDateRaw}" is not a date.`, "receptionDate");
    if (receptionNo && !receptionDate) warnings.push("Reception No has no reception date.");
    if (!receptionNo && receptionDate) warnings.push("Reception date has no Reception No.");

    let requestNo: string | undefined;
    if (requestNoSource === "file") {
      requestNo = cell(row, "requestNo");
      if (!requestNo) return reject("Request No is blank.", "requestNo");
      const token = normaliseToken(requestNo);
      if (seenRequestNos.has(token)) {
        result.duplicates.push({
          row: row.row,
          field: columnMap.requestNo,
          message: `Request No "${requestNo}" already exists — skipped so the original is not duplicated.`,
        });
        return;
      }
      seenRequestNos.add(token);
    }

    const draft: ExpenseImportDraft = {
      requestNo,
      createdAt,
      projectId: project.id,
      projectName: project.projectName,
      amount,
      headOfAccount: head.name,
      subHeadOfAccount: subHead.name,
      partyName,
      description,
      remarks: cell(row, "remarks"),
      receptionNo,
      receptionDate: receptionDate ? toDateKey(receptionDate) : "",
    };

    const fingerprint = expenseFingerprint(draft);
    // Only meaningful when the file does not carry its own numbers; with numbers from the file the
    // Request No above is the better duplicate key, and two identical-looking historical entries
    // with different numbers are two real requests.
    if (requestNoSource === "generate" && seenFingerprints.has(fingerprint)) {
      result.duplicates.push({
        row: row.row,
        message: "Same project, party, amount, description and date as a request already recorded — skipped.",
      });
      return;
    }
    seenFingerprints.add(fingerprint);

    result.rows.push({ row: row.row, draft, warnings, fingerprint });
    result.totalAmount += amount;
  });

  return result;
}

/* ── request numbering ───────────────────────────────────────────────────── */

export interface ExpenseSerialConfig {
  prefix?: string;
  format?: string;
  suffix?: string;
  startingIndex?: number;
}

/** The single-request format the create form uses, kept here so the import cannot drift from it. */
export const formatRequestNo = (config: ExpenseSerialConfig, index: number): string =>
  `${config.prefix || ""}${config.format || ""}${String(index).padStart(4, "0")}${config.suffix || ""}`;

/**
 * Formats a contiguous block of request numbers and reports where the counter should land.
 *
 * One block rather than one number per row: the create form bumps `startingIndex` inside a
 * transaction per request, and running that a few hundred times over an import is both slow and a
 * way to end up with a half-numbered import if one of them fails. The caller bumps the counter once,
 * by `count`, in a single transaction and then writes the rows.
 */
export function allocateRequestNos(
  config: ExpenseSerialConfig,
  count: number,
): { requestNos: string[]; nextIndex: number } {
  const start = Number.isFinite(config.startingIndex) ? Number(config.startingIndex) : 1;
  const requestNos: string[] = [];
  for (let offset = 0; offset < Math.max(0, count); offset += 1) {
    requestNos.push(formatRequestNo(config, start + offset));
  }
  return { requestNos, nextIndex: start + Math.max(0, count) };
}

/* ── template ────────────────────────────────────────────────────────────── */

/** A type alias rather than an interface, so the rows drop straight into a workbook sheet's `rows`. */
export type ExpenseTemplateInstruction = {
  Column: string;
  Requirement: string;
  "Accepted Values": string;
  Notes: string;
};

/** Rows for the template's Instructions sheet, so every column documents itself in the file. */
export const buildExpenseTemplateInstructions = (
  requestNoSource: RequestNoSource = "generate",
): ExpenseTemplateInstruction[] =>
  EXPENSE_IMPORT_COLUMNS.map((column) => ({
    Column: column.label,
    Requirement:
      column.required || (column.key === "requestNo" && requestNoSource === "file") ? "Mandatory" : "Optional",
    "Accepted Values": column.accepted,
    Notes: column.hint,
  }));
