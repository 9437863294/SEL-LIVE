'use client';

import { AlertTriangle, Clock, Lock, PanelsTopLeft, PauseCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';
import {
  describeEApprovalAssignment,
  describeEApprovalSource,
  isMirroredEApproval,
  type EApprovalSourceLink,
  eApprovalSlaState,
  formatEApprovalDuration,
  type EApprovalAssignment,
  type EApprovalOutcome,
  type EApprovalPriority,
  type EApprovalStepRecord,
} from '@/lib/e-approval';

/** Priority tones for `StatusBadge` — the words themselves carry no status meaning. */
export const eApprovalPriorityTone: Record<EApprovalPriority, StatusTone> = {
  Low: 'neutral',
  Normal: 'info',
  High: 'warning',
  Urgent: 'danger',
};

/**
 * Step outcome tones for `StatusBadge`, where the module means more than the word alone reads as
 * ("Not Verified" is a refusal, "Escalated" a warning sign, "Clarified" an answer).
 */
export const eApprovalOutcomeTone: Record<EApprovalOutcome, StatusTone> = {
  Approved: 'success',
  Rejected: 'danger',
  Verified: 'success',
  'Verified With Observation': 'warning',
  'Not Verified': 'danger',
  Clarified: 'info',
  Returned: 'warning',
  Forwarded: 'info',
  Delegated: 'progress',
  Escalated: 'danger',
  Skipped: 'neutral',
  Cancelled: 'neutral',
  Superseded: 'neutral',
};

export function EApprovalConfidentialBadge({ confidential }: { confidential?: boolean }) {
  if (!confidential) return null;
  return (
    <Badge variant="neutral" className="gap-1">
      <Lock className="h-3 w-3" /> Confidential
    </Badge>
  );
}

/**
 * Marks a row that mirrors another module's workflow.
 *
 * Worth a badge in the register rather than only on the detail screen: these requests behave
 * slightly differently — some of their stages are completed elsewhere — and an approver scanning a
 * list of forty should be able to see which ones before opening them.
 */
export function EApprovalSourceBadge({ source }: { source?: EApprovalSourceLink | null }) {
  if (!source?.recordId) return null;
  const live = isMirroredEApproval(source);
  return (
    <Badge
      variant={live ? 'info' : 'outline'}
      className={cn('gap-1', !live && 'border-dashed')}
      title={live ? describeEApprovalSource(source) : `Unlinked from ${source.module}`}
    >
      <PanelsTopLeft className="h-3 w-3" /> {source.module}
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
      <StatusBadge tone="neutral" className={className}>
        <PauseCircle className="h-3 w-3" /> Clock paused
      </StatusBadge>
    );
  }
  return (
    <StatusBadge
      tone={sla.overdue ? 'danger' : (sla.elapsedPct ?? 0) >= 80 ? 'warning' : 'success'}
      className={className}
    >
      {sla.overdue ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      {sla.label}
    </StatusBadge>
  );
}

/** Due-in badge for a register row, where there is no step object to hand. */
export function EApprovalDueBadge({ dueAt, now }: { dueAt?: string | null; now?: Date }) {
  if (!dueAt) return <span className="text-muted-foreground">—</span>;
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return <span className="text-muted-foreground">—</span>;
  const remaining = due - (now ?? new Date()).getTime();
  return (
    <StatusBadge tone={remaining < 0 ? 'danger' : remaining < 8 * 3_600_000 ? 'warning' : 'neutral'}>
      {remaining < 0 ? `${formatEApprovalDuration(remaining)} overdue` : `${formatEApprovalDuration(remaining)} left`}
    </StatusBadge>
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

/**
 * Dialog classes for the module: a full-screen sheet on a phone, a scrollable centred modal above.
 *
 * Lives here rather than beside the settings screens because every dialog in the module needs it —
 * the action panel, delegations and the undo prompt as much as the settings forms.
 *
 * The flex utilities on `body` are load-bearing and **not** redundant with `hr-dialog-body`: those
 * rules sit inside `@media (max-width: 640px)` in `globals.css`, so above that breakpoint the body
 * claimed no flex space and had no overflow, and a tall form ran past the bottom of the modal with
 * nothing to scroll. `DialogContent` is already a `flex flex-col min-h-0` shell with a max height
 * precisely so an inner body can own the scroll; it needs a body that takes the offer at every width.
 */
export const eApprovalDialogClass = {
  content: 'hr-mobile-dialog sm:max-w-xl',
  /** Wide enough for the workflow stage editor's two-column layout. */
  contentWide: 'hr-mobile-dialog sm:max-w-5xl',
  header: 'hr-dialog-header shrink-0',
  body: 'hr-dialog-body min-h-0 flex-1 space-y-3 overflow-y-auto',
  footer: 'hr-dialog-footer shrink-0',
} as const;

/**
 * Props that stop a dialog throwing away typed work.
 *
 * Spread onto a `DialogContent`. Two different rules, because the two ways out are not equally
 * deliberate:
 *
 *   - **A click outside never closes the dialog**, whether anything has been typed or not. On the
 *     wide forms in this module — the workflow builder, the approval matrix rule — the backdrop is
 *     most of the screen, and a click that lands on it is essentially always a misclick: reaching for
 *     a scrollbar, dismissing a native autocomplete, or just missing the dialog. Nobody closes a form
 *     they are filling in by aiming at the grey. Cancel and the corner X are still right there, so
 *     nothing becomes unclosable.
 *   - **Escape closes only an untouched dialog.** It is the keyboard's dismissal and the behaviour
 *     assistive technology expects, so it keeps working for the ordinary "opened this by accident"
 *     case. Once there is something to lose it is held back too — a single keystroke should not
 *     discard a half-written rejection reason.
 *
 * Applied per dialog rather than by changing `components/ui/dialog.tsx`, which every other module in
 * the app shares: this is a decision about *this* module's forms, and quietly re-fitting the app-wide
 * primitive to suit one module is how an unrelated screen changes behaviour with nobody deciding it
 * should.
 */
export function eApprovalDialogGuard(dirty: boolean) {
  return {
    onInteractOutside: (event: Event) => event.preventDefault(),
    onEscapeKeyDown: (event: KeyboardEvent) => {
      if (dirty) event.preventDefault();
    },
  };
}
