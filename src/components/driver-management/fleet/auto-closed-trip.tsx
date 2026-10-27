'use client';

/**
 * A company-vehicle trip the server closed by itself while it was still the driver's — no location
 * reached the server for hours (usually no signal: the phone kept recording), or it ran past the
 * longest a trip may run — and that the driver has not ended (`awaitsDriverEnd`).
 *
 * Without this, the trip simply vanished from Fleet Trip the moment the phone reconnected, the
 * phone stopped recording, and the driver had nothing left to end: the manager settled it from GPS
 * alone. Here the driver ends it as usual — the odometer reading and photo — and the server settles
 * it properly (fleet `endTrip`, late driver end). Until then the phone keeps recording it, and a new
 * trip cannot start. "Leave it to the manager" stops the recording and sends what it holds.
 */

import { useState } from 'react';
import { CloudOff, Loader2, Square, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { istTimeLabel } from '@/lib/fleet/dates';
import { formatKm, type FleetTrip } from '@/lib/fleet/types';
import { drainFleetToOutbox, finishFleetRecording } from '@/components/fleet/use-trip-tracker';
import { EndTripDialog, type EndOutcome } from './end-trip-dialog';

export function AutoClosedTrip({ trip, onEnded, onLeave }: { trip: FleetTrip; onEnded: (outcome: EndOutcome) => void; onLeave: () => void }) {
  const [endOpen, setEndOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const why = trip.endedBy === 'auto_max' ? 'it ran past the longest a trip may run' : 'no location reached the server for a long time — usually no signal';

  return (
    <>
      <Card className="w-full border-amber-200 bg-amber-50/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-amber-950">
            <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
            End your trip on {trip.vehicleNumber}
          </CardTitle>
          <CardDescription className="text-amber-900/90">
            The server closed this trip at {istTimeLabel(trip.endedAt)} because {why}. If you are still on it or have just finished, end it here with the odometer reading — the route this phone recorded is sent with it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-amber-900/80">
            {trip.purposeName} · started {istTimeLabel(trip.startedAt)} · {formatKm(trip.gpsDistanceKm)} received so far
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="destructive" className="rounded-full sm:w-auto" onClick={() => setEndOpen(true)} disabled={leaving}>
              <Square className="mr-1.5 h-4 w-4" aria-hidden />
              End this trip
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-full sm:w-auto"
              disabled={leaving}
              onClick={() => {
                setLeaving(true);
                void finishFleetRecording(trip.id).finally(() => {
                  setLeaving(false);
                  onLeave();
                });
              }}
            >
              {leaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <UserCheck className="mr-1.5 h-4 w-4" aria-hidden />}
              Leave it to the manager
            </Button>
          </div>
        </CardContent>
      </Card>

      {endOpen && (
        <EndTripDialog
          open
          onOpenChange={setEndOpen}
          trip={trip}
          figures={{ distanceKm: trip.gpsDistanceKm, movingMinutes: trip.movingMinutes, idleMinutes: trip.idleMinutes, fixes: trip.pointCount }}
          lastPoint={trip.lastPointLat !== null && trip.lastPointLng !== null ? { lat: trip.lastPointLat, lng: trip.lastPointLng } : null}
          // What the phone recorded (offline, and since), into the outbox ahead of the end.
          prepareEnd={() => drainFleetToOutbox(trip.id)}
          onEnded={(outcome) => {
            setEndOpen(false);
            void finishFleetRecording(trip.id).finally(() => onEnded(outcome));
          }}
        />
      )}
    </>
  );
}
