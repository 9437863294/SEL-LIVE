'use client';

/**
 * Own-vehicle trips saved on the phone without a connection (own-trip-outbox.ts), until the server
 * has them: what each is, whether it is waiting for the network, being sent, or was not accepted —
 * with the server's reason, Retry and Remove. Shown on My Trips and Fleet Trip; nothing when empty.
 */

import { useState } from 'react';
import { CloudOff, CloudUpload, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { shortPlace } from '@/lib/fleet/places';
import { formatINR } from '@/lib/employee-trips/rates';
import { formatKm } from '@/lib/employee-trips/types';
import { flushOwnTrips, removeOwnTrip, retryOwnTrip, useOwnTripOutbox, type OwnTripQueued } from './own-trip-outbox';
import { shortDate } from './trip-ui';

export function OwnTripOutboxPanel() {
  const { items, sending } = useOwnTripOutbox();
  const [removing, setRemoving] = useState<OwnTripQueued | null>(null);
  if (!items.length) return null;
  const waiting = items.filter((item) => !item.refused).length;

  return (
    <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-950">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudOff className="h-4 w-4" aria-hidden />}
          {items.length} own-vehicle trip{items.length === 1 ? '' : 's'} saved on this phone
        </p>
        {waiting > 0 && (
          <Button type="button" size="sm" variant="outline" className="h-8 rounded-full bg-white" onClick={() => void flushOwnTrips()} disabled={sending}>
            <CloudUpload className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Send now
          </Button>
        )}
      </div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.clientTripId} className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-white/70 bg-white/80 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm text-slate-800">
                {shortPlace(item.summary.fromPlace, 1) || item.summary.fromPlace || 'Start'} → {shortPlace(item.summary.toPlace, 1) || item.summary.toPlace || '—'}
              </p>
              <p className="text-xs text-muted-foreground">
                {shortDate(item.summary.tripDate)} · {item.summary.vehicleNumber} · {formatKm(item.summary.distanceKm)} · {formatINR(item.summary.amount)}
              </p>
              <p className={item.refused ? 'mt-0.5 text-xs text-rose-700' : 'mt-0.5 text-xs text-amber-800'}>
                {item.refused ? `Not accepted: ${item.refused}` : sending ? 'Sending…' : 'Waiting for the network — it sends by itself.'}
              </p>
            </div>
            {item.refused && (
              <div className="flex shrink-0 gap-1">
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => retryOwnTrip(item.clientTripId)} aria-label="Try sending again" title="Try sending again">
                  <RotateCcw className="h-4 w-4" aria-hidden />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-rose-700" onClick={() => setRemoving(item)} aria-label="Remove from this phone" title="Remove from this phone">
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this trip from the phone?"
        description="It was not accepted, and removing it means it is not claimed. Record the trip again if it should be."
        confirmLabel="Remove"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => {
          if (removing) removeOwnTrip(removing.clientTripId);
          setRemoving(null);
        }}
      />
    </div>
  );
}
