/**
 * The central work dashboard: one screen that answers "is anything waiting on me?"
 *
 * Before this existed the home page was a launcher — one card per module the user could open — and
 * finding out whether anything needed you meant visiting up to thirty-one screens and knowing which
 * of them had a per-user queue. Four modules had built one (`hr/my-tasks`, `insurance/my-tasks`,
 * `e-approval/inbox`, and the sign-in summary in `windows-agent-morning.ts`); the other twenty-seven
 * had nothing, and none of the four knew about the others.
 *
 * ── Why a read-time fan-out rather than a `workItems` collection ───────────────────────────────
 *
 * The obvious design is a single collection every module writes a row into. It is also the wrong
 * one here, for the same reason `windows-agent-morning.ts` gives: a parallel copy of the truth has
 * to be kept in step with it, and the failure mode is a dashboard that tells somebody to approve a
 * file that was approved an hour ago. Every module already stores who its open work is pending with
 * — it just stores it under eleven different field names. So this reads those fields directly. Clear
 * your E-Approval inbox in another tab and a refresh here is correct, with nothing to reconcile.
 *
 * The cost is one query per source rather than one query total. That is paid for in three ways, all
 * in `work-dashboard-sources.ts`: a source whose module the viewer cannot see is never queried at
 * all, every query is capped, and every query's failure is an empty list rather than a broken page.
 *
 * ── Why the lanes are not one list ─────────────────────────────────────────────────────────────
 *
 * `action` is work a field names *you* for. `shared` is work your role or permission lets you take
 * but which names nobody — the FD/BG/LC approval queue routes by `requiredRole`, and Store & Stock's
 * submitted documents route by who holds the Approve permission. Merging the two would be the one
 * genuinely misleading thing this screen could do: you cannot tell what you are accountable for from
 * what anybody in your role could pick up. They stay labelled and separate.
 *
 * This module is deliberately dependency-free — no Firestore, no React — so the ordering and urgency
 * rules are unit-testable under plain node (`tests/work-dashboard.test.mjs`). Everything that talks
 * to a database lives in `work-dashboard-sources.ts`.
 */

/* ── shape ─────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Which section of the dashboard an item belongs in.
 *
 * - `action`   — a field on the record names this user. They are accountable for it.
 * - `shared`   — their role or permission admits them to a queue that names nobody.
 * - `meeting`  — a calendar commitment, or an invitation awaiting their response.
 * - `watching` — they are the requester, a watcher, or the subject of a reminder. No action implied.
 */
export type WorkLane = 'action' | 'shared' | 'meeting' | 'watching';

export const WORK_LANES: readonly WorkLane[] = ['action', 'shared', 'meeting', 'watching'] as const;

export const WORK_LANE_TITLE: Record<WorkLane, string> = {
  action: 'Needs your action',
  shared: "Your team's queue",
  meeting: 'Meetings',
  watching: 'Waiting on others',
};

export const WORK_LANE_HINT: Record<WorkLane, string> = {
  action: 'Assigned to you by name.',
  shared: 'Open to your role or permission — nobody is named yet.',
  meeting: 'Today and the week ahead.',
  watching: 'Raised by you, or you are a watcher. Nothing to do yet.',
};

/** How close an item is to — or past — its deadline. */
export type WorkUrgency = 'overdue' | 'today' | 'soon' | 'later' | 'undated';

export const WORK_URGENCY_LABEL: Record<WorkUrgency, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  soon: 'Due soon',
  later: 'Scheduled',
  undated: 'No deadline',
};

/**
 * Priority, normalised across the modules.
 *
 * Office Hub uses Low/Medium/High/Critical, Recurring Payments uses Low/Normal/High/Critical, and
 * the vehicle insurance workflow uses Normal/High/Critical. `normalizeWorkPriority` folds all three
 * onto this scale so one sort comparator works for every source.
 */
export type WorkPriority = 'Critical' | 'High' | 'Normal' | 'Low';

const PRIORITY_WEIGHT: Record<WorkPriority, number> = {
  Critical: 0,
  High: 1,
  Normal: 2,
  Low: 3,
};

/** A single piece of pending work, in the one shape the dashboard renders. */
export interface WorkItem {
  /**
   * Unique across the whole dashboard, not just within a source.
   *
   * `${sourceId}:${documentId}` rather than the bare document id, because the same document can
   * legitimately arrive twice — an E-Approval file can be pending with you *and* with your
   * department — and because two modules can hold documents with the same auto-id.
   */
  id: string;
  /** Which loader produced this. Keyed to `WORK_SOURCES`. */
  sourceId: string;
  /** Canonical module name from `@/lib/activity-modules`, for the badge and the grouping. */
  module: string;
  lane: WorkLane;
  /** What the item is, in the words the owning module uses. */
  title: string;
  /** The module's own human reference — `NS-2451`, `DR-8890`, a policy number. */
  reference?: string | null;
  /** The workflow step it is sitting on, where the module tracks one. */
  stage?: string | null;
  /** Deep link. The whole point of the screen: every row goes straight to where the work is done. */
  href: string;
  /** ISO date (`YYYY-MM-DD`) or full instant. Null when the module tracks no deadline. */
  dueAt?: string | null;
  /** Clock time, for meetings — which are stored as a calendar date plus a wall time, not an instant. */
  startTime?: string | null;
  amount?: number | null;
  priority?: WorkPriority | null;
  /** Who raised it, where that is the useful second line. */
  raisedBy?: string | null;
  /**
   * Set when the row stands for a queue rather than for one record.
   *
   * Shared queues are bulk by nature — Daily Requisition can have several hundred entries sitting at
   * a stage, and Store & Stock's submitted documents are the same shape of thing. Listing them
   * individually would bury the nine items that actually name you under three hundred that name
   * nobody, which is the exact failure this screen exists to fix. So a shared source may return one
   * row carrying a count, and the renderer shows it as "143 entries awaiting action →".
   *
   * Null or absent means the row is a single record. Only `shared` sources set it.
   */
  count?: number | null;
}

/* ── dates ─────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Reduce any of the five date representations in this codebase to an ISO calendar date.
 *
 * The modules genuinely disagree: Office Hub stores `YYYY-MM-DD` strings, the E-Approval engine
 * stores ISO instants, the requisition workflows store Firestore `Timestamp`s, and a couple of
 * places store `{seconds}` objects left by an older SDK. A comparator cannot be written against
 * that, so everything is flattened here on the way in.
 *
 * Returns null rather than throwing or guessing: an unparseable date means "no deadline", which is
 * a state the dashboard already renders, and is far better than sorting a garbled value to the top
 * of somebody's overdue list.
 */
export function toWorkDate(value: unknown): string | null {
  if (value == null || value === '') return null;

  if (typeof value === 'string') {
    // Already a calendar date — the common case, and the one worth not round-tripping through Date,
    // which would reinterpret it in the viewer's timezone and can move it a day.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : toWorkDate(parsed);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }

  if (typeof value === 'number') return toWorkDate(new Date(value));

  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof candidate.toDate === 'function') {
      try {
        return toWorkDate(candidate.toDate());
      } catch {
        return null;
      }
    }
    const seconds = candidate.seconds ?? candidate._seconds;
    if (typeof seconds === 'number') return toWorkDate(new Date(seconds * 1000));
  }

  return null;
}

/** Whole days from `today` to `date`. Negative when `date` is in the past. */
export function daysUntil(date: string, today: string): number {
  const to = Date.parse(`${date}T00:00:00Z`);
  const from = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(to) || Number.isNaN(from)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/** Inside this many days, an item reads as "due soon" rather than merely scheduled. */
export const DUE_SOON_DAYS = 3;

export function workUrgency(item: Pick<WorkItem, 'dueAt'>, today: string): WorkUrgency {
  const due = toWorkDate(item.dueAt);
  if (!due) return 'undated';
  const days = daysUntil(due, today);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= DUE_SOON_DAYS) return 'soon';
  return 'later';
}

/* ── ordering ──────────────────────────────────────────────────────────────────────────────────── */

const URGENCY_RANK: Record<WorkUrgency, number> = {
  overdue: 0,
  today: 1,
  soon: 2,
  later: 3,
  undated: 4,
};

/**
 * The order the rows appear in, within a lane.
 *
 * Urgency band first, then the due date inside it, then priority, then module and title so the
 * result is stable — a dashboard whose rows reshuffle between two refreshes of the same data is one
 * people stop trusting. Note that within `overdue` the *oldest* deadline sorts first, which is the
 * same ascending-date comparison as every other band, and happens to be what you want: the thing
 * you are furthest behind on is at the top.
 */
export function compareWorkItems(left: WorkItem, right: WorkItem, today: string): number {
  const byUrgency = URGENCY_RANK[workUrgency(left, today)] - URGENCY_RANK[workUrgency(right, today)];
  if (byUrgency !== 0) return byUrgency;

  const leftDue = toWorkDate(left.dueAt);
  const rightDue = toWorkDate(right.dueAt);
  if (leftDue && rightDue && leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;

  // Meetings on the same day are only distinguishable by their clock time.
  const leftTime = left.startTime ?? '';
  const rightTime = right.startTime ?? '';
  if (leftTime !== rightTime) {
    if (!leftTime) return 1;
    if (!rightTime) return -1;
    return leftTime < rightTime ? -1 : 1;
  }

  const byPriority =
    PRIORITY_WEIGHT[normalizeWorkPriority(left.priority) ?? 'Normal'] -
    PRIORITY_WEIGHT[normalizeWorkPriority(right.priority) ?? 'Normal'];
  if (byPriority !== 0) return byPriority;

  if (left.module !== right.module) return left.module < right.module ? -1 : 1;
  return left.title.localeCompare(right.title);
}

/** Fold a module's own priority vocabulary onto the shared scale. Unknown values become null. */
export function normalizeWorkPriority(value: unknown): WorkPriority | null {
  if (typeof value !== 'string') return null;
  switch (value.trim().toLowerCase()) {
    case 'critical':
    case 'urgent':
      return 'Critical';
    case 'high':
      return 'High';
    // Office Hub's scale has no "Normal"; its middle band is "Medium".
    case 'medium':
    case 'normal':
      return 'Normal';
    case 'low':
      return 'Low';
    default:
      return null;
  }
}

/* ── grouping ──────────────────────────────────────────────────────────────────────────────────── */

export type WorkLanes = Record<WorkLane, WorkItem[]>;

/**
 * Split items into their lanes, sorted, with duplicates collapsed.
 *
 * The de-duplication is not defensive tidying — it is load-bearing. E-Approval's inbox is three
 * queries (mine, my departments, my roles) because Firestore cannot express "any of these three
 * arrays contains me" in one, and a file routed to a department you are in *and* to you personally
 * comes back from two of them. Keyed on `id`, so the `action` copy and the `shared` copy of the same
 * document survive as one row each — which is correct, they are different statements — while two
 * identical rows collapse to one.
 */
export function groupWorkItems(items: WorkItem[], today: string): WorkLanes {
  const seen = new Set<string>();
  const lanes: WorkLanes = { action: [], shared: [], meeting: [], watching: [] };

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    lanes[item.lane].push(item);
  }

  for (const lane of WORK_LANES) {
    lanes[lane].sort((left, right) => compareWorkItems(left, right, today));
  }
  return lanes;
}

/**
 * An item that is in `action` is not also shown in `shared` or `watching`.
 *
 * A file pending with you personally is also, technically, pending with your department, and you are
 * also its requester if you raised it. Showing it three times under three headings is how a
 * dashboard with nine real items looks like twenty-three. Accountability wins: if a field names you,
 * the row appears once, in `action`.
 */
export function dropLowerLaneDuplicates(items: WorkItem[]): WorkItem[] {
  const laneRank: Record<WorkLane, number> = { action: 0, meeting: 1, shared: 2, watching: 3 };
  const best = new Map<string, WorkItem>();

  for (const item of items) {
    // Keyed on the underlying record, not on `item.id`, which already includes the source.
    const key = `${item.module}:${item.href}`;
    const existing = best.get(key);
    if (!existing || laneRank[item.lane] < laneRank[existing.lane]) best.set(key, item);
  }
  return [...best.values()];
}

/* ── summary ───────────────────────────────────────────────────────────────────────────────────── */

export interface WorkSummary {
  /** Everything in the `action` lane. The number that matters. */
  action: number;
  /** The subset of `action` that is past its deadline. */
  overdue: number;
  /** The subset of `action` due today. */
  dueToday: number;
  /** Records in shared queues — counting an aggregate row as the queue depth it stands for. */
  shared: number;
  meetingsToday: number;
  watching: number;
  /** Distinct modules represented in the `action` lane — "across 5 modules". */
  modules: number;
}

/** A row's weight in a count: its queue depth if it is an aggregate, otherwise one. */
export function workItemWeight(item: WorkItem): number {
  return typeof item.count === 'number' && item.count > 0 ? item.count : 1;
}

export function summarizeWork(lanes: WorkLanes, today: string): WorkSummary {
  const action = lanes.action;
  return {
    action: action.length,
    overdue: action.filter((item) => workUrgency(item, today) === 'overdue').length,
    dueToday: action.filter((item) => workUrgency(item, today) === 'today').length,
    shared: lanes.shared.reduce((total, item) => total + workItemWeight(item), 0),
    meetingsToday: lanes.meeting.filter((item) => toWorkDate(item.dueAt) === today).length,
    watching: lanes.watching.length,
    modules: new Set(action.map((item) => item.module)).size,
  };
}

/** Counts per module within a lane, for the "by module" breakdown. Highest first. */
export function countByModule(items: WorkItem[]): Array<{ module: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.module, (counts.get(item.module) ?? 0) + 1);
  return [...counts.entries()]
    .map(([module, count]) => ({ module, count }))
    .sort((left, right) => right.count - left.count || left.module.localeCompare(right.module));
}

/* ── presentation ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Badge classes per urgency.
 *
 * Written as explicit light/dark pairs rather than with the `--chart-*` tokens, which are defined
 * only for the dark theme in `globals.css` and render invisible against the light default.
 */
export const WORK_URGENCY_BADGE: Record<WorkUrgency, string> = {
  overdue: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900',
  today: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  soon: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900',
  later: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800',
  undated: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800',
};

/** "2 days overdue", "Due today", "Due in 3 days" — the phrase under a row. */
export function dueLabel(item: Pick<WorkItem, 'dueAt'>, today: string): string {
  const due = toWorkDate(item.dueAt);
  if (!due) return 'No deadline';
  const days = daysUntil(due, today);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days === -1) return '1 day overdue';
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return `Due in ${days} days`;
}
