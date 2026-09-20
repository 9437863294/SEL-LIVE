/**
 * The Windows Agent's arithmetic: what a recorded span of time *means*, and how a day adds up
 * (`docs/windows-agent.md` §8–§11, §31–§32).
 *
 * Pure and dependency-free apart from `office-hub-time.ts`, which is itself dependency-free — so
 * this module runs under `node --test`, inside the Admin-SDK ingest route, and in the browser when
 * a report re-derives a percentage. Reusing that time module rather than writing a second one is
 * §56's instruction not to build parallel systems: "which calendar day is this instant, in the
 * office's timezone" is a question the application already answers correctly, including the
 * midnight-boundary case that naive `getDate()` arithmetic gets wrong.
 *
 * ── The one decision the whole module rests on ──────────────────────────────────────────────────
 *
 * **A span is not classified as a whole; its seconds are split.** This is the single place the
 * specification, read literally, would produce wrong numbers, so it is worth stating plainly.
 *
 * §11 asks for "0–5 minutes: Active, 5–15: Idle, 15+: Extended Idle", which reads like a label
 * applied to a stretch of time. Apply it that way and a thirty-minute stretch in Excel that ends
 * with six idle minutes is labelled `IDLE` — and twenty-four minutes of real work vanishes from the
 * active total. Do it per span and the error compounds all day, in the direction that makes people
 * look idle when they were not. That is not a rounding difference; it is a number somebody's
 * appraisal might be argued over.
 *
 * So `foldSpan` credits `durationSeconds - idleSeconds` to `active` and the remainder to `idle` or
 * `extendedIdle`, always. The §11 thresholds decide *which idle bucket* the idle remainder lands
 * in, and they set the presence badge on the live board — they never relabel work as idleness.
 *
 * The whole-span label still exists, as `dominantClassification`, because the timeline in §10 needs
 * one colour per bar. It is a display concern and nothing sums it.
 *
 * ── Three more rules that are not obvious ──────────────────────────────────────────────────────
 *
 *  1. **The server re-derives everything the agent asserts.** The agent sends `startedAt`,
 *     `endedAt` and `idleSeconds`; the duration, the classification, the category and the work date
 *     are all computed here. A tampered or buggy agent can therefore under-report time by not
 *     sending spans — which is visible as a gap — but it cannot invent active hours.
 *
 *  2. **Time is only ever counted once.** `clampSpansToSession` bounds every span to the session's
 *     own lifetime and `resolveSpanOverlaps` drops the overlapping tail of any span that starts
 *     before the previous one ended. Windows can report two foreground changes in the same
 *     millisecond across multiple monitors (§59); without this, a day quietly totals more than
 *     twenty-four hours.
 *
 *  3. **An unknown application is recorded, not discarded.** Ingest adds it to the catalogue as
 *     `UNCLASSIFIED` so the settings screen lists what is genuinely in use. §22's configurable
 *     categories are only useful if the list populates itself.
 */

import { OFFICE_HUB_DEFAULT_TIME_ZONE, clockToMinutes, utcToZonedParts } from './office-hub-time.ts';
import type {
  ActivityClassification,
  AgentActivitySpan,
  AgentPolicySettings,
  AppCategory,
  IsoDate,
  IsoInstant,
  PresenceState,
  WindowsActivityEvent,
  WindowsApplicationUsage,
} from './windows-agent-model.ts';

/** The office timezone every work date and late-login check is read in. */
export const WINDOWS_AGENT_TIME_ZONE = OFFICE_HUB_DEFAULT_TIME_ZONE;

/* ------------------------------------------------------------------------------------------------
 * Bounds
 * ---------------------------------------------------------------------------------------------- */

/**
 * The longest single span the server will accept.
 *
 * A foreground application genuinely can hold focus for hours — a drawing left open over lunch is
 * a locked or idle span, not a short one. Twelve hours is comfortably beyond any real stretch while
 * still rejecting the pathological case: an agent whose clock jumped, or a span whose `endedAt` was
 * never written because the process was killed, arriving later as a span of several days.
 */
export const MAX_SPAN_SECONDS = 12 * 60 * 60;

/** Spans shorter than this are noise — alt-tabbing through windows, a transient splash screen. */
export const MIN_SPAN_SECONDS = 1;

/** How far in the future a span may end before it is treated as clock skew and rejected. */
export const MAX_FUTURE_SKEW_SECONDS = 5 * 60;

/** Window titles are truncated to this before storage, on the rare installation that enables them. */
export const MAX_WINDOW_TITLE_LENGTH = 120;

/* ------------------------------------------------------------------------------------------------
 * Process identity
 * ---------------------------------------------------------------------------------------------- */

/**
 * The grouping key for an application: the bare executable name, lower-cased.
 *
 * Takes a full path as readily as a name, because `GetModuleFileNameEx` returns a path and the
 * agent should not have to remember to strip it. Returns an empty string for anything unusable, and
 * callers treat that as "not attributable" rather than inventing a bucket for it.
 */
export function normalizeProcessKey(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const leaf = trimmed.split(/[\\/]/).pop() || trimmed;
  return leaf.toLowerCase().slice(0, 120);
}

/** What the built-in catalogue knows about one executable. */
export interface AppCatalogSeed {
  displayName: string;
  category: AppCategory;
}

/**
 * The software every office already has, pre-classified so the first report is readable.
 *
 * Everything here is seeded into `windowsAppCatalog` as `isBuiltIn`, and an administrator may
 * recategorise any of it (§22) — these are starting points, not verdicts. Note that no entry is
 * marked productive or unproductive, because this module does not hold that opinion: a browser is
 * `REFERENCE` because that describes the software, and whether a given hour in it was work is a
 * question for the person's manager, not for a lookup table.
 */
export const DEFAULT_APP_CATALOG: Readonly<Record<string, AppCatalogSeed>> = {
  // Office
  'excel.exe': { displayName: 'Microsoft Excel', category: 'OFFICE' },
  'winword.exe': { displayName: 'Microsoft Word', category: 'OFFICE' },
  'powerpnt.exe': { displayName: 'Microsoft PowerPoint', category: 'OFFICE' },
  'msaccess.exe': { displayName: 'Microsoft Access', category: 'OFFICE' },
  'onenote.exe': { displayName: 'Microsoft OneNote', category: 'OFFICE' },
  'visio.exe': { displayName: 'Microsoft Visio', category: 'OFFICE' },
  'winproj.exe': { displayName: 'Microsoft Project', category: 'OFFICE' },
  'soffice.bin': { displayName: 'LibreOffice', category: 'OFFICE' },
  'wps.exe': { displayName: 'WPS Office', category: 'OFFICE' },
  'et.exe': { displayName: 'WPS Spreadsheets', category: 'OFFICE' },

  // Communication
  'outlook.exe': { displayName: 'Microsoft Outlook', category: 'COMMUNICATION' },
  'teams.exe': { displayName: 'Microsoft Teams', category: 'COMMUNICATION' },
  'ms-teams.exe': { displayName: 'Microsoft Teams', category: 'COMMUNICATION' },
  'lync.exe': { displayName: 'Skype for Business', category: 'COMMUNICATION' },
  'skype.exe': { displayName: 'Skype', category: 'COMMUNICATION' },
  'zoom.exe': { displayName: 'Zoom', category: 'COMMUNICATION' },
  'slack.exe': { displayName: 'Slack', category: 'COMMUNICATION' },
  'whatsapp.exe': { displayName: 'WhatsApp', category: 'COMMUNICATION' },

  // Reference / browsing
  'chrome.exe': { displayName: 'Google Chrome', category: 'REFERENCE' },
  'msedge.exe': { displayName: 'Microsoft Edge', category: 'REFERENCE' },
  'firefox.exe': { displayName: 'Mozilla Firefox', category: 'REFERENCE' },
  'brave.exe': { displayName: 'Brave', category: 'REFERENCE' },
  'opera.exe': { displayName: 'Opera', category: 'REFERENCE' },
  'acrobat.exe': { displayName: 'Adobe Acrobat', category: 'REFERENCE' },
  'acrord32.exe': { displayName: 'Adobe Acrobat Reader', category: 'REFERENCE' },
  'foxitpdfreader.exe': { displayName: 'Foxit PDF Reader', category: 'REFERENCE' },
  'sumatrapdf.exe': { displayName: 'SumatraPDF', category: 'REFERENCE' },

  // Development
  'code.exe': { displayName: 'Visual Studio Code', category: 'DEVELOPMENT' },
  'devenv.exe': { displayName: 'Visual Studio', category: 'DEVELOPMENT' },
  'windowsterminal.exe': { displayName: 'Windows Terminal', category: 'DEVELOPMENT' },
  'powershell.exe': { displayName: 'Windows PowerShell', category: 'DEVELOPMENT' },
  'pwsh.exe': { displayName: 'PowerShell', category: 'DEVELOPMENT' },
  'cmd.exe': { displayName: 'Command Prompt', category: 'DEVELOPMENT' },
  'ssms.exe': { displayName: 'SQL Server Management Studio', category: 'DEVELOPMENT' },

  // Engineering / drawing — a construction ERP's users live in these
  'acad.exe': { displayName: 'AutoCAD', category: 'WORK' },
  'staadpro.exe': { displayName: 'STAAD.Pro', category: 'WORK' },
  'revit.exe': { displayName: 'Autodesk Revit', category: 'WORK' },
  'sketchup.exe': { displayName: 'SketchUp', category: 'WORK' },
  'tally.exe': { displayName: 'Tally', category: 'WORK' },
  'primavera.exe': { displayName: 'Primavera P6', category: 'WORK' },

  // The ERP itself, however it is opened
  'sel.agent.exe': { displayName: 'SEL LIVE Agent', category: 'ERP' },
  'sel-live.exe': { displayName: 'SEL LIVE', category: 'ERP' },

  // System surfaces that hold focus without anybody "using" them
  'explorer.exe': { displayName: 'Windows Explorer', category: 'SYSTEM' },
  'lockapp.exe': { displayName: 'Windows Lock Screen', category: 'SYSTEM' },
  'logonui.exe': { displayName: 'Windows Sign-in', category: 'SYSTEM' },
  'searchhost.exe': { displayName: 'Windows Search', category: 'SYSTEM' },
  'shellexperiencehost.exe': { displayName: 'Windows Shell', category: 'SYSTEM' },
  'taskmgr.exe': { displayName: 'Task Manager', category: 'SYSTEM' },
  'systemsettings.exe': { displayName: 'Windows Settings', category: 'SYSTEM' },
};

/** The category the built-in catalogue gives a process, or `UNCLASSIFIED`. */
export function defaultCategoryFor(processKey: string): AppCategory {
  return DEFAULT_APP_CATALOG[processKey]?.category ?? 'UNCLASSIFIED';
}

/**
 * The best display name available, in order: the administrator's catalogue, the built-in one, what
 * the executable told the agent, then the bare process name.
 *
 * The agent reads `FileDescription` from the executable's version resource, which is why
 * `EXCEL.EXE` arrives already knowing it is "Microsoft Excel" even on a machine nobody has
 * configured. The catalogue wins over it so an administrator can correct a vendor's odd naming.
 */
export function resolveApplicationName(
  processKey: string,
  reportedName: string | null | undefined,
  catalogName?: string | null,
): string {
  const catalogued = (catalogName || '').trim();
  if (catalogued) return catalogued;
  const builtIn = DEFAULT_APP_CATALOG[processKey]?.displayName;
  if (builtIn) return builtIn;
  const reported = (reportedName || '').trim();
  if (reported) return reported.slice(0, 80);
  return processKey || 'Unknown application';
}

/* ------------------------------------------------------------------------------------------------
 * Instants
 * ---------------------------------------------------------------------------------------------- */

/** Parse an ISO instant, returning null rather than an Invalid Date for anything unusable. */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Whole seconds between two instants, never negative. */
export function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

/** The office-local calendar date an instant falls on. The partition key of every daily report. */
export function workDateOf(
  instant: Date,
  timeZone: string = WINDOWS_AGENT_TIME_ZONE,
): IsoDate {
  return utcToZonedParts(instant, timeZone).date;
}

/**
 * Today, as the office reads it.
 *
 * Every screen that says "today" goes through this rather than `new Date().toISOString()`. In
 * Asia/Kolkata the two disagree for the five and a half hours after midnight local time — so a
 * dashboard opened at 02:00 would silently report yesterday, which is exactly when a night-shift
 * supervisor would be looking at it.
 */
export function todayWorkDate(timeZone: string = WINDOWS_AGENT_TIME_ZONE, now: Date = new Date()): IsoDate {
  return workDateOf(now, timeZone);
}

/** `09h 46m`, the format §7 and §9 print totals in. Seconds are shown only below a minute. */
export function formatSeconds(totalSeconds: number | null | undefined): string {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
}

/** `09:02 AM` in the office timezone. Used by the timeline and the attendance register. */
export function formatClockInZone(
  instant: Date | null,
  timeZone: string = WINDOWS_AGENT_TIME_ZONE,
): string {
  if (!instant) return '—';
  const { time } = utcToZonedParts(instant, timeZone);
  const [hourText, minuteText] = time.split(':');
  const hour = Number(hourText);
  const meridiem = hour < 12 ? 'AM' : 'PM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(displayHour).padStart(2, '0')}:${minuteText} ${meridiem}`;
}

/* ------------------------------------------------------------------------------------------------
 * Span validation (§31, §59)
 * ---------------------------------------------------------------------------------------------- */

export interface NormalizedSpan {
  spanId: string;
  eventType: AgentActivitySpan['eventType'];
  processKey: string;
  processName: string;
  reportedApplicationName: string | null;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  idleSeconds: number;
  recordedOffline: boolean;
  windowTitle: string | null;
  browserDomain: string | null;
}

export interface SpanRejection {
  spanId: string;
  reason: string;
}

export interface SpanNormalizationResult {
  spans: NormalizedSpan[];
  rejected: SpanRejection[];
}

/**
 * Turn what the agent sent into what the server is willing to store.
 *
 * Every field the agent could get wrong — accidentally or deliberately — is recomputed or clamped
 * here rather than trusted. The rejections are returned rather than swallowed so the agent can log
 * why a span it recorded never appeared, which is the difference between a diagnosable ingest
 * problem and a mysterious hole in somebody's day.
 */
export function normalizeSpans(
  rawSpans: readonly AgentActivitySpan[],
  options: {
    sessionStart: Date;
    /** The session's end, or "now" for an open session. Spans past it are clamped, not dropped. */
    sessionEnd: Date;
    /** Server time, used for the future-skew check. */
    now: Date;
    allowWindowTitles: boolean;
    allowBrowserDomains: boolean;
  },
): SpanNormalizationResult {
  const spans: NormalizedSpan[] = [];
  const rejected: SpanRejection[] = [];
  const seen = new Set<string>();
  const futureLimit = new Date(options.now.getTime() + MAX_FUTURE_SKEW_SECONDS * 1000);

  for (const raw of rawSpans) {
    const spanId = typeof raw?.spanId === 'string' ? raw.spanId.trim() : '';
    if (!spanId || spanId.length > 128) {
      rejected.push({ spanId: spanId || '(missing)', reason: 'A span id is required.' });
      continue;
    }
    if (seen.has(spanId)) {
      // Within a single batch this is the agent's bug, not a retry, so it is worth reporting.
      rejected.push({ spanId, reason: 'Duplicate span id within the same batch.' });
      continue;
    }
    seen.add(spanId);

    const startedAt = parseInstant(raw.startedAt);
    const endedAt = parseInstant(raw.endedAt);
    if (!startedAt || !endedAt) {
      rejected.push({ spanId, reason: 'startedAt and endedAt must be ISO-8601 instants.' });
      continue;
    }
    if (endedAt.getTime() <= startedAt.getTime()) {
      rejected.push({ spanId, reason: 'endedAt must be after startedAt.' });
      continue;
    }
    if (startedAt > futureLimit) {
      rejected.push({ spanId, reason: 'Span starts in the future; check the device clock.' });
      continue;
    }

    // Checked against what the agent *claimed*, before any clamping.
    //
    // Clamping first would launder the case this bound exists for. An agent that crashed with a
    // span open and resumed the next day sends one span running from yesterday to now; clamped to
    // the session it becomes a plausible nine-hour span, and the whole of today's session is
    // credited to whatever application happened to have focus when the crash happened. Rejecting
    // on the raw duration leaves a visible gap instead, which is the honest outcome — and it still
    // lets the ordinary straddle through, because that one is minutes long, not days.
    if (secondsBetween(startedAt, endedAt) > MAX_SPAN_SECONDS) {
      rejected.push({ spanId, reason: `Span exceeds the ${MAX_SPAN_SECONDS}s maximum.` });
      continue;
    }

    // Clamp rather than reject: a span that straddles the sign-in instant is normal (the agent was
    // already watching the desktop), and the part inside the session is real time worked.
    const clampedStart = new Date(Math.max(startedAt.getTime(), options.sessionStart.getTime()));
    const clampedEnd = new Date(
      Math.min(endedAt.getTime(), options.sessionEnd.getTime(), futureLimit.getTime()),
    );
    const durationSeconds = secondsBetween(clampedStart, clampedEnd);
    if (durationSeconds < MIN_SPAN_SECONDS) {
      rejected.push({ spanId, reason: 'Span falls outside the session window.' });
      continue;
    }

    const processKey = normalizeProcessKey(raw.processName);
    const idleSeconds = Math.min(
      durationSeconds,
      Math.max(0, Math.round(Number(raw.idleSeconds) || 0)),
    );

    spans.push({
      spanId,
      eventType: raw.eventType || 'APP_ACTIVE',
      processKey,
      processName: processKey || 'unknown',
      reportedApplicationName:
        typeof raw.applicationName === 'string' && raw.applicationName.trim()
          ? raw.applicationName.trim().slice(0, 80)
          : null,
      startedAt: clampedStart,
      endedAt: clampedEnd,
      durationSeconds,
      idleSeconds,
      recordedOffline: raw.recordedOffline === true,
      // §12: the policy decides, not the agent. An agent that sends a title under a policy that
      // forbids it has that title dropped here, before it is ever written.
      windowTitle: options.allowWindowTitles ? sanitizeWindowTitle(raw.windowTitle) : null,
      browserDomain: options.allowBrowserDomains ? extractBrowserDomain(raw.browserDomain) : null,
    });
  }

  spans.sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime());
  return { spans, rejected };
}

/**
 * Trim overlaps so a second of wall clock is counted once.
 *
 * Two foreground-change events can carry the same timestamp on a multi-monitor machine, and a
 * resumed-from-sleep agent can emit a span that starts before the one it already sent. Both
 * produce totals larger than the day. Where spans overlap, the later one is shortened — the
 * earlier span's end is evidence the application really did have focus until then.
 *
 * A span swallowed entirely by its predecessor is dropped, and its `idleSeconds` with it.
 */
export function resolveSpanOverlaps(spans: readonly NormalizedSpan[]): NormalizedSpan[] {
  const ordered = [...spans].sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime());
  const out: NormalizedSpan[] = [];
  let cursor = 0;

  for (const span of ordered) {
    const startMs = Math.max(span.startedAt.getTime(), cursor);
    if (span.endedAt.getTime() - startMs < MIN_SPAN_SECONDS * 1000) continue;

    const startedAt = startMs === span.startedAt.getTime() ? span.startedAt : new Date(startMs);
    const durationSeconds = secondsBetween(startedAt, span.endedAt);
    out.push({
      ...span,
      startedAt,
      durationSeconds,
      // Idle cannot exceed what is left of the span after trimming.
      idleSeconds: Math.min(span.idleSeconds, durationSeconds),
    });
    cursor = span.endedAt.getTime();
  }

  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Classification (§11)
 * ---------------------------------------------------------------------------------------------- */

/** The thresholds §11 makes configurable, in the shape the fold functions want them. */
export interface IdleThresholds {
  idleThresholdSeconds: number;
  extendedIdleThresholdSeconds: number;
}

/** Event types that mean the machine was not available to be worked on. */
const LOCKED_EVENT_TYPES = new Set(['LOCK', 'SLEEP']);

/**
 * The one label a span gets, for the timeline's colour and nothing else.
 *
 * Deliberately *not* what the totals are built from — see the header. A span is called idle only
 * when idleness was the majority of it, which is the reading that makes a timeline bar look like
 * what the person remembers of that stretch.
 */
export function dominantClassification(
  span: Pick<NormalizedSpan, 'eventType' | 'durationSeconds' | 'idleSeconds' | 'recordedOffline'>,
  thresholds: IdleThresholds,
): ActivityClassification {
  if (LOCKED_EVENT_TYPES.has(span.eventType)) return 'LOCKED';
  if (span.eventType === 'IDLE_START') return 'IDLE';
  const idle = span.idleSeconds;
  if (idle * 2 <= span.durationSeconds) return 'ACTIVE';
  if (idle >= thresholds.extendedIdleThresholdSeconds) return 'EXTENDED_IDLE';
  if (idle >= thresholds.idleThresholdSeconds) return 'IDLE';
  return 'ACTIVE';
}

/** What one span contributes to the running totals. */
export interface SpanContribution {
  totalSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  extendedIdleSeconds: number;
  lockedSeconds: number;
  offlineSeconds: number;
}

const EMPTY_CONTRIBUTION: SpanContribution = {
  totalSeconds: 0,
  activeSeconds: 0,
  idleSeconds: 0,
  extendedIdleSeconds: 0,
  lockedSeconds: 0,
  offlineSeconds: 0,
};

/**
 * Split one span's seconds across the buckets.
 *
 * Locked time is locked time in full — nobody was at the machine, and calling part of it active
 * because an application still held focus behind the lock screen would be a straightforward lie.
 * Otherwise the seconds with input are active, and the seconds without are idle or extended-idle
 * depending on how long the unbroken idle stretch ran.
 *
 * `offlineSeconds` is a *tag*, not a bucket: the same seconds are also counted as active or idle.
 * It answers "how much of this day did the agent record while it could not reach us", which is a
 * question about confidence in the data, not about how the time was spent.
 */
export function foldSpan(
  span: Pick<
    NormalizedSpan,
    'eventType' | 'durationSeconds' | 'idleSeconds' | 'recordedOffline'
  >,
  thresholds: IdleThresholds,
): SpanContribution {
  const duration = Math.max(0, span.durationSeconds);
  if (duration === 0) return EMPTY_CONTRIBUTION;
  const offlineSeconds = span.recordedOffline ? duration : 0;

  if (LOCKED_EVENT_TYPES.has(span.eventType)) {
    return { ...EMPTY_CONTRIBUTION, totalSeconds: duration, lockedSeconds: duration, offlineSeconds };
  }

  const idle = Math.min(duration, Math.max(0, span.idleSeconds));
  const active = duration - idle;
  const isExtended = idle >= thresholds.extendedIdleThresholdSeconds;

  return {
    totalSeconds: duration,
    activeSeconds: active,
    idleSeconds: isExtended ? 0 : idle,
    extendedIdleSeconds: isExtended ? idle : 0,
    lockedSeconds: 0,
    offlineSeconds,
  };
}

/** Sum the contributions of many spans. */
export function foldSpans(
  spans: readonly Pick<
    NormalizedSpan,
    'eventType' | 'durationSeconds' | 'idleSeconds' | 'recordedOffline'
  >[],
  thresholds: IdleThresholds,
): SpanContribution {
  return spans.reduce<SpanContribution>((totals, span) => {
    const contribution = foldSpan(span, thresholds);
    return {
      totalSeconds: totals.totalSeconds + contribution.totalSeconds,
      activeSeconds: totals.activeSeconds + contribution.activeSeconds,
      idleSeconds: totals.idleSeconds + contribution.idleSeconds,
      extendedIdleSeconds: totals.extendedIdleSeconds + contribution.extendedIdleSeconds,
      lockedSeconds: totals.lockedSeconds + contribution.lockedSeconds,
      offlineSeconds: totals.offlineSeconds + contribution.offlineSeconds,
    };
  }, EMPTY_CONTRIBUTION);
}

/* ------------------------------------------------------------------------------------------------
 * Per-application rollup (§9)
 * ---------------------------------------------------------------------------------------------- */

/** One application's slice of a batch, ready to merge into `windowsApplicationUsage`. */
export interface ApplicationUsageDelta {
  processKey: string;
  processName: string;
  applicationName: string;
  category: AppCategory;
  totalSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  firstSeenAt: IsoInstant;
  lastSeenAt: IsoInstant;
  focusCount: number;
}

/**
 * Group a batch by application.
 *
 * §9 is explicit that an application is not counted merely for being open, which is exactly what
 * falls out of only ever recording the foreground window. Locked time is excluded entirely: an
 * application holding focus behind a lock screen is not being used, and counting it is how "Excel:
 * 3h 12m" comes to include a lunch break.
 */
export function buildApplicationUsageDeltas(
  spans: readonly NormalizedSpan[],
  thresholds: IdleThresholds,
  categoryOf: (processKey: string) => AppCategory,
  displayNameOf?: (processKey: string, reported: string | null) => string,
): ApplicationUsageDelta[] {
  const byProcess = new Map<string, ApplicationUsageDelta>();

  for (const span of spans) {
    if (!span.processKey) continue;
    if (LOCKED_EVENT_TYPES.has(span.eventType)) continue;
    if (span.eventType !== 'APP_ACTIVE') continue;

    const contribution = foldSpan(span, thresholds);
    const existing = byProcess.get(span.processKey);
    const startedAtIso = span.startedAt.toISOString();
    const endedAtIso = span.endedAt.toISOString();

    if (existing) {
      existing.totalSeconds += contribution.totalSeconds;
      existing.activeSeconds += contribution.activeSeconds;
      existing.idleSeconds += contribution.idleSeconds + contribution.extendedIdleSeconds;
      existing.focusCount += 1;
      if (startedAtIso < existing.firstSeenAt) existing.firstSeenAt = startedAtIso;
      if (endedAtIso > existing.lastSeenAt) existing.lastSeenAt = endedAtIso;
      continue;
    }

    byProcess.set(span.processKey, {
      processKey: span.processKey,
      processName: span.processName,
      applicationName: displayNameOf
        ? displayNameOf(span.processKey, span.reportedApplicationName)
        : resolveApplicationName(span.processKey, span.reportedApplicationName),
      category: categoryOf(span.processKey),
      totalSeconds: contribution.totalSeconds,
      activeSeconds: contribution.activeSeconds,
      idleSeconds: contribution.idleSeconds + contribution.extendedIdleSeconds,
      firstSeenAt: startedAtIso,
      lastSeenAt: endedAtIso,
      focusCount: 1,
    });
  }

  return [...byProcess.values()].sort((left, right) => right.totalSeconds - left.totalSeconds);
}

/** One row of the §9 report: an application, its time, and its share of the day. */
export interface ApplicationBreakdownRow {
  processKey: string;
  applicationName: string;
  category: AppCategory;
  totalSeconds: number;
  activeSeconds: number;
  /** Share of the *active* total, 0–100, rounded to one decimal. */
  percentOfActive: number;
}

/**
 * The §9 table, including its "Others" row.
 *
 * The long tail of one-minute entries is folded into `Others` rather than printed, because a
 * hundred-row table of transient windows hides the six applications the day was actually spent in.
 * `topN` is the cut, and the folded row is labelled so nobody mistakes it for an application.
 */
export function buildApplicationBreakdown(
  usage: readonly Pick<
    WindowsApplicationUsage,
    'processKey' | 'applicationName' | 'category' | 'totalSeconds' | 'activeSeconds'
  >[],
  options: { topN?: number } = {},
): { rows: ApplicationBreakdownRow[]; totalActiveSeconds: number } {
  const merged = new Map<string, ApplicationBreakdownRow>();
  for (const entry of usage) {
    const existing = merged.get(entry.processKey);
    if (existing) {
      existing.totalSeconds += entry.totalSeconds;
      existing.activeSeconds += entry.activeSeconds;
      continue;
    }
    merged.set(entry.processKey, {
      processKey: entry.processKey,
      applicationName: entry.applicationName,
      category: entry.category,
      totalSeconds: entry.totalSeconds,
      activeSeconds: entry.activeSeconds,
      percentOfActive: 0,
    });
  }

  const sorted = [...merged.values()].sort((left, right) => right.activeSeconds - left.activeSeconds);
  const totalActiveSeconds = sorted.reduce((sum, row) => sum + row.activeSeconds, 0);
  const topN = options.topN ?? 8;

  const head = sorted.slice(0, topN);
  const tail = sorted.slice(topN);
  if (tail.length) {
    head.push({
      processKey: '__others__',
      applicationName: 'Others',
      category: 'UNCLASSIFIED',
      totalSeconds: tail.reduce((sum, row) => sum + row.totalSeconds, 0),
      activeSeconds: tail.reduce((sum, row) => sum + row.activeSeconds, 0),
      percentOfActive: 0,
    });
  }

  for (const row of head) {
    row.percentOfActive =
      totalActiveSeconds > 0
        ? Math.round((row.activeSeconds / totalActiveSeconds) * 1000) / 10
        : 0;
  }

  return { rows: head, totalActiveSeconds };
}

/** Fold per-application seconds up to §22's categories. */
export function summariseByCategory(
  usage: readonly { category: AppCategory; activeSeconds: number }[],
): Partial<Record<AppCategory, number>> {
  const out: Partial<Record<AppCategory, number>> = {};
  for (const entry of usage) {
    out[entry.category] = (out[entry.category] ?? 0) + entry.activeSeconds;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Timeline (§10)
 * ---------------------------------------------------------------------------------------------- */

export interface TimelineEntry {
  startedAt: IsoInstant;
  endedAt: IsoInstant;
  durationSeconds: number;
  classification: ActivityClassification;
  /** `Microsoft Excel`, `Idle`, `PC Locked`, `Login`. What the row prints. */
  label: string;
  processKey: string | null;
  category: AppCategory;
}

/**
 * Collapse the stored spans into the bars §10 draws.
 *
 * Adjacent spans of the same application and classification are merged — an hour in Excel that
 * Windows reported as forty separate focus events is one hour in Excel, and forty one-pixel bars
 * are unreadable. The merge only spans a gap of at most `mergeGapSeconds`, so a genuine excursion
 * into another window still breaks the bar.
 */
export function buildTimeline(
  events: readonly Pick<
    WindowsActivityEvent,
    | 'startedAt'
    | 'endedAt'
    | 'durationSeconds'
    | 'classification'
    | 'applicationName'
    | 'processName'
    | 'category'
    | 'eventType'
  >[],
  options: { mergeGapSeconds?: number } = {},
): TimelineEntry[] {
  const mergeGapMs = (options.mergeGapSeconds ?? 60) * 1000;
  const ordered = [...events].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const out: TimelineEntry[] = [];

  for (const event of ordered) {
    const label = timelineLabel(event);
    const processKey = normalizeProcessKey(event.processName) || null;
    const previous = out[out.length - 1];

    if (
      previous &&
      previous.label === label &&
      previous.classification === event.classification &&
      new Date(event.startedAt).getTime() - new Date(previous.endedAt).getTime() <= mergeGapMs
    ) {
      previous.endedAt = event.endedAt > previous.endedAt ? event.endedAt : previous.endedAt;
      previous.durationSeconds = secondsBetween(
        new Date(previous.startedAt),
        new Date(previous.endedAt),
      );
      continue;
    }

    out.push({
      startedAt: event.startedAt,
      endedAt: event.endedAt,
      durationSeconds: event.durationSeconds,
      classification: event.classification,
      label,
      processKey,
      category: event.category,
    });
  }

  return out;
}

function timelineLabel(
  event: Pick<
    WindowsActivityEvent,
    'classification' | 'applicationName' | 'processName' | 'eventType'
  >,
): string {
  switch (event.eventType) {
    case 'LOGIN':
      return 'Login';
    case 'LOGOUT':
      return 'Logout';
    case 'LOCK':
      return 'PC Locked';
    case 'UNLOCK':
      return 'PC Unlocked';
    case 'SLEEP':
      return 'PC Asleep';
    case 'RESUME':
      return 'PC Resumed';
    default:
      break;
  }
  if (event.classification === 'LOCKED') return 'PC Locked';
  if (event.classification === 'EXTENDED_IDLE') return 'Extended idle';
  if (event.classification === 'IDLE') return 'Idle';
  return event.applicationName || event.processName || 'Unknown application';
}

/* ------------------------------------------------------------------------------------------------
 * Presence and health (§16, §17, §47)
 * ---------------------------------------------------------------------------------------------- */

/**
 * What the live board should show for a device.
 *
 * Staleness wins over whatever the last heartbeat claimed: a PC that said `ACTIVE` and then went
 * quiet for ten minutes is offline, not active, and showing it as active is how a live board stops
 * being trusted. The grace is a multiple of the configured interval rather than a fixed number of
 * seconds, so raising the interval to save writes does not start showing everybody as offline.
 */
export function resolvePresence(
  lastHeartbeatAt: Date | null,
  reported: PresenceState | null,
  options: { heartbeatIntervalSeconds: number; now: Date; missedBeatsBeforeOffline?: number },
): PresenceState {
  if (!lastHeartbeatAt) return 'OFFLINE';
  const missed = options.missedBeatsBeforeOffline ?? 3;
  const staleAfterMs = options.heartbeatIntervalSeconds * missed * 1000;
  if (options.now.getTime() - lastHeartbeatAt.getTime() > staleAfterMs) return 'OFFLINE';
  return reported ?? 'ACTIVE';
}

/** Presence derived purely from how long the user has been away from the keyboard. */
export function presenceFromIdleSeconds(
  idleSeconds: number,
  thresholds: IdleThresholds,
  locked: boolean,
): PresenceState {
  if (locked) return 'LOCKED';
  if (idleSeconds >= thresholds.extendedIdleThresholdSeconds) return 'EXTENDED_IDLE';
  if (idleSeconds >= thresholds.idleThresholdSeconds) return 'IDLE';
  return 'ACTIVE';
}

/** The §47 warnings an administrator should see against a device. */
export type AgentHealthFlag =
  | 'NO_HEARTBEAT'
  | 'OUTDATED_VERSION'
  | 'SYNC_BACKLOG'
  | 'CLOCK_SKEW'
  | 'DEVICE_BLOCKED'
  | 'NEVER_REPORTED';

export interface AgentHealthInput {
  status: string;
  lastHeartbeatAt: Date | null;
  agentVersion: string | null;
  latestVersion: string | null;
  queuedSpanCount: number;
  clockSkewSeconds: number;
  heartbeatIntervalSeconds: number;
  now: Date;
}

/** Spans queued on a PC before the backlog is worth flagging (roughly a working day's worth). */
export const SYNC_BACKLOG_THRESHOLD = 500;

/** Clock difference, in seconds, past which a device's timestamps stop being trustworthy. */
export const CLOCK_SKEW_THRESHOLD_SECONDS = 120;

export function evaluateAgentHealth(input: AgentHealthInput): AgentHealthFlag[] {
  const flags: AgentHealthFlag[] = [];
  if (input.status === 'BLOCKED' || input.status === 'DISABLED') flags.push('DEVICE_BLOCKED');
  if (!input.lastHeartbeatAt) {
    flags.push('NEVER_REPORTED');
  } else if (
    resolvePresence(input.lastHeartbeatAt, null, {
      heartbeatIntervalSeconds: input.heartbeatIntervalSeconds,
      now: input.now,
    }) === 'OFFLINE'
  ) {
    flags.push('NO_HEARTBEAT');
  }
  if (
    input.latestVersion &&
    input.agentVersion &&
    compareVersions(input.agentVersion, input.latestVersion) < 0
  ) {
    flags.push('OUTDATED_VERSION');
  }
  if (input.queuedSpanCount >= SYNC_BACKLOG_THRESHOLD) flags.push('SYNC_BACKLOG');
  if (Math.abs(input.clockSkewSeconds) >= CLOCK_SKEW_THRESHOLD_SECONDS) flags.push('CLOCK_SKEW');
  return flags;
}

/**
 * Compare two dotted version strings numerically: -1, 0 or 1.
 *
 * String comparison would put `1.10.0` before `1.9.0`, which is the update that never ships.
 * Non-numeric suffixes are ignored rather than rejected, so `1.4.2-beta` compares as `1.4.2`.
 */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    String(value || '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

/* ------------------------------------------------------------------------------------------------
 * Sessions (§7, §28)
 * ---------------------------------------------------------------------------------------------- */

/** Whether a login should reuse today's open session rather than opening a second one (§7). */
export function shouldResumeSession(
  existing: { status: string; loginAt: string; workDate: IsoDate; deviceId: string; userId: string } | null,
  candidate: { workDate: IsoDate; deviceId: string; userId: string },
): boolean {
  if (!existing) return false;
  if (existing.status !== 'OPEN') return false;
  return (
    existing.userId === candidate.userId &&
    existing.deviceId === candidate.deviceId &&
    existing.workDate === candidate.workDate
  );
}

export interface UncleanEndEstimate {
  endedAt: IsoInstant;
  estimated: boolean;
  endReason: 'HEARTBEAT_TIMEOUT';
}

/**
 * Close a session whose agent stopped reporting.
 *
 * §28 is explicit: do not manufacture an exact logout time when there is no evidence for one. The
 * last heartbeat is the last moment the machine is *known* to have been in use, so that is the end
 * time, and `estimated` is set so every screen that shows it can say so. Falling back to `loginAt`
 * for a session that never beat at all is the same principle — it records zero, rather than
 * crediting hours nobody can evidence.
 */
export function estimateUncleanEnd(session: {
  loginAt: IsoInstant;
  lastHeartbeatAt: IsoInstant | null;
  lastActivityAt: IsoInstant | null;
}): UncleanEndEstimate {
  const candidates = [session.lastActivityAt, session.lastHeartbeatAt, session.loginAt]
    .map((value) => parseInstant(value))
    .filter((value): value is Date => value !== null);
  const latest = candidates.reduce<Date | null>(
    (best, value) => (best === null || value > best ? value : best),
    null,
  );
  return {
    endedAt: (latest ?? new Date(session.loginAt)).toISOString(),
    estimated: true,
    endReason: 'HEARTBEAT_TIMEOUT',
  };
}

/** Sessions still open after this much silence are reaped as `UNCLEAN_END`. */
export function isSessionAbandoned(
  session: { lastHeartbeatAt: IsoInstant | null; loginAt: IsoInstant },
  options: { heartbeatIntervalSeconds: number; now: Date; missedBeatsBeforeAbandoned?: number },
): boolean {
  const last = parseInstant(session.lastHeartbeatAt) ?? parseInstant(session.loginAt);
  if (!last) return true;
  const missed = options.missedBeatsBeforeAbandoned ?? 10;
  return options.now.getTime() - last.getTime() > options.heartbeatIntervalSeconds * missed * 1000;
}

export interface LateLoginVerdict {
  lateLogin: boolean;
  lateByMinutes: number;
}

/**
 * Whether a sign-in counts as late, and by how much.
 *
 * Read in the office timezone, not the device's, so a laptop left on UTC does not make its owner
 * five and a half hours late. Late is recorded and shown; it is never a reason to refuse a login —
 * blocking somebody out of their PC for arriving at 09:20 is not attendance, it is an outage.
 */
export function evaluateLateLogin(
  loginAt: Date,
  options: {
    workdayStart: string;
    lateLoginGraceMinutes: number;
    timeZone?: string;
  },
): LateLoginVerdict {
  const startMinutes = clockToMinutes(options.workdayStart);
  if (startMinutes === null) return { lateLogin: false, lateByMinutes: 0 };

  const { time } = utcToZonedParts(loginAt, options.timeZone ?? WINDOWS_AGENT_TIME_ZONE);
  const loginMinutes = clockToMinutes(time);
  if (loginMinutes === null) return { lateLogin: false, lateByMinutes: 0 };

  const grace = Math.max(0, Math.round(options.lateLoginGraceMinutes));
  const lateBy = loginMinutes - (startMinutes + grace);
  if (lateBy <= 0) return { lateLogin: false, lateByMinutes: 0 };
  return { lateLogin: true, lateByMinutes: lateBy };
}

/** §21's status column. Facts about the record, never a judgement about the person. */
export type AttendanceStatus =
  | 'Present'
  | 'Late'
  | 'Short Duration'
  | 'Incomplete Logout'
  | 'Offline Session';

/**
 * Classify one day's attendance row.
 *
 * Ordered so the most actionable fact wins: a session that never closed needs fixing before
 * anybody argues about whether it was short, and a day recorded entirely offline needs its source
 * understood before its duration is read at all.
 */
export function attendanceStatusOf(
  day: {
    sessionSeconds: number;
    offlineSeconds: number;
    lateLogin: boolean;
    hasUncleanSession: boolean;
  },
  options: { minimumFullDaySeconds?: number } = {},
): AttendanceStatus {
  if (day.hasUncleanSession) return 'Incomplete Logout';
  if (day.sessionSeconds > 0 && day.offlineSeconds >= day.sessionSeconds * 0.5) {
    return 'Offline Session';
  }
  const minimum = options.minimumFullDaySeconds ?? 8 * 60 * 60;
  if (day.sessionSeconds < minimum) return 'Short Duration';
  if (day.lateLogin) return 'Late';
  return 'Present';
}

/* ------------------------------------------------------------------------------------------------
 * Privacy filters (§12, §14)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Patterns redacted from a window title before it is stored, on the installations that enable
 * titles at all.
 *
 * Titles are the one place where a system that is deliberately not a keylogger can still end up
 * holding a secret: password managers put entry names in the title bar, and "Re: Q3 salary review —
 * Outlook" is personal information whatever the monitoring policy says. These are not exhaustive
 * and are not meant to be — the real protection is that titles are off by default.
 */
const TITLE_REDACTIONS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /[\w.+-]+@[\w-]+\.[\w.]+/g, replacement: '[email]' },
  { pattern: /\b(?:\d[ -]?){13,19}\b/g, replacement: '[number]' },
  { pattern: /\b(password|passwd|pwd|otp|token|secret|api[_-]?key)\b\s*[:=]?\s*\S+/gi, replacement: '$1 [redacted]' },
];

/** Trim, redact and truncate a window title. Returns null for anything empty after cleaning. */
export function sanitizeWindowTitle(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  let title = value.replace(/\s+/g, ' ').trim();
  if (!title) return null;
  for (const { pattern, replacement } of TITLE_REDACTIONS) {
    title = title.replace(pattern, replacement);
  }
  title = title.trim();
  if (!title) return null;
  return title.length > MAX_WINDOW_TITLE_LENGTH
    ? `${title.slice(0, MAX_WINDOW_TITLE_LENGTH - 1)}…`
    : title;
}

/**
 * The registrable host of a URL, and nothing else.
 *
 * §14 permits a domain and forbids the path, the query and the fragment — which is where the search
 * terms, the document ids and the session tokens are. Parsing and re-emitting only the host is what
 * makes that guarantee structural rather than a promise: there is no code path by which a query
 * string reaches storage, because the value is never carried past this function.
 */
export function extractBrowserDomain(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    // A bare label with no dot is a machine name on the LAN, not a website; keep it, it is useful.
    return host.slice(0, 120) || null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Retention (§51)
 * ---------------------------------------------------------------------------------------------- */

/** The cut-off date before which raw spans may be deleted. Rollups are never in scope. */
export function retentionCutoffDate(
  retentionDays: number,
  now: Date = new Date(),
  timeZone: string = WINDOWS_AGENT_TIME_ZONE,
): IsoDate {
  const days = Math.max(1, Math.round(retentionDays));
  return workDateOf(new Date(now.getTime() - days * 86_400_000), timeZone);
}
