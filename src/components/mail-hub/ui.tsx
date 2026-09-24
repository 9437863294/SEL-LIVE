'use client';

/** Small presentational pieces shared by Mail Hub screens. */

import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Loader2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MailRecoveryAdvice } from '@/lib/mail-hub/model';
import type { AccountRow, ThreadSummary } from '@/lib/mail-hub/client';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-col gap-2 sm:mb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-white/60 px-6 py-12 text-center">
      {icon && <div className="text-slate-400">{icon}</div>}
      <p className="font-medium text-slate-700">{title}</p>
      {body && <p className="max-w-md text-sm text-muted-foreground">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-rose-800" onClick={onRetry}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {label ?? 'Loading…'}
    </div>
  );
}

const STATUS_STYLE: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  active: { label: 'Synced', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  connecting: { label: 'First sync', className: 'bg-sky-50 text-sky-700 border-sky-200', icon: CircleDashed },
  reauth_required: { label: 'Reconnect needed', className: 'bg-rose-50 text-rose-700 border-rose-200', icon: ShieldAlert },
  error: { label: 'Provider problem', className: 'bg-amber-50 text-amber-800 border-amber-200', icon: AlertTriangle },
  disconnected: { label: 'Disconnected', className: 'bg-slate-100 text-slate-600 border-slate-200', icon: XCircle },
};

export function AccountStatusBadge({ account }: { account: Pick<AccountRow, 'status' | 'sync'> }) {
  const style = STATUS_STYLE[account.status] ?? STATUS_STYLE.active;
  const Icon = style.icon;
  const recovering = account.status === 'active' && account.sync.phase === 'recovery';
  return (
    <Badge variant="outline" className={cn('gap-1 whitespace-nowrap font-medium', recovering ? STATUS_STYLE.connecting.className : style.className)}>
      <Icon className={cn('h-3 w-3', account.status === 'connecting' && 'animate-spin')} />
      {recovering ? 'Resyncing' : style.label}
    </Badge>
  );
}

export function statusDot(status: string) {
  return status === 'active' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-sky-500' : status === 'reauth_required' ? 'bg-rose-500' : status === 'error' ? 'bg-amber-500' : 'bg-slate-300';
}

export function RecoveryPanel({ advice, actions }: { advice: MailRecoveryAdvice; actions?: ReactNode }) {
  const tone = advice.severity === 'error' ? 'border-rose-200 bg-rose-50 text-rose-900' : advice.severity === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-sky-200 bg-sky-50 text-sky-900';
  return (
    <div className={cn('rounded-lg border px-3 py-2 text-sm', tone)}>
      <p className="font-medium">{advice.title}</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        {advice.steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function DeadlineBadge({ thread }: { thread: Pick<ThreadSummary, 'deadline' | 'assignment'> }) {
  if (thread.deadline === 'none' || thread.deadline === 'answered') return null;
  const due = thread.assignment?.dueAt ? new Date(thread.assignment.dueAt) : null;
  const className =
    thread.deadline === 'overdue' ? 'border-rose-200 bg-rose-50 text-rose-700' : thread.deadline === 'due-soon' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <Badge variant="outline" className={cn('gap-1 whitespace-nowrap text-[11px]', className)}>
      <Clock className="h-3 w-3" />
      {thread.deadline === 'overdue' ? 'Overdue' : 'Due'} {due ? formatShort(due.toISOString()) : ''}
    </Badge>
  );
}

export function formatShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function formatLong(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** `datetime-local` value for an ISO instant, in the browser's zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const INTERNAL_NOTE_CLASS = 'border-amber-300 bg-amber-50';
