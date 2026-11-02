'use client';

/**
 * The band at the top of the work board: the day, a greeting, what is waiting, and four figures.
 *
 * The figures are also the lane switch. Each one is a count of a lane, and pressing it puts that
 * lane in the list below, so a number on this screen is never more than one press from the rows
 * behind it. The pressed one turns white, which is how the list says which lane it is showing.
 */

import Link from 'next/link';
import { CalendarClock, Clock, Inbox, Play, RefreshCw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { greeting, longDate } from '@/components/home/home-data';
import { formatClock, toWorkDate, workUrgency, type WorkItem, type WorkLane, type WorkLanes, type WorkSummary } from '@/lib/work-dashboard';
import { cn } from '@/lib/utils';
import { useCountUp } from './use-count-up';

/**
 * Compact above a thousand. A shared queue can hold four figures, and `1798` beside `1` makes the
 * small number look like the unimportant one when it is the only one naming this person.
 */
const formatFigure = (value: number): string =>
  value >= 1000 ? new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value) : String(value);

function Figure({ value }: { value: number }) {
  return <>{formatFigure(useCountUp(value))}</>;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const nowClock = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

interface Tile {
  lane: WorkLane;
  label: string;
  icon: React.ElementType;
  value: number;
  note: string;
  /** The note is bad news, in rose. */
  hot?: boolean;
}

function tiles(summary: WorkSummary, lanes: WorkLanes, today: string): Tile[] {
  const meetingsToday = lanes.meeting.filter((item) => toWorkDate(item.dueAt) === today);
  const clock = nowClock();
  const next = meetingsToday
    .filter((item) => item.startTime && item.startTime >= clock)
    .sort((left, right) => (left.startTime ?? '').localeCompare(right.startTime ?? ''))[0];
  const waitingLate = lanes.watching.filter((item) => workUrgency(item, today) === 'overdue').length;
  const queueModules = new Set(lanes.shared.map((item) => item.module)).size;

  return [
    {
      lane: 'action',
      label: 'Needs your action',
      icon: Inbox,
      value: summary.action,
      note: summary.overdue
        ? `${summary.overdue} overdue`
        : summary.dueToday
          ? `${summary.dueToday} due today`
          : summary.action
            ? 'All on time'
            : 'Nothing waiting',
      hot: summary.overdue > 0,
    },
    {
      lane: 'meeting',
      label: 'Meetings today',
      icon: CalendarClock,
      value: summary.meetingsToday,
      note: next?.startTime
        ? `Next at ${formatClock(next.startTime)}`
        : meetingsToday.length
          ? 'None left today'
          : lanes.meeting.length
            ? `${lanes.meeting.length} this week`
            : 'Calendar is free',
    },
    {
      lane: 'shared',
      label: 'Your team’s queues',
      icon: Users,
      value: summary.shared,
      note: queueModules ? `In ${plural(queueModules, 'module', 'modules')}` : 'Nothing queued',
    },
    {
      lane: 'watching',
      label: 'Waiting on others',
      icon: Clock,
      value: summary.watching,
      note: waitingLate ? `${waitingLate} past the deadline` : summary.watching ? 'None past the deadline' : 'Nothing pending',
      hot: waitingLate > 0,
    },
  ];
}

export function WorkHero({
  firstName,
  summary,
  lanes,
  today,
  lane,
  onLane,
  next,
  isRefreshing,
  onRefresh,
  showTitle,
  listId,
}: {
  firstName: string;
  summary: WorkSummary;
  lanes: WorkLanes;
  today: string;
  lane: WorkLane;
  onLane: (lane: WorkLane) => void;
  /** The most pressing item that names this person, for "Start with the oldest". */
  next: WorkItem | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  /** On `/my-work` the band is the page's title, so the eyebrow says what page this is. */
  showTitle: boolean;
  /** The list the figures switch, for `aria-controls`. */
  listId: string;
}) {
  const now = new Date();
  const name = firstName || 'there';
  const nextOverdue = next ? workUrgency(next, today) === 'overdue' : false;

  return (
    <section className="wd-hero keep-light relative overflow-hidden rounded-2xl px-4 py-5 text-white sm:px-6 sm:py-6 lg:px-7">
      <div className="wd-hero-dots pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] xl:items-center xl:gap-7">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/70">
            {showTitle ? `Your work · ${longDate(now)}` : longDate(now)}
          </p>
          <h1 className="mt-1.5 text-2xl font-extrabold leading-tight tracking-tight sm:text-[28px]">
            {summary.action ? `${greeting(now)}, ${name}` : `You’re all caught up, ${name}`}
          </h1>
          <p className="mt-1.5 text-sm text-white/80">
            {summary.action ? (
              <>
                <b className="font-semibold text-white">{plural(summary.action, 'item needs', 'items need')}</b> you across{' '}
                {plural(summary.modules, 'module', 'modules')}
                {summary.overdue ? (
                  <>
                    {' — '}
                    <b className="font-semibold text-rose-200">{summary.overdue} overdue</b>
                  </>
                ) : null}
                .
              </>
            ) : (
              'Nothing is waiting on you right now. New work appears here as it arrives.'
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {next ? (
              <Button asChild size="sm" className="h-9 gap-2 bg-white px-3.5 text-slate-900 shadow-sm hover:bg-white/90" action={false}>
                <Link href={next.href} title={next.title}>
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  {nextOverdue ? 'Start with the oldest' : 'Open the most urgent'}
                </Link>
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-2 border-white/25 bg-white/10 px-3.5 text-white backdrop-blur-sm hover:bg-white/20 hover:text-white"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} aria-hidden="true" />
              {isRefreshing ? 'Refreshing' : 'Refresh'}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
          {tiles(summary, lanes, today).map((tile, index) => {
            const active = tile.lane === lane;
            const Icon = tile.icon;
            return (
              <button
                key={tile.lane}
                type="button"
                aria-pressed={active}
                aria-controls={listId}
                onClick={() => onLane(tile.lane)}
                className={cn(
                  'animate-wd-card-in min-w-0 rounded-2xl border px-3 py-3 text-left transition-colors sm:px-3.5',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-0',
                  active ? 'border-white bg-white text-slate-900 shadow-lg' : 'border-white/15 bg-white/10 text-white backdrop-blur-sm hover:bg-white/15',
                )}
                style={{ '--wd-delay': `${index * 70}ms` } as React.CSSProperties}
              >
                <span className={cn('flex items-center gap-1.5 text-[11.5px] font-semibold leading-tight', active ? 'text-slate-500' : 'text-white/70')}>
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{tile.label}</span>
                </span>
                <span className={cn('mt-1 block text-2xl font-extrabold leading-tight tracking-tight tabular-nums sm:text-[26px]', tile.value === 0 && 'opacity-50')}>
                  <Figure value={tile.value} />
                </span>
                <span
                  className={cn(
                    'block truncate text-xs',
                    tile.hot ? (active ? 'font-semibold text-rose-600' : 'font-semibold text-rose-200') : active ? 'text-slate-600' : 'text-white/75',
                  )}
                >
                  {tile.note}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
