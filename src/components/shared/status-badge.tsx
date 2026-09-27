/**
 * The app's one status badge. Pass the status as the module stores it — "PAYMENT_PENDING",
 * "Due Soon", "rejected" — and it picks the tone (`src/lib/status-tone.ts`) and a readable label.
 * A module that means something particular by a word passes `tone`; nothing passes colours.
 */

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { statusLabel, statusTone, type StatusTone } from '@/lib/status-tone';
import { cn } from '@/lib/utils';

export type { StatusTone } from '@/lib/status-tone';

const DOT: Record<StatusTone, string> = {
  neutral: 'bg-slate-400',
  info: 'bg-sky-500',
  progress: 'bg-violet-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
};

export interface StatusBadgeProps {
  /** The stored status; drives the tone unless `tone` is given, and the label unless `children` is. */
  status?: string | null;
  /** Overrides the tone the status word would read as. */
  tone?: StatusTone;
  /** A leading dot — for live states (online, in progress) or where colour alone would be missed. */
  dot?: boolean;
  /** Overrides the label; defaults to the status in words. */
  children?: ReactNode;
  /** Placement only (e.g. `shrink-0`). */
  className?: string;
  title?: string;
}

export function StatusBadge({ status, tone, dot = false, children, className, title }: StatusBadgeProps) {
  const resolved = tone ?? statusTone(status);
  const label = children ?? statusLabel(status ?? '');
  return (
    <Badge variant={resolved} className={cn('gap-1.5 whitespace-nowrap font-medium', className)} title={title}>
      {dot && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[resolved])} aria-hidden="true" />}
      {label}
    </Badge>
  );
}
