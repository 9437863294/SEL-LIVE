/**
 * The metrics layer for E-Approval reporting (`docs/e-approval-analytics.md`).
 *
 * Dependency-free, exactly as `e-approval-policy.ts` is, and for the same reasons: these numbers are
 * quoted to a board, so every one of them is unit-tested rather than eyeballed on a chart, and the
 * same function runs in a page, in an export and in a scheduled digest.
 *
 * Three rules the whole module keeps to:
 *
 *   1. **Every rate carries its denominator.** A "92% SLA compliance" over eleven steps is noise. Each
 *      summary returns the counts it divided, so a screen can refuse to draw a percentage that rests
 *      on nothing — which is the difference between an intelligence system and a decorative one.
 *
 *   2. **Turnaround excludes paused time.** A step's clock stops while its holder waits on a
 *      verification they asked for, or while the file is on hold. An approver is answerable for the
 *      time they *held* the file, not for the time it existed. Anything labelled "held" or
 *      "processing" in here means active time.
 *
 *   3. **Per-step and end-to-end are never mixed.** End-to-end flatters a chain with one fast desk;
 *      per-step is the only fair basis for ranking a person. Both are computed, and every field name
 *      says which it is.
 */

import {
  isOpenEApprovalStatus,
  isTerminalEApprovalStatus,
  type EApprovalEscalationLevel,
  type EApprovalEscalationRule,
  type EApprovalOutcome,
  type EApprovalPriority,
  type EApprovalStatus,
  type EApprovalStepStatus,
  type EApprovalStepType,
} from './e-approval-policy.ts';

/* ------------------------------------------------------------------------------------------------
 * Inputs — deliberately structural, so callers pass Firestore documents unconverted
 * ---------------------------------------------------------------------------------------------- */

export interface AnalyticsRequestRow {
  id: string;
  referenceNo?: string;
  subject?: string;
  status: EApprovalStatus | string;
  priority?: EApprovalPriority;
  requesterId: string;
  requesterName?: string;
  departmentId?: string;
  departmentName?: string;
  projectId?: string;
  projectName?: string;
  approvalTypeId?: string;
  approvalTypeName?: string;
  amount?: number;
  confidential?: boolean;
  version?: number;
  supersededCount?: number;
  pendingLabel?: string;
  currentStepName?: string;
  currentStepType?: EApprovalStepType | null;
  currentDueAt?: string | null;
  currentAssigneeIds?: string[];
  submittedAt?: string | null;
  completedAt?: string | null;
}

export interface AnalyticsStepRow {
  id: string;
  approvalId: string;
  name: string;
  type: EApprovalStepType;
  depth: number;
  status: EApprovalStepStatus | string;
  outcome?: EApprovalOutcome | null;
  sequence?: number;
  assignment?: { kind?: string; userId?: string; userName?: string; departmentId?: string; departmentName?: string; role?: string };
  actedByUserId?: string;
  actedByName?: string;
  onBehalfOfUserId?: string;
  delegatedToUserId?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  dueAt?: string | null;
  pausedMs?: number;
  slaHours?: number;
  escalationsSent?: string[];
  reopened?: boolean;
  /** Denormalised from the request, so a step rollup needs no join. */
  amount?: number;
  priority?: EApprovalPriority;
}

export interface AnalyticsEventRow {
  id: string;
  approvalId: string;
  at: string;
  kind: string;
  actorId: string;
  actorName?: string;
  stepName?: string;
}

/* ------------------------------------------------------------------------------------------------
 * Primitives
 * ---------------------------------------------------------------------------------------------- */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const millis = (value: string | Date | null | undefined): number | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  const time = parsed.getTime();
  return Number.isNaN(time) ? null : time;
};

const nowMs = (now: string | Date | undefined) => millis(now ?? new Date()) ?? Date.now();

const round = (value: number, places = 1) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const safeDivide = (numerator: number, denominator: number) => (denominator > 0 ? numerator / denominator : 0);

/** A percentage, or null when there is nothing to divide — never a misleading 0%. */
export const percentOf = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? round((numerator / denominator) * 100, 1) : null;

export interface DurationStats {
  count: number;
  /** Hours. */
  mean: number;
  median: number;
  p90: number;
  min: number;
  max: number;
  total: number;
}

const EMPTY_DURATION: DurationStats = { count: 0, mean: 0, median: 0, p90: 0, min: 0, max: 0, total: 0 };

/**
 * Mean, median and p90 over a set of durations in hours.
 *
 * Median and p90 are here because approval turnaround is badly skewed — one file that sat over a
 * long weekend drags a mean well past anything a reader would recognise as typical. Reporting the
 * mean alone is how a dashboard comes to be disbelieved by the people it describes.
 */
export function durationStats(hours: number[]): DurationStats {
  const values = hours.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!values.length) return { ...EMPTY_DURATION };
  const total = values.reduce((sum, value) => sum + value, 0);
  // Nearest-rank, not the lower neighbour: on a small sample the floor method returns a value *below*
  // the 90th percentile, which understates exactly the tail this metric exists to expose.
  const at = (fraction: number) =>
    values[Math.min(values.length - 1, Math.max(0, Math.ceil(fraction * values.length) - 1))];
  const middle = values.length / 2;
  const median =
    values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[Math.floor(middle)];
  return {
    count: values.length,
    mean: round(total / values.length),
    median: round(median),
    p90: round(at(0.9)),
    min: round(values[0]),
    max: round(values[values.length - 1]),
    total: round(total),
  };
}

/** Active hours a step was held — elapsed, less time paused waiting on somebody else or on hold. */
export function stepHeldHours(step: AnalyticsStepRow, now?: string | Date): number | null {
  const started = millis(step.startedAt);
  if (started == null) return null;
  const ended = millis(step.completedAt) ?? nowMs(now);
  const paused = Math.max(0, step.pausedMs ?? 0);
  return Math.max(0, (ended - started - paused) / HOUR_MS);
}

/** End-to-end hours from submission to closure. Null while a request is still open. */
export function requestCycleHours(row: AnalyticsRequestRow): number | null {
  const from = millis(row.submittedAt);
  const to = millis(row.completedAt);
  if (from == null || to == null) return null;
  return Math.max(0, (to - from) / HOUR_MS);
}

/** Hours a still-open request has been in the system. */
export function requestOpenHours(row: AnalyticsRequestRow, now?: string | Date): number | null {
  const from = millis(row.submittedAt);
  if (from == null) return null;
  return Math.max(0, (nowMs(now) - from) / HOUR_MS);
}

/* ------------------------------------------------------------------------------------------------
 * Filters (spec section 2)
 * ---------------------------------------------------------------------------------------------- */

export interface EApprovalAnalyticsFilter {
  from?: string | null;
  to?: string | null;
  departmentIds?: string[];
  projectIds?: string[];
  approvalTypeIds?: string[];
  requesterIds?: string[];
  /** Matches the request's *current* assignee — "what is sitting with this person". */
  assigneeIds?: string[];
  statuses?: string[];
  priorities?: EApprovalPriority[];
  minAmount?: number | null;
  maxAmount?: number | null;
  /** Free text over reference, subject, requester and the pending-with label. */
  search?: string;
}

const inList = (value: string | undefined, list: string[] | undefined) =>
  !list?.length || (value != null && list.includes(value));

/**
 * Applies a filter to the request set.
 *
 * The date range is matched on **submission**, not creation: a draft saved in March and submitted in
 * June belongs to June's numbers, because that is when it entered anybody's queue. Drafts, having no
 * submission date, fall outside every date range — which is correct, they are not yet work.
 */
export function filterEApprovalRows(
  rows: AnalyticsRequestRow[],
  filter: EApprovalAnalyticsFilter = {},
): AnalyticsRequestRow[] {
  const from = millis(filter.from);
  const to = millis(filter.to);
  const term = filter.search?.trim().toLowerCase();

  return rows.filter((row) => {
    if (from != null || to != null) {
      const submitted = millis(row.submittedAt);
      if (submitted == null) return false;
      if (from != null && submitted < from) return false;
      // Inclusive of the whole end day, so "to: 30 June" includes 30 June.
      if (to != null && submitted > to + DAY_MS - 1) return false;
    }
    if (!inList(row.departmentId, filter.departmentIds)) return false;
    if (!inList(row.projectId, filter.projectIds)) return false;
    if (!inList(row.approvalTypeId, filter.approvalTypeIds)) return false;
    if (!inList(row.requesterId, filter.requesterIds)) return false;
    if (!inList(String(row.status), filter.statuses)) return false;
    if (filter.priorities?.length && !filter.priorities.includes(row.priority as EApprovalPriority)) return false;
    if (filter.assigneeIds?.length) {
      const assignees = row.currentAssigneeIds ?? [];
      if (!filter.assigneeIds.some((id) => assignees.includes(id))) return false;
    }
    const amount = row.amount ?? 0;
    if (filter.minAmount != null && amount < filter.minAmount) return false;
    if (filter.maxAmount != null && amount > filter.maxAmount) return false;
    if (term) {
      const haystack = [row.referenceNo, row.subject, row.requesterName, row.pendingLabel, row.departmentName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
}

/* ------------------------------------------------------------------------------------------------
 * Executive KPIs (spec section 1)
 * ---------------------------------------------------------------------------------------------- */

export interface EApprovalKpis {
  raised: number;
  pending: number;
  pendingVerification: number;
  pendingClarification: number;
  returned: number;
  onHold: number;
  approved: number;
  rejected: number;
  cancelled: number;
  overdue: number;
  slaBreached: number;
  escalated: number;
  /** Money still awaiting a decision. */
  valuePending: number;
  valueApproved: number;
  /** Pending value on files that are overdue — exposure, not merely backlog. */
  valueAtRisk: number;
  /** End-to-end, closed requests only. */
  cycleHours: DurationStats;
  /** Per-step active time, every completed step. */
  stepHeldHours: DurationStats;
  /** Age in hours of the longest-waiting open request. */
  oldestPendingHours: number | null;
}

const EMPTY_KPIS = (): EApprovalKpis => ({
  raised: 0,
  pending: 0,
  pendingVerification: 0,
  pendingClarification: 0,
  returned: 0,
  onHold: 0,
  approved: 0,
  rejected: 0,
  cancelled: 0,
  overdue: 0,
  slaBreached: 0,
  escalated: 0,
  valuePending: 0,
  valueApproved: 0,
  valueAtRisk: 0,
  cycleHours: { ...EMPTY_DURATION },
  stepHeldHours: { ...EMPTY_DURATION },
  oldestPendingHours: null,
});

/**
 * The KPI block of the command centre.
 *
 * `overdue` and `slaBreached` are counted separately on purpose. Overdue is a *request* whose current
 * step is past its due time — the thing somebody must chase today. A breach is a *step* that was
 * still unfinished when its clock ran out, whether or not it has since completed — the thing that
 * shows up in a compliance number. Collapsing them hides either today's queue or this month's record.
 */
export function computeEApprovalKpis(
  rows: AnalyticsRequestRow[],
  steps: AnalyticsStepRow[] = [],
  options: { now?: string | Date; escalationLadder?: EApprovalEscalationRule[] } = {},
): EApprovalKpis {
  const at = nowMs(options.now);
  const kpis = EMPTY_KPIS();
  const escalationRuleIds = new Set(
    (options.escalationLadder ?? []).filter((rule) => rule.kind === 'Escalation').map((rule) => rule.id),
  );

  const cycleValues: number[] = [];
  let oldest: number | null = null;

  for (const row of rows) {
    const status = String(row.status);
    if (status !== 'Draft') kpis.raised += 1;

    if (status === 'Approved') {
      kpis.approved += 1;
      kpis.valueApproved += row.amount ?? 0;
    } else if (status === 'Rejected') kpis.rejected += 1;
    else if (status === 'Cancelled') kpis.cancelled += 1;

    const cycle = requestCycleHours(row);
    if (cycle != null && status === 'Approved') cycleValues.push(cycle);

    if (!isOpenEApprovalStatus(status)) continue;

    kpis.pending += 1;
    kpis.valuePending += row.amount ?? 0;
    if (status === 'Pending Verification') kpis.pendingVerification += 1;
    if (status === 'Pending Clarification') kpis.pendingClarification += 1;
    if (status === 'Returned') kpis.returned += 1;
    if (status === 'On Hold') kpis.onHold += 1;

    const due = millis(row.currentDueAt);
    if (due != null && due < at) {
      kpis.overdue += 1;
      kpis.valueAtRisk += row.amount ?? 0;
    }
    const openFor = requestOpenHours(row, options.now);
    if (openFor != null && (oldest == null || openFor > oldest)) oldest = openFor;
  }

  const heldValues: number[] = [];
  const escalatedApprovals = new Set<string>();
  for (const step of steps) {
    const due = millis(step.dueAt);
    const finished = millis(step.completedAt);
    // Breached if it ran past its clock — whether it has since completed or is still running.
    if (due != null && ((finished != null && finished > due) || (finished == null && at > due))) {
      kpis.slaBreached += 1;
    }
    if ((step.escalationsSent ?? []).some((ruleId) => escalationRuleIds.has(ruleId))) {
      escalatedApprovals.add(step.approvalId);
    }
    if (step.completedAt) {
      const held = stepHeldHours(step, options.now);
      if (held != null) heldValues.push(held);
    }
  }
  kpis.escalated = escalatedApprovals.size;
  kpis.cycleHours = durationStats(cycleValues);
  kpis.stepHeldHours = durationStats(heldValues);
  kpis.oldestPendingHours = oldest == null ? null : round(oldest);
  kpis.valuePending = round(kpis.valuePending, 2);
  kpis.valueApproved = round(kpis.valueApproved, 2);
  kpis.valueAtRisk = round(kpis.valueAtRisk, 2);
  return kpis;
}

export type ComparisonPeriod = 'day' | 'week' | 'month' | 'year';

export interface KpiComparison {
  current: EApprovalKpis;
  previous: EApprovalKpis;
  /** Signed change per numeric KPI, and the percentage where a base exists. */
  delta: Record<string, { change: number; percent: number | null }>;
  window: { currentFrom: string; currentTo: string; previousFrom: string; previousTo: string };
}

const PERIOD_MS: Record<ComparisonPeriod, number> = {
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
  year: 365 * DAY_MS,
};

/**
 * The same KPIs over this period and the one before it.
 *
 * The comparison window is the *equivalent preceding span*, not calendar-aligned: comparing a
 * seven-day window against the previous seven days is a like-for-like the reader can act on, whereas
 * "this month so far" against "all of last month" is a comparison that always looks like a collapse
 * on the 2nd of the month.
 */
export function compareEApprovalKpis(
  rows: AnalyticsRequestRow[],
  steps: AnalyticsStepRow[],
  options: { now?: string | Date; period: ComparisonPeriod; escalationLadder?: EApprovalEscalationRule[] },
): KpiComparison {
  const at = nowMs(options.now);
  const span = PERIOD_MS[options.period];
  const currentFrom = at - span;
  const previousFrom = at - span * 2;

  const inWindow = (from: number, to: number) => (row: AnalyticsRequestRow) => {
    const submitted = millis(row.submittedAt);
    return submitted != null && submitted >= from && submitted < to;
  };
  const stepsFor = (subset: AnalyticsRequestRow[]) => {
    const ids = new Set(subset.map((row) => row.id));
    return steps.filter((step) => ids.has(step.approvalId));
  };

  const currentRows = rows.filter(inWindow(currentFrom, at));
  const previousRows = rows.filter(inWindow(previousFrom, currentFrom));
  const current = computeEApprovalKpis(currentRows, stepsFor(currentRows), options);
  const previous = computeEApprovalKpis(previousRows, stepsFor(previousRows), options);

  const delta: KpiComparison['delta'] = {};
  for (const key of Object.keys(current) as Array<keyof EApprovalKpis>) {
    const left = current[key];
    const right = previous[key];
    if (typeof left !== 'number' || typeof right !== 'number') continue;
    delta[key] = { change: round(left - right, 2), percent: right === 0 ? null : round(((left - right) / right) * 100) };
  }

  return {
    current,
    previous,
    delta,
    window: {
      currentFrom: new Date(currentFrom).toISOString(),
      currentTo: new Date(at).toISOString(),
      previousFrom: new Date(previousFrom).toISOString(),
      previousTo: new Date(currentFrom).toISOString(),
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Status distribution (spec section 2)
 * ---------------------------------------------------------------------------------------------- */

export interface StatusSlice {
  status: string;
  count: number;
  value: number;
  percent: number | null;
}

export function summarizeEApprovalStatuses(rows: AnalyticsRequestRow[]): StatusSlice[] {
  const tally = new Map<string, { count: number; value: number }>();
  for (const row of rows) {
    const key = String(row.status);
    const entry = tally.get(key) ?? { count: 0, value: 0 };
    entry.count += 1;
    entry.value += row.amount ?? 0;
    tally.set(key, entry);
  }
  return Array.from(tally.entries())
    .map(([status, entry]) => ({
      status,
      count: entry.count,
      value: round(entry.value, 2),
      percent: percentOf(entry.count, rows.length),
    }))
    .sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------------------------------------
 * Aging (spec section 3)
 * ---------------------------------------------------------------------------------------------- */

export const E_APPROVAL_AGE_BUCKETS = [
  { label: '0–4 hours', maxHours: 4 },
  { label: '4–8 hours', maxHours: 8 },
  { label: '8–24 hours', maxHours: 24 },
  { label: '1–2 days', maxHours: 48 },
  { label: '3–5 days', maxHours: 120 },
  { label: '6–7 days', maxHours: 168 },
  { label: '8–15 days', maxHours: 360 },
  { label: '16–30 days', maxHours: 720 },
  { label: 'Above 30 days', maxHours: Number.POSITIVE_INFINITY },
] as const;

export type EApprovalAgeBucket = (typeof E_APPROVAL_AGE_BUCKETS)[number]['label'];

export function eApprovalAgeBucketOf(hours: number | null | undefined): EApprovalAgeBucket | null {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return null;
  for (const bucket of E_APPROVAL_AGE_BUCKETS) {
    if (hours < bucket.maxHours) return bucket.label;
  }
  return 'Above 30 days';
}

export interface AgingRow {
  bucket: EApprovalAgeBucket;
  count: number;
  value: number;
  overdue: number;
  /** Highest priority present in the bucket, so a screen can flag it. */
  urgent: number;
}

/** Aging of the open pile, in the nine buckets the spec asks for. */
export function summarizeEApprovalAging(
  rows: AnalyticsRequestRow[],
  options: { now?: string | Date } = {},
): AgingRow[] {
  const at = nowMs(options.now);
  const tally = new Map<EApprovalAgeBucket, AgingRow>(
    E_APPROVAL_AGE_BUCKETS.map((bucket) => [
      bucket.label,
      { bucket: bucket.label, count: 0, value: 0, overdue: 0, urgent: 0 },
    ]),
  );
  for (const row of rows) {
    if (!isOpenEApprovalStatus(String(row.status))) continue;
    const bucket = eApprovalAgeBucketOf(requestOpenHours(row, options.now));
    if (!bucket) continue;
    const entry = tally.get(bucket) as AgingRow;
    entry.count += 1;
    entry.value = round(entry.value + (row.amount ?? 0), 2);
    const due = millis(row.currentDueAt);
    if (due != null && due < at) entry.overdue += 1;
    if (row.priority === 'Urgent' || row.priority === 'High') entry.urgent += 1;
  }
  return E_APPROVAL_AGE_BUCKETS.map((bucket) => tally.get(bucket.label) as AgingRow);
}

export interface OldestPendingRow {
  id: string;
  referenceNo?: string;
  subject?: string;
  requesterName?: string;
  departmentName?: string;
  pendingWith?: string;
  currentStepName?: string;
  pendingSince: string | null;
  ageHours: number;
  bucket: EApprovalAgeBucket | null;
  amount?: number;
  priority?: EApprovalPriority;
  overdue: boolean;
  escalationLevel: EApprovalEscalationLevel | null;
}

/**
 * The oldest open approvals, worst first — the table a director actually reads.
 *
 * Escalation level is resolved from the rules already fired on the file's live steps, so the row says
 * how far up it has travelled rather than only how long it has sat.
 */
export function oldestPendingEApprovals(
  rows: AnalyticsRequestRow[],
  steps: AnalyticsStepRow[] = [],
  options: { now?: string | Date; limit?: number; escalationLadder?: EApprovalEscalationRule[] } = {},
): OldestPendingRow[] {
  const at = nowMs(options.now);
  const levelByRule = new Map(
    (options.escalationLadder ?? []).filter((rule) => rule.level).map((rule) => [rule.id, rule.level as EApprovalEscalationLevel]),
  );
  const rank = (level: EApprovalEscalationLevel | null) =>
    level == null ? -1 : ['Level 1', 'Level 2', 'Level 3', 'Management'].indexOf(level);

  const stepsByApproval = new Map<string, AnalyticsStepRow[]>();
  for (const step of steps) {
    stepsByApproval.set(step.approvalId, [...(stepsByApproval.get(step.approvalId) ?? []), step]);
  }

  return rows
    .filter((row) => isOpenEApprovalStatus(String(row.status)))
    .map((row) => {
      const ageHours = requestOpenHours(row, options.now) ?? 0;
      const due = millis(row.currentDueAt);
      let highest: EApprovalEscalationLevel | null = null;
      for (const step of stepsByApproval.get(row.id) ?? []) {
        for (const ruleId of step.escalationsSent ?? []) {
          const level = levelByRule.get(ruleId);
          if (level && rank(level) > rank(highest)) highest = level;
        }
      }
      return {
        id: row.id,
        referenceNo: row.referenceNo,
        subject: row.subject,
        requesterName: row.requesterName,
        departmentName: row.departmentName,
        pendingWith: row.pendingLabel,
        currentStepName: row.currentStepName,
        pendingSince: row.submittedAt ?? null,
        ageHours: round(ageHours),
        bucket: eApprovalAgeBucketOf(ageHours),
        amount: row.amount,
        priority: row.priority,
        overdue: due != null && due < at,
        escalationLevel: highest,
      };
    })
    .sort((a, b) => b.ageHours - a.ageHours)
    .slice(0, options.limit ?? 50);
}

/* ------------------------------------------------------------------------------------------------
 * Bottlenecks (spec section 4)
 * ---------------------------------------------------------------------------------------------- */

export interface BottleneckActor {
  key: string;
  name: string;
  departmentName?: string;
  pending: number;
  overdue: number;
  /** Hours the oldest live step has been held. */
  oldestPendingHours: number;
  averagePendingHours: number;
  slaBreaches: number;
  pendingValue: number;
  /** Completed work, for context — a big queue on a fast desk is not the same problem. */
  completed: number;
  averageHeldHours: number;
}

const liveStep = (step: AnalyticsStepRow) =>
  ['Active', 'Awaiting Verification', 'Awaiting Clarification', 'On Hold'].includes(String(step.status));

/**
 * Who is holding the most, and for how long.
 *
 * Keyed on the person who *holds* the step rather than the step's nominal assignee, so a claimed
 * department step counts against whoever claimed it. Completed volume is reported alongside the
 * queue because the two together are the actual signal: a long queue on a desk that also clears the
 * most work is capacity, not obstruction, and the report should not accuse it of the latter.
 */
export function summarizeEApprovalBottleneckApprovers(
  steps: AnalyticsStepRow[],
  options: { now?: string | Date; limit?: number } = {},
): BottleneckActor[] {
  const at = nowMs(options.now);
  const tally = new Map<string, BottleneckActor & { pendingHours: number[]; heldHours: number[] }>();

  const holderOf = (step: AnalyticsStepRow) => {
    const id = step.actedByUserId || step.assignment?.userId || step.delegatedToUserId;
    const name =
      step.actedByName || step.assignment?.userName || step.assignment?.departmentName || step.assignment?.role;
    return { id: id || name || 'Unassigned', name: name || 'Unassigned' };
  };

  for (const step of steps) {
    const { id, name } = holderOf(step);
    const entry =
      tally.get(id) ??
      ({
        key: id,
        name,
        departmentName: step.assignment?.departmentName,
        pending: 0,
        overdue: 0,
        oldestPendingHours: 0,
        averagePendingHours: 0,
        slaBreaches: 0,
        pendingValue: 0,
        completed: 0,
        averageHeldHours: 0,
        pendingHours: [],
        heldHours: [],
      } as BottleneckActor & { pendingHours: number[]; heldHours: number[] });

    const due = millis(step.dueAt);
    const finished = millis(step.completedAt);
    if (due != null && ((finished != null && finished > due) || (finished == null && at > due))) {
      entry.slaBreaches += 1;
    }

    if (liveStep(step)) {
      entry.pending += 1;
      entry.pendingValue = round(entry.pendingValue + (step.amount ?? 0), 2);
      const held = stepHeldHours(step, options.now);
      if (held != null) {
        entry.pendingHours.push(held);
        entry.oldestPendingHours = Math.max(entry.oldestPendingHours, round(held));
      }
      if (due != null && at > due) entry.overdue += 1;
    } else if (step.completedAt) {
      entry.completed += 1;
      const held = stepHeldHours(step, options.now);
      if (held != null) entry.heldHours.push(held);
    }
    tally.set(id, entry);
  }

  return Array.from(tally.values())
    .map((entry) => ({
      key: entry.key,
      name: entry.name,
      departmentName: entry.departmentName,
      pending: entry.pending,
      overdue: entry.overdue,
      oldestPendingHours: entry.oldestPendingHours,
      averagePendingHours: round(safeDivide(entry.pendingHours.reduce((s, v) => s + v, 0), entry.pendingHours.length)),
      slaBreaches: entry.slaBreaches,
      pendingValue: entry.pendingValue,
      completed: entry.completed,
      averageHeldHours: round(safeDivide(entry.heldHours.reduce((s, v) => s + v, 0), entry.heldHours.length)),
    }))
    .filter((entry) => entry.pending > 0 || entry.completed > 0)
    .sort((a, b) => b.pending - a.pending || b.oldestPendingHours - a.oldestPendingHours)
    .slice(0, options.limit ?? 20);
}

export interface BottleneckStep {
  workflowStep: string;
  cases: number;
  processing: DurationStats;
  slaBreachPercent: number | null;
  returnPercent: number | null;
  reopenedPercent: number | null;
}

/**
 * Which stage of the workflow costs the most time.
 *
 * Grouped by step *name*, which is how a workflow stage is identified across requests — the step ids
 * are per-request. A stage with a high return rate and a low processing time is a different problem
 * from a slow one: the first is a badly-specified request reaching it, the second is a busy desk.
 */
export function summarizeEApprovalBottleneckSteps(
  steps: AnalyticsStepRow[],
  options: { now?: string | Date; limit?: number } = {},
): BottleneckStep[] {
  const at = nowMs(options.now);
  const tally = new Map<string, { hours: number[]; cases: number; breaches: number; returns: number; reopened: number }>();

  for (const step of steps) {
    const key = step.name || '(unnamed step)';
    const entry = tally.get(key) ?? { hours: [], cases: 0, breaches: 0, returns: 0, reopened: 0 };
    entry.cases += 1;
    if (step.completedAt) {
      const held = stepHeldHours(step, options.now);
      if (held != null) entry.hours.push(held);
    }
    const due = millis(step.dueAt);
    const finished = millis(step.completedAt);
    if (due != null && ((finished != null && finished > due) || (finished == null && at > due))) entry.breaches += 1;
    if (step.outcome === 'Returned') entry.returns += 1;
    if (step.reopened) entry.reopened += 1;
    tally.set(key, entry);
  }

  return Array.from(tally.entries())
    .map(([workflowStep, entry]) => ({
      workflowStep,
      cases: entry.cases,
      processing: durationStats(entry.hours),
      slaBreachPercent: percentOf(entry.breaches, entry.cases),
      returnPercent: percentOf(entry.returns, entry.cases),
      reopenedPercent: percentOf(entry.reopened, entry.cases),
    }))
    .sort((a, b) => b.processing.median - a.processing.median || b.cases - a.cases)
    .slice(0, options.limit ?? 20);
}

/* ------------------------------------------------------------------------------------------------
 * SLA (spec section 5)
 * ---------------------------------------------------------------------------------------------- */

export interface SlaSummary {
  /** Steps with a clock — the denominator for every percentage here. */
  measured: number;
  withinSla: number;
  approaching: number;
  breached: number;
  noClock: number;
  compliancePercent: number | null;
  byLevel: Array<{ level: EApprovalEscalationLevel; approvals: number }>;
}

/**
 * SLA state across a set of steps.
 *
 * "Approaching" is 80% of the clock consumed, matching the threshold the workflow module already uses
 * for escalation, so the dashboard and the reminders agree about what "nearly late" means.
 */
export function summarizeEApprovalSla(
  steps: AnalyticsStepRow[],
  options: { now?: string | Date; escalationLadder?: EApprovalEscalationRule[]; approachingAt?: number } = {},
): SlaSummary {
  const at = nowMs(options.now);
  const threshold = options.approachingAt ?? 0.8;
  const levelByRule = new Map(
    (options.escalationLadder ?? []).filter((rule) => rule.level).map((rule) => [rule.id, rule.level as EApprovalEscalationLevel]),
  );
  const perLevel = new Map<EApprovalEscalationLevel, Set<string>>();

  let measured = 0;
  let withinSla = 0;
  let approaching = 0;
  let breached = 0;
  let noClock = 0;

  for (const step of steps) {
    for (const ruleId of step.escalationsSent ?? []) {
      const level = levelByRule.get(ruleId);
      if (!level) continue;
      const bucket = perLevel.get(level) ?? new Set<string>();
      bucket.add(step.approvalId);
      perLevel.set(level, bucket);
    }

    const started = millis(step.startedAt);
    const due = millis(step.dueAt);
    if (started == null || due == null) {
      noClock += 1;
      continue;
    }
    measured += 1;
    const finished = millis(step.completedAt);
    if (finished != null) {
      if (finished > due) breached += 1;
      else withinSla += 1;
      continue;
    }
    if (at > due) {
      breached += 1;
      continue;
    }
    const consumed = safeDivide(at - started, due - started);
    if (consumed >= threshold) approaching += 1;
    else withinSla += 1;
  }

  return {
    measured,
    withinSla,
    approaching,
    breached,
    noClock,
    compliancePercent: percentOf(withinSla + approaching, measured),
    byLevel: (['Level 1', 'Level 2', 'Level 3', 'Management'] as EApprovalEscalationLevel[])
      .map((level) => ({ level, approvals: perLevel.get(level)?.size ?? 0 }))
      .filter((entry) => entry.approvals > 0),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Approver performance (spec section 6)
 * ---------------------------------------------------------------------------------------------- */

export interface ApproverPerformance {
  userId: string;
  name: string;
  assigned: number;
  approved: number;
  rejected: number;
  returned: number;
  verified: number;
  clarified: number;
  skipped: number;
  pending: number;
  overdue: number;
  slaBreaches: number;
  slaBreachPercent: number | null;
  response: DurationStats;
  approvalRatePercent: number | null;
  returnRatePercent: number | null;
  /** Actions taken on somebody else's behalf, under a delegation. */
  onBehalfOf: number;
}

/**
 * Per-person workflow metrics.
 *
 * Attributed to whoever *acted* (`actedByUserId`), not to the nominal assignee, so a delegate's work
 * counts as theirs and the delegator is not credited with decisions they did not make. `onBehalfOf`
 * keeps that visible rather than silent.
 *
 * These are workflow metrics, not an appraisal. A high return rate can be diligence and a low
 * response time can be rubber-stamping; the numbers describe a queue, not a person's worth.
 */
export function summarizeEApprovalApprovers(
  steps: AnalyticsStepRow[],
  options: { now?: string | Date; limit?: number } = {},
): ApproverPerformance[] {
  const at = nowMs(options.now);
  const tally = new Map<string, ApproverPerformance & { responseHours: number[] }>();

  const blank = (userId: string, name: string) =>
    ({
      userId,
      name,
      assigned: 0,
      approved: 0,
      rejected: 0,
      returned: 0,
      verified: 0,
      clarified: 0,
      skipped: 0,
      pending: 0,
      overdue: 0,
      slaBreaches: 0,
      slaBreachPercent: null,
      response: { ...EMPTY_DURATION },
      approvalRatePercent: null,
      returnRatePercent: null,
      onBehalfOf: 0,
      responseHours: [],
    }) as ApproverPerformance & { responseHours: number[] };

  for (const step of steps) {
    const actedBy = step.actedByUserId;
    const assignedTo = step.assignment?.kind === 'User' ? step.assignment.userId : undefined;
    const userId = actedBy || assignedTo || step.delegatedToUserId;
    if (!userId) continue;
    const name = step.actedByName || step.assignment?.userName || userId;
    const entry = tally.get(userId) ?? blank(userId, name);
    entry.name = name;
    entry.assigned += 1;

    if (step.onBehalfOfUserId && actedBy === userId) entry.onBehalfOf += 1;

    if (liveStep(step)) {
      entry.pending += 1;
      const due = millis(step.dueAt);
      if (due != null && at > due) entry.overdue += 1;
    }

    const due = millis(step.dueAt);
    const finished = millis(step.completedAt);
    if (due != null && ((finished != null && finished > due) || (finished == null && at > due))) {
      entry.slaBreaches += 1;
    }

    if (finished != null) {
      // Response time counts only steps this person actually decided. A step that was auto-skipped
      // because a parallel group was already satisfied takes near-zero time and was never worked on;
      // counting it drags the average toward zero and flatters whoever happened to be on that group.
      const decided =
        step.outcome != null && !['Skipped', 'Cancelled', 'Superseded'].includes(String(step.outcome));
      if (decided) {
        const held = stepHeldHours(step, options.now);
        if (held != null) entry.responseHours.push(held);
      }
      switch (step.outcome) {
        case 'Approved':
          entry.approved += 1;
          break;
        case 'Rejected':
          entry.rejected += 1;
          break;
        case 'Returned':
          entry.returned += 1;
          break;
        case 'Verified':
        case 'Verified With Observation':
        case 'Not Verified':
          entry.verified += 1;
          break;
        case 'Clarified':
          entry.clarified += 1;
          break;
        case 'Skipped':
          entry.skipped += 1;
          break;
        default:
          break;
      }
    }
    tally.set(userId, entry);
  }

  return Array.from(tally.values())
    .map((entry) => {
      // Decisions only: a skipped step is not a decision, and counting it would deflate every rate.
      const decisions = entry.approved + entry.rejected + entry.returned + entry.verified + entry.clarified;
      return {
        ...entry,
        response: durationStats(entry.responseHours),
        slaBreachPercent: percentOf(entry.slaBreaches, entry.assigned),
        approvalRatePercent: percentOf(entry.approved + entry.verified + entry.clarified, decisions),
        returnRatePercent: percentOf(entry.returned, decisions),
        responseHours: undefined as unknown as number[],
      };
    })
    .map(({ responseHours, ...rest }) => rest as ApproverPerformance)
    .sort((a, b) => b.assigned - a.assigned)
    .slice(0, options.limit ?? 100);
}

/* ------------------------------------------------------------------------------------------------
 * Dimension rollups — department, project, type, requester (spec sections 7, 11, 13, 14)
 * ---------------------------------------------------------------------------------------------- */

export type EApprovalDimension = 'department' | 'project' | 'approvalType' | 'requester' | 'priority';

export interface DimensionRollup {
  key: string;
  label: string;
  raised: number;
  pending: number;
  approved: number;
  rejected: number;
  returned: number;
  overdue: number;
  valuePending: number;
  valueApproved: number;
  cycleHours: DurationStats;
  approvalRatePercent: number | null;
}

const dimensionOf = (row: AnalyticsRequestRow, dimension: EApprovalDimension) => {
  switch (dimension) {
    case 'department':
      return { key: row.departmentId ?? 'none', label: row.departmentName ?? 'Unassigned' };
    case 'project':
      return { key: row.projectId ?? 'none', label: row.projectName ?? 'Not project-specific' };
    case 'approvalType':
      return { key: row.approvalTypeId ?? 'none', label: row.approvalTypeName ?? 'Unspecified' };
    case 'requester':
      return { key: row.requesterId, label: row.requesterName ?? row.requesterId };
    case 'priority':
      return { key: row.priority ?? 'Normal', label: row.priority ?? 'Normal' };
    default:
      return { key: 'none', label: 'Unassigned' };
  }
};

/** One rollup function for every "by department / by project / by type" report. */
export function rollupEApprovals(
  rows: AnalyticsRequestRow[],
  dimension: EApprovalDimension,
  options: { now?: string | Date } = {},
): DimensionRollup[] {
  const at = nowMs(options.now);
  const tally = new Map<string, DimensionRollup & { cycles: number[] }>();

  for (const row of rows) {
    const { key, label } = dimensionOf(row, dimension);
    const entry =
      tally.get(key) ??
      ({
        key,
        label,
        raised: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        returned: 0,
        overdue: 0,
        valuePending: 0,
        valueApproved: 0,
        cycleHours: { ...EMPTY_DURATION },
        approvalRatePercent: null,
        cycles: [],
      } as DimensionRollup & { cycles: number[] });

    const status = String(row.status);
    if (status !== 'Draft') entry.raised += 1;
    if (status === 'Approved') {
      entry.approved += 1;
      entry.valueApproved = round(entry.valueApproved + (row.amount ?? 0), 2);
      const cycle = requestCycleHours(row);
      if (cycle != null) entry.cycles.push(cycle);
    } else if (status === 'Rejected') entry.rejected += 1;
    else if (status === 'Returned') entry.returned += 1;

    if (isOpenEApprovalStatus(status)) {
      entry.pending += 1;
      entry.valuePending = round(entry.valuePending + (row.amount ?? 0), 2);
      const due = millis(row.currentDueAt);
      if (due != null && due < at) entry.overdue += 1;
    }
    tally.set(key, entry);
  }

  return Array.from(tally.values())
    .map(({ cycles, ...entry }) => ({
      ...entry,
      cycleHours: durationStats(cycles),
      approvalRatePercent: percentOf(entry.approved, entry.approved + entry.rejected),
    }))
    .sort((a, b) => b.raised - a.raised);
}

/* ------------------------------------------------------------------------------------------------
 * Return / rework (spec section: Return-Rework Analytics)
 * ---------------------------------------------------------------------------------------------- */

export interface ReworkSummary {
  requestsReturned: number;
  totalReturns: number;
  /** Requests returned more than once — the ones worth investigating. */
  repeatedlyReturned: number;
  requestsSuperseded: number;
  averageReturnsPerRequest: number;
  returnRatePercent: number | null;
  /** Which step sends work back most. */
  byStep: Array<{ stepName: string; returns: number }>;
  /** Requests whose content changed after approval, forcing re-approval. */
  supersededVersions: number;
}

export function summarizeEApprovalRework(
  rows: AnalyticsRequestRow[],
  steps: AnalyticsStepRow[],
  events: AnalyticsEventRow[] = [],
): ReworkSummary {
  const returnsByRequest = new Map<string, number>();
  const byStep = new Map<string, number>();

  // Prefer the event log: a step's outcome only remembers its *last* action, so a step that returned
  // a file twice would otherwise count once.
  const returnEvents = events.filter((event) => event.kind === 'Return');
  if (returnEvents.length) {
    for (const event of returnEvents) {
      returnsByRequest.set(event.approvalId, (returnsByRequest.get(event.approvalId) ?? 0) + 1);
      const key = event.stepName || '(unknown step)';
      byStep.set(key, (byStep.get(key) ?? 0) + 1);
    }
  } else {
    for (const step of steps) {
      if (step.outcome !== 'Returned') continue;
      returnsByRequest.set(step.approvalId, (returnsByRequest.get(step.approvalId) ?? 0) + 1);
      byStep.set(step.name, (byStep.get(step.name) ?? 0) + 1);
    }
  }

  const totalReturns = Array.from(returnsByRequest.values()).reduce((sum, value) => sum + value, 0);
  const submitted = rows.filter((row) => String(row.status) !== 'Draft').length;
  const supersededVersions = rows.reduce((sum, row) => sum + (row.supersededCount ?? 0), 0);

  return {
    requestsReturned: returnsByRequest.size,
    totalReturns,
    repeatedlyReturned: Array.from(returnsByRequest.values()).filter((count) => count > 1).length,
    requestsSuperseded: rows.filter((row) => (row.supersededCount ?? 0) > 0).length,
    averageReturnsPerRequest: round(safeDivide(totalReturns, returnsByRequest.size), 2),
    returnRatePercent: percentOf(returnsByRequest.size, submitted),
    byStep: Array.from(byStep.entries())
      .map(([stepName, returns]) => ({ stepName, returns }))
      .sort((a, b) => b.returns - a.returns),
    supersededVersions,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Verification load (spec section: Verification Analytics)
 * ---------------------------------------------------------------------------------------------- */

export interface VerificationSummary {
  raised: number;
  completed: number;
  pending: number;
  verified: number;
  verifiedWithObservation: number;
  notVerified: number;
  clarifications: number;
  /** How deep verification chains actually go, which is what justifies the depth cap. */
  maxDepth: number;
  nestedCount: number;
  turnaround: DurationStats;
  /** Requests that needed at least one verification, as a share of those submitted. */
  usageRatePercent: number | null;
  byVerifier: Array<{ name: string; raised: number; completed: number; averageHours: number }>;
}

export function summarizeEApprovalVerification(
  steps: AnalyticsStepRow[],
  rows: AnalyticsRequestRow[] = [],
  options: { now?: string | Date } = {},
): VerificationSummary {
  const verificationSteps = steps.filter(
    (step) => step.depth > 0 && (step.type === 'VERIFICATION' || step.type === 'REVIEW'),
  );
  const clarificationSteps = steps.filter((step) => step.depth > 0 && step.type === 'CLARIFICATION');

  const hours: number[] = [];
  const byVerifier = new Map<string, { raised: number; completed: number; hours: number[] }>();
  let verified = 0;
  let observation = 0;
  let notVerified = 0;
  let pending = 0;
  let maxDepth = 0;

  for (const step of verificationSteps) {
    maxDepth = Math.max(maxDepth, step.depth);
    const name = step.actedByName || step.assignment?.userName || step.assignment?.departmentName || 'Unassigned';
    const entry = byVerifier.get(name) ?? { raised: 0, completed: 0, hours: [] };
    entry.raised += 1;

    if (liveStep(step)) pending += 1;
    if (step.completedAt) {
      entry.completed += 1;
      const held = stepHeldHours(step, options.now);
      if (held != null) {
        hours.push(held);
        entry.hours.push(held);
      }
      if (step.outcome === 'Verified') verified += 1;
      else if (step.outcome === 'Verified With Observation') observation += 1;
      else if (step.outcome === 'Not Verified') notVerified += 1;
    }
    byVerifier.set(name, entry);
  }

  const touched = new Set(verificationSteps.map((step) => step.approvalId));
  const submitted = rows.filter((row) => String(row.status) !== 'Draft').length;

  return {
    raised: verificationSteps.length,
    completed: verified + observation + notVerified,
    pending,
    verified,
    verifiedWithObservation: observation,
    notVerified,
    clarifications: clarificationSteps.length,
    maxDepth,
    nestedCount: verificationSteps.filter((step) => step.depth > 1).length,
    turnaround: durationStats(hours),
    usageRatePercent: rows.length ? percentOf(touched.size, submitted) : null,
    byVerifier: Array.from(byVerifier.entries())
      .map(([name, entry]) => ({
        name,
        raised: entry.raised,
        completed: entry.completed,
        averageHours: round(safeDivide(entry.hours.reduce((s, v) => s + v, 0), entry.hours.length)),
      }))
      .sort((a, b) => b.raised - a.raised),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Trend
 * ---------------------------------------------------------------------------------------------- */

export interface TrendPoint {
  key: string;
  label: string;
  raised: number;
  approved: number;
  rejected: number;
  valueApproved: number;
}

/**
 * Raised against closed, bucketed by day or month.
 *
 * Buckets are pre-seeded across the whole span so a month with no activity renders as a zero rather
 * than vanishing — a gap in a trend line reads as missing data, not as a quiet month.
 */
export function eApprovalTrend(
  rows: AnalyticsRequestRow[],
  options: { now?: string | Date; granularity?: 'day' | 'month'; buckets?: number } = {},
): TrendPoint[] {
  const granularity = options.granularity ?? 'month';
  const count = options.buckets ?? (granularity === 'day' ? 30 : 12);
  const at = new Date(nowMs(options.now));

  const keyOf = (date: Date) =>
    granularity === 'day'
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const labelOf = (date: Date) =>
    granularity === 'day'
      ? date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
      : date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

  const points = new Map<string, TrendPoint>();
  for (let index = count - 1; index >= 0; index -= 1) {
    const date =
      granularity === 'day'
        ? new Date(at.getFullYear(), at.getMonth(), at.getDate() - index)
        : new Date(at.getFullYear(), at.getMonth() - index, 1);
    points.set(keyOf(date), { key: keyOf(date), label: labelOf(date), raised: 0, approved: 0, rejected: 0, valueApproved: 0 });
  }

  const bump = (value: string | null | undefined, apply: (point: TrendPoint) => void) => {
    const time = millis(value);
    if (time == null) return;
    const point = points.get(keyOf(new Date(time)));
    if (point) apply(point);
  };

  for (const row of rows) {
    bump(row.submittedAt, (point) => {
      point.raised += 1;
    });
    if (String(row.status) === 'Approved') {
      bump(row.completedAt, (point) => {
        point.approved += 1;
        point.valueApproved = round(point.valueApproved + (row.amount ?? 0), 2);
      });
    } else if (String(row.status) === 'Rejected') {
      bump(row.completedAt, (point) => {
        point.rejected += 1;
      });
    }
  }

  return Array.from(points.values());
}

/* ------------------------------------------------------------------------------------------------
 * Financial exposure (spec section: Financial Approval Analytics)
 * ---------------------------------------------------------------------------------------------- */

export const E_APPROVAL_VALUE_BANDS = [
  { label: 'Up to ₹25,000', max: 25_000 },
  { label: '₹25,001 – ₹1,00,000', max: 100_000 },
  { label: '₹1,00,001 – ₹5,00,000', max: 500_000 },
  { label: '₹5,00,001 – ₹25,00,000', max: 2_500_000 },
  { label: '₹25,00,001 – ₹1,00,00,000', max: 10_000_000 },
  { label: 'Above ₹1 crore', max: Number.POSITIVE_INFINITY },
] as const;

export interface ValueBandRow {
  band: string;
  count: number;
  pending: number;
  approved: number;
  valuePending: number;
  valueApproved: number;
}

/** Approvals by money band — the shape of financial exposure, not just its total. */
export function summarizeEApprovalValueBands(rows: AnalyticsRequestRow[]): ValueBandRow[] {
  const tally = new Map<string, ValueBandRow>(
    E_APPROVAL_VALUE_BANDS.map((band) => [
      band.label,
      { band: band.label, count: 0, pending: 0, approved: 0, valuePending: 0, valueApproved: 0 },
    ]),
  );
  for (const row of rows) {
    if (row.amount == null) continue;
    const band = E_APPROVAL_VALUE_BANDS.find((candidate) => row.amount! <= candidate.max);
    if (!band) continue;
    const entry = tally.get(band.label) as ValueBandRow;
    entry.count += 1;
    const status = String(row.status);
    if (isOpenEApprovalStatus(status)) {
      entry.pending += 1;
      entry.valuePending = round(entry.valuePending + row.amount, 2);
    } else if (status === 'Approved') {
      entry.approved += 1;
      entry.valueApproved = round(entry.valueApproved + row.amount, 2);
    }
  }
  return E_APPROVAL_VALUE_BANDS.map((band) => tally.get(band.label) as ValueBandRow);
}

/** Terminal-status share, for the compliance and audit views. */
export function eApprovalClosureRates(rows: AnalyticsRequestRow[]): {
  submitted: number;
  closed: number;
  open: number;
  closureRatePercent: number | null;
} {
  const submitted = rows.filter((row) => String(row.status) !== 'Draft');
  const closed = submitted.filter((row) => isTerminalEApprovalStatus(String(row.status)));
  return {
    submitted: submitted.length,
    closed: closed.length,
    open: submitted.length - closed.length,
    closureRatePercent: percentOf(closed.length, submitted.length),
  };
}
