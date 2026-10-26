'use client';

import { AlertTriangle, CircleDot, CloudUpload, Pause, ShieldAlert, SignalLow } from 'lucide-react';
import { chipView, type ChipState, type ChipView } from '@/lib/trip-tracking/rules';
import { cn } from '@/lib/utils';
import { useNativeTrackingStatus, useNow } from './use-tracking-status';

/**
 * The chip for a running trip, reading the native recorder itself (`tripId` is its key; null without
 * one) and ticking its own clock — so a recorder's provider does not re-render the page every few
 * seconds for a label.
 */
export function TripTrackingChip({
  tripId,
  paused = false,
  outboxPending = 0,
  fallback,
  onFix,
}: {
  tripId: string | null;
  paused?: boolean;
  outboxPending?: number;
  fallback: { tracking: boolean; error: string | null; lastFixAt: number | null; accuracyM: number | null; startedAt: number | null };
  onFix?: () => void;
}) {
  const { status, permissions } = useNativeTrackingStatus(tripId);
  const now = useNow();
  return <TrackingStatusChip view={chipView({ paused, now, outboxPending, native: status, permissions, fallback })} onFix={onFix} />;
}

/** "Syncing N points…" while the native recorder still holds fixes for the trip, else `idle`. */
export function SyncingLabel({ tripId, active, idle }: { tripId: string | null; /** A sync is under way (the button was pressed). */ active: boolean; idle: string }) {
  const { status } = useNativeTrackingStatus(active ? tripId : null);
  if (!active) return <>{idle}</>;
  const pending = status?.pending ?? 0;
  return <>{pending > 0 ? `Syncing ${pending} point${pending === 1 ? '' : 's'}…` : 'Saving the route…'}</>;
}

const TONE: Record<ChipView['tone'], string> = {
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  rose: 'border-rose-200 bg-rose-50 text-rose-800',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
};

const ICON: Record<ChipState, typeof CircleDot> = {
  recording: CircleDot,
  paused: Pause,
  no_fix: SignalLow,
  permission: ShieldAlert,
  stopped: AlertTriangle,
  degraded: AlertTriangle,
};

/**
 * Where a running trip's tracking stands: Recording / Paused / No GPS fix / Permission needed /
 * Tracking stopped (or degraded), with the last fix's age, its accuracy and the fixes still on the
 * phone. `chipView` (src/lib/trip-tracking/rules.ts) decides; this only draws it. A span, so it is
 * safe inside a paragraph or a badge row.
 */
export function TrackingStatusChip({ view, onFix }: { view: ChipView; /** Shown for "Permission needed": opens the permissions gate. */ onFix?: () => void }) {
  const Icon = ICON[view.state];
  const details = [view.lastFix ? `last fix ${view.lastFix}` : view.state === 'recording' ? 'waiting for the first fix' : null, view.accuracy].filter(Boolean).join(' · ');
  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-medium', TONE[view.tone])}>
        <Icon className={cn('h-3 w-3', view.state === 'recording' && 'animate-pulse')} aria-hidden />
        {view.label}
      </span>
      {details && <span className="min-w-0 text-muted-foreground">{details}</span>}
      {view.pending > 0 && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <CloudUpload className="h-3 w-3" aria-hidden />
          {view.pending} to send
        </span>
      )}
      {view.state === 'permission' && onFix && (
        <button type="button" onClick={onFix} className="font-medium text-primary underline underline-offset-2">
          Fix
        </button>
      )}
    </span>
  );
}
