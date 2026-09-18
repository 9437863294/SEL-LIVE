'use client';

/**
 * Presentation primitives for Office Hub.
 *
 * ── What is reused, and what is new ─────────────────────────────────────────────────────────────
 *
 * The layout primitives — page header, KPI card, empty state, filter panel, access-denied screen,
 * and above all `HrDataList` (a register that renders as cards on a phone and a table on a desktop
 * from one column spec) — are re-exported from `@/components/hr/hr-ui` rather than rewritten. They
 * are not HR-specific; they are this application's answer to §54's responsive requirement, and a
 * second copy would drift from the first within a month.
 *
 * What *is* new here is everything that encodes an Office Hub meaning: which colour a meeting status
 * is, how a response reads, what "starting in 10 minutes" looks like. Those cannot be shared,
 * because the vocabulary is different.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Circle,
  CircleDashed,
  Clock,
  MapPin,
  Radio,
  Users,
  Video,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  formatClockTime,
  formatIsoDate,
  formatRelativeToNow,
  type AttendanceStatus,
  type DecisionStatus,
  type InvitationResponse,
  type MeetingMode,
  type MeetingStatus,
  type MomStage,
  type OfficeHubMeeting,
  type OfficeHubPriority,
  type OfficeHubTask,
  type TaskStatus,
  meetingTimeState,
  taskDueBucket,
  taskProgress,
} from '@/lib/office-hub';

export {
  HrAccessDenied as OfficeHubAccessDenied,
  HrBarList as OfficeHubBarList,
  // Re-exported under its own name: a cell renders "a link", not "an office-hub link".
  HrCellLink,
  HrDataList as OfficeHubDataList,
  HrEmptyState as OfficeHubEmptyState,
  HrField as OfficeHubField,
  HrFilterCard as OfficeHubFilterCard,
  HrKpiCard as OfficeHubKpiCard,
  HrLoader as OfficeHubLoader,
  HrMeter as OfficeHubMeter,
  HrPageHeader as OfficeHubPageHeader,
  HrSection as OfficeHubSection,
  hrDialog as officeHubDialog,
  type HrListColumn as OfficeHubListColumn,
  type HrTone as OfficeHubTone,
} from '@/components/hr/hr-ui';

// Imported rather than re-exported: `PersonChip` below consults it, but no screen needs it.
import { useHrInsideLink } from '@/components/hr/hr-ui';

/* ── badges ──────────────────────────────────────────────────────────────────────────────────── */

const MEETING_STATUS_TONE: Record<MeetingStatus, string> = {
  Draft: 'border-slate-200 bg-slate-50 text-slate-600',
  Scheduled: 'border-sky-200 bg-sky-50 text-sky-700',
  // In Progress is the only one that is deliberately loud: it is the state that wants acting on.
  'In Progress': 'border-emerald-300 bg-emerald-100 text-emerald-800',
  Completed: 'border-teal-200 bg-teal-50 text-teal-700',
  Cancelled: 'border-rose-200 bg-rose-50 text-rose-700',
  Postponed: 'border-amber-200 bg-amber-50 text-amber-700',
};

export function MeetingStatusBadge({ status, className }: { status: MeetingStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn('border font-medium', MEETING_STATUS_TONE[status], className)}>
      {status === 'In Progress' && <Radio className="mr-1 h-3 w-3 animate-pulse" />}
      {status}
    </Badge>
  );
}

const TASK_STATUS_TONE: Record<TaskStatus, string> = {
  'Not Started': 'border-slate-200 bg-slate-50 text-slate-600',
  'In Progress': 'border-sky-200 bg-sky-50 text-sky-700',
  'On Hold': 'border-amber-200 bg-amber-50 text-amber-700',
  Completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Cancelled: 'border-rose-200 bg-rose-50 text-rose-700',
};

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn('border font-medium', TASK_STATUS_TONE[status], className)}>
      {status}
    </Badge>
  );
}

const DECISION_STATUS_TONE: Record<DecisionStatus, string> = {
  Open: 'border-sky-200 bg-sky-50 text-sky-700',
  'In Progress': 'border-indigo-200 bg-indigo-50 text-indigo-700',
  Completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Cancelled: 'border-rose-200 bg-rose-50 text-rose-700',
};

export function DecisionStatusBadge({ status, className }: { status: DecisionStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn('border font-medium', DECISION_STATUS_TONE[status], className)}>
      {status}
    </Badge>
  );
}

/**
 * Priority.
 *
 * Only Critical is red. A palette where High is also red leaves nothing for Critical to escalate
 * to, and every register ends up looking like an emergency.
 */
const PRIORITY_TONE: Record<OfficeHubPriority, string> = {
  Low: 'border-slate-200 bg-slate-50 text-slate-500',
  Medium: 'border-blue-200 bg-blue-50 text-blue-700',
  High: 'border-amber-300 bg-amber-50 text-amber-800',
  Critical: 'border-rose-300 bg-rose-100 text-rose-800',
};

export function PriorityBadge({ priority, className }: { priority: OfficeHubPriority; className?: string }) {
  return (
    <Badge variant="outline" className={cn('border font-medium', PRIORITY_TONE[priority], className)}>
      {priority === 'Critical' && <AlertTriangle className="mr-1 h-3 w-3" />}
      {priority}
    </Badge>
  );
}

const RESPONSE_META: Record<InvitationResponse, { tone: string; icon: React.ElementType; label: string }> = {
  Accepted: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: CheckCircle2, label: 'Accepted' },
  Maybe: { tone: 'border-amber-200 bg-amber-50 text-amber-700', icon: CircleDashed, label: 'Maybe' },
  Declined: { tone: 'border-rose-200 bg-rose-50 text-rose-700', icon: XCircle, label: 'Declined' },
  'No Response': { tone: 'border-slate-200 bg-slate-50 text-slate-500', icon: Circle, label: 'Awaiting' },
};

export function ResponseBadge({ response, className }: { response: InvitationResponse; className?: string }) {
  const meta = RESPONSE_META[response] ?? RESPONSE_META['No Response'];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn('border font-medium', meta.tone, className)}>
      <Icon className="mr-1 h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

const ATTENDANCE_TONE: Record<AttendanceStatus, string> = {
  Present: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Late: 'border-amber-200 bg-amber-50 text-amber-700',
  Absent: 'border-rose-200 bg-rose-50 text-rose-700',
  Excused: 'border-slate-200 bg-slate-50 text-slate-600',
};

export function AttendanceBadge({
  attendance,
  className,
}: {
  attendance: AttendanceStatus | null | undefined;
  className?: string;
}) {
  if (!attendance) {
    return <span className={cn('text-xs text-muted-foreground', className)}>Not marked</span>;
  }
  return (
    <Badge variant="outline" className={cn('border font-medium', ATTENDANCE_TONE[attendance], className)}>
      {attendance}
    </Badge>
  );
}

const MOM_STAGE_TONE: Record<MomStage, string> = {
  Draft: 'border-slate-200 bg-slate-50 text-slate-600',
  Prepared: 'border-sky-200 bg-sky-50 text-sky-700',
  Reviewed: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  Approved: 'border-violet-200 bg-violet-50 text-violet-700',
  Published: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

export function MomStageBadge({ stage, className }: { stage: MomStage | null | undefined; className?: string }) {
  if (!stage) {
    return <span className={cn('text-xs text-muted-foreground', className)}>No minutes</span>;
  }
  return (
    <Badge variant="outline" className={cn('border font-medium', MOM_STAGE_TONE[stage], className)}>
      {stage}
    </Badge>
  );
}

export function MeetingModeBadge({ mode, className }: { mode: MeetingMode; className?: string }) {
  const Icon = mode === 'Offline' ? MapPin : Video;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
      <Icon className="h-3.5 w-3.5" />
      {mode}
    </span>
  );
}

/* ── live state ──────────────────────────────────────────────────────────────────────────────── */

/**
 * A clock that re-renders itself.
 *
 * "Starts in 10 minutes" is wrong within a minute of being painted, and a dashboard left open on a
 * wall display would otherwise keep claiming a meeting is upcoming an hour after it ended. One
 * interval per mounted component, cleared on unmount, and deliberately coarse — 30 seconds is finer
 * than the copy's own resolution.
 */
export function useTickingNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** "In 20 minutes" / "Live now" / "Ended", for a meeting row. */
export function MeetingWhenBadge({
  meeting,
  now,
  className,
}: {
  meeting: Pick<OfficeHubMeeting, 'startAt' | 'endAt' | 'status'>;
  now?: Date;
  className?: string;
}) {
  const at = now ?? new Date();
  const state = meetingTimeState(meeting, at);

  if (meeting.status === 'Cancelled') {
    return <span className={cn('text-xs text-rose-600', className)}>Cancelled</span>;
  }

  if (state === 'live') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs font-medium text-emerald-700', className)}>
        <Radio className="h-3.5 w-3.5 animate-pulse" />
        Live now
      </span>
    );
  }
  if (state === 'ended') {
    return <span className={cn('text-xs text-muted-foreground', className)}>Ended</span>;
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        state === 'starting-soon' ? 'font-medium text-amber-700' : 'text-muted-foreground',
        className,
      )}
    >
      <Clock className="h-3.5 w-3.5" />
      {formatRelativeToNow(new Date(Date.parse(meeting.startAt)), at)}
    </span>
  );
}

/** The two-line "when" a register row shows. */
export function MeetingWhen({ meeting, className }: { meeting: Pick<OfficeHubMeeting, 'date' | 'startTime' | 'endTime'>; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="truncate text-sm font-medium text-slate-800">{formatIsoDate(meeting.date, { withWeekday: true })}</p>
      <p className="truncate text-xs text-muted-foreground">
        {formatClockTime(meeting.startTime)} – {formatClockTime(meeting.endTime)}
      </p>
    </div>
  );
}

/** Where the meeting is: a link for online, the room for offline, both for hybrid. */
export function MeetingWhere({
  meeting,
  className,
}: {
  meeting: Pick<OfficeHubMeeting, 'mode' | 'location' | 'room' | 'onlinePlatform'>;
  className?: string;
}) {
  const physical = [meeting.location, meeting.room].filter(Boolean).join(' · ');
  return (
    <div className={cn('min-w-0 text-xs text-muted-foreground', className)}>
      {meeting.mode !== 'Offline' && (
        <p className="flex items-center gap-1 truncate">
          <Video className="h-3.5 w-3.5 shrink-0" />
          {meeting.onlinePlatform || 'Online'}
        </p>
      )}
      {meeting.mode !== 'Online' && physical && (
        <p className="flex items-center gap-1 truncate">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {physical}
        </p>
      )}
      {meeting.mode === 'Offline' && !physical && <p>Location to be confirmed</p>}
    </div>
  );
}

/** "8 / 12 accepted" with a hover breakdown. */
export function ResponseSummaryChip({
  summary,
  className,
}: {
  summary: OfficeHubMeeting['responseSummary'];
  className?: string;
}) {
  const total = summary.accepted + summary.maybe + summary.declined + summary.noResponse;
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}
      title={`${summary.accepted} accepted · ${summary.maybe} maybe · ${summary.declined} declined · ${summary.noResponse} awaiting`}
    >
      <Users className="h-3.5 w-3.5" />
      <span className="tabular-nums font-medium text-slate-700">{summary.accepted}</span>
      <span>/ {total}</span>
    </span>
  );
}

/* ── task presentation ───────────────────────────────────────────────────────────────────────── */

/** Progress with the subtask count, since the two answer the same question differently. */
export function TaskProgressBar({
  task,
  className,
}: {
  task: Pick<OfficeHubTask, 'status' | 'progress' | 'subtasks'>;
  className?: string;
}) {
  const value = taskProgress(task);
  const subtasks = task.subtasks ?? [];
  const done = subtasks.filter((subtask) => subtask.done).length;

  return (
    <div className={cn('min-w-[7rem]', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">{value}%</span>
        {subtasks.length > 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {done}/{subtasks.length}
          </span>
        )}
      </div>
      <Progress value={value} className="mt-1 h-1.5" />
    </div>
  );
}

/**
 * The due date, coloured by how late it is.
 *
 * The colour is the point: a register of fifty tasks is unreadable if the reader has to compare
 * every date against today in their head.
 */
export function TaskDueDate({
  task,
  today,
  className,
}: {
  task: Pick<OfficeHubTask, 'status' | 'dueDate'>;
  today: string;
  className?: string;
}) {
  const bucket = taskDueBucket(task, today);
  if (!task.dueDate) return <span className={cn('text-xs text-muted-foreground', className)}>No due date</span>;

  const tone =
    bucket === 'overdue'
      ? 'text-rose-700 font-medium'
      : bucket === 'due-today'
        ? 'text-amber-700 font-medium'
        : bucket === 'closed'
          ? 'text-muted-foreground'
          : 'text-slate-700';

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs tabular-nums', tone, className)}>
      {bucket === 'overdue' && <AlertTriangle className="h-3.5 w-3.5" />}
      {formatIsoDate(task.dueDate)}
      {bucket === 'due-today' && <span className="text-[11px]">(today)</span>}
    </span>
  );
}

/* ── misc ────────────────────────────────────────────────────────────────────────────────────── */

/** A person, with their initials where there is no photo. */
export function PersonChip({
  name,
  subtitle,
  href,
  className,
}: {
  name: string | null | undefined;
  subtitle?: string | null;
  href?: string;
  className?: string;
}) {
  const initials = useMemo(
    () =>
      (name ?? '?')
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('') || '?',
    [name],
  );

  const body = (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">
        {initials}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-800">{name || 'Unassigned'}</span>
        {subtitle && <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>}
      </span>
    </span>
  );

  /**
   * A chip inside a linked card renders as plain text, not a second link.
   *
   * `HrDataList` wraps each phone card in an anchor when it is given `cardHref`, and the desktop
   * table does not — so a chip with an `href` is a legitimate link on a desktop row and an
   * `<a>` nested in an `<a>` on the same page's phone card. That is invalid HTML, it is a
   * hydration error, and browsers resolve it by restructuring the DOM, which breaks the card.
   *
   * Nothing is lost by degrading: the card links to the person's page already, which on every
   * screen that does this is the same destination the chip pointed at.
   */
  const insideLink = useHrInsideLink();

  return href && !insideLink ? (
    <Link href={href} className="min-w-0 hover:underline">
      {body}
    </Link>
  ) : (
    body
  );
}

/** A dashboard row of quick-action buttons (§7). */
export function QuickActionRow({
  actions,
}: {
  actions: { label: string; href: string; icon: React.ElementType; tone?: string }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            key={action.href + action.label}
            asChild
            variant="outline"
            className="h-auto justify-start gap-2 bg-white/80 py-3"
          >
            <Link href={action.href}>
              <Icon className={cn('h-4 w-4 shrink-0', action.tone ?? 'text-indigo-600')} />
              <span className="truncate text-xs font-medium sm:text-sm">{action.label}</span>
            </Link>
          </Button>
        );
      })}
    </div>
  );
}

/**
 * A banner for the thing on this screen the user most likely came to do.
 *
 * Used for the live meeting, the unanswered invitation, the overdue count — the cases where a
 * register row is not prominent enough and a toast is too transient.
 */
export function OfficeHubCallout({
  tone = 'indigo',
  icon: Icon = CalendarClock,
  title,
  description,
  action,
}: {
  tone?: 'indigo' | 'emerald' | 'amber' | 'rose';
  icon?: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  const palette = {
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
  }[tone];

  return (
    <Card className={cn('mb-3 border', palette)}>
      <CardContent className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            {description && <p className="text-xs opacity-80">{description}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </CardContent>
    </Card>
  );
}

/** Inline form error, rendered under the field it belongs to (§79). */
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-start gap-1 text-xs text-destructive" role="alert">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      {message}
    </p>
  );
}

/** The "n of m" count a register shows above itself. */
export function ResultCount({ shown, total, noun }: { shown: number; total: number; noun: string }) {
  if (shown === total) {
    return (
      <p className="text-xs text-muted-foreground">
        {total} {noun}
        {total === 1 ? '' : 's'}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Showing {shown} of {total} {noun}
      {total === 1 ? '' : 's'}
    </p>
  );
}
