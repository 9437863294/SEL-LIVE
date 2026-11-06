import { NextResponse } from 'next/server';

import { AccessDeniedError, accessErrorResponse, authenticateAccess } from '@/lib/access-control-server';
import { resolveOfficeHubCapabilities } from '@/lib/office-hub-permissions';
import {
  googleMeetConfigured,
  setSharedGoogleAccount,
  sharedGoogleAccount,
} from '@/lib/office-hub-google-server';

/**
 * Share your own connected Google account as the office account (`POST { share: true }`), or stop
 * sharing it (`POST { share: false }`).
 *
 * The office account creates Meet links for every meeting whose organizer (and scheduler) has not
 * connected Google, so nobody else has to. Two rules keep that safe:
 *
 *   • **Only your own account can be shared.** There is no user id in the request — the subject is
 *     the verified caller — so an administrator cannot hand out a colleague's Google access.
 *   • **Sharing needs Office Hub Settings › Edit**, because it decides whose calendar every such
 *     meeting is written to. Stopping is allowed to the account's owner as well, since withdrawing
 *     your own account must never depend on somebody else's permission.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    if (!googleMeetConfigured()) {
      return NextResponse.json({ error: 'Google Meet is not configured on this server.' }, { status: 503 });
    }

    const payload = (await request.json().catch(() => ({}))) as { share?: unknown };
    if (typeof payload.share !== 'boolean') {
      return NextResponse.json({ error: '`share` must be true or false.' }, { status: 400 });
    }

    const viewer = { userId: context.userId, name: context.userName, email: context.userEmail };
    const canEditSettings = resolveOfficeHubCapabilities(context.access, viewer).canEditSettings;

    if (payload.share && !canEditSettings) {
      return NextResponse.json(
        { error: 'Only someone who can edit Office Hub settings can share their Google account for everyone.' },
        { status: 403 },
      );
    }
    if (!payload.share && !canEditSettings) {
      const current = await sharedGoogleAccount();
      if (current && current.ownerUserId !== context.userId) {
        return NextResponse.json({ error: 'Only its owner or a settings editor can stop sharing it.' }, { status: 403 });
      }
    }

    const outcome = await setSharedGoogleAccount({
      userId: context.userId,
      userName: context.userName ?? null,
      share: payload.share,
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 409 });

    return NextResponse.json({
      ok: true,
      message: payload.share
        ? 'Your Google account now creates Meet links for everyone who has not connected their own.'
        : 'Stopped sharing. Each organizer now needs their own Google connection for Meet links.',
    });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    if (!(error instanceof AccessDeniedError) && status === 500) {
      console.error('[office-hub] Sharing the Google account failed', error);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
