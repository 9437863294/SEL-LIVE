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
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Inbox,
  List as ListIcon,
  RefreshCw,
  Users,
  Video,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { moduleBadgeClass } from '@/lib/activity-modules';
import { KpiCard, PageHeader, type Tone } from '@/components/shared/kpi-card';
import { CellLink, DataList, type ListColumn } from '@/components/shared/data-list';
import {
  WORK_LANES,
  WORK_LANE_HINT,
  WORK_LANE_TITLE,
  WORK_URGENCY_BADGE,
  calendarItems,
  mergedWorkItems,
  dueLabel,
  workUrgency,
  type WorkItem,
  type WorkLane,
  type WorkLanes,
  type WorkSummary,
} from '@/lib/work-dashboard';
import { useWorkDashboard } from './hooks';
import { useCountUp } from './use-count-up';
import WorkCalendar from './work-calendar';

/* ── figures ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * Compact above a thousand.
 *
 * A shared queue can genuinely hold four figures — Daily Requisition's open pipeline runs into the
 * thousands — and `1799` sitting next to `1` makes the small number look like the unimportant one,
 * when it is the only one naming this person. `1.8k` keeps the magnitude without the visual weight.
 */
const formatFigure = (value: number): string =>
  value >= 1000
    ? new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
    : String(value);

/**
 * A count, animated to its new value, and muted when it is zero.
 *
 * On a typical day most of these are zero — one person's four counts are not four pieces of news —
 * and four confident black zeroes give a screen with one real item on it the visual weight of a
 * screen with forty. Muting them keeps the eye on the number that is actually saying something.
 */
function Figure({ value }: { value: number }) {
  const shown = useCountUp(value);
  return (
    <span
      className={cn(
        'tabular-nums transition-colors',
        value === 0 && 'font-normal text-muted-foreground/60',
      )}
    >
      {/* The animated value while counting, the exact one once settled — so a compacted figure never
          shows a rounding artefact mid-flight. */}
      {formatFigure(shown)}
    </span>
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
      {figures.map((figure, index) => (
        <KpiCard
          key={figure.label}
          label={figure.label}
          value={<Figure value={figure.value} />}
          hint={figure.hint}
          icon={figure.icon}
          tone={figure.tone}
          accent
          accentClassName="animate-wd-accent"
          className={cn(
            'animate-wd-card-in',
            // A lift on hover, so the row reads as a set of objects rather than a painted band.
            'hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0',
            'transition-[transform,box-shadow] duration-200',
          )}
          /*
            Staggered by index, so the row assembles left to right rather than appearing at once —
            which is what makes four cards read as four things rather than one painted band.

            Set as a custom property, not `animationDelay`, because the accent bar inside the card
            needs the same number plus an offset. A custom property inherits to it; an inline
            `animationDelay` would apply only to the card itself.
          */
          style={{ '--wd-delay': `${index * 70}ms` } as React.CSSProperties}
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

/**
 * The columns, as a table on a desktop and a card per row on a phone.
 *
 * Declared once and rendered twice by `DataList`, which is why each column carries a `mobile` slot:
 * the phone card needs to know which value is the headline and which belongs in the label/value
 * grid. Getting that wrong is how a register ends up readable on one device and not the other.
 *
 * The urgency colour is a left border on the whole row rather than a column of its own — a column of
 * coloured squares would be a second, worse copy of the Due column, which already says "14 days
 * overdue" in words.
 */
function workColumns(today: string): Array<ListColumn<WorkItem>> {
  return [
    {
      header: 'Item',
      mobile: 'title',
      /**
       * `w-full max-w-0` is the CSS-table truncation idiom, not a mistake.
       *
       * A table cell will not honour `text-overflow: ellipsis` while its intrinsic width can grow to
       * fit the text, so a long subject either wraps to a second line or pushes the other columns
       * off. Setting `max-width: 0` with `width: 100%` makes this the one column that absorbs the
       * leftover width, and lets its content clip inside whatever is left.
       */
      className: 'w-full max-w-0',
      cell: (item) => (
        <div className="flex min-w-0 items-baseline gap-2">
          <CellLink
            href={item.href}
            className="truncate text-sm font-medium text-slate-800 hover:underline"
          >
            {item.title}
          </CellLink>
          {item.reference ? (
            <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
              {item.reference}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      header: 'Module',
      mobile: 'detail',
      className: 'whitespace-nowrap',
      cell: (item) => (
        <Badge
          variant="outline"
          className={cn('whitespace-nowrap px-1.5 py-0 text-[10px] font-medium', moduleBadgeClass(item.module))}
        >
          {item.module}
        </Badge>
      ),
    },
    {
      header: 'Stage',
      mobile: 'detail',
      className: 'hidden max-w-[14rem] truncate whitespace-nowrap lg:table-cell',
      cell: (item) => <span className="text-xs text-muted-foreground">{item.stage ?? '—'}</span>,
    },
    {
      header: 'With / raised by',
      mobile: 'detail',
      className: 'hidden max-w-[12rem] truncate whitespace-nowrap xl:table-cell',
      cell: (item) => <span className="text-xs text-muted-foreground">{item.raisedBy ?? '—'}</span>,
    },
    {
      header: 'Amount',
      align: 'right',
      mobile: 'detail',
      className: 'hidden whitespace-nowrap md:table-cell',
      cell: (item) => (
        <span className="text-xs tabular-nums text-slate-700">
          {typeof item.amount === 'number' ? formatAmount(item.amount) : '—'}
        </span>
      ),
    },
    {
      header: 'Due',
      align: 'right',
      mobile: 'aside',
      cell: (item) => {
        if (typeof item.count === 'number' && item.count > 0) {
          return (
            <Badge variant="outline" className="whitespace-nowrap px-1.5 py-0 text-[11px] tabular-nums">
              {item.count} waiting
            </Badge>
          );
        }
        const urgency = workUrgency(item, today);
        if (urgency === 'undated') return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="flex items-center justify-end gap-1.5">
            {item.startTime ? (
              <span className="text-xs font-semibold tabular-nums text-slate-700">{item.startTime}</span>
            ) : null}
            <Badge variant="outline" className={cn('whitespace-nowrap px-1.5 py-0 text-[11px] font-medium', WORK_URGENCY_BADGE[urgency])}>
              {dueLabel(item, today)}
            </Badge>
          </div>
        );
      },
    },
    {
      header: 'Action',
      align: 'right',
      // 'footer' puts the button in the card's action strip on a phone, where `DataList` stops
      // wrapping the card in a link so the button can receive the tap.
      mobile: 'footer',
      cell: (item) => (
        <div className="flex items-center justify-end gap-1.5">
          {item.actionUrl ? (
            // `target="_blank"` with `rel="noreferrer"`: a video call belongs in its own tab, and
            // the dashboard should still be there when the meeting ends.
            <Button asChild size="sm" className="h-7 gap-1 px-2 text-xs">
              <a href={item.actionUrl} target="_blank" rel="noreferrer">
                <Video className="h-3 w-3" /> Join
              </a>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs">
            <Link href={item.href}>
              {item.lane === 'meeting' ? 'Details' : 'Open'}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      ),
    },
  ];
}

/**
 * Why the action is "Open" and not "Approve".
 *
 * Every one of these nineteen sources has its own decision rules — E-Approval alone has a policy
 * engine covering the verification stack, return-to-any-step, supersede-on-material-change and the
 * approval matrix, and most modules require a comment or an attachment with the decision. A one-click
 * Approve here would either reimplement all of that (and drift from it) or bypass it. Neither is an
 * acceptable thing to do to an approval trail, so the dashboard's job ends at putting the work one
 * click from the screen that owns the decision.
 */
const laneRowClass = (item: WorkItem, today: string): string => {
  const urgency = workUrgency(item, today);
  if (typeof item.count === 'number' && item.count > 0) return 'border-l-[3px] border-l-transparent';
  return cn(
    'border-l-[3px]',
    urgency === 'overdue' && 'border-l-rose-500',
    urgency === 'today' && 'border-l-amber-500',
    urgency === 'soon' && 'border-l-blue-400',
    (urgency === 'later' || urgency === 'undated') && 'border-l-transparent',
  );
};

/** How many rows a lane shows before it offers to show the rest. */
const COLLAPSED_ROWS = 8;

/**
 * One table, one header, every lane.
 *
 * It used to be four sections, each with its own `DataList` and therefore its own header row. That
 * repeated ITEM / MODULE / STAGE / … up to four times down the page, and — worse — each table sized
 * its own columns to its own content, so the four header rows did not line up with one another. Four
 * tables of the same thing that disagree about where their columns are is harder to read than one
 * table, whatever the headings say.
 *
 * The lane survives as the `Type` column rather than as a heading. That matters: the distinction
 * between work that names you and work merely open to your role is the one genuinely useful thing
 * this screen knows, and dropping it to merge the tables would have been the wrong trade. Sorting is
 * `compareMergedWorkItems` — lane first, urgency within — so the rows naming you stay at the top and
 * a deep shared queue can never bury them.
 */
const LANE_BADGE: Record<WorkLane, string> = {
  action: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  meeting: 'bg-blue-50 text-blue-700 border-blue-200',
  shared: 'bg-violet-50 text-violet-700 border-violet-200',
  watching: 'bg-slate-50 text-slate-600 border-slate-200',
};

const LANE_SHORT: Record<WorkLane, string> = {
  action: 'Needs you',
  meeting: 'Meeting',
  shared: 'Team queue',
  watching: 'Waiting',
};

function WorkTable({ items, today }: { items: WorkItem[]; today: string }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, COLLAPSED_ROWS);

  const columns = useMemo<Array<ListColumn<WorkItem>>>(
    () => [
      {
        header: 'Type',
        mobile: 'detail',
        className: 'whitespace-nowrap',
        cell: (item) => (
          <Badge
            variant="outline"
            title={WORK_LANE_HINT[item.lane]}
            className={cn('whitespace-nowrap px-1.5 py-0 text-[10px] font-medium', LANE_BADGE[item.lane])}
          >
            {LANE_SHORT[item.lane]}
          </Badge>
        ),
      },
      ...workColumns(today),
    ],
    [today],
  );

  if (!items.length) {
    return (
      <Card className="border-dashed border-slate-200 bg-white/60">
        <CardContent className="flex flex-col items-center gap-1.5 py-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500/70" />
          <p className="font-medium text-slate-700">Nothing is waiting on you.</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Approvals, tasks, workflow steps and meetings assigned to you will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <DataList
        rows={visible}
        columns={columns}
        rowClassName={(item) => laneRowClass(item, today)}
        // No `cardHref`: the row holds an Open button, and DataList only leaves a phone card's
        // footer tappable when the card itself is not wrapped in a link.
        dense
        /*
          The rows scroll inside the table, with the header pinned, instead of lengthening the page.
          Seventeen overdue approvals should not push the figures off screen. `maxHeightClassName` is
          DataList's own mechanism — it moves the scroll to the table's wrapper and makes the header
          sticky against it. Wrapping this in a `ScrollArea` would not work: that wrapper is already a
          scroll container, so a sticky header pins to the wrong element and rides away with the rows.
        */
        maxHeightClassName="sm:max-h-[32rem]"
      />

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
    </div>
  );
}

/** The lane counts, as a line of text instead of four section headings. */
function LaneSummary({ lanes }: { lanes: WorkLanes }) {
  const present = WORK_LANES.filter((lane) => lanes[lane].length > 0);
  if (present.length <= 1) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {present.map((lane) => (
        <span key={lane} className="inline-flex items-center gap-1" title={WORK_LANE_HINT[lane]}>
          <Badge
            variant="outline"
            className={cn('px-1.5 py-0 text-[10px] font-medium', LANE_BADGE[lane])}
          >
            {LANE_SHORT[lane]}
          </Badge>
          <span className="tabular-nums">{lanes[lane].length}</span>
          <span className="hidden sm:inline">{WORK_LANE_TITLE[lane].toLowerCase()}</span>
        </span>
      ))}
    </div>
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
  const { lanes, summary, failures, today, isLoading, isRefreshing, refresh, fetchMeetings } =
    useWorkDashboard();
  const [view, setView] = useState<'list' | 'calendar'>('list');

  // `summary` is memoised on the lanes, so this fires when the counts actually change rather than
  // on every render — which is what stops the callback becoming a render loop.
  useEffect(() => {
    onSummaryChange?.(summary);
  }, [summary, onSummaryChange]);

  const merged = useMemo(() => mergedWorkItems(lanes, today), [lanes, today]);

  // How many rows the calendar can actually place, for the count on its tab.
  const datedCount = useMemo(() => calendarItems(lanes).dated.length, [lanes]);

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

      {/*
        List and Calendar are two arrangements of one dataset, not two screens. The calendar issues
        no queries of its own — it takes the same `lanes` and groups them by date — so switching is
        free, and the two can never disagree about what is pending.

        Both panels are `forceMount`ed for the same reason as the outer tabs, plus one of its own:
        each lane's table owns its expand-all state and the calendar remembers the month you paged
        to. Letting Radix unmount them would reset all of that on every switch. As there, `forceMount`
        stops Radix applying `hidden`, so `data-[state=inactive]:hidden` does the hiding.
      */}
      <Tabs value={view} onValueChange={(value) => setView(value === 'calendar' ? 'calendar' : 'list')}>
        <TabsList className="h-9 border border-slate-200/80 bg-slate-100/80 p-1 shadow-sm">
          <TabsTrigger value="list" className='h-7 gap-1.5 px-2.5 text-xs'>
            <ListIcon className="h-3.5 w-3.5" /> List
          </TabsTrigger>
          <TabsTrigger value="calendar" className='h-7 gap-1.5 px-2.5 text-xs'>
            <CalendarDays className="h-3.5 w-3.5" /> Calendar
            {datedCount > 0 ? (
              <Badge variant="outline" className="ml-0.5 px-1 py-0 text-[10px] tabular-nums">
                {datedCount}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" forceMount className="space-y-4 data-[state=inactive]:hidden">
          <LaneSummary lanes={lanes} />
          <WorkTable items={merged} today={today} />
        </TabsContent>

        <TabsContent value="calendar" forceMount className="data-[state=inactive]:hidden">
          <WorkCalendar lanes={lanes} today={today} fetchMeetings={fetchMeetings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
