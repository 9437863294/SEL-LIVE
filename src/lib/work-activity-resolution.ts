/**
 * The Activity Resolution Engine (§Y, §Z, §BE, §BF).
 *
 * Turns overlapping, contradictory signals from several sources into one non-overlapping
 * employee timeline, and answers the question the brief is actually about: an hour of "PC idle"
 * is not an hour of not working, and the system should say so.
 *
 * ── Why this is the important part ─────────────────────────────────────────────────────────────
 *
 * The Windows agent can already say "idle 11:30–12:30". On its own that is the same claim every
 * piece of monitoring software makes, and it is wrong often enough that managers learn to
 * discount it. Office Hub separately knows there was a Project Review from 11:30 to 12:15 that
 * this person checked in to. Nothing joined the two up. This does:
 *
 *     11:30–12:15   Meeting — Project Review        45m
 *     12:15–12:30   Unexplained idle                15m
 *
 * Same raw data, and now it means something.
 *
 * ── Pure, and deliberately so ──────────────────────────────────────────────────────────────────
 *
 * No Firestore, no clock, no I/O. Callers gather claims and hand them over. That is what makes
 * "what does the engine do when a call overlaps a meeting that overlaps a locked screen" a
 * question answerable by a test rather than by staging a day in the office — and it is why the
 * priority table below can be trusted, because every rule in it is pinned.
 */

/* ------------------------------------------------------------------------------------------------
 * Taxonomy (§P)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Every interval on a resolved timeline is exactly one of these.
 *
 * `UNEXPLAINED_IDLE` rather than `IDLE` is a deliberate choice of word (§BF). Idle is a fact
 * about a keyboard; unexplained is a statement about what the system knows, and it invites the
 * question "explained by what?" — which is the question that makes this useful. A day with two
 * hours of unexplained idle is a prompt to check whether meetings and calls are being recorded,
 * not a verdict on a person.
 */
export type WorkActivityCategory =
  | 'MEETING'
  | 'WORK_CALL'
  | 'FIELD_WORK'
  | 'ERP_ACTIVITY'
  | 'COMPUTER_APP'
  | 'WEBSITE'
  | 'BREAK'
  | 'PC_LOCKED'
  | 'UNEXPLAINED_IDLE'
  | 'OFFLINE';

export type WorkActivitySource =
  | 'WINDOWS'
  | 'BROWSER'
  | 'ERP'
  | 'ANDROID'
  | 'MEETING'
  | 'MANUAL';

/**
 * Lower wins (§Y).
 *
 * The order is not arbitrary and each step earns its place:
 *
 *  - A **confirmed meeting** beats everything because it is the strongest evidence that exists:
 *    somebody checked in, and a room full of people can corroborate it.
 *  - A **work call** beats desk activity because the desk is *expected* to look idle during one.
 *    This is the whole point of the Android half of the system.
 *  - **Field work** is a manual claim and sits below the two automatic ones, so a person cannot
 *    paper over a meeting they missed.
 *  - **ERP activity** beats generic application time because "approved a purchase request" is a
 *    more useful statement than "was in Chrome", and both are true at once.
 *  - **Website** sits below **application** so that browser time is not counted twice: the agent
 *    already records chrome.exe in the foreground, and the extension records the tab inside it.
 *  - **Break** beats **locked**, because an approved break explains the lock.
 *  - **Locked** beats **idle**, because a locked screen is a more specific fact than a still
 *    keyboard.
 *  - **Offline** is last: it means the agent could not report, which explains nothing by itself.
 */
export const CATEGORY_PRIORITY: Readonly<Record<WorkActivityCategory, number>> = Object.freeze({
  MEETING: 1,
  WORK_CALL: 2,
  FIELD_WORK: 3,
  ERP_ACTIVITY: 4,
  COMPUTER_APP: 5,
  WEBSITE: 6,
  BREAK: 7,
  PC_LOCKED: 8,
  UNEXPLAINED_IDLE: 9,
  OFFLINE: 10,
});

/* ------------------------------------------------------------------------------------------------
 * Input and output
 * ---------------------------------------------------------------------------------------------- */

/**
 * One source's claim about one stretch of time.
 *
 * Claims may overlap freely and contradict each other — that is the normal case, not an error.
 * Resolving them is this module's job.
 */
export interface ActivityClaim {
  source: WorkActivitySource;
  category: WorkActivityCategory;
  /** ISO-8601 instants. Inclusive start, exclusive end. */
  startAt: string;
  endAt: string;
  /** What the person was doing: a meeting subject, a contact, an application, a domain. */
  contextName?: string | null;
  /** The record this came from, so the timeline can link to it. */
  contextId?: string | null;
  /** A second line where one helps: a workbook name, a URL path. */
  detail?: string | null;
}

export interface ResolvedInterval {
  startAt: string;
  endAt: string;
  durationSeconds: number;
  category: WorkActivityCategory;
  source: WorkActivitySource | null;
  contextName: string | null;
  contextId: string | null;
  detail: string | null;
}

export interface ResolvedWorkday {
  intervals: ResolvedInterval[];
  /** Seconds per category. Every category present, so callers need no existence checks. */
  totals: Record<WorkActivityCategory, number>;
  /** First boundary to last, which is what "presence" means on a report. */
  presenceSeconds: number;
  /** Everything the engine had to throw away, so bad input is visible rather than silent. */
  rejected: RejectedClaim[];
}

export interface RejectedClaim {
  claim: ActivityClaim;
  reason: string;
}

export interface ResolveOptions {
  /**
   * The bounds of the working session, normally login to logout.
   *
   * Supplying them is what lets the engine account for time nothing claimed: a gap inside the
   * session becomes `UNEXPLAINED_IDLE`, and the buckets then sum to presence. Without them the
   * timeline still resolves, but it starts at the first claim and stops at the last, so a day
   * that began with twenty minutes of nothing simply looks twenty minutes shorter.
   */
  presenceStart?: string;
  presenceEnd?: string;

  /**
   * Intervals shorter than this are folded into their neighbour instead of being emitted.
   *
   * Without it, a day of alt-tabbing produces a timeline nobody can read: two hundred rows, most
   * of them four seconds long. Defaults to 30 seconds.
   */
  minIntervalSeconds?: number;
}

/* ------------------------------------------------------------------------------------------------
 * Resolution
 * ---------------------------------------------------------------------------------------------- */

const DEFAULT_MIN_INTERVAL_SECONDS = 30;

/**
 * Resolve many overlapping claims into one timeline.
 *
 * ── How ────────────────────────────────────────────────────────────────────────────────────────
 *
 * A sweep over every start and end in the input. Between two consecutive boundaries the set of
 * claims in force cannot change, so each of those slices has exactly one winner — the
 * highest-priority claim covering it. Adjacent slices with the same winner are then merged back
 * together.
 *
 * The alternative — walking claims in priority order and subtracting what earlier ones already
 * took — is the obvious approach and gets three-way overlaps wrong in ways that only show up as
 * totals that do not add up.
 */
export function resolveWorkday(
  claims: readonly ActivityClaim[],
  options: ResolveOptions = {},
): ResolvedWorkday {
  const minSeconds = Math.max(0, options.minIntervalSeconds ?? DEFAULT_MIN_INTERVAL_SECONDS);

  const rejected: RejectedClaim[] = [];
  const usable: Array<ActivityClaim & { start: number; end: number }> = [];

  for (const claim of claims) {
    const start = Date.parse(claim.startAt);
    const end = Date.parse(claim.endAt);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      rejected.push({ claim, reason: 'Unparseable start or end.' });
      continue;
    }
    if (end <= start) {
      // Zero-length and reversed claims are dropped rather than clamped: a claim that ends
      // before it starts is a bug at the source, and silently making it one second long would
      // hide that while still polluting the timeline.
      rejected.push({ claim, reason: 'End is not after start.' });
      continue;
    }
    if (!(claim.category in CATEGORY_PRIORITY)) {
      rejected.push({ claim, reason: 'Unknown category: ' + String(claim.category) });
      continue;
    }

    usable.push({ ...claim, start, end });
  }

  const presenceStart = parseBoundary(options.presenceStart);
  const presenceEnd = parseBoundary(options.presenceEnd);

  const boundaries = new Set<number>();
  for (const claim of usable) {
    boundaries.add(claim.start);
    boundaries.add(claim.end);
  }
  if (presenceStart !== null) boundaries.add(presenceStart);
  if (presenceEnd !== null) boundaries.add(presenceEnd);

  // Clip everything to the presence window when one was given. A meeting that ran past logout
  // is real, but it is not part of this session's timeline and would inflate presence.
  const lowerBound = presenceStart;
  const upperBound = presenceEnd;

  const ordered = [...boundaries]
    .filter((at) => (lowerBound === null || at >= lowerBound) && (upperBound === null || at <= upperBound))
    .sort((left, right) => left - right);

  if (ordered.length < 2) {
    return {
      intervals: [],
      totals: emptyTotals(),
      presenceSeconds: 0,
      rejected,
    };
  }

  type Slice = {
    start: number;
    end: number;
    winner: (ActivityClaim & { start: number; end: number }) | null;
  };

  const slices: Slice[] = [];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (end <= start) continue;

    let winner: (ActivityClaim & { start: number; end: number }) | null = null;
    let winnerPriority = Number.POSITIVE_INFINITY;

    for (const claim of usable) {
      if (claim.start > start || claim.end < end) continue;   // does not cover this slice
      const priority = CATEGORY_PRIORITY[claim.category];
      if (priority < winnerPriority) {
        winner = claim;
        winnerPriority = priority;
        continue;
      }
      // Same priority: the longer claim wins, so a two-hour meeting is not chopped up by a
      // shorter one of equal standing. Stable for equal lengths, which keeps output repeatable.
      if (priority === winnerPriority && winner !== null) {
        const incumbent = winner.end - winner.start;
        const challenger = claim.end - claim.start;
        if (challenger > incumbent) winner = claim;
      }
    }

    slices.push({ start, end, winner });
  }

  // Merge adjacent slices that say the same thing.
  const merged: Slice[] = [];
  for (const slice of slices) {
    const previous = merged[merged.length - 1];
    if (previous && previous.end === slice.start && sameActivity(previous.winner, slice.winner)) {
      previous.end = slice.end;
      continue;
    }
    merged.push({ ...slice });
  }

  // Fold away the slivers. Done after merging, so a genuine three-second gap between two spells
  // of the same application does not survive as a row of its own.
  const smoothed = foldShortIntervals(merged, minSeconds);

  const intervals: ResolvedInterval[] = smoothed.map((slice) => ({
    startAt: new Date(slice.start).toISOString(),
    endAt: new Date(slice.end).toISOString(),
    durationSeconds: Math.round((slice.end - slice.start) / 1000),
    // Nothing claimed it. Not "not working" — see the note on the category itself.
    category: slice.winner ? slice.winner.category : 'UNEXPLAINED_IDLE',
    source: slice.winner ? slice.winner.source : null,
    contextName: slice.winner?.contextName ?? null,
    contextId: slice.winner?.contextId ?? null,
    detail: slice.winner?.detail ?? null,
  }));

  const totals = emptyTotals();
  for (const interval of intervals) totals[interval.category] += interval.durationSeconds;

  return {
    intervals,
    totals,
    presenceSeconds: Math.round((ordered[ordered.length - 1] - ordered[0]) / 1000),
    rejected,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

function parseBoundary(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyTotals(): Record<WorkActivityCategory, number> {
  return {
    MEETING: 0,
    WORK_CALL: 0,
    FIELD_WORK: 0,
    ERP_ACTIVITY: 0,
    COMPUTER_APP: 0,
    WEBSITE: 0,
    BREAK: 0,
    PC_LOCKED: 0,
    UNEXPLAINED_IDLE: 0,
    OFFLINE: 0,
  };
}

/**
 * Whether two slices should read as one row.
 *
 * Category *and* context, so switching between two workbooks in Excel stays two rows — that
 * distinction is most of the value of document tracking — while two consecutive slices of the
 * same workbook merge.
 */
function sameActivity(
  left: (ActivityClaim & { start: number; end: number }) | null,
  right: (ActivityClaim & { start: number; end: number }) | null,
): boolean {
  if (left === null && right === null) return true;
  if (left === null || right === null) return false;
  return (
    left.category === right.category &&
    (left.contextId ?? null) === (right.contextId ?? null) &&
    (left.contextName ?? null) === (right.contextName ?? null) &&
    (left.detail ?? null) === (right.detail ?? null)
  );
}

/**
 * Give short intervals to the neighbour that best absorbs them.
 *
 * Extended into the *preceding* interval where there is one, because time is read forwards: a
 * four-second flicker of Explorer in the middle of an hour in Excel belongs to the Excel spell
 * that was already running, not to whatever came next.
 *
 * Never drops time. Whatever a sliver is worth is added to a neighbour, so the totals still sum
 * to presence — which is the property that makes the day's buckets trustworthy.
 */
function foldShortIntervals<T extends { start: number; end: number }>(
  slices: readonly T[],
  minSeconds: number,
): T[] {
  if (minSeconds <= 0 || slices.length === 0) return slices.map((slice) => ({ ...slice }));

  const out: T[] = [];
  for (const slice of slices) {
    const seconds = (slice.end - slice.start) / 1000;
    const previous = out[out.length - 1];

    if (seconds < minSeconds && previous) {
      previous.end = slice.end;
      continue;
    }
    out.push({ ...slice });
  }

  // A short *first* interval has no predecessor, so it goes to its successor instead. Without
  // this the opening sliver of a day survives as a row on its own.
  if (out.length > 1) {
    const first = out[0];
    if ((first.end - first.start) / 1000 < minSeconds) {
      out[1].start = first.start;
      out.shift();
    }
  }

  return out;
}

/**
 * Sum the categories that represent recorded work, as the daily summary reports it (§AN).
 *
 * Break, locked, unexplained idle and offline are deliberately excluded — and deliberately still
 * reported separately rather than hidden, because a summary that quietly folded a 45-minute
 * break into "work" would be worse than useless.
 */
export function recordedWorkSeconds(totals: Record<WorkActivityCategory, number>): number {
  return (
    totals.MEETING +
    totals.WORK_CALL +
    totals.FIELD_WORK +
    totals.ERP_ACTIVITY +
    totals.COMPUTER_APP +
    totals.WEBSITE
  );
}
