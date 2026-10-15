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
/** MongoDB ids checked against Firestore per step of the deletion check. */
export const DELETION_CHECK_BATCH = 300;
/** How long a root collection's discovered subcollection names are reused before they are looked up again. */
export const SUBCOLLECTION_CACHE_DAYS = 7;

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
 * Incremental writes: fingerprints, the per-page plan, the deletion check
 * ---------------------------------------------------------------------------------------------- */

/**
 * Fields the copy adds to every MongoDB document. Left out of the fingerprint, so a document's hash
 * depends only on what came from Firestore. `_syncRun` is from the full copies before 2026-10-15.
 */
export const COPY_BOOKKEEPING_FIELDS: readonly string[] = [
  '_hash', '_syncRun', '_syncedAt', '_firstCopiedAt', '_updatedAt', '_deletedInApp', '_deletedNoticedAt',
];

/** Filter for the documents still present in the app — use it in reports too. */
export const ACTIVE_COPY_FILTER = { _deletedInApp: { $ne: true } } as const;

/** What the per-page lookup reads of each existing MongoDB document. */
export const EXISTING_COPY_PROJECTION = { _id: 1, _hash: 1, _deletedInApp: 1, _firstCopiedAt: 1 } as const;

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without Buffer, so this file stays loadable in the browser bundle. */
function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64[a >> 2] + BASE64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? BASE64[c & 63] : '=';
  }
  return out;
}

/** A converted value in a form whose JSON is the same whatever order its keys were built in. */
function canonicalValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return { $date: Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString() };
  if (value instanceof Uint8Array) return { $binary: toBase64(value) };
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'number' && !Number.isFinite(value)) return { $number: String(value) };
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalValue((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/**
 * The canonical JSON of a converted document: keys sorted at every depth, Dates as ISO strings,
 * bytes as base64, and the copy's own bookkeeping fields (top level) left out.
 */
export function canonicalDocumentJson(doc: Record<string, unknown>): string {
  const skip = new Set(COPY_BOOKKEEPING_FIELDS);
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(doc)) if (!skip.has(key)) body[key] = doc[key];
  return JSON.stringify(canonicalValue(body));
}

/**
 * A converted document's fingerprint, stored on its copy as `_hash`. The hash function is passed in
 * (sha1 from node:crypto on the server and in the tool) so this file needs no Node modules.
 */
export const documentFingerprint = (doc: Record<string, unknown>, hash: (text: string) => string): string =>
  hash(canonicalDocumentJson(doc));

/** An existing MongoDB copy, as EXISTING_COPY_PROJECTION reads it. */
export interface ExistingCopy {
  _id: unknown;
  _hash?: unknown;
  _deletedInApp?: unknown;
  _firstCopiedAt?: unknown;
}

/**
 * What to do with one Firestore document. `insert`: not in the copy yet. `restore`: in the copy but
 * marked deleted in the app, and back. `update`: its fingerprint differs — including copies from the
 * full copies before 2026-10-15, which have no `_hash` and so are rewritten once. `unchanged`: no write.
 */
export type DocumentWriteDecision = 'insert' | 'update' | 'restore' | 'unchanged';

export function decideDocumentWrite(fingerprint: string, existing: ExistingCopy | undefined | null): DocumentWriteDecision {
  if (!existing) return 'insert';
  if (existing._deletedInApp === true) return 'restore';
  if (existing._hash !== fingerprint) return 'update';
  return 'unchanged';
}

/** Per-run and per-collection counts. `documents` is documents read from Firestore. */
export interface ReportingCopyChangeCounts {
  documents: number;
  inserted: number;
  updated: number;
  unchanged: number;
  restored: number;
  markedDeleted: number;
}

export const CHANGE_COUNT_KEYS = ['documents', 'inserted', 'updated', 'unchanged', 'restored', 'markedDeleted'] as const;

export interface PlannedWrite {
  replaceOne: { filter: { _id: string }; replacement: Record<string, unknown>; upsert: true };
}

/**
 * One page's writes. Every write is an upserting replaceOne (safe to repeat if a slice dies after
 * writing), and replacing drops `_deletedInApp` / `_deletedNoticedAt` from a restored document.
 * `_firstCopiedAt` is kept from the existing copy; copies from before 2026-10-15 never had one, so
 * theirs is the first incremental run that rewrote them.
 */
export function planPageWrites(
  docs: ReadonlyArray<Record<string, unknown> & { _id: string }>,
  existing: readonly ExistingCopy[],
  options: { hash: (text: string) => string; now: Date },
): { writes: PlannedWrite[]; counts: Omit<ReportingCopyChangeCounts, 'markedDeleted'> } {
  const byId = new Map(existing.map((copy) => [String(copy._id), copy]));
  const counts = { documents: docs.length, inserted: 0, updated: 0, unchanged: 0, restored: 0 };
  const writes: PlannedWrite[] = [];
  for (const doc of docs) {
    const fingerprint = documentFingerprint(doc, options.hash);
    const copy = byId.get(doc._id);
    const decision = decideDocumentWrite(fingerprint, copy);
    if (decision === 'unchanged') {
      counts.unchanged += 1;
      continue;
    }
    if (decision === 'insert') counts.inserted += 1;
    else if (decision === 'restore') counts.restored += 1;
    else counts.updated += 1;
    const first = copy?._firstCopiedAt;
    const firstCopiedAt = first instanceof Date || typeof first === 'string' ? first : options.now;
    const replacement = { ...doc, _hash: fingerprint, _firstCopiedAt: firstCopiedAt, _updatedAt: options.now, _syncedAt: options.now };
    writes.push({ replaceOne: { filter: { _id: doc._id }, replacement, upsert: true } });
  }
  return { writes, counts };
}

/**
 * Whether a finished collection needs its deletion check, from counts alone. After the writes every
 * Firestore document read this run is in the copy and not marked deleted, so the copy can only have
 * more such documents than were read — and each extra one was deleted in the app. Equal: nothing
 * was deleted, no scan. More: scan the copy's ids against Firestore until that many are found
 * (`expectedMissing`). A Full refresh scans every collection to the end (`expectedMissing` null).
 */
export function decideDeletionCheck(input: { mongoActive: number; firestoreRead: number; full: boolean }): { scan: boolean; expectedMissing: number | null } {
  if (input.full) return { scan: input.mongoActive > 0, expectedMissing: null };
  const extra = input.mongoActive - input.firestoreRead;
  return extra > 0 ? { scan: true, expectedMissing: extra } : { scan: false, expectedMissing: 0 };
}

/** Whether a deletion scan can stop: the copy ran out of ids, or all the expected deletions were found. */
export const deletionScanDone = (batchSize: number, found: number, expectedMissing: number | null, batchLimit = DELETION_CHECK_BATCH) =>
  batchSize < batchLimit || (expectedMissing !== null && found >= expectedMissing);

/** The update that marks copies whose documents were deleted in the app. They are kept, never removed. */
export const markDeletedUpdate = (now: Date) => ({ $set: { _deletedInApp: true, _deletedNoticedAt: now } });

/** A root collection's subcollection names, as last discovered. */
export interface SubcollectionCacheEntry {
  names: string[];
  discoveredAt: string;
}

/**
 * The cached subcollection names of `root`, or null when they must be looked up again: never
 * discovered, older than SUBCOLLECTION_CACHE_DAYS, or a Full refresh.
 */
export function cachedSubcollections(
  cache: Record<string, SubcollectionCacheEntry> | null | undefined,
  root: string,
  now: Date,
  full: boolean,
  maxAgeDays = SUBCOLLECTION_CACHE_DAYS,
): string[] | null {
  if (full) return null;
  const entry = cache?.[root];
  if (!entry || !Array.isArray(entry.names)) return null;
  const at = Date.parse(entry.discoveredAt);
  if (Number.isNaN(at) || now.getTime() - at > maxAgeDays * 86_400_000) return null;
  return [...entry.names];
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
  /** The name of whoever pressed Refresh now, shown on the run it starts. */
  requestedByName: string | null;
  /** The request is a Full refresh: subcollections looked up again and every collection checked for deletions. */
  requestedFull: boolean;
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
  requestedByName: null,
  requestedFull: false,
  updatedAt: null,
  updatedBy: null,
};

/** `stopped`: ended early with Stop; what had been copied by then is kept. */
export type ReportingCopyRunStatus = 'running' | 'succeeded' | 'failed' | 'stopped';

/** The run in progress or the last one finished — counts grow as the run goes. */
export interface ReportingCopyRun {
  runId: number;
  trigger: 'schedule' | 'manual';
  /** For a manual run: the name of whoever pressed Refresh now (absent on runs from before 2026-10-15). */
  requestedBy?: string | null;
  status: ReportingCopyRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationSeconds: number | null;
  /** Documents read from Firestore (before 2026-10-15, when every one was written: documents copied). */
  documents: number;
  /** Absent on runs before 2026-10-15, which rewrote everything and removed what was gone. */
  inserted?: number;
  updated?: number;
  unchanged?: number;
  restored?: number;
  markedDeleted?: number;
  /** MongoDB collections fully written and checked (root collections and `<parent>.<sub>` ones). */
  collections: number;
  /** Runs before 2026-10-15 only: documents deleted from the copy. Newer runs never delete. */
  removed?: number;
  /** A Full refresh (subcollections looked up again, every collection checked for deletions). */
  full?: boolean;
  error: string | null;
}

/** Add counts to a run (or any tally), treating counts it lacks as 0. */
export function addChangeCounts<T extends Partial<ReportingCopyChangeCounts>>(target: T, delta: Partial<ReportingCopyChangeCounts>): T {
  const next: Record<string, unknown> = { ...target };
  for (const key of CHANGE_COUNT_KEYS) {
    const current = typeof next[key] === 'number' ? (next[key] as number) : undefined;
    if (delta[key] !== undefined || current !== undefined) next[key] = (current ?? 0) + (delta[key] ?? 0);
  }
  return next as T;
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
  /**
   * Within a root or subcollection step: `copy` (pages of Firestore documents) then `deletions`
   * (the check for documents deleted in the app). A target is complete once both are done. Absent
   * on progress saved before 2026-10-15: `copy`.
   */
  phase?: 'copy' | 'deletions';
  /**
   * The current target's deletion scan, once counted: how many deleted documents the counts say to
   * expect (null: scan to the end, a Full refresh) and how many have been found. Null before counting.
   */
  deletionScan?: { expectedMissing: number | null; found: number } | null;
  /** A Full refresh: subcollections looked up again, every collection's deletions checked in full. */
  full?: boolean;
  /**
   * In `copy`: the last Firestore document read (an id for a root, a full path for a subcollection).
   * In `deletions`: the last MongoDB `_id` checked.
   */
  cursor: string | null;
  /** The MongoDB collection being written, for the screen. */
  target: string | null;
  /** Failed attempts at the current target; at the limit the target is skipped and reported. */
  attempts: number;
  lastError: string | null;
  /** Targets given up on, with the reason — the run then ends as failed. */
  failures: string[];
  ticks: number;
  /** Counts per MongoDB collection so far, in the order they were copied. */
  collectionCounts?: ReportingCopyCollectionCount[];
}

export interface ReportingCopyCollectionCount extends Partial<ReportingCopyChangeCounts> {
  name: string;
  /** Documents read from Firestore (on entries before 2026-10-15: documents written). */
  documents: number;
  /** Entries before 2026-10-15 only: documents deleted from the copy. */
  removed?: number;
  /** Read in full and checked for deletions in this run. */
  complete: boolean;
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
  /** Stop pressed (ISO), and by whom: the slice copying finishes its page and ends the run as stopped. */
  cancelRequestedAt: string | null;
  cancelRequestedBy: string | null;
  /** Subcollection names per root collection, reused for SUBCOLLECTION_CACHE_DAYS (a Full refresh looks again). */
  subcollectionCache?: Record<string, SubcollectionCacheEntry>;
}

export const EMPTY_REPORTING_COPY_STATE: ReportingCopyState = {
  lastRun: null,
  progress: null,
  lease: null,
  lastScheduledSlot: null,
  handledRequestAt: null,
  nextDueAt: null,
  updatedAt: null,
  cancelRequestedAt: null,
  cancelRequestedBy: null,
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
    requestedByName: typeof data.requestedByName === 'string' ? data.requestedByName : null,
    requestedFull: data.requestedFull === true,
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

/* ------------------------------------------------------------------------------------------------
 * Progress, stopping and history
 * ---------------------------------------------------------------------------------------------- */

/** How many finished runs `reportingCopy/state/history` keeps; older ones are deleted on write. */
export const REPORTING_COPY_HISTORY_KEEP = 50;
/** Per-collection rows kept on a history entry (a full copy has ~150 roots plus subcollections). */
export const REPORTING_COPY_HISTORY_COLLECTIONS = 200;
export const REPORTING_COPY_HISTORY_SUBCOLLECTION = 'history';

/**
 * How far a run has got, 0–100, by collections: the roots done, plus a share of the current one —
 * a quarter once some of its documents are written, half once they all are (finding its
 * subcollections), the rest spread over its subcollections. Not rounded, so the first collection of
 * 151 reads as a sliver rather than 0%.
 */
export function reportingCopyPercent(
  progress: Pick<ReportingCopyProgress, 'roots' | 'index' | 'step' | 'cursor' | 'subcollections' | 'subIndex' | 'phase'> | null,
): number {
  if (!progress?.roots?.length) return 0;
  const total = progress.roots.length;
  if (progress.index >= total) return 100;
  let within = 0;
  if (progress.step === 'root') within = progress.phase === 'deletions' ? 0.4 : progress.cursor ? 0.25 : 0;
  else if (progress.step === 'discover') within = 0.5;
  else within = 0.5 + 0.5 * (progress.subcollections.length ? progress.subIndex / progress.subcollections.length : 0);
  return Math.min(100, ((progress.index + within) / total) * 100);
}

/** The percentage as the screen shows it: "<1%" for a run that has started but not reached 1%. */
export function formatReportingCopyPercent(percent: number): string {
  if (percent > 0 && percent < 1) return '<1%';
  return `${Math.floor(percent)}%`;
}

/** Add one page's counts to the per-collection tally (a new entry the first time a name appears). */
export function addCollectionCount(
  counts: readonly ReportingCopyCollectionCount[] | undefined,
  name: string,
  delta: Partial<ReportingCopyChangeCounts> & { complete?: boolean },
): ReportingCopyCollectionCount[] {
  const list = [...(counts ?? [])];
  const at = list.findIndex((entry) => entry.name === name);
  const current: ReportingCopyCollectionCount = at >= 0
    ? list[at]
    : { name, documents: 0, inserted: 0, updated: 0, unchanged: 0, restored: 0, markedDeleted: 0, complete: false };
  const next = { ...addChangeCounts(current, delta), complete: current.complete || delta.complete === true };
  if (at >= 0) list[at] = next;
  else list.push(next);
  return list;
}

/**
 * What Stop does. `nothing`: no run in progress. `signal`: a slice holds a live lease — mark the
 * request and let it finish its page and end the run. `end-now`: no slice is copying (the lease is
 * absent or expired, e.g. a run whose scheduler never came) — end the run on the spot.
 */
export function decideReportingCopyStop(
  state: Pick<ReportingCopyState, 'progress' | 'lease'>,
  now: Date,
): 'nothing' | 'signal' | 'end-now' {
  if (!state.progress) return 'nothing';
  if (state.lease && Date.parse(state.lease.expiresAt) > now.getTime()) return 'signal';
  return 'end-now';
}

/** Whether a slice must stop: a run is in progress and Stop has been pressed. */
export const reportingCopyStopRequested = (state: Pick<ReportingCopyState, 'progress' | 'cancelRequestedAt'>) =>
  Boolean(state.progress && state.cancelRequestedAt);

/**
 * A run's final record. `stoppedBy` set: Stop ended it (status `stopped`, whatever failed before);
 * otherwise `failed` when any collection was given up on, else `succeeded`. An `error` passed in
 * (the 24-hour limit, no connection string) fails the run with that message.
 */
export function endReportingCopyRun(
  run: ReportingCopyRun,
  progress: Pick<ReportingCopyProgress, 'failures' | 'target'> | null,
  options: { now: Date; stoppedBy?: string | null; error?: string },
): ReportingCopyRun {
  const failures = progress?.failures ?? [];
  const durationSeconds = Math.max(0, Math.round((options.now.getTime() - Date.parse(run.startedAt)) / 1000));
  const failureText = failures.length
    ? `${failures.length} collection(s) could not be copied: ${failures.slice(0, 5).join('; ')}${failures.length > 5 ? ` …and ${failures.length - 5} more` : ''}`
    : null;
  if (options.stoppedBy !== undefined) {
    const where = progress?.target ? ` at ${progress.target}` : '';
    return {
      ...run, status: 'stopped', finishedAt: options.now.toISOString(), durationSeconds,
      error: `Stopped${options.stoppedBy ? ` by ${options.stoppedBy}` : ''}${where}.${failureText ? ` ${failureText}` : ''}`,
    };
  }
  if (options.error) return { ...run, status: 'failed', finishedAt: options.now.toISOString(), durationSeconds, error: options.error };
  return { ...run, status: failureText ? 'failed' : 'succeeded', finishedAt: options.now.toISOString(), durationSeconds, error: failureText };
}

/** `reportingCopy/state/history/{runId}`: one finished run. */
export interface ReportingCopyHistoryEntry {
  runId: number;
  trigger: 'schedule' | 'manual';
  requestedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationSeconds: number | null;
  status: ReportingCopyRunStatus;
  /** Documents read (entries before 2026-10-15: documents copied — every one was rewritten). */
  documents: number;
  collections: number;
  /** Absent on entries before 2026-10-15, which have `removed` instead. */
  inserted?: number;
  updated?: number;
  unchanged?: number;
  restored?: number;
  markedDeleted?: number;
  /** Entries before 2026-10-15 only: documents deleted from the copy. */
  removed?: number;
  full?: boolean;
  error: string | null;
  /** Collections given up on, with the reason. */
  skipped: string[];
  /** At most REPORTING_COPY_HISTORY_COLLECTIONS entries; `collectionsOmitted` counts the rest. */
  perCollection: ReportingCopyCollectionCount[];
  collectionsOmitted: number;
}

export function buildReportingCopyHistoryEntry(
  run: ReportingCopyRun,
  progress: Pick<ReportingCopyProgress, 'failures' | 'collectionCounts'> | null,
  cap = REPORTING_COPY_HISTORY_COLLECTIONS,
): ReportingCopyHistoryEntry {
  const counts = progress?.collectionCounts ?? [];
  return {
    runId: run.runId,
    trigger: run.trigger,
    requestedBy: run.requestedBy ?? null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationSeconds: run.durationSeconds,
    status: run.status,
    documents: run.documents,
    collections: run.collections,
    // Only the counts the run has: Firestore refuses undefined, and old runs have `removed` instead.
    ...Object.fromEntries(
      (['inserted', 'updated', 'unchanged', 'restored', 'markedDeleted', 'removed'] as const)
        .filter((key) => typeof run[key] === 'number')
        .map((key) => [key, run[key]]),
    ),
    full: run.full === true,
    error: run.error,
    skipped: [...(progress?.failures ?? [])],
    perCollection: counts.slice(0, cap),
    collectionsOmitted: Math.max(0, counts.length - cap),
  };
}

/** The run ids to delete so only the newest `keep` remain (ids are start times, so newest = largest). */
export function reportingCopyHistoryOverflow(runIds: readonly number[], keep = REPORTING_COPY_HISTORY_KEEP): number[] {
  return [...runIds].sort((a, b) => b - a).slice(Math.max(0, keep));
}
