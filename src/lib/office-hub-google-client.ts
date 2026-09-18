'use client';

/**
 * Office Hub — the browser's side of the Google Meet integration.
 *
 * A thin, deliberately uninteresting file: every call is a `fetch` to a route in
 * `src/app/api/office-hub/google/`, carrying the user's Firebase ID token. Nothing here knows an
 * OAuth client secret, holds a refresh token or talks to Google — the browser cannot be trusted
 * with any of the three, so it is given none of them and asks the server instead.
 *
 * The `MeetingProvider` registered at the bottom is what makes the meeting form offer a
 * "Create Meet link" button: `meeting-form.tsx` reads `supportsCreation` off whatever provider is
 * registered for the platform, so registering this one is the whole of the wiring.
 */

import { auth } from './firebase';
import { registerMeetingProvider, type MeetingProvider } from './office-hub-integrations';
import {
  DISCONNECTED_GOOGLE_CONNECTION,
  DEFAULT_GOOGLE_MEET_SETTINGS,
  isGoogleMeetUrl,
  type GoogleConnectionView,
  type GoogleMeetSettingsView,
} from './office-hub-google';

const STATUS_ENDPOINT = '/api/office-hub/google/status';
const AUTHORIZE_ENDPOINT = '/api/office-hub/google/authorize';
const EVENT_ENDPOINT = '/api/office-hub/google/event';

async function authorizedFetch(
  url: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Sign in again.');

  const token = await user.getIdToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

/* ── connection state ────────────────────────────────────────────────────────────────────────── */

export interface GoogleMeetStatus {
  /** Whether the server has an OAuth client and an encryption key. */
  configured: boolean;
  connection: GoogleConnectionView;
  settings: GoogleMeetSettingsView;
  /** Which environment variables are missing. Only present when `configured` is false. */
  configurationProblems: string[];
}

export const UNCONFIGURED_GOOGLE_STATUS: GoogleMeetStatus = {
  configured: false,
  connection: DISCONNECTED_GOOGLE_CONNECTION,
  settings: DEFAULT_GOOGLE_MEET_SETTINGS,
  configurationProblems: [],
};

/**
 * The caller's own connection state.
 *
 * Never throws for a *reported* problem — an unconfigured server, a disconnected account and a
 * revoked grant are all states the Settings card renders, not failures. It does propagate a
 * genuinely broken request, so a caller can tell "not connected" from "could not find out".
 */
export async function fetchGoogleMeetStatus(): Promise<GoogleMeetStatus> {
  const { ok, data } = await authorizedFetch(STATUS_ENDPOINT, { method: 'GET' });
  if (!ok) throw new Error(typeof data.error === 'string' ? data.error : 'Could not read the Google connection.');

  return {
    configured: data.configured === true,
    connection: (data.connection as GoogleConnectionView | null) ?? DISCONNECTED_GOOGLE_CONNECTION,
    settings: (data.settings as GoogleMeetSettingsView | undefined) ?? DEFAULT_GOOGLE_MEET_SETTINGS,
    configurationProblems: Array.isArray(data.configurationProblems)
      ? (data.configurationProblems as string[])
      : [],
  };
}

/**
 * Send the user to Google's consent screen.
 *
 * A full-page navigation rather than a popup: a popup needs `window.opener` messaging to report
 * back, and browsers increasingly sever that. The callback returns the user to `returnTo` with the
 * outcome in the query string, which works with no assumptions about window handling at all.
 */
export async function startGoogleConnect(returnTo?: string): Promise<void> {
  const target = returnTo ?? `${window.location.pathname}${window.location.search}`;
  const { ok, data } = await authorizedFetch(
    `${AUTHORIZE_ENDPOINT}?returnTo=${encodeURIComponent(target)}`,
    { method: 'GET' },
  );

  if (!ok || typeof data.authorizeUrl !== 'string') {
    const detail = typeof data.detail === 'string' ? ` ${data.detail}` : '';
    throw new Error(
      `${typeof data.error === 'string' ? data.error : 'Google could not be reached.'}${detail}`,
    );
  }

  window.location.assign(data.authorizeUrl);
}

export async function disconnectGoogleMeet(): Promise<string> {
  const { ok, data } = await authorizedFetch(STATUS_ENDPOINT, { method: 'DELETE' });
  if (!ok) throw new Error(typeof data.error === 'string' ? data.error : 'Could not disconnect Google.');
  return typeof data.message === 'string' ? data.message : 'Google disconnected.';
}

/**
 * Read the outcome the OAuth callback put in the query string.
 *
 * Returns null when there is nothing to report, so a screen can call it unconditionally on mount.
 * The caller is expected to clear the parameters afterwards — otherwise a refresh re-announces a
 * connection that happened ten minutes ago.
 */
export function readGoogleCallbackOutcome(
  search: string | URLSearchParams,
): { tone: 'success' | 'error'; message: string } | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const outcome = params.get('google');
  if (!outcome) return null;

  const message = params.get('message');

  switch (outcome) {
    case 'connected': {
      const account = params.get('account');
      return {
        tone: 'success',
        message: account
          ? `Google connected as ${account}. Meetings you organise will get a Meet link.`
          : 'Google connected. Meetings you organise will get a Meet link.',
      };
    }
    case 'denied':
      return { tone: 'error', message: message || 'Google access was not granted.' };
    case 'unconfigured':
      return {
        tone: 'error',
        message:
          message ||
          'Google Meet is not configured on this server. An administrator needs to set the ' +
            'Google OAuth variables.',
      };
    case 'invalid-state':
      return { tone: 'error', message: message || 'That Google sign-in could not be verified. Try again.' };
    default:
      return { tone: 'error', message: message || 'The Google connection did not complete.' };
  }
}

/** The query parameters the callback adds, so a screen can strip them once it has read them. */
export const GOOGLE_CALLBACK_PARAMS = ['google', 'message', 'account'] as const;

/* ── creating the conference ─────────────────────────────────────────────────────────────────── */

export interface GoogleMeetSyncResult {
  ok: boolean;
  meetUrl: string | null;
  action: string;
  warnings: string[];
  error?: string;
  /** The organizer has never connected Google: offer "Connect Google" rather than "Retry". */
  needsConnect?: boolean;
  /** The organizer's connection was rejected by Google: offer "Reconnect Google". */
  needsReconnect?: boolean;
}

/** Create or refresh the Meet link for a saved meeting. */
export async function syncGoogleMeet(meetingId: string): Promise<GoogleMeetSyncResult> {
  const { ok, data } = await authorizedFetch(EVENT_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({ meetingId }),
  });

  if (!ok) {
    return {
      ok: false,
      meetUrl: null,
      action: 'none',
      warnings: [],
      error: typeof data.error === 'string' ? data.error : 'The Meet link could not be created.',
      needsConnect: data.needsConnect === true,
    };
  }

  return {
    ok: data.ok === true,
    meetUrl: typeof data.meetUrl === 'string' ? data.meetUrl : null,
    action: typeof data.action === 'string' ? data.action : 'none',
    warnings: Array.isArray(data.warnings) ? (data.warnings as string[]) : [],
    error: typeof data.error === 'string' ? data.error : undefined,
    needsReconnect: data.needsReconnect === true,
  };
}

/** Withdraw the calendar event, which removes it from participants' Google Calendars. */
export async function withdrawGoogleMeet(meetingId: string): Promise<GoogleMeetSyncResult> {
  const { ok, data } = await authorizedFetch(EVENT_ENDPOINT, {
    method: 'DELETE',
    body: JSON.stringify({ meetingId }),
  });

  return {
    ok: ok && data.ok === true,
    meetUrl: null,
    action: 'cancel',
    warnings: Array.isArray(data.warnings) ? (data.warnings as string[]) : [],
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

/* ── the provider ────────────────────────────────────────────────────────────────────────────── */

/**
 * Google Meet as a `MeetingProvider`.
 *
 * `supportsCreation: true` is what changes the meeting form from "paste a link" to "Office Hub will
 * create the link". `validateUrl` still exists and is still used, for the one case that remains: a
 * meeting whose link was pasted before this integration, and a person who wants to point at an
 * existing Meet room rather than have a new one made.
 */
export const googleMeetProvider: MeetingProvider = {
  id: 'google-meet',
  platform: 'Google Meet',
  label: 'Google Meet',
  supportsCreation: true,

  validateUrl(url: string) {
    const trimmed = url.trim();
    if (!trimmed) return { ok: false, reason: 'Paste the Meet link, or let Office Hub create one.' };
    if (!isGoogleMeetUrl(trimmed)) {
      return {
        ok: false,
        reason: 'That is not a Google Meet link. It should look like https://meet.google.com/abc-defg-hij',
      };
    }
    return { ok: true, reason: null };
  },

  async create(input) {
    if (!input.meetingId) {
      // Not reachable from the form, which only offers the button once the meeting is saved — but
      // an explanation beats `undefined` if another caller ever gets here.
      return {
        ok: false,
        error:
          'Save the meeting first. A Meet link is created together with its Google Calendar event, ' +
          'so the meeting has to exist before the link can be made.',
      };
    }

    const result = await syncGoogleMeet(input.meetingId);
    return result.ok && result.meetUrl
      ? { ok: true, joinUrl: result.meetUrl, warnings: result.warnings }
      : {
          ok: false,
          error: result.error ?? 'Google did not return a Meet link.',
          warnings: result.warnings,
          needsConnect: result.needsConnect,
        };
  },
};

/**
 * Register the provider.
 *
 * Called at module scope so that importing this file is the registration — there is no "did
 * somebody remember to call setup()" failure mode. `OfficeHubProvider` imports it, which covers
 * every screen in the module.
 */
registerMeetingProvider(googleMeetProvider);

export function ensureGoogleMeetProviderRegistered(): void {
  registerMeetingProvider(googleMeetProvider);
}
