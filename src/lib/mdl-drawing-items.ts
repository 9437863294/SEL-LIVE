/**
 * Project Management's MDL register read as the Master Drawing List's drawing items, so the PM page
 * shows the module's figures — where the ball is, the S-curve, turnaround, the status summary — from
 * the module's own pure functions (`master-drawing-list/analytics.ts`, `register.ts`) rather than a
 * second copy of them.
 *
 * Read-only. Nothing built here is written back: PM's `mdlDrawings` records, its dialogs and its save
 * paths are untouched, and every action on the page still works on the original BOQ item and drawing.
 *
 * A BOQ item's Scope 1 › Scope 2 › Category 1 stand where the module has Scope › Schedule › Group:
 * Scope 2 carries Supply / Civil / Erection, the module's schedules.
 */

import {
  REVISION_ROUNDS,
  ballInCourt,
  COURT_LABEL,
  cycleAgeDays,
  latestRevision,
  roundIndex,
  rollup,
  type DrawingItem,
  type DrawingRecord,
  type DrawingRevision,
  type SubDrawing,
} from '@/lib/master-drawing-list/drawings';
import { sheetName } from '@/lib/master-drawing-list/register';
import { computeMdlDrawingStage, type MdlDrawing, type MdlRevision, type MdlRow, type MdlSubDrawing } from '@/lib/mdl';
import type { ExcelSheet } from '@/lib/report-excel';

/** What PM calls the module's three levels. */
export const PM_MDL_LEVELS = { scope: 'Scope 1', schedule: 'Scope 2', group: 'Category 1' } as const;

/** An item with no Scope 1 / Scope 2 still needs a strip to sit under; PM's register called it this. */
const UNGROUPED = 'Ungrouped';

const text = (value: unknown) => String(value ?? '').trim();

/** Today as 'YYYY-MM-DD' on this device's calendar — the date PM's own overdue checks use. */
export function localToday(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toDrawingRevision(revision: MdlRevision): DrawingRevision {
  // PM keeps a download URL beside the storage path; either one means the round has a file.
  const file = revision.filePath || revision.fileUrl;
  return {
    round: revision.round,
    submissionDate: revision.submissionDate ?? '',
    status: revision.status ?? '',
    comments: revision.comments ?? '',
    commentsDate: revision.commentsDate ?? '',
    ...(revision.fileName ? { fileName: revision.fileName } : {}),
    ...(file ? { filePath: file } : {}),
  };
}

type PmRecord = Partial<Pick<MdlDrawing, 'docNo' | 'drawingNo' | 'plannedStartDate' | 'plannedEndDate' | 'revisions' | 'approveDate' | 'status' | 'remark' | 'firstSubmittedOn'>>;

/** A PM drawing record (an item's own, or a sub-drawing) in the module's shape; empty when there is none yet. */
export function toDrawingRecord(source: PmRecord | undefined): DrawingRecord {
  return {
    docNo: source?.docNo ?? '',
    drawingNo: source?.drawingNo ?? '',
    plannedStartDate: source?.plannedStartDate ?? '',
    plannedEndDate: source?.plannedEndDate ?? '',
    revisions: (source?.revisions ?? []).map(toDrawingRevision),
    approveDate: source?.approveDate ?? '',
    status: source?.status ?? 'Pending',
    remark: source?.remark ?? '',
    ...(source?.firstSubmittedOn ? { firstSubmittedOn: source.firstSubmittedOn } : {}),
  };
}

export function toSubDrawing(sub: MdlSubDrawing): SubDrawing {
  return {
    ...toDrawingRecord(sub),
    id: sub.id,
    title: sub.title ?? '',
    ...(sub.assignedToId ? { assignedToId: sub.assignedToId } : {}),
    ...(sub.assignedToName ? { assignedToName: sub.assignedToName } : {}),
  };
}

/**
 * One MDL row (a BOQ item marked MDL = Yes, with its drawing record if it has one) as a drawing item.
 * `order` is its place in the register (BOQ SL No order), which the module's groups keep.
 */
export function toDrawingItem(row: MdlRow, order: number, projectCode: string): DrawingItem {
  return {
    ...toDrawingRecord(row.drawing),
    id: row.item.id,
    projectCode,
    scope: text(row.item['Scope 1']) || UNGROUPED,
    schedule: text(row.item['Scope 2']) || UNGROUPED,
    group: text(row.item['Category 1']) || null,
    order,
    slNo: text(row.item['BOQ SL No']),
    description: text(row.item.Description),
    subDrawings: (row.drawing?.subDrawings ?? []).map(toSubDrawing),
    legacy: null,
    updatedAt: null,
    updatedBy: null,
  };
}

export const toDrawingItems = (rows: MdlRow[], projectCode: string): DrawingItem[] => rows.map((row, index) => toDrawingItem(row, index, projectCode));

/* ── the register as a workbook ──────────────────────────────────────────── */

const excelDate = (value: string | null | undefined): Date | null => (value ? new Date(`${value}T00:00:00Z`) : null);

export interface PmRegisterEntry {
  row: MdlRow;
  item: DrawingItem;
  /** Live purchase orders placed against the item. */
  poNumbers: string[];
}

/**
 * The register as one sheet, the way the module exports its own: a row per BOQ item and one per
 * sub-drawing beneath it, with a submitted / status / comments-date / comments set per round (as many
 * as the deepest row needs) — plus what only PM knows: the purchase orders and the vendor stage.
 */
export function pmRegisterSheet(entries: PmRegisterEntry[], projectName: string, today: string): ExcelSheet {
  const records = entries.flatMap(({ item }) => [item, ...item.subDrawings]);
  const rounds = Math.max(
    1,
    ...records.map((record) => {
      const last = latestRevision(record.revisions);
      return last ? roundIndex(last.round) + 1 : 0;
    }),
  );
  const date = { width: 12, numFmt: 'dd.mm.yyyy' };
  const columns: ExcelSheet['columns'] = [
    { header: PM_MDL_LEVELS.scope, key: 'scope', width: 16 },
    { header: PM_MDL_LEVELS.schedule, key: 'schedule', width: 12 },
    { header: PM_MDL_LEVELS.group, key: 'group', width: 22 },
    { header: 'BOQ SL No', key: 'slNo', width: 10 },
    { header: 'Description / Sub-drawing', key: 'description', width: 60 },
    { header: 'Purchase orders', key: 'po', width: 22 },
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
    { header: 'Stage', key: 'stage', width: 20 },
    { header: 'Ball in court', key: 'court', width: 14 },
    { header: 'Days in court', key: 'courtDays', width: 10, numFmt: '0' },
    { header: 'Cycle age (days)', key: 'cycleAge', width: 10, numFmt: '0' },
    { header: 'Remark', key: 'remark', width: 40 },
  );

  const rows: Record<string, unknown>[] = [];
  for (const { row, item, poNumbers } of entries) {
    const rolled = rollup(item, today);
    const hasPo = poNumbers.length > 0;
    const pmSubs = row.drawing?.subDrawings ?? [];
    const parts: { record: DrawingRecord; sub: SubDrawing | null; stage: string }[] = [
      // An item's own stage only means something when it has no sub-drawings, as on screen.
      { record: item, sub: null, stage: pmSubs.length || !row.drawing ? '' : computeMdlDrawingStage(row.drawing, hasPo) },
      ...item.subDrawings.map((sub, index) => ({ record: sub, sub, stage: pmSubs[index] ? computeMdlDrawingStage(pmSubs[index], hasPo) : '' })),
    ];
    for (const { record, sub, stage } of parts) {
      const court = sub || !item.subDrawings.length ? ballInCourt(record, today) : null;
      const out: Record<string, unknown> = {
        scope: item.scope,
        schedule: item.schedule,
        group: item.group ?? '',
        slNo: sub ? '' : item.slNo,
        description: sub ? `   ↳ ${sub.title || 'Untitled drawing'}` : item.description,
        po: sub ? '' : poNumbers.join(', '),
        assignedTo: sub?.assignedToName ?? '',
        docNo: record.docNo,
        drawingNo: record.drawingNo,
        plannedStartDate: excelDate(sub ? record.plannedStartDate : rolled.plannedStartDate),
        plannedEndDate: excelDate(sub ? record.plannedEndDate : rolled.plannedEndDate),
        approveDate: excelDate(sub ? record.approveDate : rolled.approveDate),
        status: sub ? record.status : rolled.status,
        stage,
        court: court ? COURT_LABEL[court.court] : '',
        courtDays: court?.days ?? null,
        cycleAge: cycleAgeDays(sub ? record : rolled, today),
        remark: record.remark,
      };
      for (const revision of record.revisions) {
        out[`${revision.round}s`] = excelDate(revision.submissionDate);
        out[`${revision.round}st`] = revision.status ?? '';
        out[`${revision.round}cd`] = excelDate(revision.commentsDate);
        out[`${revision.round}c`] = revision.comments;
      }
      rows.push(out);
    }
  }
  return { name: sheetName(`MDL ${projectName}`), columns, rows };
}

/** `<prefix>-<project>-<DD.MM.YYYY>.xlsx`. */
export const pmMdlFileName = (projectName: string, today: string, prefix = 'MDL') =>
  `${prefix}-${projectName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'Project'}-${today.slice(8, 10)}.${today.slice(5, 7)}.${today.slice(0, 4)}.xlsx`;
