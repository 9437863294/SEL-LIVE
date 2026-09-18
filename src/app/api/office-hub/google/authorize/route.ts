import { NextResponse } from 'next/server';

import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccess,
  requireAccess,
} from '@/lib/access-control-server';
import { OFFICE_HUB_RESOURCES } from '@/lib/office-hub-permissions';
import {
  GoogleConfigError,
  googleAuthorizeUrl,
  googleMeetConfigurationProblems,
} from '@/lib/office-hub-google-server';

/**
 * Start the Google consent flow (`GET /api/office-hub/google/authorize`).
 *
 * Returns the consent URL rather than a 302, and the browser navigates to it. Two reasons: the
 * caller has to send a bearer token, which a plain `window.location` navigation cannot do, and a
 * JSON reply lets the Settings screen show a configuration problem in place rather than bouncing
 * the user to a Google error page they cannot interpret.
 *
 * ── What "authorised to do this" means here ────────────────────────────────────────────────────
 *
 * Creating a meeting. The connection is the user's own Google account and only ever affects their
 * own calendar and the meetings they organise, so the gate is the permission that makes the
 * connection useful — not a separate one, and not the Settings permission, which is for
 * administering the module rather than connecting yourself to it.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, OFFICE_HUB_RESOURCES.meetings, 'create');

    const returnTo = new URL(request.url).searchParams.get('returnTo');

    return NextResponse.json({
      authorizeUrl: googleAuthorizeUrl({
        userId: context.userId,
        userEmail: context.userEmail,
        returnTo,
      }),
    });
  } catch (error) {
    if (error instanceof GoogleConfigError) {
      // An operator problem, not a security-sensitive one: say which variable is missing, exactly
      // as `accessErrorResponse` does for a missing Admin credential.
      return NextResponse.json(
        { error: error.message, detail: error.detail, problems: googleMeetConfigurationProblems() },
        { status: 503 },
      );
    }
    const { message, status } = accessErrorResponse(error);
    if (!(error instanceof AccessDeniedError) && status === 500) {
      console.error('[office-hub] Google authorize failed', error);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
