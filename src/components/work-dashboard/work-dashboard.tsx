'use client';

/**
 * The central dashboard.
 *
 * Four sections, in the order a working day asks for them: what needs you, what your team's queues
 * hold, what you are sitting in today, and what you raised and are waiting on. Every row is a link
 * to the screen where that piece of work is actually done — which is the whole point, and the reason
 * `WorkItem.href` is required rather than optional.
 *
 * ── Why it looks like the rest of the application ──────────────────────────────────────────────
 *
 * The figures are `KpiCard`s and the header is a `PageHeader`, from `@/components/shared/kpi-card` —
 * the same two primitives fifty screens across HR and Employee already render, where they used to
 * live as `HrKpiCard` and `HrPageHeader`. A dashboard that invents its own card, its own header scale
 * and its own tile padding reads as a different application bolted on beside this one, which is
 * exactly how the first cut of this screen looked: outsized tiles with a number floating in the
 * middle of a mostly-empty box.
 *
 * They were moved out of `hr-ui.tsx` rather than imported from it because that file pulls in
 * `@/lib/hr-requirement`, and through it `hr-policy.ts` — some thirty-six hundred lines of HR rules,
 * which have no business loading on the home page.
 *
 * The board runs the full width of the page with minimal gutters — see the note on `shell` below for
 * what that costs and what the better fix would be if it ever starts to grate.
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
  RefreshCw,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { moduleBadgeClass } from '@/lib/activity-modules';
import { KpiCard, PageHeader, type Tone } from '@/components/shared/kpi-card';
import {
  WORK_LANES,
  WORK_LANE_HINT,
  WORK_LANE_TITLE,
  WORK_URGENCY_BADGE,
  countByModule,
  dueLabel,
  workUrgency,
  type WorkItem,
  type WorkLane,
  type WorkSummary,
} from '@/lib/work-dashboard';
import { useWorkDashboard } from './hooks';

/* ── figures ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * A zero is rendered muted rather than in the same weight as a real figure.
 *
 * On a typical day most of these are zero — one person's four counts are not four pieces of news —
 * and four confident black zeroes give a screen with one real item on it the visual weight of a
 * screen with forty. Muting them keeps the eye on the number that is actually saying something.
 */
function Figure({ value }: { value: number }) {
  return (
    <span className={cn('tabular-nums', value === 0 && 'font-normal text-muted-foreground/60')}>{value}</span>
  );
}

function SummaryFigures({ summary, weekMeetings }: { summary: WorkSummary; weekMeetings: number }) {
  const overdueHint =
    summary.overdue > 0
      ? `${summary.overdue} overdue${summary.dueToday > 0 ? `, ${summary.dueToday} due today` : ''}`
      : summary.dueToday > 0
        ? `${summary.dueToday} due today`
        : undefined;

  const figures: Array<{ label: string; value: number; hint?: string; icon: React.ElementType; tone: Tone }> = [
    {
      label: 'Needs your action',
      value: summary.action,
      hint: overdueHint,
      icon: Inbox,
      // Rose only when something is actually late, so the colour keeps meaning something.
      tone: summary.overdue > 0 ? 'rose' : summary.action > 0 ? 'indigo' : 'slate',
    },
    {
      label: 'Meetings today',
      value: summary.meetingsToday,
      hint: weekMeetings > summary.meetingsToday ? `${weekMeetings} this week` : undefined,
      icon: CalendarClock,
      tone: summary.meetingsToday > 0 ? 'blue' : 'slate',
    },
    {
      label: "Your team's queues",
      value: summary.shared,
      icon: Users,
      tone: summary.shared > 0 ? 'violet' : 'slate',
    },
    {
      label: 'Waiting on others',
      value: summary.watching,
      icon: Clock,
      tone: 'slate',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      {figures.map((figure) => (
        <KpiCard
          key={figure.label}
          label={figure.label}
          value={<Figure value={figure.value} />}
          hint={figure.hint}
          icon={figure.icon}
          tone={figure.tone}
        />
      ))}
    </div>
  );
}

/* ── rows ──────────────────────────────────────────────────────────────────────────────────────── */

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

  // Joined with a middot rather than laid out in columns: the fields that are present vary by
  // module, and a column grid over optional values leaves visible gaps where a module has no stage
  // or no amount.
  const details = [item.stage, item.raisedBy, typeof item.amount === 'number' ? formatAmount(item.amount) : null]
    .filter((part): part is string => Boolean(part));

  return (
    <Link
      href={item.href}
      className={cn(
        'group relative flex items-start gap-3 py-2.5 pl-4 pr-3 transition-colors',
        'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
      )}
    >
      {/* The urgency cue, repeated as words in the badge — colour is never the only carrier. */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r',
          urgency === 'overdue' && 'bg-rose-500',
          urgency === 'today' && 'bg-amber-500',
          urgency === 'soon' && 'bg-blue-400',
          (urgency === 'later' || urgency === 'undated') && 'bg-transparent',
        )}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-slate-800">{item.title}</span>
          {item.reference ? (
            <span className="font-mono text-[11px] text-muted-foreground">{item.reference}</span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px] font-medium', moduleBadgeClass(item.module))}>
            {item.module}
          </Badge>
          {details.length ? (
            <span className="truncate text-xs text-muted-foreground">{details.join(' · ')}</span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {item.startTime ? (
          <span className="text-sm font-semibold tabular-nums text-slate-700">{item.startTime}</span>
        ) : null}
        {isQueue ? (
          <Badge variant="outline" className="px-1.5 py-0 text-[11px] tabular-nums">
            {item.count} waiting
          </Badge>
        ) : urgency === 'undated' ? null : (
          <Badge variant="outline" className={cn('px-1.5 py-0 text-[11px] font-medium', WORK_URGENCY_BADGE[urgency])}>
            {dueLabel(item, today)}
          </Badge>
        )}
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
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
      <Card className="border-dashed border-slate-200 bg-white/60">
        <CardContent className="flex flex-col items-center gap-1.5 py-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500/70" />
          <p className="font-medium text-slate-700">Nothing is waiting on you.</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Approvals, tasks and workflow steps assigned to you will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <section>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{WORK_LANE_TITLE[lane]}</h2>
          <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">· {WORK_LANE_HINT[lane]}</span>
        </div>
        {byModule.length > 1 ? (
          <div className="flex flex-wrap gap-1">
            {byModule.slice(0, 4).map(({ module, count }) => (
              <Badge
                key={module}
                variant="outline"
                className={cn('px-1.5 py-0 text-[10px] font-medium', moduleBadgeClass(module))}
              >
                {module} {count}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <Card className="overflow-hidden border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
        <CardContent className="divide-y divide-slate-100 p-0">
          {visible.map((item) => (
            <WorkRow key={item.id} item={item} today={today} />
          ))}
        </CardContent>
      </Card>

      {items.length > COLLAPSED_ROWS ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-7 gap-1.5 text-xs"
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          {expanded ? 'Show less' : `Show all ${items.length}`}
        </Button>
      ) : null}
    </section>
  );
}

/* ── failures ──────────────────────────────────────────────────────────────────────────────────── */

function FailureNotice({ failures }: { failures: Array<{ id: string; label: string; message: string }> }) {
  const [open, setOpen] = useState(false);
  if (!failures.length) return null;

  return (
    <div className="rounded-lg border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-amber-900">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
        <p className="min-w-0 flex-1 text-xs">
          <span className="font-medium">
            {failures.length} queue{failures.length === 1 ? '' : 's'} could not be read.
          </span>{' '}
          <span className="text-amber-800/80">Everything below is accurate; work in these may not be shown.</span>
        </p>
        <button
          type="button"
          className="shrink-0 text-xs font-medium underline decoration-amber-400 underline-offset-2 hover:text-amber-950"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Hide' : 'Details'}
        </button>
      </div>
      {open ? (
        <ul className="mt-1.5 space-y-0.5 border-t border-amber-200/70 pl-5 pt-1.5 text-[11px] text-amber-900/90">
          {failures.map((failure) => (
            <li key={failure.id}>
              <span className="font-medium">{failure.label}</span> — {failure.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ── the screen ────────────────────────────────────────────────────────────────────────────────── */

/** "1 item needs you", "4 items need you" — the verb has to agree, and it is the first line read. */
function summaryLine(summary: WorkSummary): string {
  if (summary.action === 0) {
    return 'Pending approvals, tasks, workflow steps and meetings from every module.';
  }
  const items = summary.action === 1 ? '1 item needs' : `${summary.action} items need`;
  const modules = summary.modules === 1 ? '1 module' : `${summary.modules} modules`;
  return `${items} you across ${modules}.`;
}

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

  // Full width, by request. There is no `max-w-*` here on purpose: on a wide monitor a row's title
  // ends up a long way from its deadline badge, and that trade was made knowingly in favour of
  // fitting more on screen. If the separation ever becomes the complaint, the fix is a two-column
  // lane layout at `2xl` rather than a width cap — that uses the space instead of discarding it.
  const shell = 'w-full';

  if (isLoading) {
    return (
      <div className={cn(shell, 'space-y-3', className)}>
        <Skeleton className="h-9 w-56 rounded-md" />
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-[72px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const refreshButton = (
    <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={refresh} disabled={isRefreshing}>
      <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
      Refresh
    </Button>
  );

  return (
    <div className={cn(shell, 'space-y-4', className)}>
      {showTitle ? (
        <PageHeader title="Your work" description={summaryLine(summary)} actions={refreshButton} />
      ) : (
        // Without the title the description and the button would sit on a row of their own with
        // nothing to anchor them, so they share one baseline instead.
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{summaryLine(summary)}</p>
          {refreshButton}
        </div>
      )}

      <SummaryFigures summary={summary} weekMeetings={lanes.meeting.length} />

      <FailureNotice failures={failures} />

      {WORK_LANES.map((lane) => (
        <LaneSection key={lane} lane={lane} items={lanes[lane]} today={today} />
      ))}
    </div>
  );
}
