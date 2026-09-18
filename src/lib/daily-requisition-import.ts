/**
 * Bulk import of daily requisition entries.
 *
 * The register this reads is the one departments already keep in Excel — reception number, dep no,
 * date, narration, gross and net amount, project and department — so those are the columns, matched
 * by alias so the sheet does not have to be reshaped first. A year of history pasted straight out of
 * the existing sheet is the case this exists for.
 *
 * Three rules differ from `expenses-import.ts`, and they are why this is a separate module rather
 * than another mode of that one:
 *
 *   1. **Reception No is a natural key.** The module allocates it from `serialNumberConfigs`, one per
 *      entry, so two rows carrying the same one are the same entry. That makes duplicate detection
 *      exact rather than heuristic, and it is what lets the same sheet be imported twice safely.
 *   2. **Gross and net are separate figures.** A requisition is verified against its gross and paid
 *      against its net, and collapsing them into one `amount` would lose the deduction that the
 *      whole GST/TDS verification step exists to record.
 *   3. **Timestamp and date are different columns.** `createdAt` is when the entry was keyed, `date`
 *      is the date of the bill. The registers carry both and the reports read both.
 *
 * The generic cell parsers — amount, date, heading normalisation, header-row detection — are imported
 * from `expenses-import.ts` rather than copied. They are pure and already unit-tested there, and two
 * copies of a date parser is two date parsers that disagree by the next bug report.
 *
 * Pure — no Firebase, no exceljs, no DOM — so every rule here is unit-testable with `node --test`.
 * Reading the file and writing to Firestore live in the import dialog component.
 */

import {
  detectHeaderRow,
  normaliseToken,
  parseExpenseAmount,
  parseExpenseDate,
  readExpenseSheet,
  toDateKey,
  type ExpenseSheet,
} from "./expenses-import.ts";

export { detectHeaderRow, normaliseToken, toDateKey };
export { parseExpenseAmount as parseRequisitionAmount };

export type RequisitionImportFieldKey =
  | "receptionNo"
  | "depNo"
  | "timestamp"
  | "date"
  | "description"
  | "partyName"
  | "grossAmount"
  | "netAmount"
  | "projectName"
  | "departmentName";

export interface RequisitionImportColumn {
  key: RequisitionImportFieldKey;
  /** Heading written to the template and shown in the mapping step. */
  label: string;
  /** Alternate spellings accepted by auto-mapping, normalised (lower case, no punctuation). */
  aliases: string[];
  /** Rejected when blank. */
  required?: boolean;
  hint: string;
  accepted: string;
  sample: string;
}

/**
 * Declaration order matters: mapping runs an exact-label pass first and consumes each heading once,
 * so `description` labelled "Narration" claims a NARRATION column before `partyName` — which lists
 * the same word among its aliases — can reach for it. That is deliberate. A register's narration
 * column is a narration; where it happens to hold a party name instead, `partyFromDescription`
 * copies it across.
 */
export const REQUISITION_IMPORT_COLUMNS: RequisitionImportColumn[] = [
  {
    key: "receptionNo",
    label: "Reception No",
    aliases: ["receptionno", "recno", "receiptno", "acknowledgementno", "acknowledgmentno", "receptionnumber"],
    hint: "Taken from the file when present — history already carries its numbers. Leave the column out and each entry is allocated the next number from the serial configuration.",
    accepted: "Text, unique across the module",
    sample: "SEL/2026-27/1",
  },
  {
    key: "depNo",
    label: "Dep No",
    aliases: [
      "depno",
      "deptno",
      "departmentno",
      "departmentserialno",
      "depserialno",
      "requestno",
      "reqno",
      "voucherno",
      "billno",
    ],
    hint: "The raising department's own serial — PR NO-01, AD NO-02. Matched against an expense request's Request No where one exists, so the two records link up.",
    accepted: "Text",
    sample: "PR NO-01",
  },
  {
    key: "timestamp",
    label: "Timestamp",
    aliases: ["timestamp", "createdon", "createdat", "entrytime", "recordedat", "submittedon", "entrydatetime"],
    hint: "When the entry was keyed. A time of day is kept. Blank falls back to the bill date, then to the import date.",
    accepted: "DD/MM/YYYY HH:mm, or any accepted date",
    sample: "26/03/2026 11:49",
  },
  {
    key: "date",
    label: "Date",
    aliases: ["date", "billdate", "voucherdate", "requisitiondate", "expensedate", "invoicedate"],
    hint: "The date of the bill. Blank falls back to the timestamp, then to the import date.",
    accepted: "DD-MM-YYYY, DD-MMM-YYYY or YYYY-MM-DD",
    sample: "01/04/2026",
  },
  {
    key: "description",
    label: "Narration",
    aliases: ["narration", "description", "particulars", "purpose", "details", "nature"],
    required: true,
    hint: "What the requisition is for. Where there is no separate party column, this stands in as the party name too.",
    accepted: "Text",
    sample: "S K ENTERPRISES FOR THE MONTH OF MARCH 2026",
  },
  {
    key: "partyName",
    label: "Name of the Party",
    aliases: ["party", "partyname", "nameoftheparty", "vendor", "vendorname", "supplier", "payee", "beneficiary"],
    hint: "Optional. Left out, the narration stands in — which is what the party-analysis report groups on.",
    accepted: "Text",
    sample: "S K ENTERPRISES",
  },
  {
    key: "grossAmount",
    label: "Gross Amount",
    aliases: [
      "grossamount",
      "gross",
      "amount",
      "totalamount",
      "total",
      "billamount",
      "amountrs",
      "amountinr",
      "value",
      "debit",
    ],
    required: true,
    hint: "The figure before deductions. Rupee symbols, thousands separators and a trailing /- are tolerated. Negative amounts are rejected.",
    accepted: "Number, 0 or above",
    sample: "13,747.00",
  },
  {
    key: "netAmount",
    label: "Net Amount",
    aliases: ["netamount", "net", "payableamount", "netpayable", "amountpayable", "netvalue"],
    hint: "The figure payable after deductions. Blank means the same as gross, which is how an unverified entry starts.",
    accepted: "Number, 0 or above",
    sample: "13,747.00",
  },
  {
    key: "projectName",
    label: "Project Name",
    aliases: ["project", "projectname", "site", "sitename", "projectsite", "sitecode", "projectcode"],
    required: true,
    hint: "Must match a project in SEL Live by name or site code.",
    accepted: "Project name or site code",
    sample: "MADANPUR-RAMPUR",
  },
  {
    key: "departmentName",
    label: "Department",
    aliases: ["department", "departmentname", "dept", "deptname", "generatedbydepartment", "raisedby"],
    required: true,
    hint: "Must match a department in SEL Live by name. One file can span several — PROJECT, ADMIN, PROCUREMENT and TENDER all import together.",
    accepted: "Department name",
    sample: "ADMIN",
  },
];

export const requisitionImportColumn = (key: RequisitionImportFieldKey): RequisitionImportColumn =>
  REQUISITION_IMPORT_COLUMNS.find((column) => column.key === key) as RequisitionImportColumn;

export const REQUISITION_IMPORT_TEMPLATE_HEADERS = REQUISITION_IMPORT_COLUMNS.map((column) => column.label);
export const REQUISITION_IMPORT_TEMPLATE_SAMPLE = REQUISITION_IMPORT_COLUMNS.map((column) => column.sample);

/* ── reading pasted text ─────────────────────────────────────────────────── */

/**
 * Splits pasted register text into a grid.
 *
 * Paste is a first-class input here, not a convenience: this data lives in a sheet somebody already
 * has open, and selecting the rows and pressing Ctrl+V is a shorter path than Save As. The delimiter
 * is detected per paste rather than assumed, because a copy out of Excel is tab-separated while an
 * exported register is commas.
 *
 * Quoted CSV fields are honoured, embedded commas and doubled quotes included — the real data has a
 * project called "GHATTANATI,SANKARATI AND YELAPARRTI", which a naive split would tear in half.
 */
export function parseDelimitedGrid(text: string): string[][] {
  const body = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/, "");
  if (!body.trim()) return [];

  const lines = body.split("\n");
  // Tabs win when any line has one: a pasted spreadsheet selection is tab-separated, and its cells
  // routinely contain commas that are not delimiters.
  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : ",";

  return lines.map((line) => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (quoted) {
        if (char === '"') {
          if (line[index + 1] === '"') {
            cell += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          cell += char;
        }
        continue;
      }
      if (char === '"') {
        quoted = true;
        continue;
      }
      if (char === delimiter) {
        cells.push(cell.trim());
        cell = "";
        continue;
      }
      cell += char;
    }
    cells.push(cell.trim());
    return cells;
  });
}

export type RequisitionSheet = ExpenseSheet;

/** Rows keyed by heading, with the header row found rather than assumed. */
export function readRequisitionSheet(
  grid: readonly (readonly string[])[],
  headerRow = detectHeaderRow(grid),
): RequisitionSheet {
  return readExpenseSheet(grid, headerRow);
}

/* ── mapping ─────────────────────────────────────────────────────────────── */

export type RequisitionColumnMap = Partial<Record<RequisitionImportFieldKey, string>>;

/** Maps headings onto fields by exact label, then alias, then containment; each heading once. */
export function buildRequisitionColumnMap(headings: readonly string[]): RequisitionColumnMap {
  const mapping: RequisitionColumnMap = {};
  const available = new Set(headings);
  const take = (key: RequisitionImportFieldKey, heading: string) => {
    mapping[key] = heading;
    available.delete(heading);
  };
  const find = (predicate: (token: string) => boolean) =>
    Array.from(available).find((heading) => predicate(normaliseToken(heading)));

  REQUISITION_IMPORT_COLUMNS.forEach((column) => {
    const labelToken = normaliseToken(column.label);
    const heading = find((token) => token === labelToken);
    if (heading) take(column.key, heading);
  });

  REQUISITION_IMPORT_COLUMNS.forEach((column) => {
    if (mapping[column.key]) return;
    const aliasTokens = column.aliases.map(normaliseToken);
    const heading = find((token) => aliasTokens.includes(token));
    if (heading) take(column.key, heading);
  });

  REQUISITION_IMPORT_COLUMNS.forEach((column) => {
    if (mapping[column.key]) return;
    const candidates = [column.label, ...column.aliases]
      .map(normaliseToken)
      .filter((token) => token.length >= 5);
    const heading = find(
      (token) =>
        token.length >= 4 &&
        candidates.some((candidate) => token.includes(candidate) || candidate.includes(token)),
    );
    if (heading) take(column.key, heading);
  });

  return mapping;
}

/** Headings the mapping does not use, so the preview can say what is being ignored. */
export const unmappedRequisitionHeadings = (
  headings: readonly string[],
  columnMap: RequisitionColumnMap,
): string[] => {
  const used = new Set(Object.values(columnMap).filter(Boolean));
  return headings.filter((heading) => !used.has(heading));
};

/* ── cell parsing ────────────────────────────────────────────────────────── */

/**
 * A date that may carry a time of day.
 *
 * `undefined` for blank, `null` for present-but-unreadable. The date half is handed to the existing
 * parser — which already accepts every format these registers use — and only the time is dealt with
 * here. Needed because the sheets write `26/03/2026 11:49` in the Timestamp column, and a date
 * parser anchored at the end of the string rejects that outright.
 */
export function parseRequisitionDateTime(raw: string): Date | null | undefined {
  const text = String(raw ?? "").trim();
  if (!text) return undefined;

  const withTime = /^(.*?)[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text);
  if (!withTime) return parseExpenseDate(text);

  const date = parseExpenseDate(withTime[1].trim());
  if (!date) return date;

  let hours = Number(withTime[2]);
  const minutes = Number(withTime[3]);
  const seconds = Number(withTime[4] ?? 0);
  const meridiem = withTime[5]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  date.setHours(hours, minutes, seconds, 0);
  return date;
}

/* ── master resolution ───────────────────────────────────────────────────── */

export interface RequisitionImportProject {
  id: string;
  projectName?: string;
  siteCode?: string;
}

export interface RequisitionImportDepartment {
  id: string;
  name?: string;
}

export interface RequisitionImportMasters {
  projects: readonly RequisitionImportProject[];
  departments: readonly RequisitionImportDepartment[];
}

/** Accepts the project name, its site code, or the document id — whichever the sheet carries. */
export function resolveRequisitionProject(
  projects: readonly RequisitionImportProject[],
  raw: string,
): RequisitionImportProject | undefined {
  const token = normaliseToken(raw);
  if (!token) return undefined;
  return projects.find(
    (project) =>
      normaliseToken(project.projectName) === token ||
      normaliseToken(project.siteCode) === token ||
      normaliseToken(project.id) === token,
  );
}

export function resolveRequisitionDepartment(
  departments: readonly RequisitionImportDepartment[],
  raw: string,
): RequisitionImportDepartment | undefined {
  const token = normaliseToken(raw);
  if (!token) return undefined;
  return departments.find(
    (department) => normaliseToken(department.name) === token || normaliseToken(department.id) === token,
  );
}

/* ── validation ──────────────────────────────────────────────────────────── */

export type RequisitionStatus =
  | "Pending"
  | "Received"
  | "Verified"
  | "Cancelled"
  | "Needs Review"
  | "Received for Payment"
  | "Paid";

export type ReceptionNoSource = "file" | "generate";

export interface RequisitionImportOptions {
  /**
   * Where reception numbers come from. `file` reads the column — history already has its numbers;
   * `generate` allocates a block from the serial configuration at import time.
   */
  receptionNoSource?: ReceptionNoSource;
  /** Reception numbers already recorded, so a re-import cannot create a second entry with one. */
  existingReceptionNos?: readonly string[];
  /** Fingerprints already recorded, for rows that carry no reception number. */
  existingFingerprints?: readonly string[];
  /**
   * Fill the party name from the narration where the sheet has no party column.
   *
   * On by default, because the party-analysis report groups on `partyName` and these registers
   * routinely put the party *in* the narration — so without it that report imports blank.
   */
  partyFromDescription?: boolean;
  /** Status given to every imported entry. Historical rows are rarely still pending. */
  status?: RequisitionStatus;
  /** Stands in for "now": blank dates and the future-date warning both read it. */
  today?: Date;
}

export interface RequisitionImportDraft {
  /** Only set when numbers come from the file; otherwise allocated at import time. */
  receptionNo?: string;
  depNo: string;
  /** ISO timestamp for `date` — the date of the bill. */
  date: string;
  /** ISO timestamp for `createdAt` — when the entry was keyed. */
  createdAt: string;
  projectId: string;
  /** The resolved names, for the preview table. */
  projectName: string;
  departmentId: string;
  departmentName: string;
  description: string;
  partyName: string;
  grossAmount: number;
  netAmount: number;
  status: RequisitionStatus;
}

export interface RequisitionImportRow {
  /** 1-based row number as it appears in the user's sheet. */
  row: number;
  draft: RequisitionImportDraft;
  /** Worth knowing, but not bad enough to skip the row. */
  warnings: string[];
  fingerprint: string;
}

export interface RequisitionImportIssue {
  row: number;
  /** The heading at fault, when one column is to blame. */
  field?: string;
  message: string;
}

export interface RequisitionImportResult {
  rows: RequisitionImportRow[];
  issues: RequisitionImportIssue[];
  duplicates: RequisitionImportIssue[];
  columnMap: RequisitionColumnMap;
  unmappedHeadings: string[];
  headerRow: number;
  totalGross: number;
  totalNet: number;
}

/** `yyyy-MM-dd` of an ISO timestamp in the reader's own timezone; the raw value if it will not parse. */
export const localDateKeyOf = (iso: string): string => {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? String(iso ?? "") : toDateKey(parsed);
};

/**
 * What makes two rows the same entry when neither carries a reception number.
 *
 * Reception No is the real key and is checked before this; this is the fallback for a sheet imported
 * with numbers generated. Deliberately the whole of what was typed, so two genuinely separate
 * payments to the same party on the same day for different amounts both survive.
 */
export const requisitionFingerprint = (draft: {
  projectId: string;
  departmentId: string;
  grossAmount: number;
  partyName: string;
  description: string;
  date: string;
}): string =>
  [
    draft.projectId,
    draft.departmentId,
    draft.grossAmount.toFixed(2),
    normaliseToken(draft.partyName),
    normaliseToken(draft.description),
    localDateKeyOf(draft.date),
  ].join("|");

/**
 * Validates every row of a read sheet against the live masters.
 *
 * `columnMap` is passed in rather than derived, so the mapping step's overrides are what gets
 * validated — auto-mapping is a starting point, not a verdict.
 *
 * A row that breaks a rule is reported and skipped rather than imported half-formed. An entry
 * sitting against no project is worse than one that was never imported, because nothing in the
 * reports afterwards tells you which it was.
 */
export function parseRequisitionImportRows(
  sheet: RequisitionSheet,
  columnMap: RequisitionColumnMap,
  masters: RequisitionImportMasters,
  options: RequisitionImportOptions = {},
): RequisitionImportResult {
  const today = options.today ?? new Date();
  const status = options.status ?? "Pending";
  const fromFile = (options.receptionNoSource ?? "file") === "file";
  const partyFromDescription = options.partyFromDescription !== false;
  const seenReceptionNos = new Set(
    (options.existingReceptionNos ?? []).map(normaliseToken).filter(Boolean),
  );
  const seenFingerprints = new Set(options.existingFingerprints ?? []);

  const rows: RequisitionImportRow[] = [];
  const issues: RequisitionImportIssue[] = [];
  const duplicates: RequisitionImportIssue[] = [];

  const cellOf = (row: { cells: Record<string, string> }, key: RequisitionImportFieldKey): string => {
    const heading = columnMap[key];
    return heading ? String(row.cells[heading] ?? "").trim() : "";
  };

  for (const sheetRow of sheet.rows) {
    const rowIssues: RequisitionImportIssue[] = [];
    const warnings: string[] = [];
    const fail = (key: RequisitionImportFieldKey, message: string) =>
      rowIssues.push({
        row: sheetRow.row,
        field: columnMap[key] ?? requisitionImportColumn(key).label,
        message,
      });

    /* Dates. Either column stands in for the other, so a sheet carrying only one still imports. */
    const rawTimestamp = cellOf(sheetRow, "timestamp");
    const rawDate = cellOf(sheetRow, "date");
    const timestamp = parseRequisitionDateTime(rawTimestamp);
    const billDate = parseRequisitionDateTime(rawDate);
    if (timestamp === null) fail("timestamp", `"${rawTimestamp}" is not a date and time.`);
    if (billDate === null) fail("date", `"${rawDate}" is not a date.`);

    const resolvedDate = billDate || timestamp || today;
    const resolvedCreatedAt = timestamp || billDate || today;
    if (resolvedDate > today) warnings.push(`Dated ${toDateKey(resolvedDate)}, which is in the future.`);

    /* Amounts. */
    const rawGross = cellOf(sheetRow, "grossAmount");
    const gross = parseExpenseAmount(rawGross);
    if (gross === undefined) fail("grossAmount", "A gross amount is required.");
    else if (gross === null) fail("grossAmount", `"${rawGross}" is not a number.`);
    else if (gross < 0) fail("grossAmount", "A negative amount cannot be imported.");

    const rawNet = cellOf(sheetRow, "netAmount");
    const net = parseExpenseAmount(rawNet);
    if (net === null) fail("netAmount", `"${rawNet}" is not a number.`);
    else if (net != null && net < 0) fail("netAmount", "A negative amount cannot be imported.");

    const grossAmount = typeof gross === "number" ? gross : 0;
    const netAmount = typeof net === "number" ? net : grossAmount;
    if (typeof net === "number" && typeof gross === "number" && net > gross) {
      warnings.push("Net is higher than gross — deductions normally reduce it.");
    }

    /* Narration, and the party it may have to stand in for. */
    const description = cellOf(sheetRow, "description");
    if (!description) fail("description", "A narration is required.");

    const rawParty = cellOf(sheetRow, "partyName");
    const partyName = rawParty || (partyFromDescription ? description : "");

    /* Masters. */
    const rawProject = cellOf(sheetRow, "projectName");
    const project = resolveRequisitionProject(masters.projects, rawProject);
    if (!rawProject) fail("projectName", "A project is required.");
    else if (!project) fail("projectName", `No project matches "${rawProject}".`);

    const rawDepartment = cellOf(sheetRow, "departmentName");
    const department = resolveRequisitionDepartment(masters.departments, rawDepartment);
    if (!rawDepartment) fail("departmentName", "A department is required.");
    else if (!department) fail("departmentName", `No department matches "${rawDepartment}".`);

    const receptionNo = cellOf(sheetRow, "receptionNo");
    if (fromFile && !receptionNo) {
      fail("receptionNo", "A reception number is required when numbers come from the file.");
    }

    if (rowIssues.length) {
      issues.push(...rowIssues);
      continue;
    }

    const draft: RequisitionImportDraft = {
      receptionNo: fromFile ? receptionNo : undefined,
      depNo: cellOf(sheetRow, "depNo"),
      date: resolvedDate.toISOString(),
      createdAt: resolvedCreatedAt.toISOString(),
      projectId: (project as RequisitionImportProject).id,
      projectName: (project as RequisitionImportProject).projectName ?? rawProject,
      departmentId: (department as RequisitionImportDepartment).id,
      departmentName: (department as RequisitionImportDepartment).name ?? rawDepartment,
      description,
      partyName,
      grossAmount,
      netAmount,
      status,
    };

    /*
     * Reception No decides when the import is keyed on it — it is the module's own key, an exact
     * answer where the fingerprint is only a good guess. Two rows differing *only* in reception
     * number are then two entries, which is right: each was allocated its own.
     *
     * Keyed on `fromFile` rather than on the column merely being present. A sheet imported with
     * numbers generated still has its old numbers sitting in a column, and reading them here is what
     * let a re-import slip past both checks — the reception check was off, and a truthy token
     * switched the fingerprint check off with it.
     */
    const receptionToken = normaliseToken(receptionNo);
    const keyedByReception = fromFile && Boolean(receptionToken);

    if (keyedByReception && seenReceptionNos.has(receptionToken)) {
      duplicates.push({
        row: sheetRow.row,
        field: columnMap.receptionNo,
        message: `Reception No ${receptionNo} is already recorded.`,
      });
      continue;
    }

    const fingerprint = requisitionFingerprint(draft);
    if (!keyedByReception && seenFingerprints.has(fingerprint)) {
      duplicates.push({
        row: sheetRow.row,
        message: `Repeats an entry already recorded — ${draft.partyName || draft.description} on ${localDateKeyOf(draft.date)}.`,
      });
      continue;
    }

    if (keyedByReception) seenReceptionNos.add(receptionToken);
    seenFingerprints.add(fingerprint);
    rows.push({ row: sheetRow.row, draft, warnings, fingerprint });
  }

  return {
    rows,
    issues,
    duplicates,
    columnMap,
    unmappedHeadings: unmappedRequisitionHeadings(sheet.headings, columnMap),
    headerRow: sheet.headerRow,
    totalGross: rows.reduce((sum, entry) => sum + entry.draft.grossAmount, 0),
    totalNet: rows.reduce((sum, entry) => sum + entry.draft.netAmount, 0),
  };
}

/* ── reception numbers ───────────────────────────────────────────────────── */

export interface RequisitionSerialConfig {
  prefix?: string;
  format?: string;
  suffix?: string;
  startingIndex?: number;
}

/** The single-entry format the entry sheet uses, kept here so the import cannot drift from it. */
export const formatReceptionNo = (config: RequisitionSerialConfig, index: number): string =>
  `${config.prefix ?? ""}${config.format ?? ""}${String(index).padStart(4, "0")}${config.suffix ?? ""}`;

/**
 * A contiguous block of reception numbers, and the index the counter should be left at.
 *
 * Returned together rather than leaving the caller to do the arithmetic: getting the next index
 * wrong is exactly how the entry sheet afterwards hands out a number an imported row already has.
 */
export function allocateReceptionNos(
  config: RequisitionSerialConfig,
  count: number,
): { receptionNos: string[]; nextIndex: number } {
  const start = Math.max(1, Math.trunc(config.startingIndex ?? 1));
  const wanted = Math.max(0, count);
  const receptionNos = Array.from({ length: wanted }, (_, offset) => formatReceptionNo(config, start + offset));
  return { receptionNos, nextIndex: start + wanted };
}
