/**
 * Employee import for Office Hub (§64).
 *
 * Pure: parses pasted text or a CSV, validates every row, and returns a preview the dialog renders
 * and an error report the user can download. Nothing here writes — `importOfficeHubEmployees` in
 * the service takes this module's output and commits the rows it classified as safe.
 *
 * ── What this importer is, and deliberately is not ─────────────────────────────────────────────
 *
 * The office's employee master is the existing `employees` collection, synced from greytHR
 * (`docs/greythr-integration.md`). §89 is explicit that Office Hub must integrate with existing
 * master data rather than create a duplicate, and an importer that freely creates employee records
 * would do exactly that — and would fight the next sync, which owns those documents.
 *
 * So this importer **reconciles**. Every row is matched against the existing directory by employee
 * ID and then by email, and classified:
 *
 *   • `match`   — the person exists and the sheet agrees. Nothing to do.
 *   • `update`  — the person exists and the sheet carries Office Hub fields worth writing
 *                 (location, reporting manager, designation, department, status).
 *   • `create`  — no such person. Written with `source: 'office-hub-import'` so a later greytHR
 *                 sync can tell a manually-added record from one it owns.
 *   • `error`   — the row cannot be acted on, with a reason naming the column.
 *
 * The preview shows all four, and the commit only ever touches the first three. A user importing a
 * 400-row sheet can see, before anything is written, that 380 rows match, 15 will be updated, 3
 * created and 2 are broken — which is the only version of this feature anyone should trust.
 */

import { isIsoDate, type IsoDate } from './office-hub-time.ts';

/** The columns §64 specifies, plus the aliases real spreadsheets use for them. */
export interface EmployeeImportColumn {
  key: EmployeeImportFieldKey;
  label: string;
  required: boolean;
  sample: string;
  aliases: string[];
  hint?: string;
}

export type EmployeeImportFieldKey =
  | 'employeeId'
  | 'name'
  | 'email'
  | 'mobile'
  | 'designation'
  | 'department'
  | 'location'
  | 'reportingManager'
  | 'status'
  | 'joiningDate'
  | 'timeZone';

export const EMPLOYEE_IMPORT_COLUMNS: readonly EmployeeImportColumn[] = [
  {
    key: 'employeeId',
    label: 'Employee ID',
    required: true,
    sample: 'SEL-1042',
    aliases: ['employee id', 'empid', 'emp no', 'employee no', 'employee code', 'staff id', 'code'],
    hint: 'Matched against the existing employee directory first.',
  },
  {
    key: 'name',
    label: 'Name',
    required: true,
    sample: 'Asha Rao',
    aliases: ['name', 'full name', 'employee name', 'employee'],
  },
  {
    key: 'email',
    label: 'Email',
    required: true,
    sample: 'asha.rao@example.com',
    aliases: ['email', 'email id', 'e-mail', 'official email', 'mail'],
    hint: 'Used to match an existing login, and to send invitations.',
  },
  {
    key: 'mobile',
    label: 'Mobile',
    required: false,
    sample: '9876543210',
    aliases: ['mobile', 'phone', 'mobile no', 'contact', 'contact no', 'phone number'],
  },
  {
    key: 'designation',
    label: 'Designation',
    required: false,
    sample: 'Finance Manager',
    aliases: ['designation', 'title', 'job title', 'role', 'position'],
  },
  {
    key: 'department',
    label: 'Department',
    required: true,
    sample: 'Finance',
    aliases: ['department', 'dept', 'department name', 'division'],
    hint: 'Must match an existing department name.',
  },
  {
    key: 'location',
    label: 'Location',
    required: false,
    sample: 'Head Office',
    aliases: ['location', 'office', 'base location', 'site', 'work location'],
  },
  {
    key: 'reportingManager',
    label: 'Reporting Manager',
    required: false,
    sample: 'Ravi Kumar',
    aliases: ['reporting manager', 'manager', 'reports to', 'supervisor', 'reporting to'],
    hint: 'Matched by name or employee ID against the directory.',
  },
  {
    key: 'status',
    label: 'Status',
    required: false,
    sample: 'Active',
    aliases: ['status', 'employee status', 'active'],
    hint: 'Active or Inactive. Blank is treated as Active.',
  },
  {
    key: 'joiningDate',
    label: 'Joining Date',
    required: false,
    sample: '2024-04-01',
    aliases: ['joining date', 'date of joining', 'doj', 'joined', 'start date'],
    hint: 'yyyy-mm-dd or dd/mm/yyyy.',
  },
  {
    key: 'timeZone',
    label: 'Time Zone',
    required: false,
    sample: 'Asia/Kolkata',
    aliases: ['time zone', 'timezone', 'tz'],
    hint: 'Blank uses the office default.',
  },
] as const;

export const EMPLOYEE_IMPORT_TEMPLATE_HEADERS = EMPLOYEE_IMPORT_COLUMNS.map((column) => column.label);
export const EMPLOYEE_IMPORT_TEMPLATE_SAMPLE = EMPLOYEE_IMPORT_COLUMNS.map((column) => column.sample);

/**
 * Heading and value comparison key: case, spacing and punctuation insensitive.
 *
 * Self-contained rather than imported from `expenses-import.ts`, which has an identical helper.
 * Office Hub's pure layer deliberately depends on nothing but itself and `access-control.ts`, so
 * that it runs under `node --test` and in the Admin-SDK cron route without dragging in another
 * module's import pipeline. Twelve lines is the right price for that.
 */
export const normalizeToken = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Pasted text or CSV as a grid.
 *
 * Paste is a first-class input: the data is in a sheet the administrator already has open, and
 * selecting rows and pressing Ctrl+V is shorter than Save As. The delimiter is detected per paste
 * because a copy out of Excel is tab-separated while an exported file is commas — and quoted fields
 * are honoured, embedded delimiters and doubled quotes included, because a designation like
 * "Manager, Finance" would otherwise be torn in half.
 */
export function parseEmployeeGrid(text: string): string[][] {
  const body = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '');
  if (!body.trim()) return [];

  const lines = body.split('\n');
  const delimiter = lines.some((line) => line.includes('\t')) ? '\t' : ',';

  return lines.map((line) => {
    const cells: string[] = [];
    let cell = '';
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
        cell = '';
        continue;
      }
      cell += char;
    }
    cells.push(cell.trim());
    return cells;
  });
}

/**
 * Which grid row is the header.
 *
 * Exported registers routinely carry a title, a date and a blank line above the real headings, so
 * the header is found by looking for the row that matches the most known column names rather than
 * assumed to be row 0.
 */
export function detectEmployeeHeaderRow(grid: readonly (readonly string[])[], limit = 12): number {
  let bestRow = 0;
  let bestScore = 0;

  const known = new Set<string>();
  for (const column of EMPLOYEE_IMPORT_COLUMNS) {
    known.add(normalizeToken(column.label));
    for (const alias of column.aliases) known.add(normalizeToken(alias));
  }

  for (let row = 0; row < Math.min(grid.length, limit); row += 1) {
    const score = (grid[row] ?? []).filter((cell) => known.has(normalizeToken(cell))).length;
    if (score > bestScore) {
      bestScore = score;
      bestRow = row;
    }
  }
  return bestScore > 0 ? bestRow : 0;
}

export type EmployeeColumnMap = Partial<Record<EmployeeImportFieldKey, number>>;

/** Heading index per field, so a sheet whose columns are in a different order still imports. */
export function buildEmployeeColumnMap(headings: readonly string[]): EmployeeColumnMap {
  const map: EmployeeColumnMap = {};
  const normalized = headings.map((heading) => normalizeToken(heading));

  for (const column of EMPLOYEE_IMPORT_COLUMNS) {
    const candidates = [column.label, ...column.aliases].map((value) => normalizeToken(value));
    const index = normalized.findIndex((heading) => heading && candidates.includes(heading));
    if (index >= 0) map[column.key] = index;
  }
  return map;
}

/** Headings the mapping did not use, so the preview can say what is being ignored. */
export function unmappedEmployeeHeadings(
  headings: readonly string[],
  columnMap: EmployeeColumnMap,
): string[] {
  const used = new Set(Object.values(columnMap));
  return headings
    .map((heading, index) => ({ heading, index }))
    .filter((entry) => entry.heading.trim() && !used.has(entry.index))
    .map((entry) => entry.heading);
}

/** Required columns the sheet is missing. Import is refused until they are present. */
export function missingRequiredColumns(columnMap: EmployeeColumnMap): string[] {
  return EMPLOYEE_IMPORT_COLUMNS.filter((column) => column.required && columnMap[column.key] == null).map(
    (column) => column.label,
  );
}

/* ── the directory the importer reconciles against ───────────────────────────────────────────── */

export interface ImportDirectoryEntry {
  /** `employees` document id. */
  id: string;
  employeeId: string;
  name: string;
  email?: string | null;
  mobile?: string | null;
  designation?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  location?: string | null;
  reportingManagerId?: string | null;
  reportingManagerName?: string | null;
  status?: string | null;
  joiningDate?: string | null;
}

export interface ImportDirectory {
  employees: readonly ImportDirectoryEntry[];
  departments: readonly { id: string; name: string; status?: string | null }[];
}

export type EmployeeImportOutcome = 'create' | 'update' | 'match' | 'error';

export interface EmployeeImportRow {
  /** 1-based row number as it appears in the user's sheet, for the error report. */
  sheetRow: number;
  outcome: EmployeeImportOutcome;
  /** The values as read, after trimming. */
  raw: Record<EmployeeImportFieldKey, string>;
  employeeId: string;
  name: string;
  email: string;
  mobile: string | null;
  designation: string | null;
  departmentId: string | null;
  departmentName: string | null;
  location: string | null;
  reportingManagerId: string | null;
  reportingManagerName: string | null;
  status: 'Active' | 'Inactive';
  joiningDate: IsoDate | null;
  timeZone: string | null;
  /** The existing record this row matched, when it matched one. */
  existingId: string | null;
  /** Fields an `update` row will change, for the preview's "what will change" column. */
  changes: { field: string; from: string; to: string }[];
  /** Why the row cannot be imported. Empty for every non-error outcome. */
  errors: string[];
  /** Advisory notes that do not block the row. */
  warnings: string[];
}

export interface EmployeeImportPreview {
  headings: string[];
  columnMap: EmployeeColumnMap;
  missingColumns: string[];
  unmappedHeadings: string[];
  rows: EmployeeImportRow[];
  summary: {
    total: number;
    create: number;
    update: number;
    match: number;
    error: number;
  };
  /** True when the sheet cannot be imported at all — a missing required column. */
  blocked: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Parse a date the way spreadsheets actually hand them over.
 *
 * `yyyy-mm-dd`, `dd/mm/yyyy` and `dd-mm-yyyy` all occur in real sheets from this office.
 * Ambiguous `mm/dd/yyyy` is *not* guessed at — a day-first reading is assumed, because that is what
 * the locale uses, and a wrong guess puts a joining date eleven months out with nothing to show it.
 */
export function parseImportDate(raw: string): IsoDate | null | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (isIsoDate(value)) return value;

  const slashed = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(value);
  if (slashed) {
    const day = slashed[1].padStart(2, '0');
    const month = slashed[2].padStart(2, '0');
    const candidate = `${slashed[3]}-${month}-${day}`;
    return isIsoDate(candidate) ? candidate : null;
  }

  const iso = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(value);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    return isIsoDate(candidate) ? candidate : null;
  }

  return null;
}

/** "Active" / "Inactive" / "Y" / "N" / blank → the two statuses the app has. */
export function parseImportStatus(raw: string): 'Active' | 'Inactive' {
  const token = normalizeToken(raw);
  if (!token) return 'Active';
  if (['inactive', 'no', 'n', 'left', 'resigned', 'relieved', 'disabled', '0', 'false'].includes(token)) {
    return 'Inactive';
  }
  return 'Active';
}

/**
 * Validate and classify every row in the sheet.
 *
 * Errors are attached per row, never thrown: §64 asks for row-by-row errors and a downloadable
 * report, which means one bad row must not stop the other 399 from being previewed. A row with an
 * error is simply not committed.
 */
export function buildEmployeeImportPreview(
  grid: readonly (readonly string[])[],
  directory: ImportDirectory,
  options: { defaultTimeZone?: string } = {},
): EmployeeImportPreview {
  if (!grid.length) {
    return {
      headings: [],
      columnMap: {},
      missingColumns: EMPLOYEE_IMPORT_COLUMNS.filter((column) => column.required).map((column) => column.label),
      unmappedHeadings: [],
      rows: [],
      summary: { total: 0, create: 0, update: 0, match: 0, error: 0 },
      blocked: true,
    };
  }

  const headerRow = detectEmployeeHeaderRow(grid);
  const headings = [...(grid[headerRow] ?? [])];
  const columnMap = buildEmployeeColumnMap(headings);
  const missingColumns = missingRequiredColumns(columnMap);

  const byEmployeeId = new Map<string, ImportDirectoryEntry>();
  const byEmail = new Map<string, ImportDirectoryEntry>();
  const byName = new Map<string, ImportDirectoryEntry>();
  for (const entry of directory.employees) {
    if (entry.employeeId) byEmployeeId.set(normalizeToken(entry.employeeId), entry);
    if (entry.email) byEmail.set(entry.email.trim().toLowerCase(), entry);
    if (entry.name) byName.set(normalizeToken(entry.name), entry);
  }

  const departmentsByName = new Map<string, { id: string; name: string; status?: string | null }>();
  for (const department of directory.departments) {
    departmentsByName.set(normalizeToken(department.name), department);
  }

  const seenEmployeeIds = new Map<string, number>();
  const seenEmails = new Map<string, number>();

  const rows: EmployeeImportRow[] = [];

  for (let index = headerRow + 1; index < grid.length; index += 1) {
    const cells = grid[index] ?? [];
    // A blank line in the middle of a pasted selection is a blank line, not a row with no name.
    if (!cells.some((cell) => cell.trim())) continue;

    const read = (key: EmployeeImportFieldKey): string => {
      const position = columnMap[key];
      return position == null ? '' : String(cells[position] ?? '').trim();
    };

    const raw = Object.fromEntries(
      EMPLOYEE_IMPORT_COLUMNS.map((column) => [column.key, read(column.key)]),
    ) as Record<EmployeeImportFieldKey, string>;

    const errors: string[] = [];
    const warnings: string[] = [];

    const employeeId = raw.employeeId;
    const name = raw.name;
    const email = raw.email.toLowerCase();

    if (!employeeId) errors.push('Employee ID is blank.');
    if (!name) errors.push('Name is blank.');
    if (!email) errors.push('Email is blank.');
    else if (!EMAIL_PATTERN.test(email)) errors.push(`"${raw.email}" is not a valid email address.`);

    // Duplicates *within* the sheet, which are the ones the user can still fix before committing.
    if (employeeId) {
      const key = normalizeToken(employeeId);
      const firstSeen = seenEmployeeIds.get(key);
      if (firstSeen) errors.push(`Employee ID ${employeeId} also appears on row ${firstSeen}.`);
      else seenEmployeeIds.set(key, index + 1);
    }
    if (email && EMAIL_PATTERN.test(email)) {
      const firstSeen = seenEmails.get(email);
      if (firstSeen) errors.push(`Email ${email} also appears on row ${firstSeen}.`);
      else seenEmails.set(email, index + 1);
    }

    const department = raw.department ? departmentsByName.get(normalizeToken(raw.department)) : undefined;
    if (raw.department && !department) {
      errors.push(`Department "${raw.department}" does not exist. Create it first, or correct the spelling.`);
    } else if (!raw.department) {
      errors.push('Department is blank.');
    } else if (department?.status && department.status !== 'Active') {
      warnings.push(`Department "${department.name}" is inactive.`);
    }

    const joiningDate = parseImportDate(raw.joiningDate);
    if (joiningDate === null) errors.push(`Joining date "${raw.joiningDate}" is not a date we can read.`);

    let reportingManagerId: string | null = null;
    let reportingManagerName: string | null = raw.reportingManager || null;
    if (raw.reportingManager) {
      const manager =
        byEmployeeId.get(normalizeToken(raw.reportingManager)) ?? byName.get(normalizeToken(raw.reportingManager));
      if (manager) {
        reportingManagerId = manager.id;
        reportingManagerName = manager.name;
      } else {
        // A warning, not an error: the manager may be later in the same sheet, and refusing the row
        // would make the order of a spreadsheet matter.
        warnings.push(`Reporting manager "${raw.reportingManager}" was not found in the directory.`);
      }
    }

    const existing =
      (employeeId ? byEmployeeId.get(normalizeToken(employeeId)) : undefined) ??
      (email ? byEmail.get(email) : undefined) ??
      null;

    if (existing && employeeId && normalizeToken(existing.employeeId) !== normalizeToken(employeeId)) {
      warnings.push(
        `Matched ${existing.name} by email, but their employee ID is ${existing.employeeId}, not ${employeeId}.`,
      );
    }

    const status = parseImportStatus(raw.status);
    const resolved = {
      employeeId,
      name,
      email,
      mobile: raw.mobile || null,
      designation: raw.designation || null,
      departmentId: department?.id ?? null,
      departmentName: department?.name ?? null,
      location: raw.location || null,
      reportingManagerId,
      reportingManagerName,
      status,
      joiningDate: joiningDate ?? null,
      timeZone: raw.timeZone || options.defaultTimeZone || null,
    };

    const changes: { field: string; from: string; to: string }[] = [];
    if (existing) {
      const compare = (field: string, from: unknown, to: unknown) => {
        const before = String(from ?? '').trim();
        const after = String(to ?? '').trim();
        // Blank in the sheet means "no opinion", not "clear the existing value" — an importer that
        // empties fields because a column was left blank destroys data on every partial upload.
        if (!after || normalizeToken(before) === normalizeToken(after)) return;
        changes.push({ field, from: before || '—', to: after });
      };
      compare('Name', existing.name, resolved.name);
      compare('Email', existing.email, resolved.email);
      compare('Mobile', existing.mobile, resolved.mobile);
      compare('Designation', existing.designation, resolved.designation);
      compare('Department', existing.departmentName, resolved.departmentName);
      compare('Location', existing.location, resolved.location);
      compare('Reporting Manager', existing.reportingManagerName, resolved.reportingManagerName);
      compare('Status', existing.status, resolved.status);
      compare('Joining Date', existing.joiningDate, resolved.joiningDate);
    }

    const outcome: EmployeeImportOutcome = errors.length
      ? 'error'
      : existing
        ? changes.length
          ? 'update'
          : 'match'
        : 'create';

    rows.push({
      sheetRow: index + 1,
      outcome,
      raw,
      ...resolved,
      existingId: existing?.id ?? null,
      changes,
      errors,
      warnings,
    });
  }

  const summary = {
    total: rows.length,
    create: rows.filter((row) => row.outcome === 'create').length,
    update: rows.filter((row) => row.outcome === 'update').length,
    match: rows.filter((row) => row.outcome === 'match').length,
    error: rows.filter((row) => row.outcome === 'error').length,
  };

  return {
    headings,
    columnMap,
    missingColumns,
    unmappedHeadings: unmappedEmployeeHeadings(headings, columnMap),
    rows,
    summary,
    blocked: missingColumns.length > 0,
  };
}

/** The rows a commit will actually write. */
export const committableRows = (preview: EmployeeImportPreview): EmployeeImportRow[] =>
  preview.blocked ? [] : preview.rows.filter((row) => row.outcome === 'create' || row.outcome === 'update');

/**
 * The downloadable error report (§64).
 *
 * Carries the original row number and the original values alongside the problem, so the user can
 * open their own sheet next to it and fix the rows in place. A report that only lists messages
 * leaves them hunting.
 */
export function buildImportErrorReport(preview: EmployeeImportPreview): {
  headers: string[];
  rows: (string | number)[][];
} {
  const headers = ['Sheet Row', 'Employee ID', 'Name', 'Email', 'Department', 'Problem'];
  const rows: (string | number)[][] = [];

  for (const row of preview.rows) {
    if (!row.errors.length && !row.warnings.length) continue;
    for (const message of [...row.errors, ...row.warnings.map((warning) => `Warning: ${warning}`)]) {
      rows.push([
        row.sheetRow,
        row.raw.employeeId || '—',
        row.raw.name || '—',
        row.raw.email || '—',
        row.raw.department || '—',
        message,
      ]);
    }
  }

  return { headers, rows };
}

/** The report as CSV text, for a client-side download with no server round trip. */
export function errorReportToCsv(report: { headers: string[]; rows: (string | number)[][] }): string {
  const escape = (value: string | number): string => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [report.headers, ...report.rows].map((row) => row.map(escape).join(',')).join('\r\n');
}

/** The blank template, for the "download template" button. */
export function buildEmployeeImportTemplate(): string {
  return [EMPLOYEE_IMPORT_TEMPLATE_HEADERS, EMPLOYEE_IMPORT_TEMPLATE_SAMPLE]
    .map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
    .join('\r\n');
}

/** One sentence per column, for the instructions panel above the paste box. */
export const employeeImportInstructions = (): string[] =>
  EMPLOYEE_IMPORT_COLUMNS.map(
    (column) =>
      `${column.label}${column.required ? ' (required)' : ''} — ${column.hint ?? `e.g. ${column.sample}`}`,
  );
