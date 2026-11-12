/**
 * Importing a project's own MDL workbook — the sheets the team already keeps, each with its own
 * layout: a title or two, then a header row such as
 *   SL NO | Description | Planning Date | Proposed Approval date | Drg/Doc No | R0_submission |
 *   comments date | R1_submission | comments date | … | Approval date | Approval Status
 * (spellings vary: "R0-SUBMISSION", "R0 SUBMISSION", "R0-COMMENT", "APPROVE DATE", "STATUS").
 *
 * `detectSheet` reads each sheet's header and guesses what every column is; the Import page shows
 * that guess for the user to correct, and `parseProjectWorkbook` reads the rows with the corrected
 * mapping into the same records the consolidated import produces (`ParsedImport`).
 *
 * Rows with a description but no Sl. No. (or a letter, "A") and no dates are group headings
 * ("SUB-STATION", "EQUIPMENT"), and the rows under them belong to that group. Dates may be Excel
 * dates or text as DD.MM.YYYY / DD-MM-YYYY / DD/MM/YYYY; anything else, or a year outside
 * 2000–2099 (a typed "0026"), is left blank and listed for correction.
 */

import { isIsoDate } from './derive.ts';
import { cellText, type ImportLists, type ParsedImport, type ParsedItem } from './import.ts';
import { SCHEDULES, SCOPES, type MdlItemCore, type MdlRevision, type MdlSchedule, type MdlScope } from './types.ts';

/* ── the raw sheets ──────────────────────────────────────────────────────── */

export interface RawSheet {
  name: string;
  /** Non-empty rows; `cells[0]` is column A. */
  rows: { n: number; cells: (string | null)[] }[];
}

interface WorksheetLike {
  name: string;
  eachRow: (options: { includeEmpty: boolean }, callback: (row: { cellCount: number; getCell: (col: number) => { value: unknown } }, n: number) => void) => void;
}

/** Every worksheet as text cells (dates as 'YYYY-MM-DD'), at most `maxRows` rows each. */
export function rawSheetsFromWorkbook(workbook: { worksheets: WorksheetLike[] }, maxRows = 5000): RawSheet[] {
  return workbook.worksheets.map((ws) => {
    const rows: RawSheet['rows'] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (rows.length >= maxRows) return;
      const cells: (string | null)[] = [];
      for (let col = 1; col <= Math.min(row.cellCount, 60); col += 1) cells.push(cellText(row.getCell(col).value));
      if (cells.some(Boolean)) rows.push({ n, cells });
    });
    return { name: ws.name, rows };
  });
}

/* ── what each column is ─────────────────────────────────────────────────── */

export type ColumnRole =
  | 'ignore'
  | 'slNo'
  | 'description'
  | 'drgNo'
  | 'plannedStart'
  | 'plannedEnd'
  | 'approval'
  | 'status'
  | 'remarks'
  | `sub:${number}`
  | `com:${number}`;

export const MAX_IMPORT_ROUND = 9;

export const ROLE_LABEL = (role: ColumnRole): string => {
  if (role.startsWith('sub:')) return `R${role.slice(4)} submitted`;
  if (role.startsWith('com:')) return `R${role.slice(4)} comments date`;
  return {
    ignore: 'Ignore',
    slNo: 'Sl. No.',
    description: 'Description',
    drgNo: 'Drawing / Doc No.',
    plannedStart: 'Planned (submission) date',
    plannedEnd: 'Proposed approval date',
    approval: 'Approval date',
    status: 'Status',
    remarks: 'Remarks',
  }[role as 'ignore'];
};

/** Every role a column can take, for the mapping picker. */
export const COLUMN_ROLES: ColumnRole[] = [
  'ignore',
  'slNo',
  'description',
  'drgNo',
  'plannedStart',
  'plannedEnd',
  ...Array.from({ length: MAX_IMPORT_ROUND + 1 }, (_, n) => [`sub:${n}` as const, `com:${n}` as const]).flat(),
  'approval',
  'status',
  'remarks',
];

export interface SheetMapping {
  sheet: string;
  include: boolean;
  /** The worksheet row holding the column headings. */
  headerRow: number;
  schedule: MdlSchedule;
  scope: MdlScope;
  /** One role per column, `columns[0]` for column A. */
  columns: ColumnRole[];
  /** Worksheet rows to leave out (Skip on the validation table). */
  skipRows?: number[];
}

const norm = (value: string | null | undefined) => (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function roleOf(heading: string, lastSubRound: number | null, takenComments: Set<number>): ColumnRole {
  const h = norm(heading);
  if (!h) return 'ignore';
  const round = /^r\s*(\d+)\b/.exec(h);
  if (round) {
    const n = Number(round[1]);
    if (n <= MAX_IMPORT_ROUND && /comm/.test(h)) return `com:${n}`;
    if (n <= MAX_IMPORT_ROUND && /sub/.test(h)) return `sub:${n}`;
  }
  if (/^comm/.test(h) && lastSubRound !== null && !takenComments.has(lastSubRound)) return `com:${lastSubRound}`;
  if (/^(sl|s) ?no\b|^serial/.test(h)) return 'slNo';
  if (/desc/.test(h)) return 'description';
  if (/(drg|doc|drawing)( doc)? no\b|^drg\b/.test(h)) return 'drgNo';
  if (/propos|target/.test(h)) return 'plannedEnd';
  if (/^plann/.test(h)) return 'plannedStart';
  if (/approv\w* date|date of approv/.test(h)) return 'approval';
  if (/status/.test(h)) return 'status';
  if (/remark/.test(h)) return 'remarks';
  return 'ignore';
}

/** The row that holds the headings: the first within the top 15 with a description and a serial column. */
function findHeaderRow(sheet: RawSheet): number | null {
  for (const row of sheet.rows.slice(0, 15)) {
    const texts = row.cells.map(norm);
    if (texts.some((t) => /desc/.test(t)) && texts.some((t) => /^(sl|s) ?no\b|^serial/.test(t))) return row.n;
  }
  for (const row of sheet.rows.slice(0, 15)) if (row.cells.map(norm).some((t) => /desc/.test(t))) return row.n;
  return null;
}

/** Roles for a header row, worked out left to right ("comments date" belongs to the submission before it). */
export function rolesForHeader(cells: (string | null)[]): ColumnRole[] {
  let lastSubRound: number | null = null;
  const takenComments = new Set<number>();
  const used = new Set<ColumnRole>();
  return cells.map((cell) => {
    let role = roleOf(cell ?? '', lastSubRound, takenComments);
    // One column per single role; a second "Remarks" or "Status" is left out.
    if (role !== 'ignore' && used.has(role)) role = 'ignore';
    if (role.startsWith('sub:')) lastSubRound = Number(role.slice(4));
    if (role.startsWith('com:')) takenComments.add(Number(role.slice(4)));
    if (role !== 'ignore') used.add(role);
    return role;
  });
}

/** A guess at one sheet's layout: header row, schedule and scope, and each column's role. */
/** The first configured name found in the texts, in the order given (sheet name before titles). */
const GENERIC_WORDS = new Set(['schedule', 'works', 'work', 'drawing', 'drawings', 'list', 'master', 'and', 'the', 'ii', 'iii', 'iv', 'vi']);

function pick(names: readonly string[], ...texts: string[]): string | null {
  // The distinctive words of each name ("Schedule III Civil Works" → civil), compared by their first
  // five letters so "Elec" sheets find "Electrical".
  const keys = names.map((name) => ({ name, words: norm(name).split(' ').filter((word) => word.length > 2 && !GENERIC_WORDS.has(word)) }));
  for (const text of texts) {
    for (const { name, words } of keys) if (words.length && words.every((word) => text.includes(word))) return name;
    for (const { name, words } of keys) if (words.some((word) => text.includes(word.slice(0, Math.min(5, word.length))))) return name;
  }
  return null;
}

export function detectSheet(sheet: RawSheet, fileName: string, lists: ImportLists = { schedules: SCHEDULES, scopes: SCOPES }): SheetMapping {
  const headerRow = findHeaderRow(sheet);
  const header = sheet.rows.find((row) => row.n === headerRow)?.cells ?? [];
  const columns = rolesForHeader(header);
  const titles = [sheet.name, ...sheet.rows.filter((row) => headerRow === null || row.n < headerRow).flatMap((row) => row.cells)].map(norm).join(' ');
  const nameText = norm(sheet.name);
  const schedule: MdlSchedule = pick(lists.schedules, nameText, titles) ?? lists.schedules[0] ?? 'Supply';
  const scopeText = `${titles} ${norm(fileName)}`;
  // "TL" is how the sheets abbreviate Transmission Line.
  const tl = /\btl\b/.test(scopeText) ? lists.scopes.find((name) => /transmission/i.test(name)) : undefined;
  const scope: MdlScope = pick(lists.scopes, scopeText) ?? tl ?? lists.scopes[0] ?? 'Substation';
  // Ticked to start with only when it looks like a schedule's drawing list; scratch sheets ("Sheet1",
  // "SUMMARY", "PENDING LIST") start unticked, and the user can tick any sheet.
  const looksLikeSchedule = /supply|civil|elec|schedule|mdl|drawing/.test(nameText);
  return { sheet: sheet.name, include: headerRow !== null && columns.includes('description') && looksLikeSchedule, headerRow: headerRow ?? 1, schedule, scope, columns };
}

/* ── reading the rows ────────────────────────────────────────────────────── */

/** 'YYYY-MM-DD' from an Excel date or DD.MM.YYYY-style text; null with a reason when it is not one. */
export function looseDate(raw: string | null): { date: string | null; problem: string | null } {
  if (!raw) return { date: null, problem: null };
  const text = raw.trim();
  // Placeholders the sheets use on purpose ("AS REQ", "NA", "-", "TBA"): blank, not a mistake.
  if (/^(as ?req(uired)?\.?|n\.?\s?a\.?|not applicable|-+|tba|tbd|nil)$/i.test(text)) return { date: null, problem: null };
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) iso = text;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(text);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3].padStart(4, '0');
    iso = `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  if (!iso || !isIsoDate(iso)) return { date: null, problem: `"${text}" is not a date` };
  const year = Number(iso.slice(0, 4));
  if (year < 2000 || year > 2099) return { date: null, problem: `"${text}" has the year ${year}` };
  return { date: iso, problem: null };
}

/** A short stable id from text (FNV-1a), so a re-import finds the same items again. */
function stableId(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

const isSerial = (value: string | null) => Boolean(value && /^\d+(\.\d+)*[a-z]?$/i.test(value.trim()));

export interface WorkbookSheetSummary {
  sheet: string;
  items: number;
  groups: number;
  revisions: number;
  /** Where the sheet switched schedule or scope part-way down. */
  sections: string[];
}

/** One worksheet row as the import reads it — the validation table's row. */
export interface ImportRowResult {
  sheet: string;
  n: number;
  kind: 'item' | 'group' | 'section' | 'skipped';
  slNo: string | null;
  description: string | null;
  schedule: string;
  scope: string;
  group: string | null;
  /** What was left blank or looks wrong, and the columns (0 = A) it is about. */
  issues: { text: string; cols: number[] }[];
  itemId?: string;
}

/**
 * The rows of the included sheets as register items of `projectCode`. Item ids come from the
 * drawing list, sheet, Sl. No. and description, so importing the same workbook again skips what is
 * already there.
 */
export function parseProjectWorkbook(
  sheets: RawSheet[],
  mappings: SheetMapping[],
  projectCode: string,
  fileName: string,
  lists: ImportLists = { schedules: SCHEDULES, scopes: SCOPES },
): ParsedImport & { sheets: WorkbookSheetSummary[]; rows: ImportRowResult[] } {
  const problems: string[] = [];
  const rowResults: ImportRowResult[] = [];
  const items: ParsedItem[] = [];
  const ids = new Set<string>();
  const summaries: WorkbookSheetSummary[] = [];
  let order = 0;
  let revisionCount = 0;

  for (const mapping of mappings) {
    if (!mapping.include) continue;
    const sheet = sheets.find((entry) => entry.name === mapping.sheet);
    if (!sheet) {
      problems.push(`Sheet "${mapping.sheet}" is not in the workbook.`);
      continue;
    }
    if (!lists.schedules.includes(mapping.schedule) || !lists.scopes.includes(mapping.scope)) {
      problems.push(`Sheet "${mapping.sheet}": choose its schedule and scope.`);
      continue;
    }
    const col = (role: ColumnRole) => mapping.columns.indexOf(role);
    const descCol = col('description');
    if (descCol < 0) {
      problems.push(`Sheet "${mapping.sheet}": no column is marked Description; sheet skipped.`);
      continue;
    }
    const rounds = mapping.columns
      .flatMap((role, index) => (role.startsWith('sub:') ? [{ n: Number(role.slice(4)), sub: index, com: mapping.columns.indexOf(`com:${role.slice(4)}` as ColumnRole) }] : []))
      .sort((a, b) => a.n - b.n);
    const dateCols = mapping.columns.flatMap((role, index) => (role.startsWith('sub:') || role.startsWith('com:') || role === 'approval' || role === 'plannedStart' || role === 'plannedEnd' ? [index] : []));
    const summary: WorkbookSheetSummary = { sheet: mapping.sheet, items: 0, groups: 0, revisions: 0, sections: [] };
    let group: string | null = null;
    // A sheet can change schedule or scope part-way down ("Electrical Works_Substation").
    let schedule = mapping.schedule;
    let scope = mapping.scope;
    const skip = new Set(mapping.skipRows ?? []);
    const base = (row: RawSheet['rows'][number], kind: ImportRowResult['kind'], slNo: string | null, description: string | null): ImportRowResult => ({ sheet: mapping.sheet, n: row.n, kind, slNo, description, schedule, scope, group, issues: [] });

    for (const row of sheet.rows) {
      if (row.n <= mapping.headerRow) continue;
      const cell = (index: number) => (index >= 0 ? (row.cells[index] ?? null) : null);
      if (skip.has(row.n)) {
        rowResults.push(base(row, 'skipped', cell(col('slNo')), cell(descCol)));
        continue;
      }
      // A heading merged across the row (Excel repeats it in every merged cell): a new section when
      // it names a schedule or scope, else a group heading.
      const filled = row.cells.filter((value): value is string => Boolean(value));
      if (filled.length >= 2 && filled.every((value) => value === filled[0]) && !looseDate(filled[0]).date) {
        const text = norm(filled[0]);
        const nextSchedule = pick(lists.schedules, text);
        const nextScope = pick(lists.scopes, text);
        if (nextSchedule || nextScope) {
          schedule = nextSchedule ?? schedule;
          scope = nextScope ?? scope;
          group = null;
          summary.sections.push(`${schedule} › ${scope} from row ${row.n}`);
          rowResults.push(base(row, 'section', null, filled[0]));
        } else {
          group = filled[0];
          summary.groups += 1;
          rowResults.push(base(row, 'group', null, filled[0]));
        }
        continue;
      }
      const description = cell(descCol);
      if (!description) continue;
      const slNo = cell(col('slNo'));
      const hasDates = dateCols.some((index) => Boolean(cell(index)));
      if (!hasDates && !isSerial(slNo)) {
        group = description;
        summary.groups += 1;
        rowResults.push(base(row, 'group', slNo, description));
        continue;
      }
      const where = `${mapping.sheet} row ${row.n}`;
      const issues: string[] = [];
      const flagged: ImportRowResult['issues'] = [];
      const flag = (text: string, cols: number[]) => {
        issues.push(text);
        flagged.push({ text, cols: cols.filter((c) => c >= 0) });
      };
      const date = (index: number, label: string) => {
        const read = looseDate(cell(index));
        if (read.problem) flag(`${label}: ${read.problem}; left blank.`, [index]);
        return read.date;
      };
      const revisions: MdlRevision[] = [];
      for (const round of rounds) {
        const submittedOn = date(round.sub, `R${round.n} submission`);
        const commentedOn = round.com >= 0 ? date(round.com, `R${round.n} comments`) : null;
        if (submittedOn || commentedOn) revisions.push({ rev: round.n, submittedOn, commentedOn, transmittalNo: null });
        if (submittedOn && commentedOn && commentedOn < submittedOn) flag(`R${round.n}: comments date is before the submission.`, [round.sub, round.com]);
        if (commentedOn && !submittedOn) flag(`R${round.n}: comments date without a submission date.`, [round.sub, round.com]);
      }
      const approvedOn = date(col('approval'), 'Approval date');
      const status = cell(col('status'));
      const firstSent = revisions.find((r) => r.submittedOn)?.submittedOn;
      if (approvedOn && firstSent && approvedOn < firstSent) flag('Approval date is before the first submission.', [col('approval')]);
      const statusText = (status ?? '').toUpperCase();
      const core: MdlItemCore = {
        projectCode,
        schedule,
        scope,
        group,
        order: (order += 1),
        slNo: slNo ?? '',
        description,
        drgNo: cell(col('drgNo')),
        plannedSubmission: date(col('plannedStart'), 'Planning date'),
        targetApproval: date(col('plannedEnd'), 'Proposed approval date'),
        vendorFinalised: !/VENDOR NOT FINALI[SZ]ED/.test(statusText),
        onHold: false,
        revisions,
        approved: Boolean(approvedOn) || (/APPROVED/.test(statusText) && !/NOT APPROVED/.test(statusText)),
        approvedOn,
        remarks: cell(col('remarks')),
        legacy: { status, source: `${fileName} › ${mapping.sheet} › row ${row.n}`, issues },
      };
      let id = `${projectCode}-${stableId(`${mapping.sheet}|${slNo ?? ''}|${description}`)}`;
      if (ids.has(id)) id = `${id}-${row.n}`;
      ids.add(id);
      items.push({ id, core, expected: null });
      rowResults.push({ ...base(row, 'item', slNo, description), issues: flagged, itemId: id });
      issues.forEach((issue) => problems.push(`${where}: ${issue}`));
      summary.items += 1;
      summary.revisions += revisions.length;
      revisionCount += revisions.length;
    }
    summaries.push(summary);
  }
  return { projects: [], items, revisionCount, problems, sheets: summaries, rows: rowResults };
}

/* ── saved column mappings ───────────────────────────────────────────────── */

/**
 * A sheet layout someone confirmed on the Import page, kept so the next workbook with the same
 * headings is read the same way without mapping it again.
 */
export interface MappingTemplate {
  id: string;
  /** The header row's headings, normalised — what a sheet must match to use the template. */
  signature: string;
  headerRow: number;
  schedule: string;
  scope: string;
  columns: ColumnRole[];
  /** The drawing list it was saved for; one saved for the same list wins over one saved for another. */
  projectCode: string | null;
  sheetName: string;
  fileName: string;
  savedAt: string;
  savedByName: string;
}

/** A header row's headings, normalised and joined, trailing blanks dropped. */
export function headerSignature(sheet: RawSheet, headerRow: number): string {
  const cells = (sheet.rows.find((row) => row.n === headerRow)?.cells ?? []).map((cell) => norm(cell));
  while (cells.length && !cells[cells.length - 1]) cells.pop();
  return cells.join('|');
}

/**
 * The detected mappings with saved templates applied: a sheet whose row at a template's header row
 * has the template's headings takes its layout (schedule, scope, columns). Returns which template
 * each sheet took, if any.
 */
export function applyTemplates(sheets: RawSheet[], mappings: SheetMapping[], templates: MappingTemplate[], projectCode: string | null): { mappings: SheetMapping[]; applied: (MappingTemplate | null)[] } {
  const ranked = [...templates].sort((a, b) => Number(b.projectCode === projectCode) - Number(a.projectCode === projectCode) || b.savedAt.localeCompare(a.savedAt));
  const applied: (MappingTemplate | null)[] = [];
  const next = mappings.map((mapping, index) => {
    const sheet = sheets[index];
    const template = sheet ? ranked.find((entry) => entry.signature && headerSignature(sheet, entry.headerRow) === entry.signature) : undefined;
    applied.push(template ?? null);
    if (!template) return mapping;
    return { ...mapping, include: true, headerRow: template.headerRow, schedule: template.schedule, scope: template.scope, columns: [...template.columns] };
  });
  return { mappings: next, applied };
}
