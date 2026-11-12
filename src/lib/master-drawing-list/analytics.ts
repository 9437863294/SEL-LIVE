/**
 * The Master Drawing List dashboard's figures, worked out the way EPC document control measures a
 * drawing register: deliverables (each sub-drawing, else the item), where the ball is (with the
 * client, with SEL, not submitted, approved), planned against actual submissions and approvals over
 * time (the S-curve), monthly throughput, the client's review outcome per round, turnaround on
 * both sides, first-time approvals, ageing, and the lists that need attention.
 *
 * "Overdue at client" and "overdue with SEL" use the drawing list's own review and resubmission
 * periods (Settings); without them those two figures are not shown rather than guessed.
 */

import {
  REVISION_ROUNDS,
  ballInCourt,
  drawingUnits,
  earliestSubmissionDate,
  isApproved,
  isOverdue,
  roundIndex,
  roundTurnarounds,
  type Court,
  type DrawingItem,
  type DrawingUnit,
} from './drawings.ts';
import type { ExcelSheet } from '../report-excel.ts';
import { groupItems, groupTitle, nestGroups, sheetName, type ListOrder } from './register.ts';

export const AGE_BANDS = [
  { label: '0–15 d', max: 15 },
  { label: '16–30 d', max: 30 },
  { label: '31–60 d', max: 60 },
  { label: '61–90 d', max: 90 },
  { label: '> 90 d', max: Infinity },
] as const;

export interface UnitDays {
  unit: DrawingUnit;
  days: number;
  since: string;
}

export interface DashboardStats {
  items: number;
  units: number;
  courts: Record<Court, number>;
  approvedPct: number;
  submittedPct: number;
  /** Planned end date passed, not approved. */
  overdue: number;
  /** Not submitted though the planned start has passed. */
  lateToSubmit: number;
  /** With the client / SEL longer than the drawing list's period; null when no period is set. */
  clientOverdue: number | null;
  selOverdue: number | null;
  avgClientDays: number | null;
  avgSelDays: number | null;
  /** Approved deliverables, how many at their first submission, and the share. */
  firstTime: { approved: number; atFirst: number; pct: number | null };
  /** Average rounds an approved deliverable took. */
  avgRounds: number | null;
  ageing: { band: string; client: number; sel: number }[];
  sCurve: { month: string; label: string; plannedSubmission: number; actualSubmission: number; plannedApproval: number; actualApproval: number }[];
  monthly: { month: string; label: string; submitted: number; comments: number; approved: number }[];
  outcomes: { round: string; underReview: number; approved: number; approvedWithComments: number; resubmission: number; rejected: number }[];
  longestClient: UnitDays[];
  longestSel: UnitDays[];
  overdueList: UnitDays[];
  upcoming: { unit: DrawingUnit; date: string; kind: 'submission' | 'approval' }[];
}

const monthOf = (iso: string) => iso.slice(0, 7);
const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const average = (values: number[]) => (values.length ? Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10 : null);

/** Months from the first to the last date given, at most `limit` months ending at the last. */
function monthRange(dates: string[], limit: number): string[] {
  const months = dates.filter(Boolean).map(monthOf).sort();
  if (!months.length) return [];
  const last = months[months.length - 1];
  let month = months[0];
  const out: string[] = [];
  while (month <= last) {
    out.push(month);
    month = nextMonth(month);
  }
  return out.slice(-limit);
}

export function dashboardStats(items: DrawingItem[], today: string, periods: { reviewDays?: number | null; resubmitDays?: number | null } = {}): DashboardStats {
  const units = drawingUnits(items);
  const courts: Record<Court, number> = { client: 0, sel: 0, not_started: 0, closed: 0 };
  const ageing = AGE_BANDS.map((band) => ({ band: band.label, client: 0, sel: 0 }));
  const withClient: UnitDays[] = [];
  const withSel: UnitDays[] = [];
  const overdueList: UnitDays[] = [];
  const upcoming: DashboardStats['upcoming'] = [];
  const clientDays: number[] = [];
  const selDays: number[] = [];
  let lateToSubmit = 0;
  let submitted = 0;
  let firstTimeApproved = 0;
  let approvedUnits = 0;
  const roundsToApproval: number[] = [];
  const horizon = addDays(today, 14);
  const outcomes = new Map<string, DashboardStats['outcomes'][number]>();
  const plannedSub: string[] = [];
  const actualSub: string[] = [];
  const plannedApp: string[] = [];
  const actualApp: string[] = [];
  const monthly = new Map<string, { submitted: number; comments: number; approved: number }>();
  const bump = (date: string, key: 'submitted' | 'comments' | 'approved') => {
    if (!date) return;
    const entry = monthly.get(monthOf(date)) ?? { submitted: 0, comments: 0, approved: 0 };
    entry[key] += 1;
    monthly.set(monthOf(date), entry);
  };

  for (const unit of units) {
    const { record } = unit;
    const state = ballInCourt(record, today);
    courts[state.court] += 1;

    if ((state.court === 'client' || state.court === 'sel') && state.days !== null && state.since) {
      const band = AGE_BANDS.findIndex((entry) => state.days! <= entry.max);
      ageing[band][state.court] += 1;
      (state.court === 'client' ? withClient : withSel).push({ unit, days: state.days, since: state.since });
    }
    if (isOverdue(record, today)) overdueList.push({ unit, days: daysBetween(record.plannedEndDate, today), since: record.plannedEndDate });
    if (state.court === 'not_started' && record.plannedStartDate && record.plannedStartDate < today) lateToSubmit += 1;
    if (state.court === 'not_started' && record.plannedStartDate >= today && record.plannedStartDate <= horizon) upcoming.push({ unit, date: record.plannedStartDate, kind: 'submission' });
    else if (state.court !== 'closed' && record.plannedEndDate >= today && record.plannedEndDate <= horizon) upcoming.push({ unit, date: record.plannedEndDate, kind: 'approval' });

    const first = record.firstSubmittedOn || earliestSubmissionDate(record.revisions ?? []);
    if (first) submitted += 1;
    if (record.plannedStartDate) plannedSub.push(record.plannedStartDate);
    if (record.plannedEndDate) plannedApp.push(record.plannedEndDate);
    if (first) actualSub.push(first);
    if (isApproved(record.status) && record.approveDate) actualApp.push(record.approveDate);

    const used = (record.revisions ?? []).filter((revision) => revision.submissionDate);
    for (const revision of used) {
      bump(revision.submissionDate, 'submitted');
      bump(revision.commentsDate, 'comments');
      const entry = outcomes.get(revision.round) ?? { round: revision.round, underReview: 0, approved: 0, approvedWithComments: 0, resubmission: 0, rejected: 0 };
      if (revision.status === 'Approved') entry.approved += 1;
      else if (revision.status === 'Approved with Comments') entry.approvedWithComments += 1;
      else if (revision.status === 'Resubmission Required') entry.resubmission += 1;
      else if (revision.status === 'Rejected') entry.rejected += 1;
      else entry.underReview += 1;
      outcomes.set(revision.round, entry);
    }
    if (isApproved(record.status)) {
      approvedUnits += 1;
      bump(record.approveDate, 'approved');
      if (used.length) roundsToApproval.push(used.length);
      if (used.length === 1) firstTimeApproved += 1;
    }
    for (const turn of roundTurnarounds(record)) {
      if (turn.client !== null) clientDays.push(turn.client);
      if (turn.sel !== null) selDays.push(turn.sel);
    }
  }

  // The S-curve: cumulative counts at each month's end, from the first date to the last planned one.
  const months = monthRange([...plannedSub, ...plannedApp, ...actualSub, ...actualApp, today], 36);
  const cumulative = (dates: string[], month: string) => dates.filter((date) => monthOf(date) <= month).length;
  const sCurve = months.map((month) => ({
    month,
    label: monthLabel(month),
    plannedSubmission: cumulative(plannedSub, month),
    actualSubmission: month <= monthOf(today) ? cumulative(actualSub, month) : NaN,
    plannedApproval: cumulative(plannedApp, month),
    actualApproval: month <= monthOf(today) ? cumulative(actualApp, month) : NaN,
  }));

  // The last twelve months of activity, up to this month.
  const activityMonths = monthRange([...monthly.keys()].map((month) => `${month}-01`).concat(today), 120).filter((month) => month <= monthOf(today)).slice(-12);

  const longest = (list: UnitDays[]) => [...list].sort((a, b) => b.days - a.days).slice(0, 8);
  const countOver = (list: UnitDays[], limit?: number | null) => (limit ? list.filter((entry) => entry.days > limit).length : null);

  return {
    items: items.length,
    units: units.length,
    courts,
    approvedPct: units.length ? Math.round((courts.closed / units.length) * 100) : 0,
    submittedPct: units.length ? Math.round((submitted / units.length) * 100) : 0,
    overdue: overdueList.length,
    lateToSubmit,
    clientOverdue: countOver(withClient, periods.reviewDays),
    selOverdue: countOver(withSel, periods.resubmitDays),
    avgClientDays: average(clientDays),
    avgSelDays: average(selDays),
    firstTime: { approved: approvedUnits, atFirst: firstTimeApproved, pct: approvedUnits ? Math.round((firstTimeApproved / approvedUnits) * 100) : null },
    avgRounds: average(roundsToApproval),
    ageing,
    sCurve,
    monthly: activityMonths.map((month) => ({ month, label: monthLabel(month), ...(monthly.get(month) ?? { submitted: 0, comments: 0, approved: 0 }) })),
    outcomes: [...outcomes.values()].sort((a, b) => roundIndex(a.round) - roundIndex(b.round)).filter((entry) => REVISION_ROUNDS.includes(entry.round as (typeof REVISION_ROUNDS)[number])),
    longestClient: longest(withClient),
    longestSel: longest(withSel),
    overdueList: longest(overdueList),
    upcoming: upcoming.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10),
  };
}

/* ── progress by scope, schedule and group ───────────────────────────────── */

/** Deliverables under a scope, schedule or group, by where the ball is, and how many are overdue. */
export interface Progress {
  items: number;
  drawings: number;
  approved: number;
  client: number;
  sel: number;
  notStarted: number;
  /** Planned end date passed, not approved. */
  overdue: number;
  /** Approved, as a share of the drawings. */
  pct: number;
}

export function progressOf(items: DrawingItem[], today: string): Progress {
  const progress: Progress = { items: items.length, drawings: 0, approved: 0, client: 0, sel: 0, notStarted: 0, overdue: 0, pct: 0 };
  for (const { record } of drawingUnits(items)) {
    progress.drawings += 1;
    const { court } = ballInCourt(record, today);
    if (court === 'closed') progress.approved += 1;
    else if (court === 'client') progress.client += 1;
    else if (court === 'sel') progress.sel += 1;
    else progress.notStarted += 1;
    if (isOverdue(record, today)) progress.overdue += 1;
  }
  progress.pct = progress.drawings ? Math.round((progress.approved / progress.drawings) * 100) : 0;
  return progress;
}

export interface ProgressRow {
  key: string;
  level: 'scope' | 'schedule' | 'group';
  scope: string;
  schedule: string | null;
  /** The workbook heading; null on scope and schedule rows, and for items under no heading. */
  group: string | null;
  /** What the row shows: the scope, the schedule, or the group's title. */
  name: string;
  progress: Progress;
  children: ProgressRow[];
}

/**
 * The register's Scope › Schedule › Group tree with each level's progress, in the register's order
 * (scopes and schedules as configured, groups as first seen).
 */
export function progressTree(items: DrawingItem[], today: string, order?: ListOrder): ProgressRow[] {
  return nestGroups(groupItems(items, order)).map((scope) => ({
    key: scope.key,
    level: 'scope',
    scope: scope.scope,
    schedule: null,
    group: null,
    name: scope.scope,
    progress: progressOf(scope.items, today),
    children: scope.schedules.map((schedule) => ({
      key: schedule.key,
      level: 'schedule',
      scope: scope.scope,
      schedule: schedule.schedule,
      group: null,
      name: schedule.schedule,
      progress: progressOf(schedule.items, today),
      children: schedule.groups.map((group) => ({
        key: group.key,
        level: 'group',
        scope: scope.scope,
        schedule: schedule.schedule,
        group: group.group,
        name: groupTitle(group),
        progress: progressOf(group.items, today),
        children: [],
      })),
    })),
  }));
}

/**
 * The status summary as one sheet: a row per scope, schedule and group in the register's order,
 * then the drawing list's total. Each row names its scope and schedule, so a filter on either
 * column keeps a level's rows together.
 */
export function progressSheet(tree: ProgressRow[], total: Progress, project: { short: string }): ExcelSheet {
  const LEVEL = { scope: 'Scope', schedule: 'Schedule', group: 'Group' } as const;
  const figures = (progress: Progress) => ({
    items: progress.items,
    drawings: progress.drawings,
    approved: progress.approved,
    client: progress.client,
    sel: progress.sel,
    notStarted: progress.notStarted,
    overdue: progress.overdue,
    pct: progress.drawings ? progress.approved / progress.drawings : 0,
  });
  const rows: Record<string, unknown>[] = [];
  const add = (row: ProgressRow) => {
    rows.push({ level: LEVEL[row.level], scope: row.scope, schedule: row.schedule ?? '', group: row.level === 'group' ? row.name : '', ...figures(row.progress) });
    row.children.forEach(add);
  };
  tree.forEach(add);
  rows.push({ level: 'Total', scope: '', schedule: '', group: '', ...figures(total) });
  const count = (header: string, key: string) => ({ header, key, width: 11, numFmt: '0' });
  return {
    name: sheetName(`Summary ${project.short}`),
    columns: [
      { header: 'Level', key: 'level', width: 10 },
      { header: 'Scope', key: 'scope', width: 18 },
      { header: 'Schedule', key: 'schedule', width: 14 },
      { header: 'Group', key: 'group', width: 40 },
      count('Items', 'items'),
      count('Drawings', 'drawings'),
      count('Approved', 'approved'),
      count('With client', 'client'),
      count('With SEL', 'sel'),
      count('Not submitted', 'notStarted'),
      count('Overdue', 'overdue'),
      { header: '% approved', key: 'pct', width: 11, numFmt: '0%' },
    ],
    rows,
  };
}
