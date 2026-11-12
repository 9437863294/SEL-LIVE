/**
 * Reading the consolidated Master Drawing List workbook — the reference importer's rules, shared by
 * the Excel Import page (browser reads the file, server re-parses and writes) and the command-line
 * tool (`tools/mdl-import/import.ts`), so both give the same counts and the same problems.
 *
 * The workbook has three sheets:
 *   Projects  — Code, Short name, Full name, Client, Drawing no. prefix
 *   Items     — one row per drawing item (see ITEM_COLUMNS)
 *   Revisions — Item ID, Revision (R0, R1 …), Submitted on, Comments received on
 * Dates may be real Excel dates or text typed as DD.MM.YYYY.
 *
 * Cells travel as a plain grid of text (`ImportGrid`): no exceljs objects, so it can be sent to the
 * API as JSON and parsed in `node --test`. `gridFromWorkbook` builds it from an exceljs workbook,
 * written against the shape of exceljs values rather than importing exceljs.
 */

import type { Firestore } from 'firebase-admin/firestore';

import { derive, isIsoDate } from './derive.ts';
import { OVERALL_STATUSES, REVISION_ROUNDS, earliestSubmissionDate, type DrawingItem, type DrawingRevision, type OverallStatus, type RevisionStatus } from './drawings.ts';
import { COLLECTIONS, SCHEDULES, SCOPES, STATUSES, STATUS_LABEL, type MdlItemCore, type MdlProject, type MdlRevision, type MdlSchedule, type MdlScope, type MdlStatus } from './types.ts';

/* ── the grid ────────────────────────────────────────────────────────────── */

export type GridCell = string | null;

export interface GridRow {
  /** The worksheet row number, for messages ("Items row 12"). */
  n: number;
  cells: Record<string, GridCell>;
}

export interface GridSheet {
  headings: string[];
  rows: GridRow[];
}

/** Sheet name → its headings (row 1) and rows. */
export type ImportGrid = Record<string, GridSheet>;

export const SHEETS = ['Projects', 'Items', 'Revisions'] as const;

export const PROJECT_COLUMNS = ['Code', 'Short name', 'Full name', 'Client', 'Drawing no. prefix'];
export const REVISION_COLUMNS = ['Item ID', 'Revision', 'Submitted on', 'Comments received on'];
export const ITEM_COLUMNS = [
  'Item ID', 'Project', 'Schedule', 'Scope', 'Group', 'Sl. No. (as in workbook)', 'Description', 'Drg / Doc No.',
  'Planning date', 'Proposed approval date', 'Approved on', 'Status in workbook', 'Status (derived from dates)',
  'Remarks', 'Entries to correct', 'Source',
];

/** An exceljs cell value to trimmed text, or null when empty (the reference importer's `text`). */
export function cellText(value: unknown): GridCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as { richText?: { text: string }[]; text?: unknown; result?: unknown };
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('').trim() || null;
    if ('text' in v) return String(v.text).trim() || null;
    if ('result' in v) return cellText(v.result);
    return null;
  }
  return String(value).trim() || null;
}

interface WorksheetLike {
  getRow: (n: number) => { eachCell: (callback: (cell: { value: unknown }, col: number) => void) => void };
  eachRow: (callback: (row: { getCell: (col: number) => { value: unknown } }, n: number) => void) => void;
}
interface WorkbookLike {
  getWorksheet: (name: string) => WorksheetLike | undefined;
}

/** The three sheets of an exceljs workbook as a grid. A missing sheet is left out (the parser says so). */
export function gridFromWorkbook(workbook: WorkbookLike): ImportGrid {
  const grid: ImportGrid = {};
  for (const name of SHEETS) {
    const ws = workbook.getWorksheet(name);
    if (!ws) continue;
    const columns = new Map<number, string>();
    ws.getRow(1).eachCell((cell, col) => {
      const heading = cellText(cell.value);
      if (heading) columns.set(col, heading);
    });
    const rows: GridRow[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const cells: Record<string, GridCell> = {};
      for (const [col, heading] of columns) cells[heading] = cellText(row.getCell(col).value);
      rows.push({ n, cells });
    });
    grid[name] = { headings: [...columns.values()], rows };
  }
  return grid;
}

/* ── parsing ─────────────────────────────────────────────────────────────── */

export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFormatError';
  }
}

function sheet(grid: ImportGrid, name: string, required: string[]) {
  const ws = grid[name];
  if (!ws) throw new ImportFormatError(`Sheet "${name}" is missing from the workbook.`);
  for (const heading of required) {
    if (!ws.headings.includes(heading)) throw new ImportFormatError(`Sheet "${name}" has no column "${heading}".`);
  }
  return ws.rows.map((row) => ({ n: row.n, get: (heading: string): GridCell => row.cells[heading] ?? null }));
}

export interface ParsedItem {
  id: string;
  core: MdlItemCore;
  /** The workbook's own "Status (derived from dates)", to compare with the ERP rule. */
  expected: string | null;
}

export interface ParsedImport {
  projects: MdlProject[];
  items: ParsedItem[];
  /** Every revision row read, including those of items that were not imported. */
  revisionCount: number;
  problems: string[];
}

/** The reference importer's reading of the three sheets: what it would write, and what it had to skip. */
export function parseImport(grid: ImportGrid): ParsedImport {
  const problems: string[] = [];

  /** 'YYYY-MM-DD' from a date cell or DD.MM.YYYY text. */
  const date = (raw: GridCell, where: string): string | null => {
    if (!raw) return null;
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
    const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : raw;
    if (isIsoDate(iso)) return iso;
    problems.push(`${where}: "${raw}" is not a date; left blank.`);
    return null;
  };
  // Firestore document ids cannot contain a slash.
  const usableId = (id: string) => !id.includes('/');

  // Projects
  const projects: MdlProject[] = [];
  const shortToCode = new Map<string, string>();
  for (const r of sheet(grid, 'Projects', PROJECT_COLUMNS)) {
    const code = r.get('Code');
    const short = r.get('Short name');
    if (!code || !short) continue;
    if (!usableId(code)) {
      problems.push(`Projects row ${r.n}: code "${code}" contains "/"; row skipped.`);
      continue;
    }
    projects.push({ code, short, name: r.get('Full name') ?? short, client: r.get('Client'), drgPrefix: r.get('Drawing no. prefix') });
    shortToCode.set(short, code);
  }

  // Revisions, grouped by item
  const revisions = new Map<string, MdlRevision[]>();
  let revisionCount = 0;
  for (const r of sheet(grid, 'Revisions', REVISION_COLUMNS)) {
    const id = r.get('Item ID');
    const revText = r.get('Revision');
    const m = revText ? /^R(\d+)$/.exec(revText) : null;
    if (!id || !m) {
      problems.push(`Revisions row ${r.n}: needs an Item ID and a revision such as R0; row skipped.`);
      continue;
    }
    const where = `Revisions row ${r.n} (${id} ${revText})`;
    const list = revisions.get(id) ?? [];
    list.push({ rev: Number(m[1]), submittedOn: date(r.get('Submitted on'), where), commentedOn: date(r.get('Comments received on'), where), transmittalNo: null });
    revisions.set(id, list);
    revisionCount += 1;
  }

  // Items
  const items: ParsedItem[] = [];
  const seen = new Set<string>();
  const nextOrder = new Map<string, number>();
  for (const r of sheet(grid, 'Items', ITEM_COLUMNS)) {
    const id = r.get('Item ID');
    if (!id) continue;
    const where = `Items row ${r.n} (${id})`;
    const projectCode = shortToCode.get(r.get('Project') ?? '');
    const schedule = r.get('Schedule') as MdlSchedule;
    const scope = r.get('Scope') as MdlScope;
    const description = r.get('Description');
    if (seen.has(id)) { problems.push(`${where}: duplicate Item ID; row skipped.`); continue; }
    if (!usableId(id)) { problems.push(`${where}: the Item ID contains "/"; row skipped.`); continue; }
    if (!projectCode) { problems.push(`${where}: project is not on the Projects sheet; row skipped.`); continue; }
    if (!SCHEDULES.includes(schedule) || !SCOPES.includes(scope) || !description) {
      problems.push(`${where}: schedule, scope or description is missing or not recognised; row skipped.`);
      continue;
    }
    seen.add(id);
    const order = (nextOrder.get(projectCode) ?? 0) + 1;
    nextOrder.set(projectCode, order);
    const legacyStatus = r.get('Status in workbook');
    const approvedOn = date(r.get('Approved on'), where);
    const toCorrect = r.get('Entries to correct');
    items.push({
      id,
      expected: r.get('Status (derived from dates)'),
      core: {
        projectCode,
        schedule,
        scope,
        group: r.get('Group'),
        order,
        slNo: r.get('Sl. No. (as in workbook)') ?? '',
        description,
        drgNo: r.get('Drg / Doc No.'),
        plannedSubmission: date(r.get('Planning date'), where),
        targetApproval: date(r.get('Proposed approval date'), where),
        vendorFinalised: legacyStatus?.toUpperCase() !== 'VENDOR NOT FINALISED',
        onHold: false,
        revisions: (revisions.get(id) ?? []).sort((a, b) => a.rev - b.rev),
        approved: legacyStatus?.toUpperCase() === 'APPROVED' || approvedOn !== null,
        approvedOn,
        remarks: r.get('Remarks'),
        legacy: {
          status: legacyStatus,
          source: r.get('Source') ?? '',
          issues: toCorrect ? toCorrect.split(';').map((s) => s.trim()).filter(Boolean) : [],
        },
      },
    });
  }
  for (const id of revisions.keys()) {
    if (!seen.has(id)) problems.push(`Revisions sheet: ${id} is not on the Items sheet; its revisions were ignored.`);
  }
  return { projects, items, revisionCount, problems };
}

/* ── summary ─────────────────────────────────────────────────────────────── */

export interface ImportSummary {
  projects: { code: string; short: string; name: string; items: number; counts: Record<MdlStatus, number> }[];
  itemCount: number;
  revisionCount: number;
  /** Status from the dates (the workbook's own classification): Approved, Under review, Comments received… */
  totals: Record<MdlStatus, number>;
  /** The overall status each item gets in the register (Pending, In Progress, Approved…). */
  overall: Record<OverallStatus, number>;
  /** Items whose ERP status differs from the workbook's "Status (derived from dates)". */
  differs: string[];
  problems: string[];
}

const zeroCounts = () => Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<MdlStatus, number>;

export function summariseImport(parsed: ParsedImport): ImportSummary {
  const totals = zeroCounts();
  const overall = Object.fromEntries(OVERALL_STATUSES.map((status) => [status, 0])) as Record<OverallStatus, number>;
  const byProject = new Map(parsed.projects.map((p) => [p.code, { code: p.code, short: p.short, name: p.name, items: 0, counts: zeroCounts() }]));
  const differs: string[] = [];
  for (const item of parsed.items) {
    const status = derive(item.core).status;
    totals[status] += 1;
    overall[toDrawingItem(item.core).status] += 1;
    const project = byProject.get(item.core.projectCode);
    if (project) {
      project.items += 1;
      project.counts[status] += 1;
    }
    const label = STATUS_LABEL[status];
    if (item.expected && item.expected.toLowerCase() !== label.toLowerCase()) {
      differs.push(`${item.id}: workbook says "${item.expected}", the ERP rule gives "${label}"`);
    }
  }
  return {
    projects: [...byProject.values()],
    itemCount: parsed.items.length,
    revisionCount: parsed.revisionCount,
    totals,
    overall,
    differs,
    problems: parsed.problems,
  };
}

/** The dry-run report as text — what the command-line tool prints. */
export function summaryLines(summary: ImportSummary): string[] {
  const lines = [`Read ${summary.projects.length} projects, ${summary.itemCount} items, ${summary.revisionCount} revisions.`];
  for (const project of [...summary.projects].sort((a, b) => a.code.localeCompare(b.code))) {
    for (const status of STATUSES) {
      if (project.counts[status]) lines.push(`  ${project.code} | ${STATUS_LABEL[status]}: ${project.counts[status]}`);
    }
  }
  lines.push('Totals (status from dates):');
  for (const status of STATUSES) lines.push(`  ${STATUS_LABEL[status]}: ${summary.totals[status]}`);
  lines.push('Overall status in the register:');
  for (const status of OVERALL_STATUSES) lines.push(`  ${status}: ${summary.overall[status]}`);
  if (summary.differs.length) {
    lines.push('', `${summary.differs.length} items get a different status from the ERP rule than the workbook column shows:`);
    summary.differs.forEach((line) => lines.push(`  ${line}`));
  }
  if (summary.problems.length) {
    lines.push('', `${summary.problems.length} problems while reading:`);
    summary.problems.forEach((line) => lines.push(`  ${line}`));
  }
  return lines;
}

/* ── the register's record ───────────────────────────────────────────────── */

/**
 * A workbook row as the register stores it. The workbook has dates only, so each round's status is
 * read from them: a round followed by another was kicked back (Resubmission Required); the last
 * round is Approved when the item is, Resubmission Required when the client's comments came back,
 * else Under Review. Overall: Approved, In Progress once anything was submitted, else Pending.
 * Planning date → planned start, proposed approval date → planned end.
 */
export function toDrawingItem(core: MdlItemCore): Omit<DrawingItem, 'id' | 'updatedAt' | 'updatedBy'> {
  const sent = [...core.revisions].filter((r) => r.rev < REVISION_ROUNDS.length).sort((a, b) => a.rev - b.rev);
  const revisions: DrawingRevision[] = sent.map((r, index) => {
    const last = index === sent.length - 1;
    let status: RevisionStatus | '' = '';
    if (r.submittedOn || r.commentedOn) {
      if (!last) status = 'Resubmission Required';
      else if (core.approved) status = 'Approved';
      else status = r.commentedOn ? 'Resubmission Required' : 'Under Review';
    }
    const revision: DrawingRevision = { round: REVISION_ROUNDS[r.rev], submissionDate: r.submittedOn ?? '', comments: '', commentsDate: r.commentedOn ?? '' };
    if (status) revision.status = status;
    return revision;
  });
  const anySubmitted = revisions.some((r) => r.submissionDate);
  const status: OverallStatus = core.approved ? 'Approved' : anySubmitted ? 'In Progress' : 'Pending';
  const firstSubmittedOn = earliestSubmissionDate(revisions);
  return {
    projectCode: core.projectCode,
    schedule: core.schedule,
    scope: core.scope,
    group: core.group,
    order: core.order,
    slNo: core.slNo,
    description: core.description,
    docNo: '',
    drawingNo: core.drgNo ?? '',
    plannedStartDate: core.plannedSubmission ?? '',
    plannedEndDate: core.targetApproval ?? '',
    revisions,
    approveDate: core.approvedOn ?? '',
    status,
    remark: core.remarks ?? '',
    ...(firstSubmittedOn ? { firstSubmittedOn } : {}),
    subDrawings: [],
    legacy: core.legacy,
  };
}

/* ── writing ─────────────────────────────────────────────────────────────── */

export interface WriteOptions {
  /** Replace an existing item only when nobody has edited it in the ERP since the import. */
  overwrite: boolean;
  /** Drawing list code → ERP project id (`projects/{id}`), set on the drawing list. */
  links?: Map<string, string>;
  /** The server timestamp sentinel of whichever SDK is writing. */
  timestamp: () => unknown;
  /** Written beside `updatedBy: 'import'`. */
  importedByName?: string | null;
}

/**
 * Writes the drawing lists (merged, so a link made in Settings survives) and the items, 300 to a
 * batch. An item that already exists is skipped, unless `overwrite` and it is still as imported.
 */
export async function writeImport(db: Firestore, parsed: ParsedImport, options: WriteOptions): Promise<{ projects: number; written: number; skipped: number }> {
  for (const p of parsed.projects) {
    const link = options.links?.get(p.code);
    await db.collection(COLLECTIONS.projects).doc(p.code).set(link ? { ...p, projectId: link } : p, { merge: true });
  }
  const col = db.collection(COLLECTIONS.items);
  let written = 0;
  let skipped = 0;
  for (let i = 0; i < parsed.items.length; i += 300) {
    const chunk = parsed.items.slice(i, i + 300);
    const existing = await db.getAll(...chunk.map((it) => col.doc(it.id)));
    const batch = db.batch();
    chunk.forEach((it, j) => {
      const snap = existing[j];
      if (snap.exists && !(options.overwrite && snap.data()?.updatedBy === 'import')) {
        skipped += 1;
        return;
      }
      batch.set(col.doc(it.id), {
        ...toDrawingItem(it.core),
        updatedAt: options.timestamp(),
        updatedBy: 'import',
        updatedByName: options.importedByName ?? null,
      });
      written += 1;
    });
    await batch.commit();
  }
  return { projects: parsed.projects.length, written, skipped };
}
