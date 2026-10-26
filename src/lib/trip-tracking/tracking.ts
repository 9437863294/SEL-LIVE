/**
 * Background trip tracking for the app's two recorders — a fleet trip (company vehicle) and an
 * own-vehicle trip — on top of the native recorder (./native.ts; docs/BACKGROUND-TRACKING-PLAN.md).
 *
 * The native service records; this module starts and stops it and *drains* what it buffered:
 * points come out oldest first, are handed to the caller (the fleet outbox, or the own trip's route),
 * and are marked synced only after the caller resolves — so a fix is always in exactly one durable
 * place, the phone's SQLite or the caller's store. Points recorded while the WebView was dead wait in
 * SQLite and come out on the next drain.
 *
 * Callable only where `nativeTrackingAvailable()`; the recorders keep their in-app watcher otherwise.
 */

import { BatteryOptimization, TripRecorder, batteryPluginAvailable } from './native';
import { missingRequired, permissionRows, type NativeGap, type NativePermissions, type NativePoint, type NativeStatus, type PermissionKey, type PermissionRow } from './rules';

export { nativeTrackingAvailable } from './native';

/** A start refused because something the recorder needs is not granted; the UI opens the gate. */
export class TrackingPermissionError extends Error {
  readonly missing: PermissionKey[];

  constructor(missing: PermissionKey[]) {
    super('Location, “Allow all the time” and notifications are needed to record a trip.');
    this.name = 'TrackingPermissionError';
    this.missing = missing;
  }
}

export interface TrackingReadiness {
  permissions: NativePermissions;
  batteryIgnoring: boolean;
  rows: PermissionRow[];
  missing: PermissionKey[];
}

export async function checkTrackingPermissions(): Promise<TrackingReadiness> {
  const [permissions, battery] = await Promise.all([
    TripRecorder.getPermissionStatus(),
    batteryPluginAvailable() ? BatteryOptimization.isIgnoring().catch(() => ({ ignoring: false })) : Promise.resolve({ ignoring: false }),
  ]);
  const rows = permissionRows(permissions, battery.ignoring);
  return { permissions, batteryIgnoring: battery.ignoring, rows, missing: missingRequired(rows) };
}

export interface StartOptions {
  kind: 'fleet' | 'own';
  title: string;
  message: string;
}

/** Same trip again is harmless (the recorder makes sure it is running). */
export async function startTracking(tripId: string, options: StartOptions): Promise<void> {
  const readiness = await checkTrackingPermissions();
  if (readiness.missing.length) throw new TrackingPermissionError(readiness.missing);
  try {
    await TripRecorder.start({ tripId, kind: options.kind, title: options.title, message: options.message, intervalMs: 5_000, distanceFilterM: 30, maxAccuracyM: 50 });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'NOT_AUTHORIZED') throw new TrackingPermissionError(['location']);
    throw error;
  }
}

/** Stops recording; what is buffered stays for the next drain. */
export async function stopTracking(tripId: string): Promise<{ pending: number }> {
  const result = await TripRecorder.stop({ tripId });
  return { pending: result.pending };
}

/**
 * On app launch and whenever the app comes back to the foreground: a trip the recorder still
 * holds but is not running (the service was killed and not restarted) is started again. A gap
 * for the time it was down is recorded natively.
 */
export async function resumeIfActive(): Promise<NativeStatus | null> {
  const status = await TripRecorder.getStatus();
  if (status.activeTripId && !status.running) {
    await TripRecorder.resume().catch(() => undefined);
    return TripRecorder.getStatus();
  }
  return status;
}

export const getStatus = (tripId?: string): Promise<NativeStatus> => TripRecorder.getStatus(tripId ? { tripId } : undefined);

/* ── draining ────────────────────────────────────────────────────────────────────────────────── */

const BATCH = 200;
const draining = new Map<string, Promise<number>>();

/**
 * Hands every buffered point of `tripId` (and any gap records) to `consume`, oldest first, in
 * batches of up to 200, marking each batch synced once `consume` resolves. One drain per trip at a
 * time: a second call waits for the running one, then drains whatever arrived meanwhile.
 *
 * `consume` must store the points durably before it resolves; if it throws, the batch stays
 * buffered and the drain stops (the next one retries it).
 */
export function drainTrip(tripId: string, consume: (points: NativePoint[], gaps: NativeGap[]) => Promise<void>): Promise<number> {
  const previous = draining.get(tripId) ?? Promise.resolve(0);
  const next = previous
    .catch(() => 0)
    .then(async () => {
      let total = 0;
      let { gaps } = await TripRecorder.getGaps({ tripId });
      for (;;) {
        const { points } = await TripRecorder.getPoints({ tripId, limit: BATCH });
        if (!points.length && !gaps.length) break;
        await consume(points, gaps);
        if (points.length) await TripRecorder.markSynced({ tripId, upToId: points[points.length - 1].id });
        if (gaps.length) await TripRecorder.markGapsSynced({ tripId, upToId: gaps[gaps.length - 1].id });
        gaps = [];
        total += points.length;
        if (points.length < BATCH) break;
      }
      return total;
    });
  draining.set(tripId, next);
  void next.finally(() => {
    if (draining.get(tripId) === next) draining.delete(tripId);
  });
  return next;
}

/** Drops whatever is buffered for a trip that will not be kept (an own trip discarded at review). */
export async function discardBuffered(tripId: string): Promise<void> {
  await drainTrip(tripId, async () => undefined);
}

/* ── events ──────────────────────────────────────────────────────────────────────────────────── */

export type TrackingEvent =
  | { type: 'fix'; tripId: string }
  | { type: 'trackingError'; tripId: string; code: string; message: string; consecutive: number }
  | { type: 'status'; status: NativeStatus };

/** Subscribes to the recorder's events; returns the unsubscribe. */
export function onTrackingEvent(listener: (event: TrackingEvent) => void): () => void {
  let removed = false;
  const handles: Array<Promise<{ remove: () => Promise<void> }>> = [
    TripRecorder.addListener('fix', (event) => listener({ type: 'fix', tripId: event.tripId })),
    TripRecorder.addListener('trackingError', (event) => listener({ type: 'trackingError', ...event })),
    TripRecorder.addListener('status', (status) => listener({ type: 'status', status })),
  ];
  return () => {
    if (removed) return;
    removed = true;
    for (const handle of handles) void handle.then((entry) => entry.remove()).catch(() => undefined);
  };
}

/** The message a recorder shows for a failed start or a recorder error. */
export function trackingErrorMessage(error: unknown): string {
  if (error instanceof TrackingPermissionError) return error.message;
  const code = (error as { code?: string })?.code;
  if (code === 'ANOTHER_TRIP_ACTIVE') return 'Another trip is still recording on this phone. End it first.';
  if (code === 'NOT_AUTHORIZED') return 'Location permission was taken away — tap Fix to allow it again.';
  return error instanceof Error && error.message ? error.message : 'Trip tracking could not start.';
}
