/**
 * The register's views as pure functions over drawing items: the Schedule › Scope › Group groups
 * (where Project Management groups by purchase order), search and filters, numbering for a new
 * item, the groups to suggest, and the Excel sheet of the view on screen.
 */

import type { ExcelSheet } from '../report-excel.ts';
import {
  OVERALL_STATUSES,
  REVISION_ROUNDS,
  cycleAgeDays,
  drawingStage,
  isPendingTask,
  latestRevision,
  roundIndex,
  rollup,
  type DrawingItem,
  type OverallStatus,
} from './drawings.ts';
import { SCHEDULES, SCOPES, type MdlSchedule, type MdlScope } from './types.ts';

export const isSchedule = (value: unknown): value is MdlSchedule => SCHEDULES.includes(value as MdlSchedule);
export const isScope = (value: unknown): value is MdlScope => SCOPES.includes(value as MdlScope);
export const isOverallStatus = (value: unknown): value is OverallStatus => OVERALL_STATUSES.includes(value as OverallStatus);

/* ── groups ──────────────────────────────────────────────────────────────── */

export interface RegisterGroup<T> {
  key: string;
  schedule: MdlSchedule;
  scope: MdlScope;
  /** The workbook heading, or null for items directly under the scope. */
  group: string | null;
  items: T[];
}

/**
 * Items under Schedule › Scope › Group, each group in the order it first appears in the register
 * and every item of a heading under it — an item added later joins its group rather than opening a
 * second one at the end.
 */
export function groupItems<T extends Pick<DrawingItem, 'schedule' | 'scope' | 'group' | 'order'>>(items: T[]): RegisterGroup<T>[] {
  const groups = new Map<string, RegisterGroup<T>>();
  for (const item of [...items].sort((a, b) => a.order - b.order)) {
    const key = `${item.schedule}|${item.scope}|${item.group ?? ''}`;
    if (!groups.has(key)) groups.set(key, { key, schedule: item.schedule, scope: item.scope, group: item.group, items: [] });
    groups.get(key)!.items.push(item);
  }
  return [...groups.values()];
}

export const groupTitle = (group: Pick<RegisterGroup<unknown>, 'group' | 'schedule' | 'scope'>) => group.group ?? `${group.schedule} · ${group.scope}`;

/* ── filters ─────────────────────────────────────────────────────────────── */

export interface RegisterFilters {
  schedule?: MdlSchedule | null;
  scope?: MdlScope | null;
  status?: OverallStatus | null;
  /** Searched in the description, numbers, group, remark and sub-drawing titles. */
  q?: string | null;
}

export function matchesSearch(item: DrawingItem, q: string | null | undefined): boolean {
  const words = (q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [
    item.slNo,
    item.description,
    item.docNo,
    item.drawingNo,
    item.group ?? '',
    item.remark,
    ...item.subDrawings.flatMap((sub) => [sub.title, sub.docNo, sub.drawingNo, sub.assignedToName ?? '']),
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function filterItems(items: DrawingItem[], filters: RegisterFilters, today: string): DrawingItem[] {
  return items.filter(
    (item) =>
      (!filters.schedule || item.schedule === filters.schedule) &&
      (!filters.scope || item.scope === filters.scope) &&
      (!filters.status || rollup(item, today).status === filters.status) &&
      matchesSearch(item, filters.q),
  );
}

export const pendingItems = (items: DrawingItem[], today: string) => items.filter((item) => isPendingTask(item, today));

/* ── numbering ───────────────────────────────────────────────────────────── */

/** After every row of the project, with the next whole-number Sl. No. in its schedule and scope. */
export function nextNumbers(items: Pick<DrawingItem, 'order' | 'schedule' | 'scope' | 'slNo'>[], schedule: MdlSchedule, scope: MdlScope): { order: number; slNo: string } {
  let order = 0;
  let sl = 0;
  for (const item of items) {
    order = Math.max(order, item.order);
    if (item.schedule === schedule && item.scope === scope && /^\d+$/.test(item.slNo)) sl = Math.max(sl, Number(item.slNo));
  }
  return { order: order + 1, slNo: String(sl + 1) };
}

/** The groups already used in a project, per schedule and scope — suggestions for a new item. */
export function existingGroups(items: Pick<DrawingItem, 'schedule' | 'scope' | 'group' | 'order'>[]): { schedule: MdlSchedule; scope: MdlScope; group: string }[] {
  const seen = new Set<string>();
  const out: { schedule: MdlSchedule; scope: MdlScope; group: string }[] = [];
  for (const item of [...items].sort((a, b) => a.order - b.order)) {
    if (!item.group) continue;
    const key = `${item.schedule}|${item.scope}|${item.group}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ schedule: item.schedule, scope: item.scope, group: item.group });
  }
  return out;
}

/* ── Excel ───────────────────────────────────────────────────────────────── */

const excelDate = (value: string | null | undefined): Date | null => (value ? new Date(`${value}T00:00:00Z`) : null);

/**
 * The view on screen as one sheet: a row per item and one per sub-drawing beneath it, with a
 * submitted / status / comments / comments-date set of columns per round (as many as the deepest
 * row needs). Dates are real Excel dates shown DD.MM.YYYY.
 */
export function registerSheet(items: DrawingItem[], project: { short: string }, today: string): ExcelSheet {
  const records = items.flatMap((item) => [item, ...item.subDrawings]);
  const rounds = Math.max(1, ...records.map((record) => {
    const last = latestRevision(record.revisions);
    return last ? roundIndex(last.round) + 1 : 0;
  }));
  const date = { width: 12, numFmt: 'dd.mm.yyyy' };
  const columns: ExcelSheet['columns'] = [
    { header: 'Schedule', key: 'schedule', width: 11 },
    { header: 'Scope', key: 'scope', width: 16 },
    { header: 'Group', key: 'group', width: 28 },
    { header: 'Sl. No.', key: 'slNo', width: 8 },
    { header: 'Description / Sub-drawing', key: 'description', width: 60 },
    { header: 'Assigned to', key: 'assignedTo', width: 18 },
    { header: 'Doc No.', key: 'docNo', width: 18 },
    { header: 'Drawing No.', key: 'drawingNo', width: 26 },
    { header: 'Planned start', key: 'plannedStartDate', ...date, width: 13 },
    { header: 'Planned end', key: 'plannedEndDate', ...date, width: 13 },
  ];
  for (const round of REVISION_ROUNDS.slice(0, rounds)) {
    columns.push(
      { header: `${round} submitted`, key: `${round}s`, ...date },
      { header: `${round} status`, key: `${round}st`, width: 20 },
      { header: `${round} comments date`, key: `${round}cd`, ...date },
      { header: `${round} comments`, key: `${round}c`, width: 30 },
    );
  }
  columns.push(
    { header: 'Approve date', key: 'approveDate', ...date },
    { header: 'Status', key: 'status', width: 20 },
    { header: 'Stage', key: 'stage', width: 12 },
    { header: 'Cycle age (days)', key: 'cycleAge', width: 10 },
    { header: 'Remark', key: 'remark', width: 40 },
  );
  const rows: Record<string, unknown>[] = [];
  for (const group of groupItems(items)) {
    for (const item of group.items) {
      const rolled = rollup(item, today);
      for (const record of [item, ...item.subDrawings]) {
        const isSub = record !== item;
        const row: Record<string, unknown> = {
          schedule: item.schedule,
          scope: item.scope,
          group: item.group ?? '',
          slNo: isSub ? '' : item.slNo,
          description: isSub ? `   ↳ ${(record as DrawingItem['subDrawings'][number]).title}` : item.description,
          assignedTo: isSub ? ((record as DrawingItem['subDrawings'][number]).assignedToName ?? '') : '',
          docNo: record.docNo,
          drawingNo: record.drawingNo,
          plannedStartDate: excelDate(isSub ? record.plannedStartDate : rolled.plannedStartDate),
          plannedEndDate: excelDate(isSub ? record.plannedEndDate : rolled.plannedEndDate),
          approveDate: excelDate(isSub ? record.approveDate : rolled.approveDate),
          status: isSub ? record.status : rolled.status,
          stage: drawingStage(record),
          cycleAge: cycleAgeDays(isSub ? record : rolled, today),
          remark: record.remark,
        };
        for (const revision of record.revisions) {
          row[`${revision.round}s`] = excelDate(revision.submissionDate);
          row[`${revision.round}st`] = revision.status ?? '';
          row[`${revision.round}cd`] = excelDate(revision.commentsDate);
          row[`${revision.round}c`] = revision.comments;
        }
        rows.push(row);
      }
    }
  }
  // Sheet names: 31 characters, none of : \ / ? * [ ]. Replaced one by one rather than with a
  // character class: Tailwind scans src/ and reads a bracketed colon as a CSS class.
  let name = `MDL ${project.short}`;
  for (const forbidden of ['\\', '/', '?', '*', '[', ']', ':']) name = name.split(forbidden).join(' ');
  return { name: name.slice(0, 31), columns, rows };
}

/** `MDL-<short>-<DD.MM.YYYY>.xlsx`. */
export function exportFileName(project: { short: string }, today: string): string {
  return `MDL-${project.short.replace(/[^A-Za-z0-9._-]+/g, '-')}-${today.slice(8, 10)}.${today.slice(5, 7)}.${today.slice(0, 4)}.xlsx`;
}
