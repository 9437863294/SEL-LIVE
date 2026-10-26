'use client';

/**
 * What a trip needs from the phone before it can start (docs/BACKGROUND-TRACKING-PLAN.md):
 *
 * 1. **Prominent disclosure first** — Google Play requires the app to say, in its own words and
 *    before the system prompt, that location is collected while the app is closed and what for.
 *    The location request is only made from this screen's Continue button.
 * 2. Precise location (Android 12+ lets the driver pick "Approximate", which cannot measure a trip).
 * 3. "Allow all the time" — on Android 11+ only from the system's settings page; the gate re-checks
 *    when the driver comes back.
 * 4. Notifications (Android 13+) — the "Trip running" notification is what keeps the recorder alive.
 * 5. The phone's Location switch, and (recommended, not required) battery optimisation off.
 *
 * Each row shows Granted or Needs action with its own Fix button. Start stays disabled until every
 * required row is granted.
 */

import { useCallback, useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { CheckCircle2, Loader2, MapPin, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogClose } from '@/components/ui/dialog';
import { FormDialog } from '@/components/shared/form-dialog';
import { openAndroidLocationSettings } from '@/lib/native-android-settings';
import { BatteryOptimization, TripRecorder } from '@/lib/trip-tracking/native';
import type { PermissionKey, PermissionRow } from '@/lib/trip-tracking/rules';
import { checkTrackingPermissions, type TrackingReadiness } from '@/lib/trip-tracking/tracking';
import { cn } from '@/lib/utils';

/** Google Play's prominent disclosure for background location, word for word. */
export const LOCATION_DISCLOSURE =
  'SEL Fleet collects location data to record your trip route even when the app is closed or not in use. This is used for trip kilometres, geofence events and vehicle payment reports.';

async function fix(key: PermissionKey): Promise<void> {
  if (key === 'location' || key === 'precise') await TripRecorder.requestLocationPermission();
  else if (key === 'background') await TripRecorder.requestBackgroundLocationPermission();
  else if (key === 'notifications') await TripRecorder.requestNotificationPermission();
  else if (key === 'locationServices') await openAndroidLocationSettings();
  else if (key === 'battery') await BatteryOptimization.requestIgnore();
}

export function PermissionsGate({ open, onDone }: { open: boolean; /** true: everything required is granted and the driver chose to go on. */ onDone: (ready: boolean) => void }) {
  const [readiness, setReadiness] = useState<TrackingReadiness | null>(null);
  const [busy, setBusy] = useState<PermissionKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setReadiness(await checkTrackingPermissions());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read the phone’s permissions.');
    }
  }, []);

  // Read on opening (state set only when the answer arrives), and again whenever the driver comes
  // back from a settings page.
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    checkTrackingPermissions()
      .then((next) => alive && setReadiness(next))
      .catch((caught: Error) => alive && setError(caught.message || 'Could not read the phone’s permissions.'));
    const appState = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void refresh();
    });
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      void appState.then((handle) => handle.remove()).catch(() => undefined);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [open, refresh]);

  const run = async (key: PermissionKey) => {
    setBusy(key);
    setError(null);
    try {
      await fix(key);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That setting could not be opened.');
    } finally {
      await refresh();
      setBusy(null);
    }
  };

  const rows = readiness?.rows ?? [];
  const needsDisclosure = readiness ? !readiness.permissions.location : false;
  const ready = Boolean(readiness) && readiness!.missing.length === 0;

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onDone(false)}
      size="md"
      sheet
      title="Before the trip starts"
      description="The trip records by GPS with the screen locked. The phone needs to allow it."
      footer={
        <>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Not now
            </Button>
          </DialogClose>
          <Button type="button" disabled={!ready} onClick={() => onDone(true)}>
            {ready ? 'Start trip' : 'Fix the items above'}
          </Button>
        </>
      }
    >
      {!readiness ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Checking the phone…
        </p>
      ) : needsDisclosure ? (
        // The prominent disclosure: shown, and acknowledged, before the system location prompt.
        <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-sky-950">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden />
            Location for trip tracking
          </p>
          <p className="text-sm leading-relaxed text-sky-950">{LOCATION_DISCLOSURE}</p>
          <Button type="button" className="w-full" onClick={() => void run('location')} disabled={busy !== null}>
            {busy === 'location' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Continue
          </Button>
        </div>
      ) : null}

      {readiness && (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {rows.map((row) => (
            <GateRow key={row.key} row={row} busy={busy === row.key} disabled={busy !== null || (needsDisclosure && row.key !== 'locationServices')} onFix={() => void run(row.key)} />
          ))}
        </ul>
      )}

      {readiness && !readiness.permissions.background && readiness.permissions.location && readiness.permissions.sdkInt >= 30 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Android opens the app’s settings for this one: tap <span className="font-semibold">Location</span>, choose <span className="font-semibold">Allow all the time</span>, then come back — this screen updates by itself.
        </p>
      )}
      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
    </FormDialog>
  );
}

function GateRow({ row, busy, disabled, onFix }: { row: PermissionRow; busy: boolean; disabled: boolean; onFix: () => void }) {
  return (
    <li className="flex min-w-0 items-start gap-3 p-3">
      {row.granted ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <Wrench className={cn('mt-0.5 h-4 w-4 shrink-0', row.required ? 'text-rose-600' : 'text-amber-600')} aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800">
          {row.label}
          {!row.required && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">recommended</span>}
        </p>
        <p className="text-[11px] text-muted-foreground">{row.granted ? 'Granted' : row.hint}</p>
      </div>
      {row.granted ? (
        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Granted</span>
      ) : (
        <Button type="button" size="sm" variant={row.required ? 'default' : 'outline'} className="shrink-0" onClick={onFix} disabled={disabled}>
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          Fix
        </Button>
      )}
    </li>
  );
}
