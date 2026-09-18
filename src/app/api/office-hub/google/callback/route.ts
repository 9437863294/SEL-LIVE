import { NextResponse } from 'next/server';

import {
  GoogleConfigError,
  completeGoogleConnection,
  googleServerConfig,
  verifySignedState,
} from '@/lib/office-hub-google-server';
import { safeReturnTo } from '@/lib/office-hub-google';

/**
 * Where Google sends the browser after consent (`GET /api/office-hub/google/callback`).
 *
 * ── How this request is authenticated, given that it has no token ──────────────────────────────
 *
 * It arrives as a top-level navigation from accounts.google.com, so there is no `Authorization`
 * header to read and no way to add one. The caller's identity therefore comes from the **signed
 * `state` parameter**, which `/authorize` issued to an already-authenticated user and HMAC'd with
 * the OAuth client secret. Verifying that signature is the whole of the authentication, which is
 * why it is a constant-time compare over a payload with a 15-minute lifetime rather than a decode.
 *
 * Without the signature this endpoint would be an account-binding vulnerability: an attacker could
 * complete their own consent, take the resulting `code`, and hand a victim a callback URL carrying
 * that code alongside the victim's user id — leaving the victim's Office Hub account creating
 * meetings on the *attacker's* Google calendar, with the attacker able to read every invitation.
 * The signature makes such a URL unforgeable.
 *
 * Replay is handled by Google rather than here: an authorization code is single-use, so a second
 * request with the same code fails at the exchange.
 *
 * ── Why it redirects instead of returning JSON ─────────────────────────────────────────────────
 *
 * The user is looking at a browser tab that Google navigated. JSON would leave them staring at a
 * payload. The outcome is carried back as a query parameter on an in-application path, and the
 * Settings screen turns it into a message — with `safeReturnTo` refusing anything that is not a
 * local path, because an open redirect on an OAuth callback is a URL people are trained to click.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FALLBACK = '/office-hub/settings';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  let config;
  try {
    config = googleServerConfig();
  } catch (error) {
    if (error instanceof GoogleConfigError) {
      return redirectBack(request, FALLBACK, { google: 'unconfigured' });
    }
    throw error;
  }

  const verified = verifySignedState(params.get('state'), config);
  if (!verified.ok) {
    // The state is what identifies the user, so a bad one cannot be redirected "back" to anywhere
    // they chose — only to the default page, with the reason.
    return redirectBack(request, FALLBACK, { google: 'invalid-state', message: verified.reason });
  }

  const returnTo = safeReturnTo(verified.state.returnTo, FALLBACK);

  // The user pressed Cancel, or Google refused. Not an error worth logging.
  const denied = params.get('error');
  if (denied) {
    return redirectBack(request, returnTo, {
      google: 'denied',
      message:
        denied === 'access_denied'
          ? 'Google access was not granted, so Office Hub cannot create Meet links for you yet.'
          : 'Google did not complete the connection. Try again.',
    });
  }

  const code = params.get('code');
  if (!code) {
    return redirectBack(request, returnTo, { google: 'denied', message: 'Google did not return an authorization code.' });
  }

  try {
    const result = await completeGoogleConnection({ code, userId: verified.state.userId });

    return result.ok
      ? redirectBack(request, returnTo, { google: 'connected', account: result.googleEmail ?? '' })
      : redirectBack(request, returnTo, { google: 'failed', message: result.error });
  } catch (error) {
    if (error instanceof GoogleConfigError) {
      console.error('[office-hub] Google callback blocked by configuration:', error.detail);
      return redirectBack(request, returnTo, { google: 'unconfigured', message: error.message });
    }
    console.error('[office-hub] Google callback failed', error);
    return redirectBack(request, returnTo, {
      google: 'failed',
      message: 'The Google connection could not be completed.',
    });
  }
}

function redirectBack(
  request: Request,
  path: string,
  query: Record<string, string | undefined>,
): NextResponse {
  const target = new URL(path, new URL(request.url).origin);
  for (const [key, value] of Object.entries(query)) {
    if (value) target.searchParams.set(key, value);
  }
  return NextResponse.redirect(target, { status: 303 });
}
