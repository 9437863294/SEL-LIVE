import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_GOOGLE_MEET_SETTINGS,
  GOOGLE_MAX_ATTENDEES,
  GOOGLE_MEET_SCOPES,
  GOOGLE_OAUTH_STATE_TTL_MS,
  buildGoogleAuthUrl,
  buildGoogleEventBody,
  conferenceRequestId,
  describeGoogleApiError,
  googleAttendeesFrom,
  googleConnectionHealth,
  googleEventDescription,
  googleMeetCode,
  googleOAuthStateExpired,
  googleSyncPlan,
  googleSyncSummary,
  grantCoversMeetCreation,
  isGoogleMeetUrl,
  meetJoinView,
  normalizeGoogleMeetUrl,
  normalizeSendUpdates,
  packGoogleOAuthState,
  readGoogleConference,
  safeReturnTo,
  unpackGoogleOAuthState,
} from '../src/lib/office-hub-google.ts';

const config = { clientId: 'client-123.apps.googleusercontent.com', redirectUri: 'https://erp.example.com/api/office-hub/google/callback' };

const meeting = {
  id: 'meet1',
  title: 'Finance Review',
  meetingType: 'Review',
  description: 'Quarterly numbers.',
  date: '2026-09-21',
  startTime: '10:00',
  endTime: '11:00',
  timeZone: 'Asia/Kolkata',
  startAt: '2026-09-21T04:30:00.000Z',
  endAt: '2026-09-21T05:30:00.000Z',
  mode: 'Online',
  status: 'Scheduled',
  organizerId: 'u1',
  organizerName: 'Asha',
  reminderOffsets: [15, 60],
  recurrence: { frequency: 'None', interval: 1, endMode: 'never' },
};

const participants = [
  { email: 'Asha@Example.com', name: 'Asha', attendanceRole: 'Required' },
  { email: 'ben@example.com', name: 'Ben', attendanceRole: 'Optional' },
];

/* ── OAuth ───────────────────────────────────────────────────────────────────────────────────── */

test('the consent URL asks for a refresh token, and asks in the way that actually returns one', () => {
  const url = new URL(buildGoogleAuthUrl(config, { state: 'signed-state', loginHint: 'asha@example.com' }));

  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), config.clientId);
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri);
  assert.equal(url.searchParams.get('response_type'), 'code');

  // Without offline access Google returns an access token only, and the integration silently stops
  // working an hour after each connection.
  assert.equal(url.searchParams.get('access_type'), 'offline');
  // Without a forced consent screen a returning user gets no refresh token at all.
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(url.searchParams.get('state'), 'signed-state');
  assert.equal(url.searchParams.get('login_hint'), 'asha@example.com');
});

test('the requested scopes are the narrow calendar ones, not full calendar access', () => {
  const scopes = new URL(buildGoogleAuthUrl(config, { state: 's' })).searchParams.get('scope').split(' ');

  assert.ok(scopes.includes('https://www.googleapis.com/auth/calendar.events'));
  assert.ok(!scopes.includes('https://www.googleapis.com/auth/calendar'), 'the broad scope is not requested');
  assert.ok(!scopes.some((scope) => scope.includes('gmail') || scope.includes('drive')));
  assert.deepEqual(scopes, [...GOOGLE_MEET_SCOPES]);
});

test('a missing login hint is omitted rather than sent empty', () => {
  const url = new URL(buildGoogleAuthUrl(config, { state: 's', loginHint: '   ' }));
  assert.equal(url.searchParams.has('login_hint'), false);
});

test('the OAuth state round-trips, and a tampered or stale one is refused', () => {
  const state = { userId: 'u1', returnTo: '/office-hub/settings', issuedAt: Date.parse('2026-09-18T10:00:00Z') };
  const packed = packGoogleOAuthState(state);

  assert.deepEqual(unpackGoogleOAuthState(packed), state);
  // Base64url: safe in a query string and through Google's redirect.
  assert.ok(!/[+/=]/.test(packed));

  assert.equal(unpackGoogleOAuthState('not-base64-at-all!!'), null);
  assert.equal(unpackGoogleOAuthState(packGoogleOAuthState({ ...state, userId: '' })), null);

  const at = new Date(state.issuedAt);
  assert.equal(googleOAuthStateExpired(state, at), false);
  assert.equal(googleOAuthStateExpired(state, new Date(state.issuedAt + GOOGLE_OAUTH_STATE_TTL_MS + 1)), true);
  // A state from the future is a clock-skew or forgery signal, not a valid one.
  assert.equal(googleOAuthStateExpired(state, new Date(state.issuedAt - 120_000)), true);
});

test('the callback will only redirect to a local path', () => {
  assert.equal(safeReturnTo('/office-hub/meetings/m1'), '/office-hub/meetings/m1');

  // An open redirect on an OAuth callback is a URL people are trained to click.
  assert.equal(safeReturnTo('https://evil.example.com/steal'), '/office-hub/settings');
  assert.equal(safeReturnTo('//evil.example.com/steal'), '/office-hub/settings', 'protocol-relative is absolute');
  assert.equal(safeReturnTo('/office-hub\\..\\..\\evil'), '/office-hub/settings');
  assert.equal(safeReturnTo('/office-hub\r\nLocation: https://evil'), '/office-hub/settings');
  assert.equal(safeReturnTo(''), '/office-hub/settings');
  assert.equal(safeReturnTo(null), '/office-hub/settings');
  assert.equal(safeReturnTo(undefined, '/somewhere'), '/somewhere');
});

/* ── connection health ───────────────────────────────────────────────────────────────────────── */

test('a connection is only healthy with a token and a scope that can create events', () => {
  assert.equal(googleConnectionHealth(null), 'disconnected');
  assert.equal(googleConnectionHealth({ refreshTokenPresent: false }), 'disconnected');

  assert.equal(
    googleConnectionHealth({ refreshTokenPresent: true, scopes: ['https://www.googleapis.com/auth/calendar.events'] }),
    'connected',
  );

  // Revoked, password changed, or unused for six months.
  assert.equal(
    googleConnectionHealth({ refreshTokenPresent: true, reauthReason: 'Google no longer accepts it.' }),
    'reauth-required',
  );

  // A grant narrower than asked for: the user unticked the calendar permission. Worse than no
  // connection, because everything looks connected and every call 403s.
  assert.equal(googleConnectionHealth({ refreshTokenPresent: true, scopes: ['openid', 'email'] }), 'reauth-required');

  assert.equal(grantCoversMeetCreation(['https://www.googleapis.com/auth/calendar']), true);
  assert.equal(grantCoversMeetCreation(['openid']), false);
});

/* ── the sync plan ───────────────────────────────────────────────────────────────────────────── */

test('an in-person meeting never gets a conference, and loses one it had', () => {
  assert.equal(googleSyncPlan({ id: 'm', mode: 'Offline', status: 'Scheduled' }).action, 'none');

  // Switched from online to in-person: the Meet is withdrawn rather than left dangling.
  assert.equal(
    googleSyncPlan({ id: 'm', mode: 'Offline', status: 'Scheduled', googleEventId: 'ev1' }).action,
    'cancel',
  );
});

test('a draft is not on anybody’s calendar until it is sent', () => {
  assert.equal(googleSyncPlan({ id: 'm', mode: 'Online', status: 'Draft' }).action, 'none');
});

test('a cancelled meeting has its event deleted, which is what clears participants’ calendars', () => {
  assert.equal(
    googleSyncPlan({ id: 'm', mode: 'Online', status: 'Cancelled', googleEventId: 'ev1' }).action,
    'cancel',
  );
  assert.equal(googleSyncPlan({ id: 'm', mode: 'Online', status: 'Cancelled' }).action, 'none');
});

test('a recurring series is one Google event, and its instances inherit the link', () => {
  const parent = googleSyncPlan({ id: 'p', mode: 'Online', status: 'Scheduled', seriesId: 'p', isSeriesParent: true });
  assert.equal(parent.action, 'create');

  const child = googleSyncPlan({ id: 'c', mode: 'Online', status: 'Scheduled', seriesId: 'p', isSeriesParent: false });
  assert.equal(child.action, 'inherit', 'an instance must not mint its own conference');
  assert.equal(child.inheritFromMeetingId, 'p');

  // An occurrence edited on its own owns a separate event, and that one is patched.
  const detached = googleSyncPlan({
    id: 'c',
    mode: 'Online',
    status: 'Scheduled',
    seriesId: 'p',
    isSeriesParent: false,
    googleEventId: 'ev-child',
  });
  assert.equal(detached.action, 'update');
});

test('an existing event is patched, so the link participants already hold keeps working', () => {
  assert.equal(googleSyncPlan({ id: 'm', mode: 'Online', status: 'Scheduled' }).action, 'create');
  assert.equal(
    googleSyncPlan({ id: 'm', mode: 'Hybrid', status: 'Scheduled', googleEventId: 'ev1' }).action,
    'update',
  );
});

test('a meeting on another platform is left completely alone', () => {
  // The bug this guards: editing the title of a legacy Zoom meeting must not mint a Google event
  // and overwrite the Zoom link participants already hold.
  const zoom = googleSyncPlan({ id: 'm', mode: 'Online', status: 'Scheduled', onlinePlatform: 'Zoom' });
  assert.equal(zoom.action, 'none');
  assert.match(zoom.reason, /Zoom/);

  assert.equal(
    googleSyncPlan({ id: 'm', mode: 'Online', status: 'Scheduled', onlinePlatform: 'Microsoft Teams' }).action,
    'none',
  );

  // A new meeting, and a legacy record with no platform at all, are both ours.
  assert.equal(
    googleSyncPlan({ id: 'm', mode: 'Online', status: 'Scheduled', onlinePlatform: 'Google Meet' }).action,
    'create',
  );
  assert.equal(googleSyncPlan({ id: 'm', mode: 'Online', status: 'Scheduled', onlinePlatform: null }).action, 'create');
});

test('a finished meeting is not touched, and a postponed one gets no new link', () => {
  // Patching it would rewrite history on everybody's calendar.
  assert.equal(googleSyncPlan({ id: 'm', mode: 'Online', status: 'Completed', googleEventId: 'ev1' }).action, 'none');
  assert.equal(googleSyncPlan({ id: 'm', mode: 'Online', status: 'Completed' }).action, 'none');

  // Postponed keeps its old date until somebody reschedules it, so a new event would invite
  // everybody to a time the meeting is explicitly not happening.
  assert.equal(googleSyncPlan({ id: 'm', mode: 'Online', status: 'Postponed' }).action, 'none');
  // One it already has is still kept in step.
  assert.equal(googleSyncPlan({ id: 'm', mode: 'Online', status: 'Postponed', googleEventId: 'ev1' }).action, 'update');

  // A meeting in progress whose link failed must still be able to get one — people are trying to
  // join it right now.
  assert.equal(googleSyncPlan({ id: 'm', mode: 'Online', status: 'In Progress' }).action, 'create');
});

test('cancelling still works on a platform Office Hub does not manage', () => {
  // The ordering matters: an explicit cancel is honoured before the platform guard, because the
  // event exists on somebody's calendar regardless of which platform the link points at.
  assert.equal(
    googleSyncPlan({ id: 'm', mode: 'Online', status: 'Scheduled', onlinePlatform: 'Zoom', googleEventId: 'ev1' }, 'cancel')
      .action,
    'cancel',
  );
});

test('cancel intent overrides everything, and is a no-op with no event', () => {
  assert.equal(
    googleSyncPlan({ id: 'm', mode: 'Online', status: 'Scheduled', googleEventId: 'ev1' }, 'cancel').action,
    'cancel',
  );
  assert.equal(googleSyncPlan({ id: 'm', mode: 'Online', status: 'Scheduled' }, 'cancel').action, 'none');
});

/* ── the event body ──────────────────────────────────────────────────────────────────────────── */

test('the event body asks Google to mint a Meet, with a deterministic request id', () => {
  const { body } = buildGoogleEventBody({ meeting, attendees: participants });

  assert.equal(body.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
  assert.equal(body.conferenceData.createRequest.requestId, 'officehub-meet1');

  // Determinism is what makes a retry safe: Google returns the conference it already made rather
  // than a second one, so a double-click cannot hand out two links for one meeting.
  assert.equal(conferenceRequestId('meet1'), conferenceRequestId('meet1'));
  assert.notEqual(conferenceRequestId('meet1'), conferenceRequestId('meet2'));
});

test('a request id is sanitised and bounded to what Google accepts', () => {
  const id = conferenceRequestId('a/b c:d#e'.repeat(20));
  assert.ok(id.length <= 64);
  assert.match(id, /^[A-Za-z0-9\-_]+$/);
});

test('the event carries the instant and the zone, because a series needs both', () => {
  const { body } = buildGoogleEventBody({ meeting, attendees: participants });

  assert.equal(body.start.dateTime, '2026-09-21T04:30:00.000Z');
  assert.equal(body.end.dateTime, '2026-09-21T05:30:00.000Z');
  // The zone is not redundant alongside a UTC instant: Google expands an RRULE in it, which is what
  // keeps "every Monday at 09:30" at 09:30 across a DST change.
  assert.equal(body.start.timeZone, 'Asia/Kolkata');
  assert.equal(body.end.timeZone, 'Asia/Kolkata');
});

test('a recurring meeting sends an RRULE, prefixed as Google requires', () => {
  const { body } = buildGoogleEventBody({
    meeting: {
      ...meeting,
      isSeriesParent: true,
      recurrence: { frequency: 'Weekly', interval: 1, weekdays: [1], endMode: 'after-occurrences', occurrences: 8 },
    },
    attendees: participants,
  });

  assert.deepEqual(body.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=8']);
});

test('only the series parent carries the rule', () => {
  const { body } = buildGoogleEventBody({
    meeting: {
      ...meeting,
      isSeriesParent: false,
      recurrence: { frequency: 'Weekly', interval: 1, weekdays: [1], endMode: 'never' },
    },
    attendees: participants,
  });

  assert.equal(body.recurrence, undefined, 'an instance must not repeat on its own');
});

test('a non-recurring meeting sends no recurrence at all', () => {
  const { body } = buildGoogleEventBody({ meeting, attendees: participants });
  assert.equal(body.recurrence, undefined);
});

test('attendees are lower-cased, deduplicated, and marked optional where they are', () => {
  const { attendees, warnings } = googleAttendeesFrom([
    ...participants,
    { email: 'ASHA@example.com', name: 'Asha again', attendanceRole: 'Required' },
  ]);

  assert.equal(attendees.length, 2, 'the same address twice is one attendee');
  assert.equal(attendees[0].email, 'asha@example.com');
  assert.equal(attendees[0].optional, false);
  assert.equal(attendees[1].optional, true);
  assert.equal(attendees[0].responseStatus, 'needsAction');
  assert.deepEqual(warnings, []);
});

test('a participant with no email is dropped and named, never silently omitted', () => {
  const { attendees, warnings } = googleAttendeesFrom([
    { email: 'asha@example.com', name: 'Asha' },
    { email: null, name: 'Chandra' },
    { email: 'not-an-address', name: 'Dev' },
  ]);

  assert.equal(attendees.length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Chandra/);
  assert.match(warnings[0], /Dev/);
  // The point of the warning: they are still invited in Office Hub.
  assert.match(warnings[0], /Office Hub invitation/);
});

test('an over-large guest list is truncated with a warning rather than failing the whole sync', () => {
  const many = Array.from({ length: GOOGLE_MAX_ATTENDEES + 5 }, (_unused, index) => ({
    email: `person${index}@example.com`,
    name: `Person ${index}`,
  }));

  const { attendees, warnings } = googleAttendeesFrom(many);
  assert.equal(attendees.length, GOOGLE_MAX_ATTENDEES);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /5 were left off/);
});

test('warnings from the guest list reach the caller of buildGoogleEventBody', () => {
  const result = buildGoogleEventBody({
    meeting,
    attendees: [{ email: null, name: 'Chandra' }],
  });

  assert.equal(result.attendeeCount, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.body.attendees, undefined, 'no attendees key rather than an empty array');
});

test('Office Hub keeps control of the guest list', () => {
  const { body } = buildGoogleEventBody({ meeting, attendees: participants });

  // Attendees adding their own guests would put people in the Meet who are not participants here,
  // which would make the attendance sheet and the response summary both wrong.
  assert.equal(body.guestsCanModify, false);
  assert.equal(body.guestsCanInviteOthers, false);
});

test('the event points back at the meeting, and is traceable to it', () => {
  const { body } = buildGoogleEventBody({
    meeting,
    attendees: participants,
    meetingUrl: 'https://erp.example.com/office-hub/meetings/meet1',
  });

  assert.equal(body.extendedProperties.private.officeHubMeetingId, 'meet1');
  assert.equal(body.extendedProperties.private.officeHubMeetingType, 'Review');
  assert.equal(body.source.url, 'https://erp.example.com/office-hub/meetings/meet1');
  assert.match(body.description, /Quarterly numbers\./);
  assert.match(body.description, /Respond in Office Hub/);
});

test('the description tells participants where their response is actually counted', () => {
  const text = googleEventDescription({ meeting, attendees: participants, meetingUrl: 'https://erp/x' });
  assert.match(text, /Respond in Office Hub so attendance is recorded/);
});

test('the location is the room, place and address in that order', () => {
  const { body } = buildGoogleEventBody({
    meeting: { ...meeting, mode: 'Hybrid', room: '3F', location: 'Head Office', address: '12 Example Road' },
    attendees: participants,
  });

  assert.equal(body.location, '3F, Head Office, 12 Example Road');
});

test('reminder offsets become Google popups, bounded and deduplicated of nonsense', () => {
  const { body } = buildGoogleEventBody({
    meeting: { ...meeting, reminderOffsets: [15, 60, 0, -5, 999_999] },
    attendees: participants,
  });

  assert.equal(body.reminders.useDefault, false);
  assert.deepEqual(body.reminders.overrides, [
    { method: 'popup', minutes: 15 },
    { method: 'popup', minutes: 60 },
  ]);
});

test('a patch can decline to request a conference, so an existing Meet is left alone', () => {
  const { body } = buildGoogleEventBody({ meeting, attendees: participants, requestConference: false });
  assert.equal(body.conferenceData, undefined);
});

/* ── reading the response ────────────────────────────────────────────────────────────────────── */

test('the Meet link is read from hangoutLink, or from the video entry point', () => {
  const fromHangout = readGoogleConference({
    id: 'ev1',
    htmlLink: 'https://calendar.google.com/event?eid=x',
    hangoutLink: 'https://meet.google.com/abc-defg-hij',
    conferenceData: { createRequest: { status: { statusCode: 'success' } } },
  });

  assert.equal(fromHangout.eventId, 'ev1');
  assert.equal(fromHangout.joinUrl, 'https://meet.google.com/abc-defg-hij');
  assert.equal(fromHangout.htmlLink, 'https://calendar.google.com/event?eid=x');
  assert.equal(fromHangout.conferenceStatus, 'success');

  const fromEntryPoints = readGoogleConference({
    id: 'ev2',
    conferenceData: {
      entryPoints: [
        { entryPointType: 'video', uri: 'https://meet.google.com/xyz-wxyz-abc' },
        { entryPointType: 'phone', uri: 'tel:+91-11-1234-5678', pin: '123456' },
      ],
    },
  });

  assert.equal(fromEntryPoints.joinUrl, 'https://meet.google.com/xyz-wxyz-abc');
  assert.equal(fromEntryPoints.phonePin, '123456');
  assert.equal(fromEntryPoints.phoneNumber, '+91-11-1234-5678');
});

test('a pending conference is reported as pending, not as a missing link', () => {
  const pending = readGoogleConference({
    id: 'ev3',
    conferenceData: { createRequest: { status: { statusCode: 'pending' } } },
  });

  assert.equal(pending.conferenceStatus, 'pending');
  assert.equal(pending.joinUrl, null);
});

test('an absent event reads as nothing rather than throwing', () => {
  const empty = readGoogleConference(null);
  assert.equal(empty.eventId, null);
  assert.equal(empty.joinUrl, null);
  assert.equal(empty.conferenceStatus, 'none');
});

/* ── Meet URLs ───────────────────────────────────────────────────────────────────────────────── */

test('a Meet link is recognised by host and by the shape of its code', () => {
  assert.equal(isGoogleMeetUrl('https://meet.google.com/abc-defg-hij'), true);
  assert.equal(isGoogleMeetUrl('https://meet.google.com/lookup/abcdefghij'), true);

  // The half-copied paste: right host, no meeting.
  assert.equal(isGoogleMeetUrl('https://meet.google.com/'), false);
  assert.equal(isGoogleMeetUrl('https://meet.google.com'), false);

  assert.equal(isGoogleMeetUrl('https://teams.microsoft.com/l/meetup-join/x'), false);
  assert.equal(isGoogleMeetUrl('https://meet.google.com.evil.example.com/abc-defg-hij'), false);
  assert.equal(isGoogleMeetUrl('javascript:alert(1)'), false);
  assert.equal(isGoogleMeetUrl(''), false);
  assert.equal(isGoogleMeetUrl(null), false);
});

test('a Meet link is normalised so it does not carry somebody else’s account', () => {
  // `?authuser=` sends the next person to an account chooser rather than the meeting.
  assert.equal(
    normalizeGoogleMeetUrl('https://meet.google.com/abc-defg-hij?authuser=1&hs=197'),
    'https://meet.google.com/abc-defg-hij',
  );
  assert.equal(normalizeGoogleMeetUrl('https://MEET.GOOGLE.COM/abc-defg-hij/'), 'https://meet.google.com/abc-defg-hij');

  // A non-Meet link is passed through rather than mangled — legacy meetings still hold them.
  assert.equal(normalizeGoogleMeetUrl('https://zoom.us/j/123'), 'https://zoom.us/j/123');
  assert.equal(normalizeGoogleMeetUrl(''), null);
});

test('the meeting code is extracted for reading out loud', () => {
  assert.equal(googleMeetCode('https://meet.google.com/abc-defg-hij'), 'abc-defg-hij');
  assert.equal(googleMeetCode('https://meet.google.com/lookup/xyz'), null);
  assert.equal(googleMeetCode('https://zoom.us/j/1'), null);
});

/* ── errors ──────────────────────────────────────────────────────────────────────────────────── */

test('an expired grant asks for a reconnect and does not invite a retry', () => {
  const failure = describeGoogleApiError({ status: 400, body: { error: 'invalid_grant' } });

  assert.equal(failure.needsReconnect, true);
  assert.equal(failure.retryable, false);
  assert.match(failure.message, /Reconnect Google/);
});

test('a 401 is a reconnect regardless of what the body says', () => {
  assert.equal(describeGoogleApiError({ status: 401 }).needsReconnect, true);
});

test('a narrowed grant is distinguished from a rate limit, though both are 403', () => {
  const scope = describeGoogleApiError({
    status: 403,
    body: { error: { errors: [{ reason: 'insufficientPermissions' }] } },
  });
  assert.equal(scope.needsReconnect, true);
  assert.equal(scope.retryable, false);

  const throttled = describeGoogleApiError({
    status: 403,
    body: { error: { errors: [{ reason: 'rateLimitExceeded' }] } },
  });
  assert.equal(throttled.retryable, true);
  assert.equal(throttled.needsReconnect, false);
});

test('a missing event counts as gone, so deleting it has already succeeded', () => {
  assert.equal(describeGoogleApiError({ status: 404 }).gone, true);
  assert.equal(describeGoogleApiError({ status: 410 }).gone, true);
  assert.equal(describeGoogleApiError({ status: 500 }).gone, false);
});

test('throttling and server faults are retryable; a rejected payload is not', () => {
  assert.equal(describeGoogleApiError({ status: 429 }).retryable, true);
  assert.equal(describeGoogleApiError({ status: 503 }).retryable, true);
  assert.equal(describeGoogleApiError({ status: 400, body: { error: { message: 'Invalid conference type' } } }).retryable, false);
});

test('the message is written for the organizer, and carries Google’s detail without its shape', () => {
  const failure = describeGoogleApiError({
    status: 400,
    body: { error: { message: 'Invalid conference type value.', errors: [{ reason: 'invalid' }] } },
  });

  assert.match(failure.message, /Google Calendar rejected the meeting/);
  assert.match(failure.message, /Invalid conference type value\./);
  // The reason is kept for the log, not the sentence.
  assert.equal(failure.reason, 'invalid');
});

/* ── the join affordance ─────────────────────────────────────────────────────────────────────── */

test('the join view prefers the Google link and explains its absence', () => {
  const synced = meetJoinView({
    mode: 'Online',
    status: 'Scheduled',
    googleMeetUrl: 'https://meet.google.com/abc-defg-hij',
  });
  assert.equal(synced.canJoin, true);
  assert.equal(synced.meetingCode, 'abc-defg-hij');

  // A legacy pasted link still produces a Join button.
  const legacy = meetJoinView({ mode: 'Online', status: 'Scheduled', meetingUrl: 'https://zoom.us/j/9' });
  assert.equal(legacy.canJoin, true);
  assert.equal(legacy.joinUrl, 'https://zoom.us/j/9');

  const draft = meetJoinView({ mode: 'Online', status: 'Draft' });
  assert.equal(draft.canJoin, false);
  assert.match(draft.unavailableReason, /when the invitations are sent/);

  const failed = meetJoinView({ mode: 'Online', status: 'Scheduled', googleSyncState: 'failed' });
  assert.match(failed.unavailableReason, /retry/);

  // An in-person meeting is not missing a link; it has no use for one.
  const offline = meetJoinView({ mode: 'Offline', status: 'Scheduled' });
  assert.equal(offline.canJoin, false);
  assert.equal(offline.unavailableReason, null);
});

/* ── settings ────────────────────────────────────────────────────────────────────────────────── */

test('the send-updates setting tolerates a hand-edited settings document', () => {
  assert.equal(normalizeSendUpdates('none'), 'none');
  assert.equal(normalizeSendUpdates('externalOnly'), 'externalOnly');
  assert.equal(normalizeSendUpdates('all'), 'all');
  assert.equal(normalizeSendUpdates('yes please'), DEFAULT_GOOGLE_MEET_SETTINGS.sendUpdates);
  assert.equal(normalizeSendUpdates(undefined), DEFAULT_GOOGLE_MEET_SETTINGS.sendUpdates);
  assert.equal(normalizeSendUpdates(null), DEFAULT_GOOGLE_MEET_SETTINGS.sendUpdates);
});

test('the summary says what will actually happen to participants', () => {
  assert.match(googleSyncSummary({ connected: false, sendUpdates: 'all', attendeeCount: 3 }), /Connect Google/);

  const emailing = googleSyncSummary({ connected: true, sendUpdates: 'all', attendeeCount: 3 });
  assert.match(emailing, /Google will email 3 participants/);

  const quiet = googleSyncSummary({ connected: true, sendUpdates: 'none', attendeeCount: 1 });
  assert.match(quiet, /Google will not email/);
  assert.match(quiet, /1 participant/);
});
