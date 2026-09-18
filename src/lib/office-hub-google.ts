/**
 * Office Hub — Google Meet, the pure half.
 *
 * Google Meet is the module's *only* conferencing platform (the platform picker offers nothing
 * else), and Office Hub creates the Meet itself rather than asking the organizer to paste a link.
 *
 * ── How a Meet link actually gets made ─────────────────────────────────────────────────────────
 *
 * There is no "create a Meet" endpoint worth using here. A Meet link is a property of a Google
 * Calendar event: you insert an event with `conferenceData.createRequest` and
 * `conferenceSolutionKey.type = 'hangoutsMeet'`, pass `conferenceDataVersion=1`, and Google mints
 * the conference and returns it as `hangoutLink`. That is the path this module builds, and it is
 * also why the meeting lands on participants' Google Calendars — the two are the same operation,
 * not two features.
 *
 * ── Two things about that which are worth knowing before reading on ────────────────────────────
 *
 * 1. **Google will also collect RSVPs, and Office Hub does not read them.** The event carries
 *    attendees, so Google Calendar shows every participant Yes/No/Maybe buttons alongside the ones
 *    in Office Hub. Office Hub's `officeHubParticipants.response` stays authoritative: it is what
 *    the attendance sheet, the response summary and the chaser notifications all read. A participant
 *    who answers in Google Calendar has, as far as this application is concerned, not answered.
 *    `googleSendUpdates: 'none'` in settings suppresses Google's invitation emails and takes most of
 *    the confusion away while keeping the calendar entry; it is a setting rather than a default
 *    because which of the two is less confusing depends on how an office already works.
 *
 * 2. **A recurring series is one Google event, not one per occurrence.** Office Hub materialises a
 *    series into N Firestore meetings; syncing each would put N separate events on everyone's
 *    calendar. So the series *parent* owns a single event carrying the RRULE, and the instances
 *    inherit its `googleMeetUrl` without making an API call. `googleSyncPlan` is where that is
 *    decided, and it is the reason the nightly series top-up needs no Google credentials at all —
 *    which matters, because per-user OAuth has none to offer when nobody is signed in.
 *
 * Everything here is pure: URL building, request-body shaping, response reading and error
 * classification. The network, the token store and the cryptography live in
 * `office-hub-google-server.ts`, so all of the below is tested directly under `node --test`.
 */

import type { OfficeHubMeeting, OnlineMeetingPlatform } from './office-hub-model.ts';
import { recurrenceRuleFor } from './office-hub-integrations.ts';

/* ── the platform ────────────────────────────────────────────────────────────────────────────── */

/**
 * The only platform Office Hub offers.
 *
 * `OnlineMeetingPlatform` in the model stays a five-member union on purpose: meetings created before
 * this integration may hold `'Zoom'`, and a stored record has to keep rendering. What changed is
 * what a *new* meeting may be — see `SELECTABLE_MEETING_PLATFORMS` in the model.
 */
export const OFFICE_HUB_MEETING_PLATFORM: OnlineMeetingPlatform = 'Google Meet';

/* ── OAuth ───────────────────────────────────────────────────────────────────────────────────── */

export const GOOGLE_OAUTH_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_OAUTH_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

/**
 * The scopes requested, and the ones deliberately not.
 *
 * `calendar.events` is enough to insert, patch and delete events — including minting a conference —
 * on the calendars the user can already write to. The broader `calendar` scope would additionally
 * grant calendar creation, sharing and ACL changes, none of which this module does, so asking for
 * it would be asking the user to trust the application with more than it needs.
 *
 * `openid` and `email` are there so the callback can record *which* Google account was connected.
 * Without it the connection card can only say "connected", and an organizer who authorised a
 * personal Gmail account instead of their work one has no way to notice.
 */
export const GOOGLE_MEET_SCOPES: readonly string[] = [
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
] as const;

export interface GoogleOAuthConfig {
  clientId: string;
  redirectUri: string;
}

/**
 * The consent URL to send an organizer to.
 *
 * Three parameters carry the weight:
 *
 *   • `access_type=offline` is what makes Google return a **refresh token**. Without it the
 *     application gets an hour of access and then silently stops being able to create Meet links.
 *   • `prompt=consent` forces the consent screen every time. Google only returns a refresh token on
 *     a consent grant, and a user who has authorised before would otherwise get a code that
 *     exchanges into an access token with no refresh token — a connection that works until the
 *     first token expiry and then fails in a way that looks random.
 *   • `include_granted_scopes=true` so re-authorising for a new scope does not silently drop scopes
 *     the user has already granted elsewhere in the application.
 *
 * `login_hint` is the user's Office Hub email. It only preselects an account on the chooser; it does
 * not restrict anything, and the user can still pick a different one — which is why the callback
 * records what they actually chose.
 */
export function buildGoogleAuthUrl(
  config: GoogleOAuthConfig,
  options: { state: string; loginHint?: string | null; scopes?: readonly string[] },
): string {
  const url = new URL(GOOGLE_OAUTH_AUTH_ENDPOINT);
  const params = url.searchParams;

  params.set('client_id', config.clientId);
  params.set('redirect_uri', config.redirectUri);
  params.set('response_type', 'code');
  params.set('scope', (options.scopes ?? GOOGLE_MEET_SCOPES).join(' '));
  params.set('access_type', 'offline');
  params.set('prompt', 'consent');
  params.set('include_granted_scopes', 'true');
  params.set('state', options.state);
  if (options.loginHint?.trim()) params.set('login_hint', options.loginHint.trim());

  return url.toString();
}

/** The form body for exchanging an authorization code. `URLSearchParams`-ready, not a URL. */
export function authorizationCodeBody(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Record<string, string> {
  return {
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  };
}

/** The form body for refreshing an access token. */
export function refreshTokenBody(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Record<string, string> {
  return {
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
  };
}

/* ── OAuth state ─────────────────────────────────────────────────────────────────────────────── */

export interface GoogleOAuthState {
  /** The Office Hub user the connection will belong to. */
  userId: string;
  /** Where to send the browser once the exchange is done. Same-origin path only. */
  returnTo: string;
  /** Millisecond timestamp, so a state parameter cannot be replayed indefinitely. */
  issuedAt: number;
}

/** How long a consent round-trip may take before its state is refused. */
export const GOOGLE_OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

/**
 * Pack the state parameter's payload.
 *
 * The payload alone is not trustworthy — anybody can write one — so the server HMACs it before use
 * and verifies the signature in the callback. That check is what makes this a CSRF defence rather
 * than a convenience: without it, an attacker could hand a victim a callback URL carrying *their*
 * code and the victim's `userId`, and have the victim's Office Hub account bound to the attacker's
 * Google account. The signing lives in `office-hub-google-server.ts` because it needs a secret.
 *
 * Base64url, because a state parameter travels in a query string and through Google's redirect.
 */
export function packGoogleOAuthState(state: GoogleOAuthState): string {
  return base64UrlEncode(JSON.stringify(state));
}

export function unpackGoogleOAuthState(payload: string): GoogleOAuthState | null {
  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as Partial<GoogleOAuthState>;
    if (!parsed || typeof parsed.userId !== 'string' || !parsed.userId) return null;
    if (typeof parsed.issuedAt !== 'number' || !Number.isFinite(parsed.issuedAt)) return null;
    return {
      userId: parsed.userId,
      returnTo: typeof parsed.returnTo === 'string' ? parsed.returnTo : '/office-hub/settings',
      issuedAt: parsed.issuedAt,
    };
  } catch {
    return null;
  }
}

export function googleOAuthStateExpired(state: GoogleOAuthState, now: Date = new Date()): boolean {
  const age = now.getTime() - state.issuedAt;
  // A negative age means a clock skew between the signer and the verifier, not a valid state.
  return age < -60_000 || age > GOOGLE_OAUTH_STATE_TTL_MS;
}

/**
 * Where the callback may send the browser.
 *
 * An open redirect in an OAuth callback is a real vulnerability — the URL is one a user is trained
 * to click and it arrives carrying a code — so only in-application paths are honoured and anything
 * else falls back to Settings. Rejecting `//host` matters as much as rejecting `https://host`:
 * a protocol-relative URL is an absolute one to a browser.
 */
export function safeReturnTo(candidate: string | null | undefined, fallback = '/office-hub/settings'): string {
  const value = (candidate ?? '').trim();
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (value.includes('\\') || /[\r\n]/.test(value)) return fallback;
  return value;
}

/* ── the stored connection ───────────────────────────────────────────────────────────────────── */

export type GoogleConnectionHealth = 'connected' | 'disconnected' | 'reauth-required';

/**
 * What the client is allowed to know about a connection.
 *
 * Note what is absent: the refresh token, the access token and the encryption envelope. A redacted
 * view exists so that shaping it is a deliberate act rather than a `delete` somebody forgets — the
 * API route builds this and cannot accidentally serialise the stored document.
 */
export interface GoogleConnectionView {
  connected: boolean;
  health: GoogleConnectionHealth;
  /** The Google account that was authorised, so a wrong one is visible. */
  googleEmail: string | null;
  connectedAt: string | null;
  lastUsedAt: string | null;
  /** Set when Google has rejected the stored grant and the user must authorise again. */
  reauthReason: string | null;
  /** Scopes actually granted, which can be narrower than those requested. */
  scopes: string[];
}

export const DISCONNECTED_GOOGLE_CONNECTION: GoogleConnectionView = {
  connected: false,
  health: 'disconnected',
  googleEmail: null,
  connectedAt: null,
  lastUsedAt: null,
  reauthReason: null,
  scopes: [],
};

/** Whether a granted scope set can still create events. A narrowed grant is worse than none. */
export function grantCoversMeetCreation(scopes: readonly string[]): boolean {
  return scopes.some(
    (scope) =>
      scope === 'https://www.googleapis.com/auth/calendar.events' ||
      scope === 'https://www.googleapis.com/auth/calendar',
  );
}

/**
 * Classify a stored connection.
 *
 * `reauth-required` is separated from `disconnected` because the two need different words on the
 * screen: one is "connect your Google account", the other is "Google stopped accepting the
 * connection you already made", which happens when a user revokes access, changes their password
 * or has not used it for six months.
 */
export function googleConnectionHealth(
  connection: { refreshTokenPresent: boolean; reauthReason?: string | null; scopes?: readonly string[] } | null,
): GoogleConnectionHealth {
  if (!connection || !connection.refreshTokenPresent) return 'disconnected';
  if (connection.reauthReason) return 'reauth-required';
  if (connection.scopes && connection.scopes.length && !grantCoversMeetCreation(connection.scopes)) {
    return 'reauth-required';
  }
  return 'connected';
}

/* ── which meetings sync, and how ────────────────────────────────────────────────────────────── */

export type GoogleSyncState = 'not-synced' | 'synced' | 'inherited' | 'failed' | 'skipped';

export type GoogleSyncAction =
  /** Insert a new Google event and mint a conference. */
  | 'create'
  /** Patch the existing event in place, keeping the same Meet link. */
  | 'update'
  /** Delete the event, which retracts it from participants' calendars. */
  | 'cancel'
  /** Copy the series parent's link rather than calling Google. */
  | 'inherit'
  /** Nothing to do, for a stated reason. */
  | 'none';

export interface GoogleSyncPlan {
  action: GoogleSyncAction;
  reason: string;
  /** For `inherit`: the meeting to copy the conference from. */
  inheritFromMeetingId?: string | null;
}

type SyncCandidate = Pick<OfficeHubMeeting, 'id' | 'mode' | 'status'> &
  Partial<Pick<OfficeHubMeeting, 'seriesId' | 'isSeriesParent' | 'onlinePlatform'>> & {
    googleEventId?: string | null;
  };

/**
 * Decide what, if anything, to do with Google for one meeting.
 *
 * Every caller — the create path, the edit path, the cancel path and the API route — asks this
 * rather than deciding for itself, because the interesting cases are the ones easy to get wrong:
 * an offline meeting has no conference, a draft is not yet real, and a series instance must not mint
 * its own.
 */
export function googleSyncPlan(
  meeting: SyncCandidate,
  intent: 'save' | 'cancel' = 'save',
): GoogleSyncPlan {
  const hasEvent = Boolean(meeting.googleEventId);

  if (intent === 'cancel') {
    return hasEvent
      ? { action: 'cancel', reason: 'Removing the event retracts it from participants’ calendars.' }
      : { action: 'none', reason: 'No Google event was created for this meeting.' };
  }

  if (meeting.status === 'Cancelled') {
    return hasEvent
      ? { action: 'cancel', reason: 'The meeting is cancelled, so its calendar event is removed.' }
      : { action: 'none', reason: 'The meeting is cancelled.' };
  }

  if (meeting.mode === 'Offline') {
    return hasEvent
      ? { action: 'cancel', reason: 'The meeting is no longer online, so its Meet link is withdrawn.' }
      : { action: 'none', reason: 'An in-person meeting has no conference.' };
  }

  if (meeting.status === 'Draft') {
    return { action: 'none', reason: 'A draft is not on anybody’s calendar until it is sent.' };
  }

  /**
   * A meeting on another platform is left entirely alone.
   *
   * This guard is load-bearing rather than defensive. A meeting created before Office Hub
   * standardised on Meet may hold `onlinePlatform: 'Zoom'` and a pasted Zoom link; without this,
   * merely editing its title would mint a Google event and overwrite `meetingUrl` with a Meet link
   * the organizer never asked for — silently breaking a join link participants already hold.
   *
   * A null platform is treated as Google Meet: that is what a new meeting gets, and a legacy record
   * with no platform at all has no other link to protect.
   */
  if (meeting.onlinePlatform && meeting.onlinePlatform !== 'Google Meet') {
    return {
      action: 'none',
      reason: `This meeting uses ${meeting.onlinePlatform}, so Office Hub leaves its link alone.`,
    };
  }

  // It has happened. Its event is a record of a past meeting, and patching it would rewrite
  // history on everybody's calendar; minting a new one would invite people to something over.
  if (meeting.status === 'Completed') {
    return { action: 'none', reason: 'The meeting has finished.' };
  }

  // A series instance that is not the parent: the parent's event carries the RRULE and Google has
  // already put every occurrence on the attendees' calendars. Minting one per instance would show
  // the same meeting twice and hand out a different link each time.
  const isSeriesChild = Boolean(meeting.seriesId) && !meeting.isSeriesParent;
  if (isSeriesChild) {
    return hasEvent
      ? { action: 'update', reason: 'This occurrence has its own event, from a single-occurrence edit.' }
      : {
          action: 'inherit',
          reason: 'The series shares one Google event and one Meet link.',
          inheritFromMeetingId: meeting.seriesId ?? null,
        };
  }

  if (hasEvent) {
    return { action: 'update', reason: 'Updating the existing event keeps the Meet link people already have.' };
  }

  /**
   * A *new* conference is only minted for a meeting that is going to happen.
   *
   * `Postponed` is the case this excludes: the record keeps its old date until somebody reschedules
   * it, so creating an event now would put the meeting on everybody's calendar at a time it is
   * explicitly not happening. An event it already has is still patched and cancelled above — this
   * governs creation only.
   */
  if (meeting.status === 'Scheduled' || meeting.status === 'In Progress') {
    return { action: 'create', reason: 'Creating the event mints the Meet link.' };
  }

  return { action: 'none', reason: `A ${meeting.status.toLowerCase()} meeting does not get a new Meet link.` };
}

/* ── the event body ──────────────────────────────────────────────────────────────────────────── */

export interface GoogleEventAttendee {
  email: string;
  displayName?: string | null;
  optional?: boolean;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
}

export interface GoogleCalendarEventBody {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees?: GoogleEventAttendee[];
  conferenceData?: {
    createRequest: {
      requestId: string;
      conferenceSolutionKey: { type: 'hangoutsMeet' };
    };
  };
  recurrence?: string[];
  reminders?: { useDefault: boolean; overrides?: { method: 'email' | 'popup'; minutes: number }[] };
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  extendedProperties?: { private?: Record<string, string> };
  source?: { title: string; url: string };
  status?: 'confirmed' | 'cancelled' | 'tentative';
  transparency?: 'opaque' | 'transparent';
}

/**
 * The `conferenceData.createRequest.requestId`, derived from the meeting id.
 *
 * Deterministic on purpose. Google's contract is that repeating an insert with the same
 * `requestId` against the same event returns the conference it already made rather than making a
 * second one, so a retried request — a timeout, a double-click, a cron re-run — cannot leave a
 * meeting with two Meet links where participants hold whichever one their invitation happened to
 * carry. The same property is why `office-hub-service.ts` can retry a failed sync without checking
 * anything first.
 */
export function conferenceRequestId(meetingId: string): string {
  // Google accepts up to 64 characters; Firestore ids are 20, so the prefix is free. Restricted to
  // the characters Google documents as safe rather than trusting an id generator's alphabet.
  return `officehub-${meetingId}`.replace(/[^A-Za-z0-9\-_]/g, '-').slice(0, 64);
}

export interface GoogleEventInput {
  meeting: Pick<
    OfficeHubMeeting,
    'id' | 'title' | 'startAt' | 'endAt' | 'timeZone' | 'mode' | 'status'
  > &
    Partial<
      Pick<
        OfficeHubMeeting,
        | 'description'
        | 'location'
        | 'room'
        | 'address'
        | 'recurrence'
        | 'reminderOffsets'
        | 'meetingType'
        | 'isSeriesParent'
      >
    > & {
      /** A meeting has no reference number of its own; a caller may pass a related one. */
      reference?: string | null;
    };
  attendees: readonly { email?: string | null; name?: string | null; attendanceRole?: string | null }[];
  /** Absolute URL of the meeting in Office Hub, added so the event points back here. */
  meetingUrl?: string | null;
  /** Omitted when patching an event that already has a conference. */
  requestConference?: boolean;
  guestsCanInviteOthers?: boolean;
}

export interface GoogleEventBuildResult {
  body: GoogleCalendarEventBody;
  /** Participants left off the event, and why — surfaced, never swallowed. */
  warnings: string[];
  attendeeCount: number;
}

/**
 * Build the `events.insert` / `events.patch` body for a meeting.
 *
 * ── On the timestamps ──────────────────────────────────────────────────────────────────────────
 *
 * `startAt`/`endAt` are the instants `meetingInstants` derived from the meeting's wall clock and
 * zone, so they already carry a `Z` offset and are unambiguous. `timeZone` is still sent alongside
 * them, and is not redundant: for a recurring event Google expands the RRULE in that zone, which is
 * what makes "every Monday at 09:30" stay at 09:30 across a DST change rather than drifting by an
 * hour. Sending the instant without the zone is the classic way to get a series that is correct for
 * three weeks.
 */
export function buildGoogleEventBody(input: GoogleEventInput): GoogleEventBuildResult {
  const { meeting } = input;
  const warnings: string[] = [];
  const timeZone = meeting.timeZone || 'Asia/Kolkata';

  const { attendees, warnings: attendeeWarnings } = googleAttendeesFrom(input.attendees);
  warnings.push(...attendeeWarnings);

  const body: GoogleCalendarEventBody = {
    summary: meeting.title,
    start: { dateTime: meeting.startAt, timeZone },
    end: { dateTime: meeting.endAt, timeZone },
    // Office Hub owns the guest list. Letting attendees add their own would put people in the Meet
    // who are not participants here, so attendance and the response summary would both be wrong.
    guestsCanModify: false,
    guestsCanInviteOthers: input.guestsCanInviteOthers ?? false,
    status: 'confirmed',
  };

  const description = googleEventDescription(input);
  if (description) body.description = description;

  const place = [meeting.room, meeting.location, meeting.address].map((part) => part?.trim()).filter(Boolean);
  if (place.length) body.location = place.join(', ');

  if (attendees.length) body.attendees = attendees;

  if (input.requestConference !== false) {
    body.conferenceData = {
      createRequest: {
        requestId: conferenceRequestId(meeting.id),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  // Only the series parent carries the rule — see `googleSyncPlan`.
  if (meeting.isSeriesParent !== false) {
    const rule = recurrenceRuleFor(meeting.recurrence ?? null);
    if (rule) body.recurrence = [`RRULE:${rule}`];
  }

  const offsets = (meeting.reminderOffsets ?? []).filter(
    (offset): offset is number => typeof offset === 'number' && offset > 0 && offset <= 40_320,
  );
  if (offsets.length) {
    // Google's own popup reminders, mirroring Office Hub's offsets. Office Hub still sends its
    // notifications — a reminder that depends on the user having Google Calendar open is not a
    // reminder — so these are a second, independent nudge rather than the mechanism.
    body.reminders = {
      useDefault: false,
      overrides: offsets.slice(0, 5).map((minutes) => ({ method: 'popup' as const, minutes })),
    };
  }

  // Written so an event found in Google Calendar can be traced back to the meeting that made it,
  // and so a future reconciliation pass can find Office Hub's events without guessing.
  body.extendedProperties = {
    private: {
      officeHubMeetingId: meeting.id,
      ...(meeting.reference ? { officeHubReference: meeting.reference } : {}),
      ...(meeting.meetingType ? { officeHubMeetingType: meeting.meetingType } : {}),
    },
  };

  if (input.meetingUrl) {
    body.source = { title: 'Open in Office Hub', url: input.meetingUrl };
  }

  return { body, warnings, attendeeCount: attendees.length };
}

/**
 * Turn Office Hub participants into Calendar attendees.
 *
 * Participants with no email address are dropped, because Google has no other way to identify a
 * person — and the fact is returned as a warning rather than logged, so the organizer is told which
 * of their colleagues will not get a calendar entry. Silently omitting them is how somebody misses
 * a meeting.
 */
export function googleAttendeesFrom(
  participants: readonly { email?: string | null; name?: string | null; attendanceRole?: string | null }[],
): { attendees: GoogleEventAttendee[]; warnings: string[] } {
  const attendees: GoogleEventAttendee[] = [];
  const seen = new Set<string>();
  const missing: string[] = [];

  for (const participant of participants) {
    const email = (participant.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      missing.push((participant.name ?? '').trim() || 'an unnamed participant');
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    attendees.push({
      email,
      displayName: (participant.name ?? '').trim() || undefined,
      optional: participant.attendanceRole === 'Optional',
      responseStatus: 'needsAction',
    });
  }

  const warnings: string[] = [];
  if (missing.length) {
    const names = missing.slice(0, 5).join(', ');
    const rest = missing.length > 5 ? ` and ${missing.length - 5} more` : '';
    warnings.push(
      `No Google Calendar invitation for ${names}${rest} — no email address on record. ` +
        'They still have the Office Hub invitation and the Meet link.',
    );
  }
  // Google rejects an event over 500 attendees outright, which would fail the whole sync.
  if (attendees.length > GOOGLE_MAX_ATTENDEES) {
    warnings.push(
      `Google Calendar allows ${GOOGLE_MAX_ATTENDEES} attendees on one event; ` +
        `${attendees.length - GOOGLE_MAX_ATTENDEES} were left off the calendar entry but keep their ` +
        'Office Hub invitation.',
    );
    attendees.length = GOOGLE_MAX_ATTENDEES;
  }

  return { attendees, warnings };
}

export const GOOGLE_MAX_ATTENDEES = 500;

/** The event description: the meeting's own text, then a line back to Office Hub. */
export function googleEventDescription(input: GoogleEventInput): string {
  const parts: string[] = [];
  const text = (input.meeting.description ?? '').trim();
  if (text) parts.push(text);
  if (input.meeting.reference) parts.push(`Reference: ${input.meeting.reference}`);
  if (input.meetingUrl) parts.push(`Agenda, minutes and attendance: ${input.meetingUrl}`);
  parts.push('Created by Office Hub. Respond in Office Hub so attendance is recorded.');
  return parts.join('\n\n');
}

/* ── reading the response ────────────────────────────────────────────────────────────────────── */

export interface GoogleCalendarEventResponse {
  id?: string;
  htmlLink?: string;
  hangoutLink?: string;
  status?: string;
  conferenceData?: {
    conferenceId?: string;
    entryPoints?: {
      entryPointType?: string;
      uri?: string;
      label?: string;
      pin?: string;
      accessCode?: string;
      passcode?: string;
      meetingCode?: string;
    }[];
    createRequest?: { status?: { statusCode?: string }; requestId?: string };
    conferenceSolution?: { key?: { type?: string }; name?: string };
  };
}

export interface GoogleConferenceResult {
  eventId: string | null;
  joinUrl: string | null;
  htmlLink: string | null;
  /** The dial-in PIN, when Google provided phone entry. Stored as the meeting's passcode. */
  phonePin: string | null;
  phoneNumber: string | null;
  /** `success`, `pending` or `failure` as Google reports it. */
  conferenceStatus: 'success' | 'pending' | 'failure' | 'none';
}

/**
 * Pull the parts Office Hub stores out of an event response.
 *
 * `hangoutLink` is checked first because it is the field Google fills for a Meet conference and the
 * one that keeps working; the `entryPoints` walk is the documented general form and covers the case
 * where `hangoutLink` is absent. A `pending` conference is a real state — Google occasionally
 * returns the event before the conference is provisioned — and is reported rather than treated as
 * a missing link, so the caller can re-read instead of concluding the sync failed.
 */
export function readGoogleConference(event: GoogleCalendarEventResponse | null | undefined): GoogleConferenceResult {
  if (!event) {
    return { eventId: null, joinUrl: null, htmlLink: null, phonePin: null, phoneNumber: null, conferenceStatus: 'none' };
  }

  const entryPoints = event.conferenceData?.entryPoints ?? [];
  const video = entryPoints.find((point) => point.entryPointType === 'video');
  const phone = entryPoints.find((point) => point.entryPointType === 'phone');

  const rawStatus = event.conferenceData?.createRequest?.status?.statusCode;
  const joinUrl = normalizeGoogleMeetUrl(event.hangoutLink ?? video?.uri ?? null);

  const conferenceStatus: GoogleConferenceResult['conferenceStatus'] =
    rawStatus === 'success' || (!rawStatus && joinUrl)
      ? 'success'
      : rawStatus === 'pending'
        ? 'pending'
        : rawStatus === 'failure'
          ? 'failure'
          : 'none';

  return {
    eventId: event.id ?? null,
    joinUrl,
    htmlLink: event.htmlLink ?? null,
    phonePin: phone?.pin ?? phone?.passcode ?? phone?.accessCode ?? null,
    phoneNumber: phone?.uri?.replace(/^tel:/, '') ?? null,
    conferenceStatus,
  };
}

/* ── Meet URLs ───────────────────────────────────────────────────────────────────────────────── */

/** `https://meet.google.com/abc-defg-hij`, optionally with a lookup or dial-in path. */
const MEET_HOST = /^(?:[a-z0-9-]+\.)*meet\.google\.com$/i;
const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i;

/**
 * Whether a link is a Google Meet address.
 *
 * The meeting code shape is checked as well as the host, because `https://meet.google.com/` on its
 * own — which is what a half-copied paste produces — is a valid URL on the right host that takes
 * nobody to the meeting. Google's own `_meet/` and `lookup/` paths are accepted since both resolve.
 */
export function isGoogleMeetUrl(url: string | null | undefined): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) return false;
  if (!MEET_HOST.test(parsed.hostname)) return false;

  const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
  if (!path) return false;
  if (path.startsWith('lookup/') || path.startsWith('_meet/')) return path.length > 7;
  return MEET_CODE.test(path);
}

/** Strip tracking parameters and normalise the host, so a stored link is the canonical one. */
export function normalizeGoogleMeetUrl(url: string | null | undefined): string | null {
  const parsed = parseHttpUrl(url);
  if (!parsed) return null;
  if (!MEET_HOST.test(parsed.hostname)) return (url ?? '').trim() || null;

  const path = parsed.pathname.replace(/\/+$/, '');
  // `?authuser=` and `?hs=` are added by whichever Google account copied the link and would send
  // somebody else to an account chooser.
  return `https://meet.google.com${path}`;
}

/** The meeting code, for showing a joinable code next to the button. */
export function googleMeetCode(url: string | null | undefined): string | null {
  const parsed = parseHttpUrl(url);
  if (!parsed || !MEET_HOST.test(parsed.hostname)) return null;
  const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
  return MEET_CODE.test(path) ? path.toLowerCase() : null;
}

function parseHttpUrl(url: string | null | undefined): URL | null {
  const value = (url ?? '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : null;
  } catch {
    return null;
  }
}

/* ── errors ──────────────────────────────────────────────────────────────────────────────────── */

export interface GoogleApiFailure {
  /** What to show the user. Never a raw Google payload. */
  message: string;
  /** Whether trying the same call again could work. */
  retryable: boolean;
  /** Whether the user must authorise Google again before anything will work. */
  needsReconnect: boolean;
  /** Whether the remote object is gone, so "delete" has already succeeded. */
  gone: boolean;
  /** Google's own reason, kept for the log rather than the screen. */
  reason: string | null;
}

/**
 * Turn a Google API failure into something a caller can act on.
 *
 * The three questions every call site asks are "retry?", "reconnect?" and "already gone?", so this
 * answers those rather than returning a status code for each caller to re-interpret. The message is
 * written for the organizer: Google's own strings ("Invalid conference type value", "Insufficient
 * Permission") do not tell them what to do.
 */
export function describeGoogleApiError(input: {
  status: number;
  body?: unknown;
}): GoogleApiFailure {
  const { status } = input;
  const reason = googleErrorReason(input.body);
  const detail = googleErrorMessage(input.body);

  if (status === 401 || reason === 'invalid_grant' || reason === 'authError') {
    return {
      message:
        'Google no longer accepts the connected account. Reconnect Google in Office Hub settings ' +
        'to create Meet links again.',
      retryable: false,
      needsReconnect: true,
      gone: false,
      reason,
    };
  }

  if (status === 403 && (reason === 'insufficientPermissions' || reason === 'forbidden' || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
    return {
      message:
        'The connected Google account did not grant calendar access. Reconnect Google and accept ' +
        'the calendar permission.',
      retryable: false,
      needsReconnect: true,
      gone: false,
      reason,
    };
  }

  if (status === 403 && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || reason === 'quotaExceeded')) {
    return {
      message: 'Google is rate-limiting calendar requests. The Meet link will be created shortly.',
      retryable: true,
      needsReconnect: false,
      gone: false,
      reason,
    };
  }

  if (status === 404 || reason === 'notFound' || reason === 'deleted') {
    return {
      message: 'That event is no longer in Google Calendar.',
      retryable: false,
      needsReconnect: false,
      gone: true,
      reason,
    };
  }

  // Calendar returns 410 Gone for an event deleted from a recurring series.
  if (status === 410) {
    return {
      message: 'That event has already been removed from Google Calendar.',
      retryable: false,
      needsReconnect: false,
      gone: true,
      reason,
    };
  }

  if (status === 429 || status >= 500) {
    return {
      message: 'Google Calendar is not responding. The meeting is saved; its Meet link will follow.',
      retryable: true,
      needsReconnect: false,
      gone: false,
      reason,
    };
  }

  if (status === 400) {
    return {
      message: `Google Calendar rejected the meeting${detail ? `: ${detail}` : '.'}`,
      retryable: false,
      needsReconnect: false,
      gone: false,
      reason,
    };
  }

  return {
    message: `Google Calendar returned an error (${status})${detail ? `: ${detail}` : '.'}`,
    retryable: status >= 500,
    needsReconnect: false,
    gone: false,
    reason,
  };
}

function googleErrorReason(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;

  // OAuth token endpoint shape: { error: 'invalid_grant', error_description: '…' }
  if (typeof record.error === 'string') return record.error;

  // Calendar API shape: { error: { errors: [{ reason }], status } }
  const error = record.error as Record<string, unknown> | undefined;
  if (error && typeof error === 'object') {
    const errors = error.errors as { reason?: string }[] | undefined;
    if (Array.isArray(errors) && errors[0]?.reason) return errors[0].reason;
    if (typeof error.status === 'string') return error.status;
  }
  return null;
}

function googleErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (typeof record.error_description === 'string') return record.error_description;
  const error = record.error as Record<string, unknown> | undefined;
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message;
  return null;
}

/* ── the join affordance ─────────────────────────────────────────────────────────────────────── */

export interface MeetJoinView {
  /** Whether to show a Join button at all. */
  canJoin: boolean;
  joinUrl: string | null;
  meetingCode: string | null;
  /** Why there is no link, when there is not. Shown in place of the button. */
  unavailableReason: string | null;
}

/**
 * What to render where the Join button goes.
 *
 * Kept separate from `meetingJoinView` in `office-hub-rules.ts`, which answers the *authorisation*
 * question — whether this viewer may see the link at all. This one answers the state question, and
 * is only ever reached for a viewer the other has already cleared.
 */
export function meetJoinView(meeting: {
  mode: OfficeHubMeeting['mode'];
  status: OfficeHubMeeting['status'];
  meetingUrl?: string | null;
  googleMeetUrl?: string | null;
  googleSyncState?: GoogleSyncState | null;
}): MeetJoinView {
  if (meeting.mode === 'Offline') {
    return { canJoin: false, joinUrl: null, meetingCode: null, unavailableReason: null };
  }

  const url = normalizeGoogleMeetUrl(meeting.googleMeetUrl ?? meeting.meetingUrl ?? null);
  if (url) {
    return { canJoin: true, joinUrl: url, meetingCode: googleMeetCode(url), unavailableReason: null };
  }

  const reason =
    meeting.status === 'Draft'
      ? 'The Meet link is created when the invitations are sent.'
      : meeting.googleSyncState === 'failed'
        ? 'The Meet link could not be created. Open the meeting and retry it.'
        : 'No Meet link yet.';

  return { canJoin: false, joinUrl: null, meetingCode: null, unavailableReason: reason };
}

/* ── base64url ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Base64url without a dependency, and without assuming a runtime.
 *
 * `btoa`/`atob` exist in the browser and in Node 16+; `Buffer` exists only in Node. This module is
 * imported from both, and the state parameter has to round-trip identically in each, so the
 * available one is used and the padding is handled explicitly rather than left to differ.
 */
function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).Buffer.from(padded, 'base64').toString('utf8');
}

/* ── formatting helpers the UI shares ────────────────────────────────────────────────────────── */

/** One line describing the calendar side effect, shown under the platform picker. */
export function googleSyncSummary(input: {
  connected: boolean;
  sendUpdates: 'all' | 'externalOnly' | 'none';
  attendeeCount: number;
}): string {
  if (!input.connected) {
    return 'Connect Google to create the Meet link and put this meeting on participants’ calendars.';
  }
  const who = input.attendeeCount === 1 ? '1 participant' : `${input.attendeeCount} participants`;
  return input.sendUpdates === 'none'
    ? `The meeting will appear on ${who}’ Google Calendar. Google will not email them; Office Hub sends the invitation.`
    : `Google will email ${who} and add the meeting to their Google Calendar, alongside the Office Hub invitation.`;
}

export interface GoogleMeetSettingsView {
  enabled: boolean;
  sendUpdates: 'all' | 'externalOnly' | 'none';
  calendarId: string;
}

export const DEFAULT_GOOGLE_MEET_SETTINGS: GoogleMeetSettingsView = {
  enabled: true,
  // Google emails the invitation and shows its own RSVP buttons. Chosen deliberately: an office
  // that already lives in Google Calendar expects the invitation to arrive there. Set to 'none' to
  // make Office Hub the only thing that emails, while the event still appears on their calendar.
  sendUpdates: 'all',
  // 'primary' is the organizer's own calendar. A shared calendar id works too, but then the
  // connected account must have write access to it.
  calendarId: 'primary',
};

/** Type guard for the settings value, so a hand-edited settings document cannot break a sync. */
export function normalizeSendUpdates(value: unknown): 'all' | 'externalOnly' | 'none' {
  return value === 'none' || value === 'externalOnly' || value === 'all'
    ? value
    : DEFAULT_GOOGLE_MEET_SETTINGS.sendUpdates;
}
