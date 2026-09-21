/**
 * Work calls and the work contact directory (§Q–§U, §AL).
 *
 * ── What this can honestly know, and what it cannot ────────────────────────────────────────────
 *
 * §T asks for call states "where OS permissions/API allow", and is explicit that where the
 * connected-call state is unavailable the system must represent what it has rather than
 * fabricate timing. That instruction decides the whole design, so it is worth being blunt about
 * why.
 *
 * The SEL LIVE Android application is the live web app in a Capacitor shell. It dials by handing
 * a `tel:` URL to the platform dialer, which needs no permission and works on every Android
 * version. What it gets in return is nothing: the web layer is not told when the call connects,
 * when it is answered, or when it ends. Observing that would need `READ_PHONE_STATE` and
 * `READ_CALL_LOG` — both restricted permissions, both limited by Play policy, and on Android 10
 * and later largely unavailable to an app that is not the default dialer.
 *
 * So this models what is actually observable:
 *
 *   DIALLED         the number was handed to the dialer. Certain.
 *   COMPLETED       the employee came back and confirmed it happened, and for how long.
 *   CANCELLED       the employee came back and said it did not happen.
 *   NOT_CONFIRMED   dialled, never confirmed. Deliberately worth nothing.
 *
 * There is no CONNECTED, because nothing here can see one.
 *
 * ── Why an unconfirmed call is worth zero ──────────────────────────────────────────────────────
 *
 * The tempting shortcut is to treat "dialled at 15:12, app reopened at 15:31" as nineteen
 * minutes of work call. It would fill the timeline nicely and it would be a guess: the person
 * may have been refused, left a voicemail, or put the phone down and gone to lunch. An
 * unconfirmed dial therefore produces no claim at all, and those nineteen minutes stay
 * unexplained idle — which is the honest answer and the one that prompts somebody to confirm
 * their calls.
 */

import type { WorkActivityCategory, ActivityClaim } from './work-activity-resolution.ts';

/* ------------------------------------------------------------------------------------------------
 * Collections
 * ---------------------------------------------------------------------------------------------- */

export const WORK_CALL_COLLECTIONS = {
  /** The shared directory: clients, site managers, vendors, consultants (§R). */
  contacts: 'workContacts',
  /** One document per dialled call. */
  calls: 'workCalls',
} as const;

/* ------------------------------------------------------------------------------------------------
 * Contacts (§R)
 * ---------------------------------------------------------------------------------------------- */

export type WorkContactType =
  | 'CLIENT'
  | 'SITE_MANAGER'
  | 'VENDOR'
  | 'CONTRACTOR'
  | 'EMPLOYEE'
  | 'CONSULTANT'
  | 'BANK'
  | 'GOVERNMENT'
  | 'OTHER';

export const WORK_CONTACT_TYPES: readonly WorkContactType[] = [
  'CLIENT',
  'SITE_MANAGER',
  'VENDOR',
  'CONTRACTOR',
  'EMPLOYEE',
  'CONSULTANT',
  'BANK',
  'GOVERNMENT',
  'OTHER',
];

export interface WorkContact {
  id: string;
  name: string;
  company: string | null;
  designation: string | null;
  /** Stored as entered and normalised separately, so a directory import is not lossy. */
  mobile: string;
  email: string | null;
  projectId: string | null;
  siteId: string | null;
  department: string | null;
  contactType: WorkContactType;

  /**
   * Digits only, for duplicate detection and lookup.
   *
   * The same site manager gets entered as "+91 98765 43210", "098765 43210" and
   * "9876543210" by three different people, and a directory that treats those as three
   * contacts is a directory nobody trusts.
   */
  mobileNormalized: string;

  /** An employee contact points back at the ERP user, so the two are not duplicated (§BQ). */
  userId: string | null;

  active: boolean;
  createdAt?: unknown;
  createdBy?: string | null;
  updatedAt?: unknown;
  updatedBy?: string | null;
}

/* ------------------------------------------------------------------------------------------------
 * Calls
 * ---------------------------------------------------------------------------------------------- */

export type WorkCallState = 'DIALLED' | 'COMPLETED' | 'CANCELLED' | 'NOT_CONFIRMED';

/**
 * Where a completed call's duration came from.
 *
 * Recorded because the two are not equally good, and a report that showed them identically
 * would be overstating what it knows. `RETURN_TO_APP` is the app noticing it became visible
 * again; `MANUAL` is the employee typing a duration.
 */
export type WorkCallDurationSource = 'RETURN_TO_APP' | 'MANUAL';

export interface WorkCall {
  id: string;
  userId: string;
  employeeId: string | null;

  contactId: string | null;
  /** Denormalised so the timeline and reports do not need a second read per row. */
  contactName: string;
  contactCompany: string | null;
  contactType: WorkContactType;

  projectId: string | null;
  projectName: string | null;
  siteId: string | null;
  purpose: string | null;

  state: WorkCallState;
  /** When the number was handed to the dialer. The one instant that is certain. */
  dialledAt: string;
  /**
   * The office-local date the call belongs to, stamped by `workDateOf` at creation.
   *
   * Carried as its own field rather than derived from `dialledAt` when queried, for the reason
   * `todayWorkDate` gives: in Asia/Kolkata a UTC range and a local day disagree for the five and
   * a half hours after midnight, so a call made at 02:00 would land in yesterday's report — which
   * is exactly when a night-shift supervisor would be looking at it.
   */
  workDate: string;
  /** When the employee confirmed. Null until they do. */
  endedAt: string | null;
  /** Null unless the call was confirmed — see the header. */
  durationSeconds: number | null;
  durationSource: WorkCallDurationSource | null;

  deviceInfo: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/* ------------------------------------------------------------------------------------------------
 * Rules
 * ---------------------------------------------------------------------------------------------- */

/** Longest call this will accept as confirmed. */
export const MAX_CALL_SECONDS = 4 * 60 * 60;

/** Below this a "call" is a misdial or a wrong number, and is not work. */
export const MIN_CALL_SECONDS = 5;

/**
 * Digits only, with an Indian country code removed so the same number matches itself.
 *
 * `+91 98765 43210`, `098765 43210` and `9876543210` all become `9876543210`. Numbers that are
 * not ten digits are left as their digits, because an extension or an international number is
 * still a number and refusing to store it would be worse than not matching it.
 */
export function normalizeMobile(value: string): string {
  const digits = String(value || '').replace(/\D+/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** Whether this looks dialable at all. Deliberately permissive — see `normalizeMobile`. */
export function isDialableMobile(value: string): boolean {
  return normalizeMobile(value).length >= 6;
}

export interface DurationOutcome {
  seconds: number | null;
  state: WorkCallState;
  reason: string | null;
}

/**
 * Work out a confirmed call's duration, and refuse the ones that make no sense.
 *
 * ── Why the ceiling ───────────────────────────────────────────────────────────────────────────
 *
 * The overwhelmingly common failure is not a fraudulent entry, it is somebody dialling at 15:12,
 * never reopening the app, and returning to it at nine the next morning. Left alone that is an
 * eighteen-hour work call, and it would sit at the top of every report. Anything past the
 * ceiling is treated as never confirmed, which leaves the time unexplained rather than absurd.
 */
export function resolveCallDuration(
  dialledAt: string,
  endedAt: string,
  explicitSeconds?: number | null,
): DurationOutcome {
  const start = Date.parse(dialledAt);
  const end = Date.parse(endedAt);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { seconds: null, state: 'NOT_CONFIRMED', reason: 'Unreadable call times.' };
  }

  const seconds = typeof explicitSeconds === 'number' && Number.isFinite(explicitSeconds)
    ? Math.round(explicitSeconds)
    : Math.round((end - start) / 1000);

  if (seconds < 0) {
    return { seconds: null, state: 'NOT_CONFIRMED', reason: 'The call ended before it started.' };
  }
  if (seconds < MIN_CALL_SECONDS) {
    return { seconds: null, state: 'CANCELLED', reason: 'Shorter than ' + MIN_CALL_SECONDS + ' seconds.' };
  }
  if (seconds > MAX_CALL_SECONDS) {
    return {
      seconds: null,
      state: 'NOT_CONFIRMED',
      reason: 'Longer than ' + MAX_CALL_SECONDS / 3600 + ' hours, so the app was probably reopened much later.',
    };
  }

  return { seconds, state: 'COMPLETED', reason: null };
}

/**
 * Turn calls into claims for the resolution engine (§U).
 *
 * Only confirmed calls with a duration produce a claim. A dial nobody confirmed contributes
 * nothing, so the desk time it overlapped stays unexplained rather than being quietly credited.
 */
export function callsToActivityClaims(calls: readonly WorkCall[]): ActivityClaim[] {
  const claims: ActivityClaim[] = [];

  for (const call of calls) {
    if (call.state !== 'COMPLETED') continue;
    if (typeof call.durationSeconds !== 'number' || call.durationSeconds <= 0) continue;

    const start = Date.parse(call.dialledAt);
    if (!Number.isFinite(start)) continue;

    // Derived from the duration rather than trusting endedAt, so the claim can never disagree
    // with the number the reports add up.
    const end = start + call.durationSeconds * 1000;

    claims.push({
      source: 'ANDROID',
      category: 'WORK_CALL' as WorkActivityCategory,
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
      contextName: call.contactCompany ? call.contactName + ' — ' + call.contactCompany : call.contactName,
      contextId: call.id,
      detail: call.purpose ?? null,
    });
  }

  return claims;
}

/** One row of §AL's report. */
export interface CallsByType {
  contactType: WorkContactType;
  calls: number;
  seconds: number;
}

/**
 * Group confirmed calls by who they were to.
 *
 * Unconfirmed calls are counted in `dialled` but contribute no time, so a report can say "seven
 * dialled, five confirmed, 1h 14m" instead of implying the two unconfirmed ones were silent.
 */
export function summarizeCalls(calls: readonly WorkCall[]): {
  dialled: number;
  confirmed: number;
  totalSeconds: number;
  byType: CallsByType[];
} {
  const byType = new Map<WorkContactType, CallsByType>();
  let confirmed = 0;
  let totalSeconds = 0;

  for (const call of calls) {
    if (call.state !== 'COMPLETED' || typeof call.durationSeconds !== 'number') continue;
    confirmed += 1;
    totalSeconds += call.durationSeconds;

    const row = byType.get(call.contactType) ?? { contactType: call.contactType, calls: 0, seconds: 0 };
    row.calls += 1;
    row.seconds += call.durationSeconds;
    byType.set(call.contactType, row);
  }

  return {
    dialled: calls.length,
    confirmed,
    totalSeconds,
    byType: [...byType.values()].sort((left, right) => right.seconds - left.seconds),
  };
}
