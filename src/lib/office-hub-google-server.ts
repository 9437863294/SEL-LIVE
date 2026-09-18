import 'server-only';

/**
 * Office Hub — Google Meet, the half that holds secrets.
 *
 * Everything that must not reach a browser: the OAuth client secret, the per-user refresh tokens,
 * the encryption key, and the Calendar API calls those authorise. The shaping of every request and
 * the reading of every response lives in `office-hub-google.ts`, which is pure and tested directly;
 * this file is the plumbing around it.
 *
 * ── The security properties this file is responsible for ───────────────────────────────────────
 *
 *  1. **No credential is reachable from the client.** `import 'server-only'` makes a client-side
 *     import a build error rather than a leak. The client ID is not secret and could be public, but
 *     it is read here anyway so there is exactly one place to look.
 *
 *  2. **Refresh tokens are encrypted at rest.** A Google refresh token is a standing grant to read
 *     and write that person's calendar until they revoke it; it does not expire on its own. Storing
 *     a collection of them in plaintext means a database export is a set of live grants. They are
 *     sealed with AES-256-GCM under `OFFICE_HUB_GOOGLE_TOKEN_KEY`, which lives in the environment
 *     and not in Firestore — so possession of the database is not possession of the tokens.
 *
 *  3. **Missing key means no storage, not plaintext storage.** If the key is unset, connecting
 *     fails with an operator-readable error. Falling back to plaintext would be the kind of default
 *     nobody discovers until it matters.
 *
 *  4. **The OAuth state parameter is signed.** Unsigned state in a callback is a real account-
 *     binding vulnerability — see `packGoogleOAuthState`. The signature is HMAC-SHA256 over the
 *     payload, verified with a constant-time compare.
 *
 *  5. **Only the Admin SDK reads the connection collection.** `firestore.rules` denies all client
 *     access to `officeHubGoogleConnections`, so even a stolen ID token cannot fetch a token
 *     envelope; the rules and this file have to agree, and they are commented in both places.
 *
 * ── Why per-user OAuth rather than a service account ──────────────────────────────────────────
 *
 * Chosen deliberately. A service account with domain-wide delegation would need a Workspace
 * super-admin to authorise it once, which this installation would rather not require. The cost is
 * that each organizer connects their own account, and a meeting scheduled by somebody who has not
 * connected gets no Meet link — `googleSyncPlan` returns the state and the UI asks them to connect
 * rather than failing the save. The refresh token being stored server-side does mean the cron sweep
 * can still act for a connected user with nobody signed in, which is what makes the retry step
 * below possible.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from './firebase-admin';
import { OFFICE_HUB_COLLECTIONS, OFFICE_HUB_SETTINGS_DOC_ID } from './office-hub';
import type { OfficeHubMeeting } from './office-hub-model';
import {
  DEFAULT_GOOGLE_MEET_SETTINGS,
  DISCONNECTED_GOOGLE_CONNECTION,
  GOOGLE_CALENDAR_API_BASE,
  GOOGLE_MEET_SCOPES,
  GOOGLE_OAUTH_REVOKE_ENDPOINT,
  GOOGLE_OAUTH_TOKEN_ENDPOINT,
  authorizationCodeBody,
  buildGoogleAuthUrl,
  buildGoogleEventBody,
  describeGoogleApiError,
  googleConnectionHealth,
  googleOAuthStateExpired,
  googleSyncPlan,
  normalizeSendUpdates,
  packGoogleOAuthState,
  readGoogleConference,
  refreshTokenBody,
  safeReturnTo,
  unpackGoogleOAuthState,
  type GoogleConferenceResult,
  type GoogleConnectionView,
  type GoogleEventInput,
  type GoogleOAuthState,
  type GoogleSyncAction,
} from './office-hub-google';

/* ── configuration ───────────────────────────────────────────────────────────────────────────── */

export interface GoogleServerConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class GoogleConfigError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = 'GoogleConfigError';
  }
}

/** The application's public base URL, following the convention `office-hub-server.ts` already uses. */
export function appBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_BASE_URL ?? '';
  if (configured.trim()) return configured.trim().replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}

export const GOOGLE_CALLBACK_PATH = '/api/office-hub/google/callback';

/**
 * Whether the integration is configured at all.
 *
 * Checked before anything is offered in the UI, because "Connect Google" that leads to a Google
 * error page is worse than an explanation of what the operator has not set up yet.
 */
export function googleMeetConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() &&
      tokenEncryptionKey(false),
  );
}

export function googleMeetConfigurationProblems(): string[] {
  const problems: string[] = [];
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()) problems.push('GOOGLE_OAUTH_CLIENT_ID is not set.');
  if (!process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()) problems.push('GOOGLE_OAUTH_CLIENT_SECRET is not set.');
  if (!process.env.OFFICE_HUB_GOOGLE_TOKEN_KEY?.trim()) {
    problems.push(
      'OFFICE_HUB_GOOGLE_TOKEN_KEY is not set. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  } else if (!tokenEncryptionKey(false)) {
    problems.push('OFFICE_HUB_GOOGLE_TOKEN_KEY is not a 32-byte base64 or hex value.');
  }
  return problems;
}

export function googleServerConfig(): GoogleServerConfig {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new GoogleConfigError(
      'Google Meet is not configured on this server.',
      googleMeetConfigurationProblems().join(' '),
    );
  }

  // The redirect URI must match a value registered on the OAuth client *exactly*, including the
  // scheme and any trailing slash, or Google refuses with redirect_uri_mismatch. Derived from one
  // base URL so it cannot differ between the authorize call and the token exchange — a mismatch
  // between those two is the other way this fails, and it fails at the exchange, after consent.
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || `${appBaseUrl()}${GOOGLE_CALLBACK_PATH}`;

  return { clientId, clientSecret, redirectUri };
}

/* ── token encryption ────────────────────────────────────────────────────────────────────────── */

const TOKEN_KEY_VERSION = 1;

/**
 * The AES-256-GCM key, accepted as base64 or hex.
 *
 * Both, because an operator generating 32 random bytes will reach for whichever their tooling
 * prints and neither is wrong. Length is checked rather than assumed: a 16-byte key would silently
 * produce AES-128 and a truncated one throws deep inside `createCipheriv` with a message that does
 * not mention the variable.
 */
function tokenEncryptionKey(required: true): Buffer;
function tokenEncryptionKey(required: false): Buffer | null;
function tokenEncryptionKey(required: boolean): Buffer | null {
  const raw = process.env.OFFICE_HUB_GOOGLE_TOKEN_KEY?.trim();
  if (!raw) {
    if (!required) return null;
    throw new GoogleConfigError(
      'Google Meet cannot store credentials on this server.',
      'OFFICE_HUB_GOOGLE_TOKEN_KEY is not set. Office Hub will not save a Google refresh token ' +
        'unencrypted. Generate a key with: node -e "console.log(require(\'crypto\')' +
        '.randomBytes(32).toString(\'base64\'))"',
    );
  }

  const candidate = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (candidate.length !== 32) {
    if (!required) return null;
    throw new GoogleConfigError(
      'Google Meet cannot store credentials on this server.',
      `OFFICE_HUB_GOOGLE_TOKEN_KEY decodes to ${candidate.length} bytes; AES-256-GCM needs 32.`,
    );
  }
  return candidate;
}

interface SealedToken {
  cipher: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

function sealRefreshToken(refreshToken: string): SealedToken {
  const key = tokenEncryptionKey(true);
  // 12 bytes is the GCM standard nonce length and the one Node optimises for. Fresh per seal —
  // reusing a nonce under the same key is the way to lose GCM's guarantees entirely.
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const sealed = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()]);
  return {
    cipher: sealed.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    keyVersion: TOKEN_KEY_VERSION,
  };
}

function openRefreshToken(sealed: {
  refreshTokenCipher?: string | null;
  refreshTokenIv?: string | null;
  refreshTokenTag?: string | null;
}): string | null {
  if (!sealed.refreshTokenCipher || !sealed.refreshTokenIv || !sealed.refreshTokenTag) return null;
  try {
    const key = tokenEncryptionKey(true);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.refreshTokenIv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.refreshTokenTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.refreshTokenCipher, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Authentication failure means the key changed or the record was tampered with. Either way the
    // token is unusable and the honest answer is "reconnect", not a stack trace.
    return null;
  }
}

/* ── signed OAuth state ──────────────────────────────────────────────────────────────────────── */

/**
 * Sign the state payload with the client secret.
 *
 * The client secret doubles as the HMAC key rather than introducing a fourth environment variable:
 * it is already required for this integration to work at all, already server-only, and rotating it
 * invalidating in-flight consent round-trips is correct behaviour rather than a side effect.
 */
function signState(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSignedState(state: GoogleOAuthState, config: GoogleServerConfig): string {
  const payload = packGoogleOAuthState(state);
  return `${payload}.${signState(payload, config.clientSecret)}`;
}

export function verifySignedState(
  raw: string | null | undefined,
  config: GoogleServerConfig,
  now: Date = new Date(),
): { ok: true; state: GoogleOAuthState } | { ok: false; reason: string } {
  const value = (raw ?? '').trim();
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return { ok: false, reason: 'The sign-in request was malformed.' };

  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = signState(payload, config.clientSecret);

  // Constant-time, and length-checked first because `timingSafeEqual` throws on a length mismatch.
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    return { ok: false, reason: 'The sign-in request could not be verified. Start again from Settings.' };
  }

  const state = unpackGoogleOAuthState(payload);
  if (!state) return { ok: false, reason: 'The sign-in request was malformed.' };
  if (googleOAuthStateExpired(state, now)) {
    return { ok: false, reason: 'The Google sign-in took too long. Start again from Settings.' };
  }

  return { ok: true, state };
}

/** The consent URL for a user, with a signed state. */
export function googleAuthorizeUrl(input: {
  userId: string;
  userEmail?: string | null;
  returnTo?: string | null;
}): string {
  const config = googleServerConfig();
  // Fail before redirecting rather than after consent: a user who authorises and then hits
  // "cannot store credentials" has granted access for nothing.
  tokenEncryptionKey(true);

  const state = createSignedState(
    {
      userId: input.userId,
      returnTo: safeReturnTo(input.returnTo),
      issuedAt: Date.now(),
    },
    config,
  );

  return buildGoogleAuthUrl(config, { state, loginHint: input.userEmail ?? null });
}

/* ── the connection store ────────────────────────────────────────────────────────────────────── */

interface StoredConnection {
  userId: string;
  googleEmail: string | null;
  googleUserId: string | null;
  refreshTokenCipher: string | null;
  refreshTokenIv: string | null;
  refreshTokenTag: string | null;
  keyVersion?: number | null;
  scopes?: string[];
  reauthReason?: string | null;
  connectedAt?: { toDate?: () => Date } | null;
  lastUsedAt?: { toDate?: () => Date } | null;
}

const connectionDoc = (userId: string) =>
  getFirebaseAdminFirestore().collection(OFFICE_HUB_COLLECTIONS.googleConnections).doc(userId);

async function readConnection(userId: string): Promise<StoredConnection | null> {
  const snapshot = await connectionDoc(userId).get();
  if (!snapshot.exists) return null;
  return { ...(snapshot.data() as StoredConnection), userId };
}

/** The redacted view a screen may have. Built here so no route can serialise the stored document. */
export async function googleConnectionFor(userId: string): Promise<GoogleConnectionView> {
  if (!googleMeetConfigured()) return DISCONNECTED_GOOGLE_CONNECTION;

  const stored = await readConnection(userId);
  if (!stored) return DISCONNECTED_GOOGLE_CONNECTION;

  const scopes = stored.scopes ?? [];
  const health = googleConnectionHealth({
    refreshTokenPresent: Boolean(stored.refreshTokenCipher),
    reauthReason: stored.reauthReason ?? null,
    scopes,
  });

  return {
    connected: health === 'connected',
    health,
    googleEmail: stored.googleEmail ?? null,
    connectedAt: timestampToIso(stored.connectedAt),
    lastUsedAt: timestampToIso(stored.lastUsedAt),
    reauthReason: stored.reauthReason ?? null,
    scopes,
  };
}

function timestampToIso(value: { toDate?: () => Date } | null | undefined): string | null {
  const date = value?.toDate?.();
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

/* ── the OAuth exchange ──────────────────────────────────────────────────────────────────────── */

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  token_type?: string;
}

/**
 * Complete the consent round-trip and store the connection.
 *
 * The identity comes out of the `id_token` rather than a `userinfo` call: the token is already in
 * the response, and it is signed by Google over a channel authenticated by the client secret, so
 * reading its payload without re-verifying the signature is sound here — this is not a token
 * arriving from a browser, it is one just received over TLS from the token endpoint in exchange for
 * a secret only this server holds.
 */
export async function completeGoogleConnection(input: {
  code: string;
  userId: string;
  organizationId?: string | null;
}): Promise<{ ok: true; googleEmail: string | null } | { ok: false; error: string }> {
  const config = googleServerConfig();

  const response = await fetch(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(
      authorizationCodeBody({
        code: input.code,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
      }),
    ),
  });

  const body = (await response.json().catch(() => null)) as GoogleTokenResponse | null;

  if (!response.ok || !body) {
    const failure = describeGoogleApiError({ status: response.status, body });
    console.error('[office-hub] Google token exchange failed', response.status, failure.reason);
    return { ok: false, error: failure.message };
  }

  if (!body.refresh_token) {
    // `prompt=consent` is set precisely so this cannot happen. If it still does, the cause is worth
    // saying out loud, because the alternative is a connection that works for one hour.
    return {
      ok: false,
      error:
        'Google did not return a refresh token, so the connection would stop working after an ' +
        'hour. Remove Office Hub from your Google account permissions and connect again.',
    };
  }

  const scopes = (body.scope ?? '').split(' ').filter(Boolean);
  const identity = readIdTokenClaims(body.id_token);
  const sealed = sealRefreshToken(body.refresh_token);

  await connectionDoc(input.userId).set(
    {
      userId: input.userId,
      googleEmail: identity.email,
      googleUserId: identity.sub,
      refreshTokenCipher: sealed.cipher,
      refreshTokenIv: sealed.iv,
      refreshTokenTag: sealed.tag,
      keyVersion: sealed.keyVersion,
      scopes: scopes.length ? scopes : [...GOOGLE_MEET_SCOPES],
      reauthReason: null,
      connectedAt: FieldValue.serverTimestamp(),
      lastUsedAt: null,
      organizationId: input.organizationId ?? null,
    },
    { merge: true },
  );

  // A fresh grant invalidates whatever was cached for a previous one.
  accessTokenCache.delete(input.userId);

  return { ok: true, googleEmail: identity.email };
}

/** The `email` and `sub` claims, without verifying — see `completeGoogleConnection` for why. */
function readIdTokenClaims(idToken: string | undefined): { email: string | null; sub: string | null } {
  if (!idToken) return { email: null, sub: null };
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return { email: null, sub: null };
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
    return {
      email: typeof claims.email === 'string' ? claims.email : null,
      sub: typeof claims.sub === 'string' ? claims.sub : null,
    };
  } catch {
    return { email: null, sub: null };
  }
}

/**
 * Disconnect, and tell Google.
 *
 * The revoke call is best-effort: if it fails the local record is still removed, because a user who
 * clicked Disconnect must end up disconnected here regardless of what Google says. Leaving the
 * token behind so the revoke can be retried would mean the application could still act as them.
 */
export async function disconnectGoogle(userId: string): Promise<{ revoked: boolean }> {
  const stored = await readConnection(userId);
  let revoked = false;

  if (stored) {
    const refreshToken = openRefreshToken(stored);
    if (refreshToken) {
      try {
        const response = await fetch(GOOGLE_OAUTH_REVOKE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refreshToken }),
        });
        revoked = response.ok;
      } catch {
        revoked = false;
      }
    }
  }

  await connectionDoc(userId).delete();
  accessTokenCache.delete(userId);
  return { revoked };
}

/* ── access tokens ───────────────────────────────────────────────────────────────────────────── */

const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Refresh a minute early, so a token cannot expire between the check and the call using it. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export class GoogleReauthRequired extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'GoogleReauthRequired';
  }
}

/**
 * A usable access token for a user, refreshing if needed.
 *
 * The cache is per-process and therefore per serverless instance — which is the useful scope: it
 * collapses the three or four Calendar calls one "save meeting" makes into a single refresh,
 * without introducing a shared token store that would have to be secured all over again.
 *
 * `invalid_grant` is handled rather than propagated: it means the user revoked access, changed
 * their password, or left the token unused for six months. The connection is marked
 * `reauth-required` so the UI can say so, and the stored token is left in place — deleting it would
 * lose the record that a connection ever existed, and the user's next reconnect overwrites it.
 */
export async function googleAccessTokenFor(userId: string): Promise<string> {
  const cached = accessTokenCache.get(userId);
  if (cached && cached.expiresAt - TOKEN_EXPIRY_MARGIN_MS > Date.now()) return cached.token;

  const config = googleServerConfig();
  const stored = await readConnection(userId);
  if (!stored) throw new GoogleReauthRequired('No Google account is connected.');

  const refreshToken = openRefreshToken(stored);
  if (!refreshToken) {
    throw new GoogleReauthRequired(
      'The stored Google credential could not be read. Reconnect Google in Office Hub settings.',
    );
  }

  const response = await fetch(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(
      refreshTokenBody({ refreshToken, clientId: config.clientId, clientSecret: config.clientSecret }),
    ),
  });

  const body = (await response.json().catch(() => null)) as GoogleTokenResponse | null;

  if (!response.ok || !body?.access_token) {
    const failure = describeGoogleApiError({ status: response.status, body });
    if (failure.needsReconnect) {
      await connectionDoc(userId)
        .set({ reauthReason: failure.message }, { merge: true })
        .catch(() => {});
      accessTokenCache.delete(userId);
      throw new GoogleReauthRequired(failure.message);
    }
    throw new Error(failure.message);
  }

  const expiresAt = Date.now() + (body.expires_in ?? 3600) * 1000;
  accessTokenCache.set(userId, { token: body.access_token, expiresAt });

  // Clearing a stale reauth flag and stamping usage in one write. Fire-and-forget: it is bookkeeping
  // for the settings screen, and a failure here must not fail the meeting being saved.
  void connectionDoc(userId)
    .set({ lastUsedAt: FieldValue.serverTimestamp(), reauthReason: null }, { merge: true })
    .catch(() => {});

  return body.access_token;
}

/* ── the Calendar API ────────────────────────────────────────────────────────────────────────── */

export interface GoogleSyncOutcome {
  ok: boolean;
  /** Present on success. */
  conference?: GoogleConferenceResult;
  eventId?: string | null;
  calendarId?: string;
  /** Participants left off the calendar entry, and why. Always surfaced to the organizer. */
  warnings: string[];
  /** Present on failure, already written for a person. */
  error?: string;
  needsReconnect?: boolean;
  retryable?: boolean;
}

interface CalendarCallOptions {
  userId: string;
  calendarId?: string;
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}

async function calendarFetch(
  accessToken: string,
  path: string,
  init: { method: string; query?: Record<string, string>; body?: unknown },
): Promise<{ status: number; body: unknown; ok: boolean }> {
  const url = new URL(`${GOOGLE_CALENDAR_API_BASE}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);

  const response = await fetch(url, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  // Read as text first: a successful delete returns 204 with no body, and `.json()` on an empty
  // body throws — which would turn a successful call into an exception. A non-JSON error page from
  // a proxy is kept as the raw string rather than discarded, so it reaches the log.
  const text = await response.text();
  return { status: response.status, body: text ? parseJsonOrText(text) : null, ok: response.ok };
}

function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Create the Google Calendar event and its Meet conference.
 *
 * `conferenceDataVersion=1` is mandatory and easy to miss: without it Google accepts the request,
 * ignores `conferenceData` entirely, and returns a perfectly valid event with no Meet link — a
 * success that produces nothing, which is the hardest kind of bug to see.
 */
export async function createGoogleMeetEvent(
  input: GoogleEventInput,
  options: CalendarCallOptions,
): Promise<GoogleSyncOutcome> {
  const calendarId = options.calendarId || DEFAULT_GOOGLE_MEET_SETTINGS.calendarId;
  const { body, warnings } = buildGoogleEventBody({ ...input, requestConference: true });

  try {
    const accessToken = await googleAccessTokenFor(options.userId);
    const result = await calendarFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      query: {
        conferenceDataVersion: '1',
        sendUpdates: normalizeSendUpdates(options.sendUpdates),
      },
      body,
    });

    if (!result.ok) return failureOutcome(result, warnings);

    const conference = readGoogleConference(result.body as Parameters<typeof readGoogleConference>[0]);
    if (!conference.joinUrl && conference.conferenceStatus !== 'pending') {
      warnings.push(
        'Google created the calendar event but did not return a Meet link. Retry the Meet link ' +
          'from the meeting page.',
      );
    }

    return { ok: true, conference, eventId: conference.eventId, calendarId, warnings };
  } catch (error) {
    return thrownOutcome(error, warnings);
  }
}

/**
 * Patch an existing event.
 *
 * A patch rather than an update, so fields Office Hub does not manage — a colour a user set, a
 * reminder they added — survive an edit here. The conference is only requested when the event does
 * not already have one, which is the "meeting switched from in-person to online" case; asking again
 * for an event that has a Meet would be harmless but sends a `createRequest` Google has to ignore.
 */
export async function patchGoogleMeetEvent(
  input: GoogleEventInput & { eventId: string; hasConference: boolean },
  options: CalendarCallOptions,
): Promise<GoogleSyncOutcome> {
  const calendarId = options.calendarId || DEFAULT_GOOGLE_MEET_SETTINGS.calendarId;
  const { body, warnings } = buildGoogleEventBody({ ...input, requestConference: !input.hasConference });

  try {
    const accessToken = await googleAccessTokenFor(options.userId);
    const result = await calendarFetch(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      {
        method: 'PATCH',
        query: {
          conferenceDataVersion: '1',
          sendUpdates: normalizeSendUpdates(options.sendUpdates),
        },
        body,
      },
    );

    if (!result.ok) return failureOutcome(result, warnings);

    const conference = readGoogleConference(result.body as Parameters<typeof readGoogleConference>[0]);
    return { ok: true, conference, eventId: conference.eventId ?? input.eventId, calendarId, warnings };
  } catch (error) {
    return thrownOutcome(error, warnings);
  }
}

/**
 * Delete the event, which is what retracts it from participants' calendars.
 *
 * An already-absent event counts as success. The caller's intent is "this should not be on anyone's
 * calendar", and a 404 means it is not — reporting that as a failure would leave a cancelled meeting
 * permanently showing a sync error nobody can clear.
 */
export async function deleteGoogleMeetEvent(
  input: { eventId: string },
  options: CalendarCallOptions,
): Promise<GoogleSyncOutcome> {
  const calendarId = options.calendarId || DEFAULT_GOOGLE_MEET_SETTINGS.calendarId;

  try {
    const accessToken = await googleAccessTokenFor(options.userId);
    const result = await calendarFetch(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      { method: 'DELETE', query: { sendUpdates: normalizeSendUpdates(options.sendUpdates) } },
    );

    if (result.ok) return { ok: true, warnings: [], calendarId };

    const failure = describeGoogleApiError({ status: result.status, body: result.body });
    if (failure.gone) return { ok: true, warnings: [], calendarId };
    return {
      ok: false,
      warnings: [],
      error: failure.message,
      needsReconnect: failure.needsReconnect,
      retryable: failure.retryable,
    };
  } catch (error) {
    return thrownOutcome(error, []);
  }
}

function failureOutcome(
  result: { status: number; body: unknown },
  warnings: string[],
): GoogleSyncOutcome {
  const failure = describeGoogleApiError({ status: result.status, body: result.body });
  // The status and Google's own reason go to the log; only the written message goes to the screen.
  console.error('[office-hub] Google Calendar call failed', result.status, failure.reason);
  return {
    ok: false,
    warnings,
    error: failure.message,
    needsReconnect: failure.needsReconnect,
    retryable: failure.retryable,
  };
}

function thrownOutcome(error: unknown, warnings: string[]): GoogleSyncOutcome {
  if (error instanceof GoogleReauthRequired) {
    return { ok: false, warnings, error: error.reason, needsReconnect: true, retryable: false };
  }
  if (error instanceof GoogleConfigError) {
    console.error('[office-hub] Google Meet is misconfigured:', error.detail);
    return { ok: false, warnings, error: error.message, needsReconnect: false, retryable: false };
  }
  console.error('[office-hub] Google Calendar call threw', error);
  return {
    ok: false,
    warnings,
    // A thrown fetch is a network fault, not a rejection, so it is worth retrying.
    error: 'Google Calendar could not be reached. The meeting is saved; its Meet link will follow.',
    needsReconnect: false,
    retryable: true,
  };
}

/* ── syncing one meeting ─────────────────────────────────────────────────────────────────────── */

export interface SyncMeetingResult {
  ok: boolean;
  action: GoogleSyncAction;
  reason: string;
  meetUrl: string | null;
  eventId: string | null;
  htmlLink: string | null;
  warnings: string[];
  error?: string;
  needsReconnect?: boolean;
  retryable?: boolean;
}

/**
 * Bring one meeting's Google state in line with the meeting, and record what happened.
 *
 * The single entry point for every caller — the create path, the edit path, the cancel path, the
 * manual retry button and the cron sweep all call this, so the decision about what Google needs is
 * made in one place from the meeting document rather than five times from whatever each caller
 * happens to know.
 *
 * ── It does not throw ──────────────────────────────────────────────────────────────────────────
 *
 * Deliberately. A meeting is a real thing that exists in this office whether or not Google was
 * reachable when it was saved; failing the save because a calendar API returned 503 would be the
 * integration deciding it is more important than the meeting. Failures are written to
 * `googleSyncState: 'failed'` with a readable `googleSyncError`, which the meeting page shows with
 * a Retry, and which the sweep picks up on its own.
 */
export async function syncMeetingToGoogle(input: {
  meetingId: string;
  /** Whose Google account to act as. Defaults to the meeting's organizer. */
  asUserId?: string;
  intent?: 'save' | 'cancel';
  settings?: GoogleMeetRuntimeSettings;
}): Promise<SyncMeetingResult> {
  const firestore = getFirebaseAdminFirestore();
  const meetingRef = firestore.collection(OFFICE_HUB_COLLECTIONS.meetings).doc(input.meetingId);
  const snapshot = await meetingRef.get();

  if (!snapshot.exists) {
    return emptyResult('none', 'That meeting no longer exists.', { ok: false, error: 'Meeting not found.' });
  }

  const meeting = { ...(snapshot.data() as Record<string, unknown>), id: snapshot.id } as OfficeHubMeeting;
  const settings = input.settings ?? (await googleMeetSettings());
  const intent = input.intent ?? 'save';

  if (!settings.enabled) {
    return emptyResult('none', 'Google Meet is switched off in Office Hub settings.', { ok: true });
  }
  if (!googleMeetConfigured()) {
    return emptyResult('none', googleMeetConfigurationProblems().join(' '), {
      ok: false,
      error: 'Google Meet is not configured on this server.',
    });
  }

  const plan = googleSyncPlan(meeting, intent);
  const actingUserId = input.asUserId || meeting.googleOrganizerUserId || meeting.organizerId;

  if (plan.action === 'none') {
    return emptyResult('none', plan.reason, { ok: true });
  }

  /**
   * A series instance shares the parent's conference. No API call, no token, no organizer needing
   * to be signed in — which is what lets the nightly series top-up produce joinable instances.
   */
  if (plan.action === 'inherit') {
    const parentId = plan.inheritFromMeetingId;
    if (!parentId || parentId === meeting.id) {
      return emptyResult('none', 'This occurrence has no series parent to inherit from.', { ok: true });
    }
    const parent = await firestore.collection(OFFICE_HUB_COLLECTIONS.meetings).doc(parentId).get();
    const parentMeetUrl = (parent.data() as OfficeHubMeeting | undefined)?.googleMeetUrl ?? null;

    if (!parentMeetUrl) {
      return emptyResult('inherit', 'The series does not have a Meet link yet.', { ok: true });
    }

    await meetingRef.set(
      {
        googleMeetUrl: parentMeetUrl,
        meetingUrl: parentMeetUrl,
        googleCalendarId: (parent.data() as OfficeHubMeeting | undefined)?.googleCalendarId ?? settings.calendarId,
        googleOrganizerUserId:
          (parent.data() as OfficeHubMeeting | undefined)?.googleOrganizerUserId ?? actingUserId,
        googleSyncState: 'inherited',
        googleSyncError: null,
        googleSyncedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    return {
      ok: true,
      action: 'inherit',
      reason: plan.reason,
      meetUrl: parentMeetUrl,
      eventId: null,
      htmlLink: null,
      warnings: [],
    };
  }

  if (plan.action === 'cancel') {
    const outcome = await deleteGoogleMeetEvent(
      { eventId: String(meeting.googleEventId) },
      { userId: actingUserId, calendarId: meeting.googleCalendarId ?? settings.calendarId, sendUpdates: settings.sendUpdates },
    );

    if (outcome.ok) {
      await meetingRef.set(
        {
          googleEventId: null,
          googleEventHtmlLink: null,
          googleSyncState: 'not-synced',
          googleSyncError: null,
          googleSyncedAt: new Date().toISOString(),
          // `googleMeetUrl` is cleared too: the conference dies with the event, so leaving the URL
          // would show a Join button that opens a Meet nobody can enter.
          googleMeetUrl: null,
        },
        { merge: true },
      );
    } else {
      await recordSyncFailure(meetingRef, outcome.error);
    }

    return {
      ok: outcome.ok,
      action: 'cancel',
      reason: plan.reason,
      meetUrl: null,
      eventId: null,
      htmlLink: null,
      warnings: outcome.warnings,
      error: outcome.error,
      needsReconnect: outcome.needsReconnect,
      retryable: outcome.retryable,
    };
  }

  // create | update — both need the guest list.
  const participantSnapshot = await firestore
    .collection(OFFICE_HUB_COLLECTIONS.participants)
    .where('meetingId', '==', meeting.id)
    .get();

  const attendees = participantSnapshot.docs.map((entry) => {
    const data = entry.data() as Record<string, unknown>;
    return {
      email: typeof data.email === 'string' ? data.email : null,
      name: typeof data.name === 'string' ? data.name : null,
      attendanceRole: typeof data.attendanceRole === 'string' ? data.attendanceRole : null,
    };
  });

  const eventInput: GoogleEventInput = {
    meeting,
    attendees,
    meetingUrl: `${appBaseUrl()}/office-hub/meetings/${meeting.id}`,
  };

  const callOptions: CalendarCallOptions = {
    userId: actingUserId,
    calendarId: meeting.googleCalendarId ?? settings.calendarId,
    sendUpdates: settings.sendUpdates,
  };

  const outcome =
    plan.action === 'update' && meeting.googleEventId
      ? await patchGoogleMeetEvent(
          { ...eventInput, eventId: meeting.googleEventId, hasConference: Boolean(meeting.googleMeetUrl) },
          callOptions,
        )
      : await createGoogleMeetEvent(eventInput, callOptions);

  if (!outcome.ok) {
    await recordSyncFailure(meetingRef, outcome.error);
    return {
      ok: false,
      action: plan.action,
      reason: plan.reason,
      meetUrl: meeting.googleMeetUrl ?? null,
      eventId: meeting.googleEventId ?? null,
      htmlLink: meeting.googleEventHtmlLink ?? null,
      warnings: outcome.warnings,
      error: outcome.error,
      needsReconnect: outcome.needsReconnect,
      retryable: outcome.retryable,
    };
  }

  const conference = outcome.conference;
  const meetUrl = conference?.joinUrl ?? meeting.googleMeetUrl ?? null;

  await meetingRef.set(
    {
      googleEventId: outcome.eventId ?? meeting.googleEventId ?? null,
      googleCalendarId: outcome.calendarId ?? settings.calendarId,
      googleOrganizerUserId: actingUserId,
      googleEventHtmlLink: conference?.htmlLink ?? meeting.googleEventHtmlLink ?? null,
      ...(meetUrl
        ? {
            googleMeetUrl: meetUrl,
            // `meetingUrl` is what every screen reads for the Join button, so it is kept in step.
            meetingUrl: meetUrl,
            onlinePlatform: 'Google Meet',
          }
        : {}),
      // The dial-in PIN, where Google gave one. Written into the existing passcode field rather
      // than a new one, because that is the field the meeting page already shows.
      ...(conference?.phonePin ? { meetingPasscode: conference.phonePin } : {}),
      googleSyncState: conference?.conferenceStatus === 'pending' ? 'not-synced' : 'synced',
      googleSyncError: null,
      googleSyncedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  // The instances of a series inherit from the parent, and the parent has only just acquired its
  // link — so push it down now rather than waiting for the nightly sweep to do it.
  if (meetUrl && meeting.isSeriesParent && meeting.seriesId) {
    await propagateSeriesMeetLink(meeting.seriesId, meeting.id, meetUrl, outcome.calendarId ?? settings.calendarId, actingUserId);
  }

  return {
    ok: true,
    action: plan.action,
    reason: plan.reason,
    meetUrl,
    eventId: outcome.eventId ?? null,
    htmlLink: conference?.htmlLink ?? null,
    warnings: outcome.warnings,
  };
}

/** Copy a series' Meet link onto every instance that does not have one. */
async function propagateSeriesMeetLink(
  seriesId: string,
  parentId: string,
  meetUrl: string,
  calendarId: string,
  actingUserId: string,
): Promise<number> {
  const firestore = getFirebaseAdminFirestore();
  const instances = await firestore
    .collection(OFFICE_HUB_COLLECTIONS.meetings)
    .where('seriesId', '==', seriesId)
    .get();

  const batch = firestore.batch();
  let touched = 0;

  for (const entry of instances.docs) {
    if (entry.id === parentId) continue;
    const data = entry.data() as OfficeHubMeeting;
    if (data.googleMeetUrl === meetUrl) continue;
    // An occurrence that was edited on its own owns a separate event; leave it alone.
    if (data.googleEventId) continue;

    batch.set(
      entry.ref,
      {
        googleMeetUrl: meetUrl,
        meetingUrl: meetUrl,
        googleCalendarId: calendarId,
        googleOrganizerUserId: actingUserId,
        googleSyncState: 'inherited',
        googleSyncError: null,
        googleSyncedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    touched += 1;
  }

  if (touched) await batch.commit();
  return touched;
}

async function recordSyncFailure(
  ref: DocumentReference,
  error: string | undefined,
): Promise<void> {
  await ref
    .set(
      {
        googleSyncState: 'failed',
        googleSyncError: error ?? 'The Meet link could not be created.',
        googleSyncedAt: new Date().toISOString(),
      },
      { merge: true },
    )
    .catch(() => {});
}

function emptyResult(
  action: GoogleSyncAction,
  reason: string,
  extra: { ok: boolean; error?: string },
): SyncMeetingResult {
  return {
    ok: extra.ok,
    action,
    reason,
    meetUrl: null,
    eventId: null,
    htmlLink: null,
    warnings: [],
    error: extra.error,
  };
}

/**
 * Retry the meetings whose Google sync failed (§62's sweep).
 *
 * Bounded, and ordered oldest-first, so a persistent failure cannot consume the whole sweep. Only
 * future meetings are retried: a Meet link for a meeting that already happened is of no use to
 * anybody, and retrying it forever would keep the error on the screen.
 */
export async function retryFailedGoogleSyncs(options: { now?: Date; limit?: number } = {}): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
}> {
  if (!googleMeetConfigured()) return { attempted: 0, succeeded: 0, failed: 0 };

  const settings = await googleMeetSettings();
  if (!settings.enabled) return { attempted: 0, succeeded: 0, failed: 0 };

  const now = options.now ?? new Date();
  const limit = options.limit ?? 25;

  const pending = await getFirebaseAdminFirestore()
    .collection(OFFICE_HUB_COLLECTIONS.meetings)
    .where('googleSyncState', '==', 'failed')
    .where('startAt', '>=', now.toISOString())
    .orderBy('startAt', 'asc')
    .limit(limit)
    .get();

  let succeeded = 0;
  let failed = 0;

  for (const entry of pending.docs) {
    const result = await syncMeetingToGoogle({ meetingId: entry.id, settings });
    if (result.ok) succeeded += 1;
    else failed += 1;
  }

  return { attempted: pending.size, succeeded, failed };
}

/* ── the settings this reads ─────────────────────────────────────────────────────────────────── */

export interface GoogleMeetRuntimeSettings {
  enabled: boolean;
  sendUpdates: 'all' | 'externalOnly' | 'none';
  calendarId: string;
}

/** Read the Google half of the settings document through the Admin SDK. */
export async function googleMeetSettings(): Promise<GoogleMeetRuntimeSettings> {
  try {
    const snapshot = await getFirebaseAdminFirestore()
      .collection(OFFICE_HUB_COLLECTIONS.settings)
      .doc(OFFICE_HUB_SETTINGS_DOC_ID)
      .get();

    const data = (snapshot.data() ?? {}) as Record<string, unknown>;
    return {
      enabled: data.googleMeetEnabled !== false,
      sendUpdates: normalizeSendUpdates(data.googleSendUpdates),
      calendarId:
        typeof data.googleCalendarId === 'string' && data.googleCalendarId.trim()
          ? data.googleCalendarId.trim()
          : DEFAULT_GOOGLE_MEET_SETTINGS.calendarId,
    };
  } catch {
    // An installation that has never opened Settings has no document, and a meeting must still get
    // a Meet link.
    return { ...DEFAULT_GOOGLE_MEET_SETTINGS };
  }
}
