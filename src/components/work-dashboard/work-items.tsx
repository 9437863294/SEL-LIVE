'use client';

/**
 * The work itself, as cards: grouped by deadline in the List view, in deadline columns on the Board.
 *
 * Every card goes to the screen where the work is done. The whole card is the link, and the button
 * on it is the same link said out loud — "Review", "Open" — never "Approve". Each module has its own
 * decision rules (E-Approval's policy engine, required comments and attachments), and a one-click
 * decision here would either copy all of that and drift from it, or bypass it. The board's job ends
 * at putting the work one click from the screen that owns the decision.
 */

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, BellRing, Check, ChevronDown, User, Video, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import {
  WORK_BUCKETS,
  WORK_BUCKET_LABEL,
  formatWorkAmount,
  normalizeWorkPriority,
  workBucket,
  workWhenLabel,
  type WorkBucket,
  type WorkItem,
  type WorkKind,
  type WorkLane,
} from '@/lib/work-dashboard';
import { cn } from '@/lib/utils';
import { workModuleLook } from './work-module';

/* ── module tile ───────────────────────────────────────────────────────────────────────────────── */

const TILE_SIZE = {
  chip: 'h-[18px] w-[18px] rounded-full',
  sm: 'h-6 w-6 rounded-lg',
  rail: 'h-8 w-8 rounded-[10px]',
  md: 'h-11 w-11 rounded-[13px]',
} as const;

const TILE_ICON = { chip: 'h-2.5 w-2.5', sm: 'h-3.5 w-3.5', rail: 'h-4 w-4', md: 'h-[22px] w-[22px]' } as const;

/** The module's launcher icon on its gradient, so a card wears the same tile as the module's card. */
export function ModuleTile({ module, size = 'md', className }: { module: string; size?: keyof typeof TILE_SIZE; className?: string }) {
  const look = workModuleLook(module);
  const { Icon } = look;
  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center bg-gradient-to-br text-white', look.gradient, TILE_SIZE[size], className)}
      style={size === 'md' ? { boxShadow: `0 6px 14px -6px ${look.accent}` } : undefined}
    >
      <Icon className={TILE_ICON[size]} strokeWidth={size === 'chip' ? 2.2 : 1.8} />
    </span>
  );
}

/* ── deadlines ─────────────────────────────────────────────────────────────────────────────────── */

const BUCKET_TONE: Record<WorkBucket, StatusTone> = {
  overdue: 'danger',
  today: 'warning',
  week: 'info',
  later: 'success',
};

/** The heading dots and board-column dots. */
export const BUCKET_DOT: Record<WorkBucket, string> = {
  overdue: 'bg-rose-500',
  today: 'bg-amber-500',
  week: 'bg-blue-500',
  later: 'bg-emerald-500',
};

const isQueue = (item: WorkItem) => typeof item.count === 'number' && item.count > 0;

function WhenBadge({ item, today, className }: { item: WorkItem; today: string; className?: string }) {
  const bucket = workBucket(item, today);
  const undated = !item.dueAt;
  return (
    <StatusBadge
      tone={undated ? 'neutral' : item.kind === 'meeting' ? 'info' : BUCKET_TONE[bucket]}
      className={cn('rounded-full', className)}
    >
      {bucket === 'overdue' && item.kind !== 'meeting' ? <BellRing className="h-3 w-3" aria-hidden="true" /> : null}
      {workWhenLabel(item, today)}
    </StatusBadge>
  );
}

/* ── one card ──────────────────────────────────────────────────────────────────────────────────── */

const ACTION_LABEL: Record<WorkKind, string> = {
  approval: 'Review',
  task: 'Open',
  meeting: 'Details',
  reminder: 'Open',
};

function actionLabel(item: WorkItem): string {
  return isQueue(item) ? 'Open queue' : ACTION_LABEL[item.kind];
}

const Dot = () => <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-muted-foreground/40" aria-hidden="true" />;

export function WorkCard({ item, today, index = 0 }: { item: WorkItem; today: string; index?: number }) {
  const look = workModuleLook(item.module);
  const bucket = workBucket(item, today);
  const queue = isQueue(item);
  const priority = normalizeWorkPriority(item.priority);
  const label = actionLabel(item);
  // Only the two that ask for attention get a stripe; a stripe on every card is a border.
  const stripe = queue || item.kind === 'meeting' ? null : bucket === 'overdue' ? 'bg-rose-500' : bucket === 'today' ? 'bg-amber-500' : null;

  return (
    <li
      className={cn(
        'group/card relative overflow-hidden rounded-2xl border bg-card shadow-sm animate-wd-card-in',
        'transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-px hover:border-foreground/20 hover:shadow-md motion-reduce:hover:translate-y-0',
      )}
      style={{ '--wd-delay': `${Math.min(index, 8) * 40}ms` } as React.CSSProperties}
    >
      {stripe ? <span className={cn('absolute inset-y-0 left-0 w-1', stripe)} aria-hidden="true" /> : null}
      {/* The whole card is the link. Kept out of the tab order and the accessibility tree: the
          button below is the same link, named, so a keyboard reaches each card once. */}
      <Link href={item.href} tabIndex={-1} aria-hidden="true" className="absolute inset-0 rounded-[inherit]" />

      <div className="pointer-events-none relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-3 p-3.5 sm:gap-x-4 sm:px-4 md:grid-cols-[auto_minmax(0,1fr)_7.5rem_auto] md:items-center">
        <ModuleTile module={item.module} />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14.5px] font-bold leading-snug">
            <span className="min-w-0 break-words">{item.title}</span>
            {item.reference ? (
              <span className="max-w-full truncate rounded-md bg-muted px-1.5 py-px font-mono text-[11px] font-medium text-muted-foreground">
                {item.reference}
              </span>
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pl-0.5 pr-2 font-semibold text-foreground/80">
              <ModuleTile module={item.module} size="chip" />
              {look.label}
            </span>
            {item.stage ? (
              <>
                <Dot />
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Workflow className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{item.stage}</span>
                </span>
              </>
            ) : null}
            {item.raisedBy ? (
              <>
                <Dot />
                <span className="inline-flex min-w-0 items-center gap-1">
                  <User className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{item.raisedBy}</span>
                </span>
              </>
            ) : null}
            {priority === 'Critical' || priority === 'High' ? (
              <StatusBadge tone={priority === 'Critical' ? 'danger' : 'warning'} className="rounded-full px-2 py-0 text-[11px]">
                {priority}
              </StatusBadge>
            ) : null}
          </div>
        </div>

        {/* One row under the text on a phone; two columns of the card's grid from md up. */}
        <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 md:contents">
          <div className="shrink-0 md:text-right">
            {queue ? (
              <>
                <span className="text-[15px] font-extrabold tabular-nums">{item.count!.toLocaleString('en-IN')}</span>
                <span className="ml-1 text-[11px] text-muted-foreground md:ml-0 md:block">waiting</span>
              </>
            ) : typeof item.amount === 'number' ? (
              <span title={`₹${item.amount.toLocaleString('en-IN')}`}>
                <span className="text-[15px] font-extrabold tabular-nums">{formatWorkAmount(item.amount)}</span>
                <span className="hidden text-[11px] text-muted-foreground md:block">Amount</span>
              </span>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 md:flex-none md:flex-col md:items-end">
            {queue ? <span className="md:hidden" /> : <WhenBadge item={item} today={today} />}
            <div className="pointer-events-auto flex items-center gap-1.5">
              {item.actionUrl ? (
                // A video call belongs in its own tab; the board should still be here when it ends.
                <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 px-2.5">
                  <a href={item.actionUrl} target="_blank" rel="noreferrer">
                    <Video className="h-3.5 w-3.5" aria-hidden="true" />
                    Join
                  </a>
                </Button>
              ) : null}
              <Button asChild size="sm" className="h-8 gap-1.5 px-3" action={false}>
                <Link href={item.href} aria-label={`${label}: ${item.title}`}>
                  {label}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/* ── list ──────────────────────────────────────────────────────────────────────────────────────── */

/** How many cards show before the list offers the rest. */
const COLLAPSED_CARDS = 12;

function ShowAll({ total, expanded, onToggle }: { total: number; expanded: boolean; onToggle: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={onToggle}>
      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
      {expanded ? 'Show fewer' : `Show all ${total}`}
    </Button>
  );
}

/**
 * Cards under deadline headings when sorted by deadline; one run of cards for any other order,
 * where headings would split the order the person just asked for.
 */
export function WorkList({ items, today, grouped }: { items: WorkItem[]; today: string; grouped: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, COLLAPSED_CARDS);
  const more = items.length > COLLAPSED_CARDS ? <ShowAll total={items.length} expanded={expanded} onToggle={() => setExpanded((value) => !value)} /> : null;

  if (!grouped) {
    return (
      <div className="space-y-2">
        <ol className="space-y-2.5">
          {visible.map((item, index) => (
            <WorkCard key={item.id} item={item} today={today} index={index} />
          ))}
        </ol>
        {more}
      </div>
    );
  }

  // Counts in the headings are of the whole lane, not of the cards shown before "Show all".
  const totals = new Map<WorkBucket, number>();
  for (const item of items) {
    const bucket = workBucket(item, today);
    totals.set(bucket, (totals.get(bucket) ?? 0) + 1);
  }

  let index = 0;
  return (
    <div className="space-y-5">
      {WORK_BUCKETS.map((bucket) => {
        const rows = visible.filter((item) => workBucket(item, today) === bucket);
        if (!rows.length) return null;
        return (
          <section key={bucket} aria-label={WORK_BUCKET_LABEL[bucket]}>
            <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-bold">
              <span className={cn('h-2 w-2 rounded-full', BUCKET_DOT[bucket])} aria-hidden="true" />
              {WORK_BUCKET_LABEL[bucket]}
              <span className="font-semibold tabular-nums text-muted-foreground">{totals.get(bucket)}</span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </h3>
            <ol className="space-y-2.5">
              {rows.map((item) => (
                <WorkCard key={item.id} item={item} today={today} index={index++} />
              ))}
            </ol>
          </section>
        );
      })}
      {more}
    </div>
  );
}

/* ── board ─────────────────────────────────────────────────────────────────────────────────────── */

const COLLAPSED_COLUMN = 8;

function BoardColumn({ bucket, items, today }: { bucket: WorkBucket; items: WorkItem[]; today: string }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, COLLAPSED_COLUMN);
  return (
    <section aria-label={WORK_BUCKET_LABEL[bucket]} className="flex min-h-[15rem] min-w-0 flex-col rounded-2xl bg-muted/60 p-2.5">
      <h3 className="mx-1 mb-2.5 mt-0.5 flex items-center gap-2 text-[12.5px] font-bold">
        <span className={cn('h-2 w-2 rounded-full', BUCKET_DOT[bucket])} aria-hidden="true" />
        {WORK_BUCKET_LABEL[bucket]}
        <span className="ml-auto font-semibold tabular-nums text-muted-foreground">{items.length}</span>
      </h3>
      {items.length ? (
        <ol className="space-y-2">
          {visible.map((item) => {
            const look = workModuleLook(item.module);
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="block rounded-xl border bg-card p-3 shadow-sm transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="mb-2 flex items-center gap-2">
                    <ModuleTile module={item.module} size="sm" />
                    <span className="truncate text-[11.5px] font-semibold text-muted-foreground">{look.label}</span>
                  </span>
                  <span className="line-clamp-3 text-[13px] font-semibold leading-snug">{item.title}</span>
                  {item.stage ? <span className="mt-1 block truncate text-[11.5px] text-muted-foreground">{item.stage}</span> : null}
                  <span className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5">
                    {isQueue(item) ? (
                      <span className="text-xs font-semibold text-muted-foreground">{item.count!.toLocaleString('en-IN')} waiting</span>
                    ) : (
                      <WhenBadge item={item} today={today} className="text-[11px]" />
                    )}
                    {typeof item.amount === 'number' ? (
                      <span className="text-[13px] font-bold tabular-nums">{formatWorkAmount(item.amount)}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="flex flex-1 items-center justify-center py-8 text-xs text-muted-foreground">Nothing here</p>
      )}
      {items.length > COLLAPSED_COLUMN ? (
        <div className="mt-1.5">
          <ShowAll total={items.length} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
        </div>
      ) : null}
    </section>
  );
}

export function WorkColumns({ items, today }: { items: WorkItem[]; today: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {WORK_BUCKETS.map((bucket) => (
        <BoardColumn key={bucket} bucket={bucket} today={today} items={items.filter((item) => workBucket(item, today) === bucket)} />
      ))}
    </div>
  );
}

/* ── nothing to show ───────────────────────────────────────────────────────────────────────────── */

const EMPTY_TEXT: Record<WorkLane, [string, string]> = {
  action: ['All caught up', 'Nothing needs your action. New approvals, tasks and steps appear here as they arrive.'],
  meeting: ['No meetings this week', 'Meetings you are in, and invitations waiting for your answer, appear here.'],
  shared: ['Your team’s queues are empty', 'Work open to your role, with nobody named on it yet, appears here.'],
  watching: ['Nothing waiting on others', 'What you raised, or are watching, is tracked here until it is done.'],
};

export function WorkEmpty({ lane, filtered, onClear }: { lane: WorkLane; filtered: boolean; onClear: () => void }) {
  const [title, text] = filtered ? ['Nothing matches', 'Try another search, or clear the module filter.'] : EMPTY_TEXT[lane];
  return (
    <div className="rounded-2xl border border-dashed bg-card px-5 py-10 text-center">
      <span
        className={cn(
          'mx-auto mb-3.5 flex h-14 w-14 items-center justify-center rounded-[18px] text-white',
          filtered ? 'bg-gradient-to-br from-slate-400 to-slate-600' : 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_12px_24px_-10px_#059669]',
        )}
        aria-hidden="true"
      >
        <Check className="h-7 w-7" />
      </span>
      <p className="text-base font-bold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{text}</p>
      {filtered ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
