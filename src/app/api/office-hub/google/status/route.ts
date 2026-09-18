import { NextResponse } from 'next/server';

import { AccessDeniedError, accessErrorResponse, authenticateAccess } from '@/lib/access-control-server';
import {
  disconnectGoogle,
  googleConnectionFor,
  googleMeetConfigurationProblems,
  googleMeetConfigured,
  googleMeetSettings,
} from '@/lib/office-hub-google-server';

/**
 * The caller's own Google connection (`GET`), and disconnecting it (`DELETE`).
 *
 * ── Only ever your own ────────────────────────────────────────────────────────────────────────
 *
 * There is no `userId` parameter, by design. The subject is always `context.userId` from the
 * verified token, so no permission level lets one user inspect or revoke another's Google
 * connection — an administrator who needs that uses Google's own admin tools, which is where such
 * a decision belongs and where it is audited.
 *
 * What comes back is the redacted `GoogleConnectionView`: connection state, the Google account's
 * address and the granted scopes. The refresh token, its encryption envelope and every access token
 * stay on the server — see the header of `office-hub-google-server.ts`.
 *
 * `configurationProblems` is included only when the integration is not set up, so the Settings
 * screen can tell an administrator which environment variable is missing instead of showing a
 * Connect button that cannot work. It names variables, never their values.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    const configured = googleMeetConfigured();

    const [connection, settings] = await Promise.all([
      configured ? googleConnectionFor(context.userId) : Promise.resolve(null),
      googleMeetSettings(),
    ]);

    return NextResponse.json({
      configured,
      settings,
      connection,
      ...(configured ? {} : { configurationProblems: googleMeetConfigurationProblems() }),
    });
  } catch (error) {
    return errorResponse(error, 'status');
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await authenticateAccess(request);
    const { revoked } = await disconnectGoogle(context.userId);

    return NextResponse.json({
      ok: true,
      revoked,
      message: revoked
        ? 'Google disconnected. Office Hub can no longer create Meet links for you.'
        : // Honest about the partial outcome: the local grant is gone either way, but the user may
          // want to remove Office Hub from their Google account permissions themselves.
          'Google disconnected here. Google did not confirm the revocation — check ' +
          'myaccount.google.com/permissions if you want to be certain.',
    });
  } catch (error) {
    return errorResponse(error, 'disconnect');
  }
}

function errorResponse(error: unknown, operation: string): NextResponse {
  const { message, status } = accessErrorResponse(error);
  if (!(error instanceof AccessDeniedError) && status === 500) {
    console.error(`[office-hub] Google ${operation} failed`, error);
  }
  return NextResponse.json({ error: message }, { status });
}
