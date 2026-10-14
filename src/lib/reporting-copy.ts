/**
 * The reporting copy: a one-way copy of the (default) Firestore database into `newdatabase`
 * (Firestore with MongoDB compatibility), so the company's data can be queried with MongoDB tools.
 * The app never reads or writes `newdatabase`; the copy job is its only writer.
 *
 * This file is the dependency-free half, shared by three callers that cannot share anything else:
 * the scheduled job (`reporting-copy-server.ts`), the settings screen, and the standalone
 * `tools/mongo-sync/sync.mjs`, which imports it with a `.ts` path under Node's type stripping. It
 * holds what is copied (the exclusion lists), how a Firestore value becomes a BSON-friendly one, and
 * the schedule math — when a refresh is due — so all of it is unit-testable
 * (tests/reporting-copy.test.mjs).
 */
import { parseRunTime } from './recurring-payments-schedule.ts';

/**
 * What the copy leaves out. Empty: by decision on 2026-10-14, newdatabase is a full copy, including
 * personal data (employeeSensitive), Mail Hub and credentials. Firebase security rules do not apply
 * to it; only its database users and IAM do. Every login to it can read everything copied, so give
 * reporting users read-only logins and keep the list of logins short. Add collection names here to
 * stop copying them; that does not remove what is already in newdatabase — drop those by hand.
 */
export const EXCLUDED_COLLECTIONS: string[] = [];

/** Fields removed from every copied document, wherever they appear. Empty: copied as they are. */
export const EXCLUDED_FIELDS: string[] = [];

/** How many documents of each collection are sampled to discover its subcollections. */
export const SUBCOLLECTION_SAMPLE = 500;

/** The MongoDB-compatible database the copy goes to. */
export const TARGET_DATABASE = 'newdatabase';

/** Documents read from Firestore per query, and written to MongoDB per bulkWrite. */
export const READ_PAGE = 1000;
export const WRITE_BATCH = 500;

/** Server-only Firestore collection holding `config` (what the owner sets) and `state` (what the job did). */
export const REPORTING_COPY_COLLECTION = 'reportingCopy';
export const REPORTING_COPY_RESOURCE = 'Settings.Reporting Database';

/* ------------------------------------------------------------------------------------------------
 * Value conversion
 * ---------------------------------------------------------------------------------------------- */

// Only the prototype is needed (DocumentReference's constructor is private, so no construct signature).
type FirestoreClass<T> = { prototype: T };

/** `value instanceof cls`, as a type guard TypeScript can narrow with. */
const isInstance = <T>(value: unknown, cls: FirestoreClass<T>): value is T =>
  typeof value === 'object' && value !== null && Object.prototype.isPrototypeOf.call(cls.prototype, value);

/**
 * The Firestore SDK classes the conversion recognises. Passed in rather than imported, so this file
 * loads without firebase-admin — the tool resolves it from the repo, the app from its bundle, and
 * the tests hand in stand-ins.
 */
export interface FirestoreValueClasses {
  Timestamp: FirestoreClass<{ toDate(): Date }>;
  GeoPoint: FirestoreClass<{ latitude: number; longitude: number }>;
  DocumentReference: FirestoreClass<{ path: string }>;
}

/**
 * Firestore value → plain BSON-friendly value: Timestamps become Dates, GeoPoints
 * `{ latitude, longitude }`, document references their path, bytes stay bytes. Fields named in
 * `excludedFields` are dropped at every depth.
 */
export function makeValueConverter(classes: FirestoreValueClasses, excludedFields: readonly string[] = EXCLUDED_FIELDS) {
  const excluded = new Set(excludedFields);
  const convert = (value: unknown): unknown => {
    if (value === null || value === undefined) return null;
    if (isInstance(value, classes.Timestamp)) return value.toDate();
    if (isInstance(value, classes.GeoPoint)) return { latitude: value.latitude, longitude: value.longitude };
    if (isInstance(value, classes.DocumentReference)) return value.path;
    // Buffer is a Uint8Array; the driver stores either as BSON binary.
    if (value instanceof Uint8Array) return value;
    if (value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(convert);
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value)) if (!excluded.has(key)) out[key] = convert(inner);
      return out;
    }
    return value;
  };
  return convert;
}

/** The MongoDB collection a subcollection is copied to: `<parent>.<sub>`. */
export const subcollectionTarget = (root: string, sub: string) => `${root}.${sub}`;

/**
 * Whether a collection-group document sits directly under `root` (`root/{doc}/{sub}/{id}`). A
 * collection group spans every parent of that name, so the copy of `root.sub` keeps only these.
 */
export function isDirectChildOf(path: string, root: string): boolean {
  const segments = path.split('/');
  return segments.length === 4 && segments[0] === root;
}

/* ------------------------------------------------------------------------------------------------
 * Settings and state
 * ---------------------------------------------------------------------------------------------- */

export type ReportingCopyFrequency = 'daily' | 'everyHours' | 'weekly';

/** Every N hours, for N that divides a day — so the times are the same every day. */
export const EVERY_HOURS_OPTIONS = [1, 2, 3, 4, 6, 8, 12] as const;
export const DEFAULT_REPORTING_COPY_TIMEZONE = 'Asia/Kolkata';
export const DEFAULT_REPORTING_COPY_TIME = '02:00';
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `reportingCopy/config`: what the owner sets on Settings › Reporting Database. */
export interface ReportingCopyConfig {
  enabled: boolean;
  frequency: ReportingCopyFrequency;
  /** For `everyHours`: one of EVERY_HOURS_OPTIONS. */
  everyHours: number;
  /** For `weekly`: 0 = Sunday … 6 = Saturday. */
  weekDays: number[];
  /** `HH:mm`, in `timezone`. For `everyHours`, the first refresh of the day; the rest follow every N hours. */
  timeOfDay: string;
  timezone: string;
  /**
   * When the schedule was last saved (ISO). A time slot before it never counts as missed, so
   * switching the schedule on at 10:00 for a 02:00 refresh waits for tomorrow's 02:00 instead of
   * starting a full copy on the spot.
   */
  scheduleFrom: string | null;
  /** "Refresh now" (ISO): the next tick starts a run if none has started since. */
  requestedAt: string | null;
  requestedBy: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_REPORTING_COPY_CONFIG: ReportingCopyConfig = {
  enabled: false,
  frequency: 'daily',
  everyHours: 6,
  weekDays: [0],
  timeOfDay: DEFAULT_REPORTING_COPY_TIME,
  timezone: DEFAULT_REPORTING_COPY_TIMEZONE,
  scheduleFrom: null,
  requestedAt: null,
  requestedBy: null,
  updatedAt: null,
  updatedBy: null,
};

export type ReportingCopyRunStatus = 'running' | 'succeeded' | 'failed';

/** The run in progress or the last one finished — counts grow as the run goes. */
export interface ReportingCopyRun {
  runId: number;
  trigger: 'schedule' | 'manual';
  status: ReportingCopyRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationSeconds: number | null;
  documents: number;
  /** MongoDB collections fully written (root collections and `<parent>.<sub>` ones). */
  collections: number;
  removed: number;
  error: string | null;
}

/**
 * Where a run that spans several ticks has got to. Each tick works through the root collections in
 * order — the root's documents, then the discovery of its subcollections, then each subcollection —
 * saving the cursor after every page so the next tick starts where this one stopped.
 */
export interface ReportingCopyProgress {
  runId: number;
  /** Root collection names, listed once at the start; null until listed. */
  roots: string[] | null;
  index: number;
  step: 'root' | 'discover' | 'sub';
  subcollections: string[];
  subIndex: number;
  /** Last document written in the current target: an id for a root, a full path for a subcollection. */
  cursor: string | null;
  /** The MongoDB collection being written, for the screen. */
  target: string | null;
  /** Failed attempts at the current target; at the limit the target is skipped and reported. */
  attempts: number;
  lastError: string | null;
  /** Targets given up on, with the reason — the run then ends as failed. */
  failures: string[];
  ticks: number;
}

/** `reportingCopy/state`: written only by the job. */
export interface ReportingCopyState {
  lastRun: ReportingCopyRun | null;
  progress: ReportingCopyProgress | null;
  /** One run at a time: the tick holding it, until `expiresAt`. */
  lease: { holder: string; expiresAt: string } | null;
  /** The newest scheduled slot a run has been started for (ISO). */
  lastScheduledSlot: string | null;
  /** The `requestedAt` the last manual run answered. */
  handledRequestAt: string | null;
  nextDueAt: string | null;
  updatedAt: string | null;
}

export const EMPTY_REPORTING_COPY_STATE: ReportingCopyState = {
  lastRun: null,
  progress: null,
  lease: null,
  lastScheduledSlot: null,
  handledRequestAt: null,
  nextDueAt: null,
  updatedAt: null,
};

const isoOrNull = (value: unknown): string | null => {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  // A Firestore Timestamp, should someone write one by hand.
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  return null;
};

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** A stored config document, with defaults for anything missing or malformed. */
export function normalizeReportingCopyConfig(raw: Record<string, unknown> | undefined | null): ReportingCopyConfig {
  const data = raw ?? {};
  const frequency = (['daily', 'everyHours', 'weekly'] as const).includes(data.frequency as ReportingCopyFrequency)
    ? (data.frequency as ReportingCopyFrequency)
    : DEFAULT_REPORTING_COPY_CONFIG.frequency;
  const everyHours = Number(data.everyHours);
  const weekDays = Array.isArray(data.weekDays)
    ? [...new Set(data.weekDays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : DEFAULT_REPORTING_COPY_CONFIG.weekDays;
  const timezone = typeof data.timezone === 'string' && isValidTimeZone(data.timezone) ? data.timezone : DEFAULT_REPORTING_COPY_TIMEZONE;
  return {
    enabled: data.enabled === true,
    frequency,
    everyHours: (EVERY_HOURS_OPTIONS as readonly number[]).includes(everyHours) ? everyHours : DEFAULT_REPORTING_COPY_CONFIG.everyHours,
    weekDays,
    timeOfDay: parseRunTime(String(data.timeOfDay ?? '')) === null ? DEFAULT_REPORTING_COPY_TIME : String(data.timeOfDay).trim().padStart(5, '0'),
    timezone,
    scheduleFrom: isoOrNull(data.scheduleFrom),
    requestedAt: isoOrNull(data.requestedAt),
    requestedBy: typeof data.requestedBy === 'string' ? data.requestedBy : null,
    updatedAt: isoOrNull(data.updatedAt),
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

/** The part of the config the settings screen edits. */
export type ReportingCopySettingsInput = Pick<ReportingCopyConfig, 'enabled' | 'frequency' | 'everyHours' | 'weekDays' | 'timeOfDay' | 'timezone'>;

/** Validate a settings save. Strict, unlike `normalize…`: a bad value is refused, not replaced. */
export function parseReportingCopySettings(input: unknown): { ok: true; value: ReportingCopySettingsInput } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Settings are required.' };
  const data = input as Record<string, unknown>;
  if (typeof data.enabled !== 'boolean') return { ok: false, error: '`enabled` must be true or false.' };
  if (!['daily', 'everyHours', 'weekly'].includes(String(data.frequency))) {
    return { ok: false, error: 'Frequency must be daily, every N hours or weekly.' };
  }
  const frequency = data.frequency as ReportingCopyFrequency;
  const everyHours = Number(data.everyHours ?? DEFAULT_REPORTING_COPY_CONFIG.everyHours);
  if (!(EVERY_HOURS_OPTIONS as readonly number[]).includes(everyHours)) {
    return { ok: false, error: `Every N hours must be one of ${EVERY_HOURS_OPTIONS.join(', ')}.` };
  }
  const rawDays = data.weekDays ?? DEFAULT_REPORTING_COPY_CONFIG.weekDays;
  if (!Array.isArray(rawDays) || rawDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    return { ok: false, error: 'Days must be weekday numbers, 0 (Sunday) to 6 (Saturday).' };
  }
  const weekDays = [...new Set(rawDays as number[])].sort();
  if (frequency === 'weekly' && !weekDays.length) return { ok: false, error: 'Choose at least one day for a weekly refresh.' };
  const timeOfDay = String(data.timeOfDay ?? '').trim();
  if (!/^\d{2}:\d{2}$/.test(timeOfDay) || parseRunTime(timeOfDay) === null) {
    return { ok: false, error: 'Time must be HH:mm, 24-hour.' };
  }
  const timezone = String(data.timezone ?? DEFAULT_REPORTING_COPY_TIMEZONE).trim();
  if (!timezone || !isValidTimeZone(timezone)) return { ok: false, error: `Unknown timezone "${timezone}".` };
  return { ok: true, value: { enabled: data.enabled, frequency, everyHours, weekDays, timeOfDay, timezone } };
}

/* ------------------------------------------------------------------------------------------------
 * Schedule math
 * ---------------------------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

/** How far `timeZone`'s wall clock is ahead of UTC at `instant`, in ms. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return wall - Math.floor(instant / 1000) * 1000;
}

/** The instant a local calendar day + minute-of-day happens in `timeZone` (DST-safe to the hour). */
function zonedInstant(localMidnightUtc: number, minutes: number, timeZone: string): number {
  const wall = localMidnightUtc + minutes * 60_000;
  const first = wall - zoneOffsetMs(wall, timeZone);
  return wall - zoneOffsetMs(first, timeZone);
}

/** Minutes of the day a refresh starts on `weekday` (0 = Sunday). */
function slotMinutes(config: ReportingCopyConfig, weekday: number): number[] {
  const at = parseRunTime(config.timeOfDay) ?? parseRunTime(DEFAULT_REPORTING_COPY_TIME)!;
  if (config.frequency === 'weekly') return config.weekDays.includes(weekday) ? [at] : [];
  if (config.frequency === 'everyHours') {
    const step = config.everyHours * 60;
    const out: number[] = [];
    for (let minute = at % step; minute < 1440; minute += step) out.push(minute);
    return out;
  }
  return [at];
}

/** Every slot instant (ms) on the local days `from`…`to` days away from today, in order. */
function slotsAround(config: ReportingCopyConfig, now: Date, from: number, to: number): number[] {
  const timeZone = isValidTimeZone(config.timezone) ? config.timezone : DEFAULT_REPORTING_COPY_TIMEZONE;
  // Today's local date, as a UTC midnight: plain calendar arithmetic from here on.
  const todayWall = now.getTime() + zoneOffsetMs(now.getTime(), timeZone);
  const today = Math.floor(todayWall / DAY_MS) * DAY_MS;
  const out: number[] = [];
  for (let offset = from; offset <= to; offset += 1) {
    const day = today + offset * DAY_MS;
    for (const minute of slotMinutes(config, new Date(day).getUTCDay())) out.push(zonedInstant(day, minute, timeZone));
  }
  return out.sort((a, b) => a - b);
}

/** The newest scheduled slot at or before `now`, or null when the schedule has none (no days chosen). */
export function latestReportingCopySlot(config: ReportingCopyConfig, now: Date): Date | null {
  const past = slotsAround(config, now, -8, 0).filter((at) => at <= now.getTime());
  return past.length ? new Date(past[past.length - 1]) : null;
}

/** The first scheduled slot after `now` (and not before `scheduleFrom`), or null when there is none. */
export function nextReportingCopySlot(config: ReportingCopyConfig, now: Date): Date | null {
  const floor = Math.max(now.getTime(), config.scheduleFrom ? Date.parse(config.scheduleFrom) : 0);
  const next = slotsAround(config, now, 0, 8).find((at) => at > floor);
  return next === undefined ? null : new Date(next);
}

export interface ReportingCopyDue {
  due: boolean;
  trigger: 'schedule' | 'manual' | null;
  reason: string;
  /** For a scheduled run: the slot it answers (ISO). */
  slot: string | null;
}

/**
 * Whether a new run should start at `now`. A pending "Refresh now" always counts; otherwise the
 * schedule must be on and its newest slot must have passed without a run — "has passed" rather
 * than "is now", so a late or skipped tick still starts it on the next one, and several missed
 * slots start one run, not one each. Says nothing about a run already in progress: the caller
 * continues that one before asking.
 */
export function reportingCopyDue(
  config: ReportingCopyConfig,
  state: Pick<ReportingCopyState, 'lastScheduledSlot' | 'handledRequestAt'>,
  now: Date,
): ReportingCopyDue {
  const result = (due: boolean, trigger: ReportingCopyDue['trigger'], reason: string, slot: string | null = null) => ({ due, trigger, reason, slot });
  if (config.requestedAt && (!state.handledRequestAt || Date.parse(config.requestedAt) > Date.parse(state.handledRequestAt))) {
    return result(true, 'manual', 'Refresh requested', latestReportingCopySlot(config, now)?.toISOString() ?? null);
  }
  if (!config.enabled) return result(false, null, 'Scheduled refreshes are switched off');
  const slot = latestReportingCopySlot(config, now);
  if (!slot) return result(false, null, 'No refresh day is chosen');
  if (config.scheduleFrom && slot.getTime() < Date.parse(config.scheduleFrom)) return result(false, null, 'Waiting for the first scheduled time');
  if (state.lastScheduledSlot && slot.getTime() <= Date.parse(state.lastScheduledSlot)) return result(false, null, 'Up to date with the schedule');
  return result(true, 'schedule', 'Scheduled refresh', slot.toISOString());
}

/** When the next run is expected to start (ISO), for the screen; null when nothing is scheduled. */
export function reportingCopyNextDueAt(
  config: ReportingCopyConfig,
  state: Pick<ReportingCopyState, 'lastScheduledSlot' | 'handledRequestAt'>,
  now: Date,
): string | null {
  const due = reportingCopyDue(config, state, now);
  if (due.due) return now.toISOString();
  if (!config.enabled) return null;
  return nextReportingCopySlot(config, now)?.toISOString() ?? null;
}

/** A one-line description of the schedule, e.g. "Every 6 hours from 02:00 (Asia/Kolkata)". */
export function describeReportingCopySchedule(config: ReportingCopyConfig): string {
  if (!config.enabled) return 'Off';
  const zone = ` (${config.timezone})`;
  if (config.frequency === 'everyHours') {
    return config.everyHours === 1 ? `Every hour from ${config.timeOfDay}${zone}` : `Every ${config.everyHours} hours from ${config.timeOfDay}${zone}`;
  }
  if (config.frequency === 'weekly') {
    const days = config.weekDays.map((day) => WEEKDAY_NAMES[day].slice(0, 3)).join(', ');
    return `Weekly on ${days || 'no day'} at ${config.timeOfDay}${zone}`;
  }
  return `Daily at ${config.timeOfDay}${zone}`;
}
