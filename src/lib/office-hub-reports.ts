/**
 * Report aggregation (§39, §40, §73).
 *
 * Pure: every function takes the records the page has already fetched and returns rows ready to
 * render or export. Nothing here reads Firestore, so the same aggregation feeds the on-screen chart,
 * the Excel export and a test — and a report can be checked against a fixture rather than against
 * the database.
 *
 * ── One constraint runs through all of it ───────────────────────────────────────────────────────
 *
 * §40 and §73 both say, in as many words, that the system must not produce performance scores or
 * rankings. So every per-person and per-team figure below is a plain count of a plainly named
 * thing — active tasks, overdue tasks, meetings attended — and there is no composite, no weighted
 * index, and no ordering by "productivity". The restraint is the feature: the moment several counts
 * are folded into one number, that number gets used to compare people, and nobody involved agreed
 * to the weights. Callers sort by whichever single count they are actually asking about.
 */

import {
  daysBetween,
  monthKey,
  type IsoDate,
} from './office-hub-time.ts';
import {
  OFFICE_HUB_PRIORITIES,
  TASK_STATUSES,
  type MeetingStatus,
  type OfficeHubActionItem,
  type OfficeHubDecision,
  type OfficeHubMeeting,
  type OfficeHubParticipant,
  type OfficeHubPriority,
  type OfficeHubTask,
  type TaskStatus,
} from './office-hub-model.ts';
import {
  isActionItemOverdue,
  isDecisionOverdue,
  isOpenActionItemStatus,
  isOpenDecisionStatus,
  isTaskClosed,
  isTaskOverdue,
  summarizeAttendance,
} from './office-hub-rules.ts';

/** A chartable row: one label, one count. The shape every bar and pie below produces. */
export interface CountRow {
  label: string;
  count: number;
  /** Secondary count, where a row carries two series (e.g. created vs completed). */
  secondary?: number;
  /** Percentage of the report's total, rounded. */
  share?: number;
}

const bucket = (rows: Map<string, number>, key: string, by = 1): void => {
  rows.set(key, (rows.get(key) ?? 0) + by);
};

const toRows = (counts: Map<string, number>, options: { sort?: 'count' | 'label' } = {}): CountRow[] => {
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const rows = [...counts.entries()].map(([label, count]) => ({
    label,
    count,
    share: total ? Math.round((count / total) * 100) : 0,
  }));
  if (options.sort === 'label') return rows.sort((a, b) => a.label.localeCompare(b.label));
  return rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};

/* ── meeting report ───────────────────────────────────────────────────────────────────────────── */

export interface MeetingReport {
  total: number;
  byMonth: CountRow[];
  byDepartment: CountRow[];
  byType: CountRow[];
  byOrganizer: CountRow[];
  byStatus: CountRow[];
  byMode: CountRow[];
  cancelled: number;
  completed: number;
  postponed: number;
  recurring: number;
  /** Meetings whose minutes are published, over meetings completed. */
  minutesPublished: number;
  /** Total scheduled minutes, so "how much time did we spend in meetings" is answerable. */
  scheduledMinutes: number;
  attendance: {
    invited: number;
    present: number;
    late: number;
    absent: number;
    excused: number;
    unmarked: number;
    attendanceRate: number;
  };
}

export function buildMeetingReport(
  meetings: readonly OfficeHubMeeting[],
  participants: readonly Pick<OfficeHubParticipant, 'attendance' | 'meetingId'>[] = [],
  options: { departmentNames?: Readonly<Record<string, string>> } = {},
): MeetingReport {
  const byMonth = new Map<string, number>();
  const byDepartment = new Map<string, number>();
  const byType = new Map<string, number>();
  const byOrganizer = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byMode = new Map<string, number>();

  let cancelled = 0;
  let completed = 0;
  let postponed = 0;
  let recurring = 0;
  let minutesPublished = 0;
  let scheduledMinutes = 0;

  for (const meeting of meetings) {
    bucket(byMonth, monthKey(meeting.date));
    bucket(byType, meeting.meetingType || 'Unspecified');
    bucket(byOrganizer, meeting.organizerName || 'Unknown');
    bucket(byStatus, meeting.status);
    bucket(byMode, meeting.mode);

    if (meeting.departmentIds?.length) {
      for (const departmentId of meeting.departmentIds) {
        bucket(byDepartment, options.departmentNames?.[departmentId] ?? departmentId);
      }
    } else {
      // Counted rather than dropped: "how many of our meetings are not attached to a department"
      // is one of the more useful things this report says.
      bucket(byDepartment, 'No department');
    }

    if (meeting.status === 'Cancelled') cancelled += 1;
    if (meeting.status === 'Completed') completed += 1;
    if (meeting.status === 'Postponed') postponed += 1;
    if (meeting.recurrence && meeting.recurrence.frequency !== 'None') recurring += 1;
    if (meeting.momStage === 'Published') minutesPublished += 1;

    if (meeting.status !== 'Cancelled') {
      const start = Date.parse(meeting.startAt);
      const end = Date.parse(meeting.endAt);
      if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
        scheduledMinutes += Math.round((end - start) / 60_000);
      }
    }
  }

  const meetingIds = new Set(meetings.map((meeting) => meeting.id));
  const relevantParticipants = participants.filter((participant) => meetingIds.has(participant.meetingId));
  const attendance = summarizeAttendance(relevantParticipants);

  return {
    total: meetings.length,
    byMonth: toRows(byMonth, { sort: 'label' }),
    byDepartment: toRows(byDepartment),
    byType: toRows(byType),
    byOrganizer: toRows(byOrganizer),
    byStatus: toRows(byStatus),
    byMode: toRows(byMode),
    cancelled,
    completed,
    postponed,
    recurring,
    minutesPublished,
    scheduledMinutes,
    attendance: {
      invited: attendance.invited,
      present: attendance.present,
      late: attendance.late,
      absent: attendance.absent,
      excused: attendance.excused,
      unmarked: attendance.unmarked,
      attendanceRate: attendance.attendanceRate,
    },
  };
}

/* ── task report ──────────────────────────────────────────────────────────────────────────────── */

export interface TaskReport {
  total: number;
  created: number;
  completed: number;
  pending: number;
  overdue: number;
  cancelled: number;
  onHold: number;
  byStatus: CountRow[];
  byPriority: CountRow[];
  byAssignee: CountRow[];
  byDepartment: CountRow[];
  byTeam: CountRow[];
  byMonth: CountRow[];
  /** Median days from start to completion, for completed tasks that have both dates. */
  medianCompletionDays: number | null;
  /** Completed on or before the due date, over completed tasks that had a due date. */
  onTimeCompletionRate: number | null;
  fromMeetings: number;
}

export function buildTaskReport(
  tasks: readonly OfficeHubTask[],
  today: IsoDate,
  options: { departmentNames?: Readonly<Record<string, string>> } = {},
): TaskReport {
  const byStatus = new Map<string, number>();
  const byPriority = new Map<string, number>();
  const byAssignee = new Map<string, number>();
  const byDepartment = new Map<string, number>();
  const byTeam = new Map<string, number>();
  const byMonth = new Map<string, number>();

  let completed = 0;
  let overdue = 0;
  let cancelled = 0;
  let onHold = 0;
  let fromMeetings = 0;

  const completionDays: number[] = [];
  let dueDated = 0;
  let onTime = 0;

  for (const task of tasks) {
    bucket(byStatus, task.status);
    bucket(byPriority, task.priority);
    bucket(byAssignee, task.assigneeName || task.teamName || 'Unassigned');
    bucket(byDepartment, task.departmentId ? options.departmentNames?.[task.departmentId] ?? task.departmentName ?? task.departmentId : 'No department');
    if (task.teamName) bucket(byTeam, task.teamName);
    if (task.startDate) bucket(byMonth, monthKey(task.startDate));

    if (task.status === 'Completed') completed += 1;
    if (task.status === 'Cancelled') cancelled += 1;
    if (task.status === 'On Hold') onHold += 1;
    if (isTaskOverdue(task, today)) overdue += 1;
    if (task.meetingId) fromMeetings += 1;

    if (task.status === 'Completed' && task.completedAt) {
      const completedOn = task.completedAt.slice(0, 10);
      if (task.startDate) {
        const days = daysBetween(task.startDate, completedOn);
        if (days >= 0) completionDays.push(days);
      }
      if (task.dueDate) {
        dueDated += 1;
        if (completedOn <= task.dueDate) onTime += 1;
      }
    }
  }

  const pending = tasks.length - completed - cancelled;

  return {
    total: tasks.length,
    created: tasks.length,
    completed,
    pending,
    overdue,
    cancelled,
    onHold,
    byStatus: orderedRows(byStatus, TASK_STATUSES),
    byPriority: orderedRows(byPriority, OFFICE_HUB_PRIORITIES),
    byAssignee: toRows(byAssignee),
    byDepartment: toRows(byDepartment),
    byTeam: toRows(byTeam),
    byMonth: toRows(byMonth, { sort: 'label' }),
    medianCompletionDays: median(completionDays),
    onTimeCompletionRate: dueDated ? Math.round((onTime / dueDated) * 100) : null,
    fromMeetings,
  };
}

/** Rows in a fixed order, so a status chart's bars do not reshuffle as the data changes. */
function orderedRows(counts: Map<string, number>, order: readonly string[]): CountRow[] {
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const known = order.map((label) => ({
    label,
    count: counts.get(label) ?? 0,
    share: total ? Math.round(((counts.get(label) ?? 0) / total) * 100) : 0,
  }));
  const extras = [...counts.entries()]
    .filter(([label]) => !order.includes(label))
    .map(([label, count]) => ({ label, count, share: total ? Math.round((count / total) * 100) : 0 }));
  return [...known, ...extras];
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  // The median rather than the mean, because one task that sat open for nine months drags a mean
  // into uselessness and is exactly the kind of task these datasets contain.
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/* ── action item and decision reports ─────────────────────────────────────────────────────────── */

export interface ActionItemReport {
  total: number;
  open: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  overdue: number;
  withoutTask: number;
  byResponsible: CountRow[];
  byMeeting: CountRow[];
  /** Open items grouped by how long they have been open. */
  ageing: CountRow[];
}

export function buildActionItemReport(
  items: readonly OfficeHubActionItem[],
  today: IsoDate,
): ActionItemReport {
  const byResponsible = new Map<string, number>();
  const byMeeting = new Map<string, number>();
  const ageing = new Map<string, number>();

  let open = 0;
  let inProgress = 0;
  let completed = 0;
  let cancelled = 0;
  let overdue = 0;
  let withoutTask = 0;

  for (const item of items) {
    if (item.status === 'Open') open += 1;
    if (item.status === 'In Progress') inProgress += 1;
    if (item.status === 'Completed') completed += 1;
    if (item.status === 'Cancelled') cancelled += 1;
    if (isActionItemOverdue(item, today)) overdue += 1;
    if (isOpenActionItemStatus(item.status) && !item.taskId) withoutTask += 1;

    bucket(byResponsible, item.responsibleUserName || item.responsibleTeamName || 'Unassigned');
    if (item.meetingTitle) bucket(byMeeting, item.meetingTitle);
    if (isOpenActionItemStatus(item.status)) bucket(ageing, ageingBucket(item.meetingDate ?? item.dueDate, today));
  }

  return {
    total: items.length,
    open,
    inProgress,
    completed,
    cancelled,
    overdue,
    withoutTask,
    byResponsible: toRows(byResponsible),
    byMeeting: toRows(byMeeting),
    ageing: orderedRows(ageing, AGEING_BUCKETS),
  };
}

export const AGEING_BUCKETS: readonly string[] = ['0–7 days', '8–14 days', '15–30 days', '31–60 days', '60+ days', 'No date'];

export function ageingBucket(from: IsoDate | null | undefined, today: IsoDate): string {
  if (!from) return 'No date';
  const days = daysBetween(from, today);
  if (days <= 7) return '0–7 days';
  if (days <= 14) return '8–14 days';
  if (days <= 30) return '15–30 days';
  if (days <= 60) return '31–60 days';
  return '60+ days';
}

export interface DecisionReport {
  total: number;
  open: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  overdue: number;
  byOwner: CountRow[];
  byDepartment: CountRow[];
  byPriority: CountRow[];
  byMonth: CountRow[];
  ageing: CountRow[];
}

export function buildDecisionReport(
  decisions: readonly OfficeHubDecision[],
  today: IsoDate,
  options: { departmentNames?: Readonly<Record<string, string>> } = {},
): DecisionReport {
  const byOwner = new Map<string, number>();
  const byDepartment = new Map<string, number>();
  const byPriority = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const ageing = new Map<string, number>();

  let open = 0;
  let inProgress = 0;
  let completed = 0;
  let cancelled = 0;
  let overdue = 0;

  for (const decision of decisions) {
    if (decision.status === 'Open') open += 1;
    if (decision.status === 'In Progress') inProgress += 1;
    if (decision.status === 'Completed') completed += 1;
    if (decision.status === 'Cancelled') cancelled += 1;
    if (isDecisionOverdue(decision, today)) overdue += 1;

    bucket(byOwner, decision.ownerName || 'Unassigned');
    bucket(
      byDepartment,
      decision.departmentId
        ? options.departmentNames?.[decision.departmentId] ?? decision.departmentName ?? decision.departmentId
        : 'No department',
    );
    bucket(byPriority, decision.priority);
    bucket(byMonth, monthKey(decision.decisionDate));
    if (isOpenDecisionStatus(decision.status)) bucket(ageing, ageingBucket(decision.decisionDate, today));
  }

  return {
    total: decisions.length,
    open,
    inProgress,
    completed,
    cancelled,
    overdue,
    byOwner: toRows(byOwner),
    byDepartment: toRows(byDepartment),
    byPriority: orderedRows(byPriority, OFFICE_HUB_PRIORITIES),
    byMonth: toRows(byMonth, { sort: 'label' }),
    ageing: orderedRows(ageing, AGEING_BUCKETS),
  };
}

/* ── management overview ──────────────────────────────────────────────────────────────────────── */

export interface ManagementOverview {
  upcomingMeetings: number;
  meetingsCompletedThisMonth: number;
  meetingsCancelledThisMonth: number;
  openActionItems: number;
  overdueActionItems: number;
  openDecisions: number;
  overdueDecisions: number;
  activeTasks: number;
  overdueTasks: number;
  unpublishedMinutes: number;
  /** Pending tasks per department — the one table §73 asks for by name. */
  departmentPendingTasks: CountRow[];
  /** What is due in the next fortnight, soonest first. */
  upcomingDeadlines: {
    kind: 'task' | 'decision' | 'action-item';
    id: string;
    title: string;
    owner: string;
    dueDate: IsoDate;
    overdue: boolean;
    priority: OfficeHubPriority | null;
  }[];
}

/**
 * The management-only overview (§73).
 *
 * Operational facts, deliberately in the same units the people doing the work see them in. There is
 * no "department efficiency" figure here and no league table, for the reason given at the top of
 * this file.
 */
export function buildManagementOverview(input: {
  meetings: readonly OfficeHubMeeting[];
  tasks: readonly OfficeHubTask[];
  decisions: readonly OfficeHubDecision[];
  actionItems: readonly OfficeHubActionItem[];
  today: IsoDate;
  monthStart: IsoDate;
  monthEnd: IsoDate;
  departmentNames?: Readonly<Record<string, string>>;
  deadlineHorizonDays?: number;
}): ManagementOverview {
  const { today, monthStart, monthEnd } = input;
  const horizonDays = input.deadlineHorizonDays ?? 14;

  const departmentPending = new Map<string, number>();
  let activeTasks = 0;
  let overdueTasks = 0;

  const deadlines: ManagementOverview['upcomingDeadlines'] = [];

  for (const task of input.tasks) {
    if (isTaskClosed(task.status)) continue;
    activeTasks += 1;
    if (isTaskOverdue(task, today)) overdueTasks += 1;
    bucket(
      departmentPending,
      task.departmentId
        ? input.departmentNames?.[task.departmentId] ?? task.departmentName ?? task.departmentId
        : 'No department',
    );
    if (task.dueDate && daysBetween(today, task.dueDate) <= horizonDays) {
      deadlines.push({
        kind: 'task',
        id: task.id,
        title: task.title,
        owner: task.assigneeName || task.teamName || 'Unassigned',
        dueDate: task.dueDate,
        overdue: task.dueDate < today,
        priority: task.priority,
      });
    }
  }

  let openDecisions = 0;
  let overdueDecisions = 0;
  for (const decision of input.decisions) {
    if (!isOpenDecisionStatus(decision.status)) continue;
    openDecisions += 1;
    if (isDecisionOverdue(decision, today)) overdueDecisions += 1;
    if (decision.dueDate && daysBetween(today, decision.dueDate) <= horizonDays) {
      deadlines.push({
        kind: 'decision',
        id: decision.id,
        title: decision.title,
        owner: decision.ownerName,
        dueDate: decision.dueDate,
        overdue: decision.dueDate < today,
        priority: decision.priority,
      });
    }
  }

  let openActionItems = 0;
  let overdueActionItems = 0;
  for (const item of input.actionItems) {
    if (!isOpenActionItemStatus(item.status)) continue;
    openActionItems += 1;
    if (isActionItemOverdue(item, today)) overdueActionItems += 1;
    if (item.dueDate && daysBetween(today, item.dueDate) <= horizonDays) {
      deadlines.push({
        kind: 'action-item',
        id: item.id,
        title: item.title,
        owner: item.responsibleUserName || item.responsibleTeamName || 'Unassigned',
        dueDate: item.dueDate,
        overdue: item.dueDate < today,
        priority: item.priority,
      });
    }
  }

  const completedThisMonth = input.meetings.filter(
    (meeting) => meeting.status === 'Completed' && meeting.date >= monthStart && meeting.date <= monthEnd,
  );

  return {
    upcomingMeetings: input.meetings.filter(
      (meeting) => meeting.date >= today && meeting.status !== 'Cancelled' && meeting.status !== 'Completed',
    ).length,
    meetingsCompletedThisMonth: completedThisMonth.length,
    meetingsCancelledThisMonth: input.meetings.filter(
      (meeting) => meeting.status === 'Cancelled' && meeting.date >= monthStart && meeting.date <= monthEnd,
    ).length,
    openActionItems,
    overdueActionItems,
    openDecisions,
    overdueDecisions,
    activeTasks,
    overdueTasks,
    unpublishedMinutes: completedThisMonth.filter((meeting) => meeting.momStage !== 'Published').length,
    departmentPendingTasks: toRows(departmentPending),
    upcomingDeadlines: deadlines.sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title),
    ),
  };
}

/* ── dashboard tiles ─────────────────────────────────────────────────────────────────────────── */

export interface MeetingStatistics {
  today: number;
  thisWeek: number;
  thisMonth: number;
  organizedByMe: number;
  awaitingMyResponse: number;
}

export function buildMeetingStatistics(input: {
  meetings: readonly Pick<OfficeHubMeeting, 'date' | 'status' | 'organizerId'>[];
  awaitingResponse: number;
  viewerUserId: string;
  today: IsoDate;
  weekStart: IsoDate;
  weekEnd: IsoDate;
  monthStart: IsoDate;
  monthEnd: IsoDate;
}): MeetingStatistics {
  const live = input.meetings.filter((meeting) => meeting.status !== 'Cancelled');
  return {
    today: live.filter((meeting) => meeting.date === input.today).length,
    thisWeek: live.filter((meeting) => meeting.date >= input.weekStart && meeting.date <= input.weekEnd).length,
    thisMonth: live.filter((meeting) => meeting.date >= input.monthStart && meeting.date <= input.monthEnd).length,
    organizedByMe: live.filter((meeting) => meeting.organizerId === input.viewerUserId).length,
    awaitingMyResponse: input.awaitingResponse,
  };
}

export interface TaskStatistics {
  total: number;
  notStarted: number;
  inProgress: number;
  onHold: number;
  completed: number;
  cancelled: number;
  overdue: number;
  dueToday: number;
  dueSoon: number;
}

export function buildTaskStatistics(
  tasks: readonly Pick<OfficeHubTask, 'status' | 'dueDate'>[],
  today: IsoDate,
  soonDays = 7,
): TaskStatistics {
  const stats: TaskStatistics = {
    total: tasks.length,
    notStarted: 0,
    inProgress: 0,
    onHold: 0,
    completed: 0,
    cancelled: 0,
    overdue: 0,
    dueToday: 0,
    dueSoon: 0,
  };

  const key: Record<TaskStatus, keyof TaskStatistics> = {
    'Not Started': 'notStarted',
    'In Progress': 'inProgress',
    'On Hold': 'onHold',
    Completed: 'completed',
    Cancelled: 'cancelled',
  };

  for (const task of tasks) {
    const field = key[task.status];
    if (field) (stats[field] as number) += 1;
    if (isTaskClosed(task.status)) continue;
    if (!task.dueDate) continue;
    if (task.dueDate < today) stats.overdue += 1;
    else if (task.dueDate === today) stats.dueToday += 1;
    else if (daysBetween(today, task.dueDate) <= soonDays) stats.dueSoon += 1;
  }

  return stats;
}

/** Rows for the Excel/CSV export of a report. One flat sheet per section. */
export function reportRowsToSheet(title: string, rows: readonly CountRow[]): {
  title: string;
  rows: Record<string, string | number>[];
} {
  return {
    title,
    rows: rows.map((row) => ({
      Label: row.label,
      Count: row.count,
      'Share %': row.share ?? 0,
    })),
  };
}

/** Meeting statuses in the order a status chart should show them. */
export const MEETING_STATUS_ORDER: readonly MeetingStatus[] = [
  'Draft',
  'Scheduled',
  'In Progress',
  'Completed',
  'Postponed',
  'Cancelled',
] as const;
