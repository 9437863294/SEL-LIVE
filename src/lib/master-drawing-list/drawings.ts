/**
 * The Master Drawing List's live record: one document per drawing item, each with its own
 * drawing (doc/drawing numbers, planned window, submission rounds R0, R1 … with a status picked per
 * round, an approve date and an overall status picked by hand) and any sub-drawings under it, each
 * a drawing of its own with an assignee.
 *
 * The flow and the rules follow Project Management's Design & Engineering register, without its
 * links: no BOQ item, no purchase order, no vendor collection. This is a register on its own.
 *
 * Pure functions only, so the screens, the API and the tests share them. "Today" is always passed
 * in as 'YYYY-MM-DD' (India), never read from the clock here.
 */

import type { MdlLegacy, MdlSchedule, MdlScope } from './types.ts';

/* ── vocabulary ──────────────────────────────────────────────────────────── */

/** Rounds a drawing can go through. R0 to R3 are shown as in PM; later ones open when needed. */
export const REVISION_ROUNDS = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9'] as const;
export type RevisionRound = (typeof REVISION_ROUNDS)[number];
/** How many rounds a fresh record carries, as Project Management's does. */
export const DEFAULT_ROUNDS = 4;

export const REVISION_STATUSES = ['Pending', 'Under Review', 'Approved', 'Approved with Comments', 'Resubmission Required', 'Rejected'] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const OVERALL_STATUSES = ['Pending', 'In Progress', 'Approved', 'Approved with Comments', 'Rejected'] as const;
export type OverallStatus = (typeof OVERALL_STATUSES)[number];

export const CLOSED_STATUSES: readonly OverallStatus[] = ['Approved', 'Approved with Comments'];

/**
 * Where a drawing has got to. Project Management's chain also has vendor stages (Awaiting Vendor,
 * Ready for Review…); a standalone register has no purchase orders, so only these remain.
 */
export const DRAWING_STAGES = ['Planned', 'With Client', 'Approved', 'Rejected'] as const;
export type DrawingStage = (typeof DRAWING_STAGES)[number];

/* ── records ─────────────────────────────────────────────────────────────── */

export interface DrawingRevision {
  round: RevisionRound;
  /** 'YYYY-MM-DD' or ''. */
  submissionDate: string;
  status?: RevisionStatus | '';
  comments: string;
  commentsDate: string;
  /** The drawing file submitted with this round (Storage path under master-drawing-list/). */
  fileName?: string;
  filePath?: string;
}

/** The fields an item's own drawing and every sub-drawing share. */
export interface DrawingRecord {
  docNo: string;
  drawingNo: string;
  plannedStartDate: string;
  plannedEndDate: string;
  revisions: DrawingRevision[];
  approveDate: string;
  status: OverallStatus;
  remark: string;
  /** The earliest submission ever recorded; cycle age counts from here and it never moves later. */
  firstSubmittedOn?: string;
}

export interface SubDrawing extends DrawingRecord {
  id: string;
  title: string;
  /** Whoever is responsible. Being assigned is itself the authority to update it. */
  assignedToId?: string;
  assignedToName?: string;
  createdAt?: string;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
}

export interface DrawingItem extends DrawingRecord {
  id: string;
  projectCode: string;
  schedule: MdlSchedule;
  scope: MdlScope;
  /** The heading the item sits under, or null. */
  group: string | null;
  /** Position in the register. */
  order: number;
  slNo: string;
  description: string;
  subDrawings: SubDrawing[];
  /** Kept on items that came from the Excel workbooks. */
  legacy: MdlLegacy | null;
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByName?: string | null;
}

/* ── small helpers ───────────────────────────────────────────────────────── */

export const isApproved = (status?: OverallStatus | null): boolean => status != null && CLOSED_STATUSES.includes(status);

export const roundIndex = (round: string): number => REVISION_ROUNDS.indexOf(round as RevisionRound);

/** Rounds R0 … R(count-1), empty. */
export const emptyRevisions = (count: number = DEFAULT_ROUNDS): DrawingRevision[] =>
  REVISION_ROUNDS.slice(0, count).map((round) => ({ round, submissionDate: '', comments: '', commentsDate: '' }));

export const hasRevisionData = (revision?: DrawingRevision): boolean =>
  Boolean(revision?.submissionDate || revision?.status || revision?.comments || revision?.commentsDate || revision?.filePath);

/** A round the client kicked back, which is what opens the next one. */
export const isRevisionRejected = (revision?: DrawingRevision): boolean => revision?.status === 'Rejected' || revision?.status === 'Resubmission Required';

/** The latest round with anything entered, for the "Revision" column. */
export function latestRevision(revisions: DrawingRevision[]): DrawingRevision | null {
  for (let i = revisions.length - 1; i >= 0; i -= 1) if (hasRevisionData(revisions[i])) return revisions[i];
  return null;
}

/** Rounds to show in the form: R0, plus one more for every round already started. */
export function countVisibleRevisions(revisions: DrawingRevision[]): number {
  let count = 1;
  revisions.forEach((revision, i) => {
    if (hasRevisionData(revision)) count = Math.min(i + 2, revisions.length);
  });
  return count;
}

/**
 * The rounds as the form edits them: in round order, at least DEFAULT_ROUNDS, and always one empty
 * round beyond the last one used (up to R9), so "Add Revision" has somewhere to go.
 */
export function formRevisions(revisions: DrawingRevision[] | undefined): DrawingRevision[] {
  const byRound = new Map((revisions ?? []).map((revision) => [revision.round, revision]));
  const used = (revisions ?? []).filter(hasRevisionData).map((revision) => roundIndex(revision.round));
  const count = Math.min(REVISION_ROUNDS.length, Math.max(DEFAULT_ROUNDS, (used.length ? Math.max(...used) : -1) + 2));
  return emptyRevisions(count).map((empty) => ({ ...empty, ...byRound.get(empty.round) }));
}

/** The rounds as stored: trailing empty rounds beyond R3 dropped. */
export function storedRevisions(revisions: DrawingRevision[]): DrawingRevision[] {
  let last = revisions.length - 1;
  while (last >= DEFAULT_ROUNDS && !hasRevisionData(revisions[last])) last -= 1;
  return revisions.slice(0, last + 1);
}

/** The earliest submission date across the rounds. */
export function earliestSubmissionDate(revisions: DrawingRevision[]): string | undefined {
  const dates = revisions.map((revision) => revision.submissionDate).filter(Boolean).sort();
  return dates[0];
}

export const emptyRecord = (): DrawingRecord => ({
  docNo: '',
  drawingNo: '',
  plannedStartDate: '',
  plannedEndDate: '',
  revisions: emptyRevisions(),
  approveDate: '',
  status: 'Pending',
  remark: '',
});

export const emptySubDrawing = (id: string): SubDrawing => ({ id, title: '', ...emptyRecord() });

/* ── dates ───────────────────────────────────────────────────────────────── */

const DAY = 86_400_000;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;

/** Past its planned end date without being approved. */
export function isOverdue(record: Pick<DrawingRecord, 'plannedEndDate' | 'status'> | undefined, today: string): boolean {
  if (!record?.plannedEndDate || isApproved(record.status)) return false;
  return record.plannedEndDate < today;
}

/** Days since the first-ever submission (never resets on a later round); null before one. */
export function cycleAgeDays(record: Pick<DrawingRecord, 'firstSubmittedOn'> | undefined, today: string): number | null {
  if (!record?.firstSubmittedOn) return null;
  const days = Math.round(dayNumber(today) - dayNumber(record.firstSubmittedOn));
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

/** 'YYYY-MM-DD' → '05 Mar 2026', as Project Management shows dates; '—' when empty. */
export function formatMdlDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/* ── stage and roll-up ───────────────────────────────────────────────────── */

export function drawingStage(record: Pick<DrawingRecord, 'status' | 'revisions'>): DrawingStage {
  if (isApproved(record.status)) return 'Approved';
  if (record.status === 'Rejected') return 'Rejected';
  if ((record.revisions ?? []).some(hasRevisionData)) return 'With Client';
  return 'Planned';
}

/** Whether the item's own record carries a drawing, as opposed to only holding sub-drawings. */
export const hasOwnDrawingWork = (record?: DrawingRecord): boolean =>
  Boolean(record?.docNo || record?.drawingNo || (record?.revisions ?? []).some(hasRevisionData));

/** One status for a set: anything rejected dominates; all approved is approved; any movement is In Progress. */
export function rollUpStatuses(statuses: OverallStatus[]): OverallStatus {
  if (!statuses.length) return 'Pending';
  if (statuses.some((status) => status === 'Rejected')) return 'Rejected';
  if (statuses.every((status) => status === 'Approved')) return 'Approved';
  if (statuses.every((status) => isApproved(status))) return 'Approved with Comments';
  if (statuses.some((status) => status !== 'Pending')) return 'In Progress';
  return 'Pending';
}

export interface Rollup {
  plannedStartDate: string;
  plannedEndDate: string;
  approveDate: string;
  status: OverallStatus;
  remark: string;
  firstSubmittedOn?: string;
  /** The item's own drawing or any sub-drawing is past its own planned end date, unapproved. */
  overdue: boolean;
  subTotal: number;
  subApproved: number;
}

const earliest = (values: (string | undefined)[]) => values.filter((v): v is string => Boolean(v)).sort()[0] ?? '';
const latest = (values: (string | undefined)[]) => values.filter((v): v is string => Boolean(v)).sort().pop() ?? '';

/** What the views show for an item: its own record, or rolled up over its own drawing and sub-drawings. */
export function rollup(item: DrawingRecord & { subDrawings?: SubDrawing[] }, today: string): Rollup {
  const subs = item.subDrawings ?? [];
  const own: Rollup = {
    plannedStartDate: item.plannedStartDate ?? '',
    plannedEndDate: item.plannedEndDate ?? '',
    approveDate: item.approveDate ?? '',
    status: item.status ?? 'Pending',
    remark: item.remark ?? '',
    firstSubmittedOn: item.firstSubmittedOn,
    overdue: isOverdue(item, today),
    subTotal: 0,
    subApproved: 0,
  };
  if (!subs.length) return own;
  const ownCounts = hasOwnDrawingWork(item);
  const status = rollUpStatuses([...(ownCounts ? [own.status] : []), ...subs.map((sub) => sub.status)]);
  return {
    plannedStartDate: earliest([own.plannedStartDate, ...subs.map((sub) => sub.plannedStartDate)]),
    plannedEndDate: latest([own.plannedEndDate, ...subs.map((sub) => sub.plannedEndDate)]),
    approveDate: isApproved(status) ? latest([own.approveDate, ...subs.map((sub) => sub.approveDate)]) : own.approveDate,
    status,
    remark: own.remark,
    firstSubmittedOn: earliest([own.firstSubmittedOn, ...subs.map((sub) => sub.firstSubmittedOn)]) || undefined,
    overdue: (ownCounts && own.overdue) || subs.some((sub) => isOverdue(sub, today)),
    subTotal: subs.length,
    subApproved: subs.filter((sub) => isApproved(sub.status)).length,
  };
}

/** Outstanding work: every item in the register that is not approved yet. */
export const isPendingTask = (item: DrawingItem, today: string): boolean => !isApproved(rollup(item, today).status);

/** The furthest round across the item's own drawing and its sub-drawings. */
export function latestRevisionAcrossItem(item: DrawingRecord & { subDrawings?: SubDrawing[] }): DrawingRevision | null {
  const candidates = [item.revisions ?? [], ...(item.subDrawings ?? []).map((sub) => sub.revisions ?? [])]
    .map(latestRevision)
    .filter((revision): revision is DrawingRevision => revision !== null);
  if (!candidates.length) return null;
  return candidates.reduce((furthest, current) => (roundIndex(current.round) > roundIndex(furthest.round) ? current : furthest));
}

/** The assignee can always update their sub-drawing; anyone else needs Drawings · Edit. */
export const canEditSubDrawing = (sub: Pick<SubDrawing, 'assignedToId'>, userId: string | undefined, canEditRegister: boolean): boolean =>
  canEditRegister || (Boolean(userId) && sub.assignedToId === userId);

/** Outline numbering: group, item, sub-drawing — "1", "1.2", "1.2.3". */
export const outlineNo = (...indexes: number[]): string => indexes.map((index) => index + 1).join('.');

/** How far a set of items has got, for a group heading: drawings (sub-drawings, else the item) and approved. */
export function summariseItems(items: DrawingItem[]): { drawings: number; approved: number } {
  let drawings = 0;
  let approved = 0;
  for (const item of items) {
    if (item.subDrawings.length) {
      drawings += item.subDrawings.length;
      approved += item.subDrawings.filter((sub) => isApproved(sub.status)).length;
    } else {
      drawings += 1;
      if (isApproved(item.status)) approved += 1;
    }
  }
  return { drawings, approved };
}
