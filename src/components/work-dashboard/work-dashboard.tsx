'use client';

/**
 * The central dashboard.
 *
 * Four sections, in the order a working day asks for them: what needs you, what your team's queues
 * hold, what you are sitting in today, and what you raised and are waiting on. Every row is a link
 * to the screen where that piece of work is actually done — which is the whole point, and the reason
 * `WorkItem.href` is required rather than optional.
 *
 * ── What this screen deliberately does not do ──────────────────────────────────────────────────
 *
 * No charts, and no per-person productivity figures. A count of somebody's open items is not a
 * measure of their output, and a dashboard that implies otherwise gets gamed rather than used —
 * the same instruction Office Hub's management overview follows ("do not generate employee
 * performance scores or rankings", §73). What is here is operational: what is waiting, how late it
 * is, and where to click.
 *
 * It also does not hide the fact that a source failed. A count of zero because nothing is pending
 * and a count of zero because the query was denied look identical, and only one of them means you
 * can stop worrying — so failures get a visible notice naming the queues that could not be read.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  Inbox,
  Layers,
  RefreshCw,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { moduleBadgeClass } from '@/lib/activity-modules';
import {
  WORK_LANES,
  WORK_LANE_HINT,
  WORK_LANE_TITLE,
  WORK_URGENCY_BADGE,
  WORK_URGENCY_LABEL,
  countByModule,
  dueLabel,
  workUrgency,
  type WorkItem,
  type WorkLane,
  type WorkSummary,
} from '@/lib/work-dashboard';
import { useWorkDashboard } from './hooks';

/* ── small pieces ──────────────────────────────────────────────────────────────────────────────── */

function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: React.ElementType;
  tone: string;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="flex items-start gap-3 p-4">
        <span className={cn('mt-0.5 rounded-md border p-2', tone)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-semibold leading-none tabular-nums">{value}</p>
          <p className="mt-1 text-sm font-medium text-foreground">{label}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

const formatAmount = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
    notation: value >= 1_00_00_000 ? 'compact' : 'standard',
  }).format(value);

function WorkRow({ item, today }: { item: WorkItem; today: string }) {
  const urgency = workUrgency(item, today);
  const isQueue = typeof item.count === 'number' && item.count > 0;

  return (
    <Link
      href={item.href}
      className={cn(
        'group flex items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors',
        'hover:border-border hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      {/* A colour-blind-safe cue: the left rule repeats what the urgency badge says in words. */}
      <span
        aria-hidden
        className={cn(
          'mt-1 h-8 w-1 shrink-0 rounded-full',
          urgency === 'overdue' && 'bg-red-500',
          urgency === 'today' && 'bg-amber-500',
          urgency === 'soon' && 'bg-blue-500',
          (urgency === 'later' || urgency === 'undated') && 'bg-border',
        )}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
          {item.reference ? (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.reference}</span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Badge variant="outline" className={cn('px-1.5 py-0 text-[11px]', moduleBadgeClass(item.module))}>
            {item.module}
          </Badge>
          {item.stage ? <span className="truncate">{item.stage}</span> : null}
          {item.raisedBy ? <span className="truncate">{item.raisedBy}</span> : null}
          {typeof item.amount === 'number' ? (
            <span className="tabular-nums">{formatAmount(item.amount)}</span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        {item.startTime ? (
          <span className="text-sm font-semibold tabular-nums">{item.startTime}</span>
        ) : null}
        {isQueue ? (
          <Badge variant="outline" className="px-1.5 py-0 text-[11px] tabular-nums">
            {item.count} waiting
          </Badge>
        ) : urgency === 'undated' ? null : (
          <Badge variant="outline" className={cn('px-1.5 py-0 text-[11px]', WORK_URGENCY_BADGE[urgency])}>
            {dueLabel(item, today)}
          </Badge>
        )}
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </Link>
  );
}

/** How many rows a lane shows before it offers to show the rest. */
const COLLAPSED_ROWS = 8;

function LaneSection({ lane, items, today }: { lane: WorkLane; items: WorkItem[]; today: string }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, COLLAPSED_ROWS);
  const byModule = useMemo(() => countByModule(items), [items]);

  if (!items.length) {
    // An empty `action` lane is the one worth saying out loud — it is the answer to the question the
    // screen exists to ask. The other three are simply left out rather than shown as a wall of
    // zeroes, the same choice `MyHrTasks` makes.
    if (lane !== 'action') return null;
    return (
      <Card className="border-border/60">
        <CardContent className="flex items-center gap-3 p-6">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <div>
            <p className="text-sm font-medium">Nothing is waiting on you.</p>
            <p className="text-xs text-muted-foreground">
              Approvals, tasks and workflow steps assigned to you will appear here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">
            {WORK_LANE_TITLE[lane]}{' '}
            <span className="text-sm font-normal text-muted-foreground tabular-nums">({items.length})</span>
          </h2>
          <p className="text-xs text-muted-foreground">{WORK_LANE_HINT[lane]}</p>
        </div>
        {byModule.length > 1 ? (
          <div className="flex flex-wrap gap-1">
            {byModule.slice(0, 5).map(({ module, count }) => (
              <Badge
                key={module}
                variant="outline"
                className={cn('px-1.5 py-0 text-[11px]', moduleBadgeClass(module))}
              >
                {module} {count}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <Card className="border-border/60">
        <CardContent className="divide-y divide-border/50 p-1.5">
          {visible.map((item) => (
            <WorkRow key={item.id} item={item} today={today} />
          ))}
        </CardContent>
      </Card>

      {items.length > COLLAPSED_ROWS ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          {expanded ? 'Show less' : `Show all ${items.length}`}
        </Button>
      ) : null}
    </section>
  );
}

function FailureNotice({ failures }: { failures: Array<{ id: string; label: string; message: string }> }) {
  const [open, setOpen] = useState(false);
  if (!failures.length) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              {failures.length} queue{failures.length === 1 ? '' : 's'} could not be read.
            </p>
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
              Everything else below is accurate. Work in these may be waiting without appearing here.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-xs"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Hide' : 'Details'}
          </Button>
        </div>
        {open ? (
          <ul className="space-y-1 pl-7 text-xs text-amber-900/90 dark:text-amber-200/90">
            {failures.map((failure) => (
              <li key={failure.id}>
                <span className="font-medium">{failure.label}</span> — {failure.message}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ── the screen ────────────────────────────────────────────────────────────────────────────────── */

export default function WorkDashboard({
  className,
  showTitle = true,
  onSummaryChange,
}: {
  className?: string;
  /**
   * False on the home page, where the tab is already labelled "Your work" and an `<h1>` saying the
   * same thing directly under it reads as a mistake. The summary line and Refresh stay either way.
   */
  showTitle?: boolean;
  /**
   * Reports the summary upward so a caller can label a tab with the pending count.
   *
   * A callback rather than the caller running `useWorkDashboard` itself: the hook fans out across
   * every module the viewer can see, and two copies of it on one page would mean doing all of that
   * twice to render the same numbers in two places.
   */
  onSummaryChange?: (summary: WorkSummary) => void;
}) {
  const { lanes, summary, failures, today, isLoading, isRefreshing, refresh } = useWorkDashboard();

  // `summary` is memoised on the lanes, so this fires when the counts actually change rather than
  // on every render — which is what stops the callback becoming a render loop.
  useEffect(() => {
    onSummaryChange?.(summary);
  }, [summary, onSummaryChange]);

  if (isLoading) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-[86px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-5', className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          {showTitle ? <h1 className="text-xl font-semibold tracking-tight">Your work</h1> : null}
          <p className="text-sm text-muted-foreground">
            {summary.action > 0
              ? `${summary.action} item${summary.action === 1 ? '' : 's'} need you across ${summary.modules} module${summary.modules === 1 ? '' : 's'}.`
              : 'Pending approvals, tasks, workflow steps and meetings from every module.'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={refresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Needs your action"
          value={summary.action}
          hint={summary.overdue > 0 ? `${summary.overdue} overdue, ${summary.dueToday} due today` : undefined}
          icon={Inbox}
          tone={
            summary.overdue > 0
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300'
              : 'border-border bg-muted text-foreground'
          }
        />
        <StatTile
          label="Meetings today"
          value={summary.meetingsToday}
          hint={lanes.meeting.length > summary.meetingsToday ? `${lanes.meeting.length} this week` : undefined}
          icon={CalendarClock}
          tone="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
        />
        <StatTile
          label="In your team's queues"
          value={summary.shared}
          icon={Users}
          tone="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300"
        />
        <StatTile
          label="Waiting on others"
          value={summary.watching}
          icon={Clock}
          tone="border-border bg-muted text-muted-foreground"
        />
      </div>

      <FailureNotice failures={failures} />

      {WORK_LANES.map((lane) => (
        <LaneSection key={lane} lane={lane} items={lanes[lane]} today={today} />
      ))}

      {/* Named so the legend is not the only place the words appear — every row carries them too. */}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <Layers className="h-3 w-3" />
        {(['overdue', 'today', 'soon'] as const).map((urgency) => (
          <span key={urgency} className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className={cn(
                'h-2 w-2 rounded-full',
                urgency === 'overdue' && 'bg-red-500',
                urgency === 'today' && 'bg-amber-500',
                urgency === 'soon' && 'bg-blue-500',
              )}
            />
            {WORK_URGENCY_LABEL[urgency]}
          </span>
        ))}
      </p>
    </div>
  );
}
