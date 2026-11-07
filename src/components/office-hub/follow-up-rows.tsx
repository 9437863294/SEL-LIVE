'use client';

/**
 * The rows of the decision and action item registers (2026-11-07, from the user's mockup
 * `sel-decisions-actions-teams-redesign.html`): a decision as a card with its follow-up and how many
 * of its actions are done, an action item as a row under the meeting that raised it, and the
 * three-step explainer the empty action item register shows.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Building2, CalendarDays, CircleCheck, ExternalLink, FileText, Link2, ListChecks, Loader2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  OFFICE_HUB_BASE_PATH,
  decisionFollowUp,
  formatIsoDate,
  isActionItemOverdue,
  relativeDue,
  type MeetingGroup,
  type OfficeHubActionItem,
  type OfficeHubDecision,
} from '@/lib/office-hub';
import { PRIORITY_COLOUR, PriorityBars } from './task-create-dialog';
import { MiniProgress, PersonLine, RoundTick, WorkStatusChip } from './register-parts';

const BASE = OFFICE_HUB_BASE_PATH;

/* ── decisions ──────────────────────────────────────────────────────────────────────────────── */

export function DecisionCard({
  decision,
  today,
  viewerId,
  actions,
  onOpen,
}: {
  decision: OfficeHubDecision;
  today: string;
  viewerId: string;
  /** Done / total of its action items, or null when they could not be counted. */
  actions: { done: number; total: number } | null;
  onOpen: () => void;
}) {
  const follow = decisionFollowUp(decision, today);
  const finished = decision.status === 'Completed' || decision.status === 'Cancelled';
  const day = Number(decision.decisionDate.slice(8, 10));
  const monthShort = formatIsoDate(decision.decisionDate, { year: false }).split(' ')[1] ?? '';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'relative grid w-full grid-cols-2 items-center gap-x-4 gap-y-2 overflow-hidden rounded-[15px] border py-3 pl-[18px] pr-3.5 text-left transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md',
        'lg:grid-cols-[52px_minmax(0,1fr)_180px_160px] xl:grid-cols-[56px_minmax(0,1fr)_200px_170px_120px]',
        finished ? 'bg-muted/30' : 'bg-card',
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: PRIORITY_COLOUR[decision.priority] }} />
      <span className="hidden rounded-xl bg-muted py-1 text-center lg:block">
        <small className="block text-[10px] font-extrabold uppercase text-muted-foreground">{monthShort}</small>
        <b className="block text-lg leading-tight">{day}</b>
      </span>

      <span className="col-span-2 min-w-0 lg:col-span-1">
        <span className={cn('block break-words text-sm font-extrabold leading-snug', finished && 'text-muted-foreground')}>{decision.title}</span>
        {decision.description && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{decision.description}</span>}
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          <MetaChip>{decision.reference}</MetaChip>
          <MetaChip className="lg:hidden">Taken {formatIsoDate(decision.decisionDate, { year: false })}</MetaChip>
          {decision.meetingTitle && <MetaChip icon={CalendarDays}>{decision.meetingTitle}</MetaChip>}
          {decision.projectName && <MetaChip icon={Building2}>{decision.projectName}</MetaChip>}
          {decision.departmentName && <MetaChip>{decision.departmentName}</MetaChip>}
          <span className="hidden lg:inline-flex xl:hidden">
            <WorkStatusChip status={decision.status} />
          </span>
        </span>
      </span>

      <PersonLine seed={decision.ownerId} name={decision.ownerName} subtitle="Owner" you={decision.ownerId === viewerId} />

      <span className="min-w-0">
        <b
          className={cn(
            'block text-xs',
            follow.tone === 'late'
              ? 'text-rose-600'
              : follow.tone === 'today'
                ? 'text-amber-600'
                : follow.tone === 'done'
                  ? 'text-emerald-700'
                  : follow.tone === 'none'
                    ? 'text-muted-foreground'
                    : '',
          )}
        >
          {follow.label}
        </b>
        {follow.detail && <small className="block truncate text-[11px] font-semibold text-muted-foreground">{follow.detail}</small>}
        {actions && actions.total > 0 && <MiniProgress done={actions.done} total={actions.total} noun="actions" />}
      </span>

      <span className="col-span-2 flex flex-wrap items-center gap-2 lg:hidden xl:col-span-1 xl:flex xl:flex-col xl:items-start xl:gap-1.5">
        <WorkStatusChip status={decision.status} />
        <PriorityBars priority={decision.priority} />
      </span>
    </button>
  );
}

function MetaChip({ children, icon: Icon, className }: { children: ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 rounded-[7px] bg-muted px-1.5 py-px text-[11px] font-bold text-muted-foreground', className)}>
      {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/* ── action items ───────────────────────────────────────────────────────────────────────────── */

const isOpen = (item: OfficeHubActionItem) => item.status === 'Open' || item.status === 'In Progress';

/** A meeting's heading over its action items: title, date, how many are done, its minutes. */
export function ActionGroupHeader({ group }: { group: MeetingGroup<OfficeHubActionItem> }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 bg-pink-50/50 px-3.5 py-2.5">
      <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-gradient-to-br from-pink-300 to-pink-700 text-white">
        {group.meetingId ? <CalendarDays className="h-3.5 w-3.5" /> : <ListChecks className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <b className="text-[13px]">{group.title}</b>
        <small className="block text-[11.5px] font-semibold text-muted-foreground sm:ml-1.5 sm:inline">
          {group.date ? `${formatIsoDate(group.date, { withWeekday: true, year: false })} · ` : ''}
          {group.items.length} item{group.items.length === 1 ? '' : 's'} · {group.done} done
        </small>
      </span>
      {group.meetingId && (
        <Button size="sm" variant="outline" asChild className="h-7 gap-1.5 px-2.5 text-xs">
          <Link href={`${BASE}/meetings/${group.meetingId}/mom`}>
            <FileText className="h-3.5 w-3.5" aria-hidden />
            Open minutes
          </Link>
        </Button>
      )}
    </div>
  );
}

export function ActionRow({
  item,
  today,
  viewerId,
  decisionReference,
  canTick,
  canConvert,
  busy,
  onToggle,
  onConvert,
}: {
  item: OfficeHubActionItem;
  today: string;
  viewerId: string;
  decisionReference: string | null;
  canTick: boolean;
  canConvert: boolean;
  busy: boolean;
  onToggle: () => void;
  onConvert: () => void;
}) {
  const done = item.status === 'Completed';
  const late = isActionItemOverdue(item, today);
  const dueToday = item.dueDate === today && isOpen(item);
  const who = item.responsibleUserName ?? item.responsibleTeamName ?? 'Nobody';
  const whoSeed = item.responsibleUserId ?? item.responsibleTeamId ?? item.id;
  const subtitle = item.responsibleUserName ? item.responsibleTeamName ?? item.departmentName ?? null : item.responsibleTeamName ? 'Team' : null;

  const due = (
    <span className={cn('whitespace-nowrap text-xs font-bold', late ? 'text-rose-600' : dueToday ? 'text-amber-600' : '')}>
      {done ? 'Done' : relativeDue(item.dueDate, today)}
      {item.dueDate && <small className="block text-[11px] font-semibold text-muted-foreground">{formatIsoDate(item.dueDate, { withWeekday: true, year: false })}</small>}
    </span>
  );

  const task: ReactNode = item.taskId ? (
    <Link
      href={`${BASE}/tasks/${item.taskId}`}
      className="inline-flex items-center gap-1 rounded-[8px] border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11.5px] font-extrabold text-blue-700 hover:bg-blue-100"
    >
      <ExternalLink className="h-3 w-3" aria-hidden />
      View task
    </Link>
  ) : canConvert && isOpen(item) ? (
    <button
      type="button"
      disabled={busy}
      onClick={onConvert}
      className="inline-flex items-center gap-1 rounded-[8px] border border-dashed border-pink-400 bg-pink-50 px-2 py-0.5 text-[11.5px] font-extrabold text-pink-700 hover:bg-pink-100 disabled:opacity-50 dark:text-pink-300"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Link2 className="h-3 w-3" aria-hidden />}
      Turn into task
    </button>
  ) : (
    <span className="text-xs text-muted-foreground">—</span>
  );

  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 border-t border-border/60 py-2.5 pl-[22px] pr-3.5 hover:bg-pink-50/30 lg:grid-cols-[28px_minmax(0,1fr)_170px_120px_100px_110px_130px]">
      <RoundTick
        done={done}
        disabled={!canTick || busy || item.status === 'Cancelled'}
        onToggle={onToggle}
        label={`${done ? 'Reopen' : 'Complete'} ${item.title}`}
        title={!canTick ? 'Only the responsible person, the person who raised it or a team leader can change this' : done ? 'Reopen' : item.taskId ? 'Mark done (closes its task too)' : 'Mark done'}
      />
      <span className="min-w-0">
        <span className={cn('block break-words text-[13px] font-bold leading-snug', done && 'text-muted-foreground line-through')}>{item.title}</span>
        <span className="text-[11px] font-bold text-muted-foreground">{item.reference}</span>
        {item.decisionId && (
          <Link href={`${BASE}/decisions/${item.decisionId}`} className="ml-1 text-[11px] font-bold text-violet-700 hover:underline">
            · from {decisionReference ?? 'a decision'}
          </Link>
        )}
        {item.carriedFromActionItemId && <span className="ml-1 text-[11px] font-bold text-amber-700">· carried forward</span>}
      </span>

      {/* phones and tablets: one wrapped line under the title */}
      <span className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 lg:hidden">
        <PersonLine seed={whoSeed} name={who} subtitle={subtitle} you={item.responsibleUserId === viewerId} size={20} />
        {due}
        <WorkStatusChip status={item.status} />
        {task}
      </span>

      <span className="hidden min-w-0 lg:block">
        <PersonLine seed={whoSeed} name={who} subtitle={subtitle} you={item.responsibleUserId === viewerId} />
      </span>
      <span className="hidden lg:block">{due}</span>
      <span className="hidden lg:block">
        <PriorityBars priority={item.priority} />
      </span>
      <span className="hidden lg:block">
        <WorkStatusChip status={item.status} />
      </span>
      <span className="hidden lg:block">{task}</span>
    </li>
  );
}

/** The empty register's explainer. Step 3 is what `updateTask` does on completion. */
export function HowActionItemsWork() {
  const steps: [string, string, LucideIcon][] = [
    ['1. Raise it in a meeting', 'Write it into the minutes with a person and a due date', CalendarDays],
    ['2. Turn it into a task', 'The person gets reminders until it is done', Link2],
    ['3. It closes itself', 'When the task is completed, the action item is too', CircleCheck],
  ];
  return (
    <div className="rounded-2xl border border-dashed border-pink-300 bg-pink-50/40 p-3.5">
      <h6 className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">How action items work</h6>
      {steps.map(([title, body, Icon]) => (
        <div key={title} className="mb-1.5 flex items-center gap-2.5 rounded-[11px] border bg-card px-2.5 py-2 last:mb-0">
          <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-gradient-to-br from-pink-300 to-pink-700 text-white">
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">
            <b className="block text-[12.5px]">{title}</b>
            <span className="text-[11.5px] text-muted-foreground">{body}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
