'use client';

import { AlertTriangle, Clock, Lock, PauseCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  describeEApprovalAssignment,
  eApprovalOutcomeStyles,
  eApprovalSlaState,
  eApprovalStatusStyles,
  formatEApprovalDuration,
  type EApprovalAssignment,
  type EApprovalOutcome,
  type EApprovalPriority,
  type EApprovalStatus,
  type EApprovalStepRecord,
} from '@/lib/e-approval';

/** Status pill. Uses the palette the policy module owns, so every screen agrees on the colours. */
export function EApprovalStatusBadge({
  status,
  className,
}: {
  status: EApprovalStatus | string;
  className?: string;
}) {
  const style = eApprovalStatusStyles[status as EApprovalStatus] ?? 'bg-muted text-muted-foreground';
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap border font-medium', style, className)}>
      {status}
    </Badge>
  );
}

export function EApprovalOutcomeBadge({ outcome }: { outcome: EApprovalOutcome | null | undefined }) {
  if (!outcome) return null;
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap border font-medium', eApprovalOutcomeStyles[outcome])}>
      {outcome}
    </Badge>
  );
}

const priorityStyles: Record<EApprovalPriority, string> = {
  Low: 'bg-slate-100 text-slate-600 border-slate-200',
  Normal: 'bg-sky-50 text-sky-700 border-sky-200',
  High: 'bg-amber-100 text-amber-800 border-amber-200',
  Urgent: 'bg-rose-100 text-rose-800 border-rose-200',
};

export function EApprovalPriorityBadge({ priority }: { priority: EApprovalPriority | undefined }) {
  if (!priority || priority === 'Normal') return null;
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap border text-[10px]', priorityStyles[priority])}>
      {priority}
    </Badge>
  );
}

export function EApprovalConfidentialBadge({ confidential }: { confidential?: boolean }) {
  if (!confidential) return null;
  return (
    <Badge variant="outline" className="gap-1 border-stone-300 bg-stone-100 text-[10px] text-stone-700">
      <Lock className="h-3 w-3" /> Confidential
    </Badge>
  );
}

/**
 * "19h 25m left" / "4h overdue" / "Paused".
 *
 * Reads the paused state from the step rather than from the clock, so an approver waiting on a
 * verification they asked for is not shown as running out of time.
 */
export function EApprovalSlaBadge({
  step,
  now,
  className,
}: {
  step: EApprovalStepRecord;
  now?: string;
  className?: string;
}) {
  const sla = eApprovalSlaState(step, now ?? new Date());
  if (sla.dueAt == null) return null;
  if (sla.paused) {
    return (
      <Badge variant="outline" className={cn('gap-1 border-zinc-200 bg-zinc-100 text-[10px] text-zinc-600', className)}>
        <PauseCircle className="h-3 w-3" /> Clock paused
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 text-[10px]',
        sla.overdue
          ? 'border-rose-200 bg-rose-100 text-rose-800'
          : (sla.elapsedPct ?? 0) >= 80
            ? 'border-amber-200 bg-amber-100 text-amber-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700',
        className,
      )}
    >
      {sla.overdue ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      {sla.label}
    </Badge>
  );
}

/** Due-in text for a register row, where there is no step object to hand. */
export function EApprovalDueBadge({ dueAt, now }: { dueAt?: string | null; now?: Date }) {
  if (!dueAt) return <span className="text-xs text-muted-foreground">—</span>;
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return <span className="text-xs text-muted-foreground">—</span>;
  const remaining = due - (now ?? new Date()).getTime();
  return (
    <span
      className={cn(
        'whitespace-nowrap text-xs font-medium',
        remaining < 0 ? 'text-rose-600' : remaining < 8 * 3_600_000 ? 'text-amber-600' : 'text-muted-foreground',
      )}
    >
      {remaining < 0 ? `${formatEApprovalDuration(remaining)} overdue` : `${formatEApprovalDuration(remaining)} left`}
    </span>
  );
}

export function EApprovalAssigneeLabel({ assignment }: { assignment: EApprovalAssignment | undefined }) {
  return <span className="truncate">{describeEApprovalAssignment(assignment)}</span>;
}

/** An empty state that says what the screen would show, rather than just "No data". */
export function EApprovalEmptyState({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      {Icon && <Icon className="h-10 w-10 text-muted-foreground/40" />}
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {description && <p className="max-w-md text-xs text-muted-foreground/80">{description}</p>}
    </div>
  );
}

/** A labelled field for the overview grid — used a few dozen times on the detail screen. */
export function EApprovalField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 break-words text-sm">{children || '—'}</div>
    </div>
  );
}
