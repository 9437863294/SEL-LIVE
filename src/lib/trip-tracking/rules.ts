/**
 * The rules of background trip tracking that need no device: turning a natively recorded fix into
 * the shapes the app already uses, what the status chip says, which permissions block a start, and
 * the "keep tracking alive" steps per phone maker (docs/BACKGROUND-TRACKING-PLAN.md).
 *
 * Pure: no imports but types, so the rules are tested under Node's type stripping
 * (tests/trip-tracking.test.mjs).
 */

import type { ClientPoint } from '../fleet/types.ts';
import type { TripLocationPoint } from '../vehicle-management.ts';

/** One fix as the native recorder buffered it (TripRecorder.getPoints). Times are epoch ms. */
export interface NativePoint {
  id: number;
  clientPointId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  /** Metres per second, as Android reports it. */
  speed: number | null;
  bearing: number | null;
  altitude: number | null;
  recordedAt: number;
}

/** A stretch the recorder was not running (the app or phone killed it), recorded on restart. */
export interface NativeGap {
  id: number;
  fromMs: number;
  toMs: number;
}

export interface NativeStatus {
  activeTripId: string | null;
  kind: 'fleet' | 'own' | null;
  startedAt: number | null;
  running: boolean;
  lastFixAt: number | null;
  lastAccuracy: number | null;
  accepted: number;
  pending: number;
  lastAliveAt: number | null;
  consecutiveErrors: number;
  lastError: { code: string; message: string; at: number } | null;
  gapsPending: number;
  /** False while Android reports no location available (GPS off, no sky). Absent on older builds. */
  locationAvailable?: boolean;
}

export interface NativePermissions {
  location: boolean;
  precise: boolean;
  background: boolean;
  notifications: boolean;
  locationServices: boolean;
  sdkInt: number;
}

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const kmph = (metresPerSecond: number | null): number | null => (metresPerSecond === null || metresPerSecond < 0 ? null : Math.round(metresPerSecond * 3.6 * 10) / 10);
const heading = (degrees: number | null): number | null => (degrees === null || degrees < 0 || degrees > 360 ? null : degrees);

/** For the outbox and `POST …/points`: the native id becomes the idempotency key. */
export function toClientPoint(point: NativePoint): ClientPoint {
  return {
    clientPointId: point.clientPointId,
    lat: point.lat,
    lng: point.lng,
    accuracyM: finite(point.accuracy),
    speedKmph: kmph(finite(point.speed)),
    headingDeg: heading(finite(point.bearing)),
    recordedAt: new Date(point.recordedAt).toISOString(),
  };
}

/** For the live route and the trip's measured summary. */
export function toRoutePoint(point: NativePoint): TripLocationPoint {
  return {
    lat: point.lat,
    lng: point.lng,
    accuracyMeters: finite(point.accuracy) ?? undefined,
    speedKmph: kmph(finite(point.speed)) ?? undefined,
    headingDeg: heading(finite(point.bearing)) ?? undefined,
    recordedAtIso: new Date(point.recordedAt).toISOString(),
  };
}

/* ── the status chip ─────────────────────────────────────────────────────────────────────────── */

export type ChipState = 'recording' | 'paused' | 'no_fix' | 'permission' | 'stopped' | 'degraded';

export interface ChipView {
  state: ChipState;
  label: string;
  tone: 'emerald' | 'amber' | 'rose' | 'slate';
  /** "12 s ago", or null before the first fix. */
  lastFix: string | null;
  accuracy: string | null;
  /** Fixes on the phone not yet sent: the native buffer plus the outbox. */
  pending: number;
}

/** With no fix at all this long after the start, the GPS is not getting through. */
export const FIRST_FIX_GRACE_MS = 2 * 60_000;
/** Errors in a row after which a trip's tracking is "degraded" rather than a blip. */
export const DEGRADED_AFTER_ERRORS = 2;

export function ageLabel(fromMs: number | null, now: number): string | null {
  if (fromMs === null) return null;
  const seconds = Math.max(0, Math.round((now - fromMs) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min ago`;
}

const CHIP: Record<ChipState, Pick<ChipView, 'label' | 'tone'>> = {
  recording: { label: 'Recording', tone: 'emerald' },
  paused: { label: 'Paused', tone: 'slate' },
  no_fix: { label: 'No GPS fix', tone: 'amber' },
  permission: { label: 'Permission needed', tone: 'rose' },
  stopped: { label: 'Tracking stopped', tone: 'rose' },
  degraded: { label: 'Tracking degraded', tone: 'amber' },
};

/**
 * What the chip says. `native` is the recorder's status when the app has one; without it (an old
 * APK, the browser) the chip is worked out from the in-app tracker's own figures.
 */
export function chipView(input: {
  paused: boolean;
  now: number;
  outboxPending: number;
  native?: NativeStatus | null;
  permissions?: NativePermissions | null;
  /** The in-app watcher's figures, used when there is no native status. */
  fallback?: { tracking: boolean; error: string | null; lastFixAt: number | null; accuracyM: number | null; startedAt: number | null };
}): ChipView {
  const { paused, now, outboxPending, native, permissions, fallback } = input;
  const view = (state: ChipState, lastFixAt: number | null, accuracyM: number | null, pending: number): ChipView => ({
    state,
    ...CHIP[state],
    lastFix: ageLabel(lastFixAt, now),
    accuracy: accuracyM === null ? null : `±${Math.round(accuracyM)} m`,
    pending,
  });

  if (native) {
    const pending = native.pending + outboxPending;
    if (paused) return view('paused', native.lastFixAt, native.lastAccuracy, pending);
    const permissionLost = permissions ? !permissions.location || !permissions.background : native.lastError?.code === 'NOT_AUTHORIZED';
    if (permissionLost) return view('permission', native.lastFixAt, native.lastAccuracy, pending);
    if (!native.running) return view('stopped', native.lastFixAt, native.lastAccuracy, pending);
    if (native.consecutiveErrors >= DEGRADED_AFTER_ERRORS) return view('degraded', native.lastFixAt, native.lastAccuracy, pending);
    // A parked vehicle sends no fixes (the 30 m distance filter), so silence alone is not "no fix":
    // only Android saying location is unavailable, or nothing at all since the start.
    const neverFixed = native.lastFixAt === null && native.startedAt !== null && now - native.startedAt > FIRST_FIX_GRACE_MS;
    if (native.locationAvailable === false || neverFixed) return view('no_fix', native.lastFixAt, native.lastAccuracy, pending);
    return view('recording', native.lastFixAt, native.lastAccuracy, pending);
  }

  const lastFixAt = fallback?.lastFixAt ?? null;
  const accuracyM = fallback?.accuracyM ?? null;
  if (paused) return view('paused', lastFixAt, accuracyM, outboxPending);
  if (fallback?.error) return view(/permission|allow/i.test(fallback.error) ? 'permission' : 'stopped', lastFixAt, accuracyM, outboxPending);
  if (!fallback?.tracking) return view('stopped', lastFixAt, accuracyM, outboxPending);
  const neverFixed = lastFixAt === null && fallback.startedAt !== null && now - fallback.startedAt > FIRST_FIX_GRACE_MS;
  return view(neverFixed ? 'no_fix' : 'recording', lastFixAt, accuracyM, outboxPending);
}

/* ── what must be granted before a trip starts ───────────────────────────────────────────────── */

export type PermissionKey = 'location' | 'precise' | 'background' | 'notifications' | 'locationServices' | 'battery';

export interface PermissionRow {
  key: PermissionKey;
  label: string;
  hint: string;
  granted: boolean;
  /** Blocks a trip start. Battery optimisation is recommended, not required. */
  required: boolean;
}

/** Android 13 (API 33) introduced the notification permission; below it the row is about the switch. */
export function permissionRows(status: NativePermissions, batteryIgnoring: boolean): PermissionRow[] {
  return [
    { key: 'location', label: 'Location', hint: 'To record where the trip goes.', granted: status.location, required: true },
    {
      key: 'precise',
      label: 'Precise location',
      hint: 'Approximate location is off by up to 3 km — too coarse to measure a trip.',
      granted: status.location && status.precise,
      required: true,
    },
    {
      key: 'background',
      label: 'Allow all the time',
      hint: status.sdkInt >= 30 ? 'In Settings choose Location → “Allow all the time”, then come back.' : 'So recording carries on with the screen locked.',
      granted: status.background,
      required: true,
    },
    {
      key: 'notifications',
      label: 'Notifications',
      hint: 'The “Trip running” notification is what keeps Android from stopping the recording.',
      granted: status.notifications,
      required: true,
    },
    { key: 'locationServices', label: 'Location services on', hint: 'The phone’s Location switch (GPS).', granted: status.locationServices, required: true },
    {
      key: 'battery',
      label: 'Battery optimisation off',
      hint: 'Recommended: stops the phone putting the app to sleep on long trips.',
      granted: batteryIgnoring,
      required: false,
    },
  ];
}

export const missingRequired = (rows: PermissionRow[]): PermissionKey[] => rows.filter((row) => row.required && !row.granted).map((row) => row.key);

/* ── phone makers that kill background apps ──────────────────────────────────────────────────── */

export interface OemGuide {
  brand: string;
  steps: string[];
}

const GUIDES: Array<{ match: RegExp; guide: OemGuide }> = [
  {
    match: /^(xiaomi|redmi|poco)/,
    guide: { brand: 'Xiaomi / Redmi / Poco', steps: ['Autostart: turn it ON for SEL Driver.', 'Battery saver → No restrictions.', 'Open Recents and lock the app (padlock), so clearing Recents does not close it.'] },
  },
  {
    match: /^(oppo|realme|oneplus)/,
    guide: { brand: 'Oppo / Realme / OnePlus', steps: ['Allow auto launch for SEL Driver.', 'Battery usage → Allow background activity.', 'Open Recents and lock the app.'] },
  },
  {
    match: /^(vivo|iqoo)/,
    guide: { brand: 'Vivo / iQOO', steps: ['Autostart: turn it ON for SEL Driver.', 'Background power consumption → Allow high.', 'Open Recents and lock the app.'] },
  },
  {
    match: /^(huawei|honor)/,
    guide: { brand: 'Huawei / Honor', steps: ['App launch → SEL Driver → Manage manually: Auto-launch, Secondary launch and Run in background ON.', 'Battery → turn off power-intensive app monitoring for SEL Driver.', 'Open Recents and lock the app.'] },
  },
  {
    match: /^samsung/,
    guide: { brand: 'Samsung', steps: ['Battery → Unrestricted for SEL Driver.', 'Battery → Background usage limits: remove SEL Driver from “Sleeping apps” and “Deep sleeping apps”.'] },
  },
];

/** The steps for this phone's maker (Device.getInfo().manufacturer), or null for stock Android. */
export function oemGuideFor(manufacturer: string | null | undefined): OemGuide | null {
  const name = String(manufacturer ?? '').trim().toLowerCase();
  if (!name) return null;
  return GUIDES.find((entry) => entry.match.test(name))?.guide ?? null;
}

/** A gap this long during a trip means the phone stopped the recorder: show the guide again. */
export const GUIDE_AGAIN_AFTER_GAP_MS = 10 * 60_000;

export const gapsNeedGuide = (gaps: Array<Pick<NativeGap, 'fromMs' | 'toMs'>>): boolean => gaps.some((gap) => gap.toMs - gap.fromMs > GUIDE_AGAIN_AFTER_GAP_MS);

/** A gap as the points request carries it (`gaps` on `POST …/points`). */
export const toGapRecord = (gap: Pick<NativeGap, 'fromMs' | 'toMs'>) => ({ fromAt: new Date(gap.fromMs).toISOString(), toAt: new Date(gap.toMs).toISOString() });
