import { NextResponse } from 'next/server';

import { AccessDeniedError, accessErrorResponse, authenticateAccess } from '@/lib/access-control-server';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { OFFICE_HUB_COLLECTIONS } from '@/lib/office-hub';
import type { OfficeHubMeeting } from '@/lib/office-hub-model';
import {
  canEditMeeting,
  isMeetingOrganizer,
  resolveOfficeHubCapabilities,
} from '@/lib/office-hub-permissions';
import {
  explainNoGoogleAccount,
  googleMeetConfigured,
  resolveGoogleActingUser,
  syncMeetingToGoogle,
} from '@/lib/office-hub-google-server';

/**
 * Create, update or withdraw a meeting's Google Meet link.
 *
 * `POST { meetingId }` brings Google in line with the meeting — which is a create, a patch, an
 * inherit or nothing, decided by `googleSyncPlan` from the meeting document rather than by the
 * caller. `DELETE { meetingId }` withdraws the calendar event.
 *
 * ── Authorisation is per meeting, not per module ───────────────────────────────────────────────
 *
 * Holding `Office Hub.Meetings / edit` is not enough: this route re-runs the same
 * `canEditMeeting` / `canCancelMeeting` predicates the UI uses, over the meeting document, so
 * "only the organizer can change this meeting" is enforced here and not merely rendered. §31's
 * "do not rely only on frontend permission checks" is the reason this route reads the meeting
 * before it does anything with it.
 *
 * ── Whose Google account is used ───────────────────────────────────────────────────────────────
 *
 * The organizer's own when they have connected one, so the event sits on their calendar. Otherwise
 * whoever scheduled it for them, and failing that the one office account an administrator shared
 * (Settings → Google Meet) — so an office does not need every person to connect Google. The account
 * that created an event keeps owning it, since only it can change or remove that event. See
 * `resolveGoogleActingUser`. (Changed 2026-11-06: it used to be the organizer's or nothing.)
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return handle(request, 'save');
}

export async function DELETE(request: Request) {
  return handle(request, 'cancel');
}

async function handle(request: Request, intent: 'save' | 'cancel') {
  try {
    const context = await authenticateAccess(request);

    if (!googleMeetConfigured()) {
      return NextResponse.json(
        { error: 'Google Meet is not configured on this server.' },
        { status: 503 },
      );
    }

    const payload = (await request.json().catch(() => ({}))) as { meetingId?: unknown; accessOnly?: unknown };
    const meetingId = typeof payload.meetingId === 'string' ? payload.meetingId.trim() : '';
    const accessOnly = payload.accessOnly === true;
    if (!meetingId) {
      return NextResponse.json({ error: 'A meetingId is required.' }, { status: 400 });
    }

    const snapshot = await getFirebaseAdminFirestore()
      .collection(OFFICE_HUB_COLLECTIONS.meetings)
      .doc(meetingId)
      .get();

    if (!snapshot.exists) {
      return NextResponse.json({ error: 'That meeting no longer exists.' }, { status: 404 });
    }

    const meeting = { ...(snapshot.data() as Record<string, unknown>), id: snapshot.id } as OfficeHubMeeting;

    /**
     * The viewer built here carries identity only, not team memberships.
     *
     * `canEditMeeting` uses the viewer to answer "are you the organizer", and the capability set to
     * answer "may you edit anyone's" — neither reads `teamIds`. Loading every team membership to
     * satisfy a shape would be four reads to change nothing. The capability derived from *leading*
     * a team is therefore absent here, which makes this check strictly narrower than the client's,
     * and narrower is the safe direction for a server-side gate.
     */
    const viewer = { userId: context.userId, name: context.userName, email: context.userEmail };
    const capabilities = resolveOfficeHubCapabilities(context.access, viewer);

    if (intent === 'cancel') {
      /**
       * Withdrawing the calendar event is authorised by authority over the meeting, **not** by
       * `canCancelMeeting`.
       *
       * That predicate refuses an already-cancelled meeting, which is exactly the state this route
       * is reached in: `cancelMeeting` marks the meeting cancelled in Firestore and *then* asks for
       * the Google event to be removed. Using it here would 403 on every cancellation and leave the
       * meeting sitting on everybody's Google Calendar — the specific failure that makes people
       * turn up to a meeting that is not happening.
       *
       * So the question asked is the one that actually matters: may this person act on this
       * meeting? A completed or cancelled meeting can still need its calendar entry cleaned up.
       */
      const mayWithdraw = isMeetingOrganizer(meeting, viewer) || capabilities.canCancelAnyMeeting;
      if (!mayWithdraw) {
        return NextResponse.json(
          { error: 'Only the organizer can withdraw this meeting’s calendar invitation.' },
          { status: 403 },
        );
      }
    } else {
      const verdict = canEditMeeting(meeting, viewer, capabilities);
      if (!verdict.allowed) {
        return NextResponse.json({ error: verdict.reason ?? 'Not permitted.' }, { status: 403 });
      }
    }

    /**
     * Whose Google account creates the link: the organizer's, else the scheduler's, else the one
     * office account an administrator shared — so nobody else has to connect. Checked before the
     * sync so "no account at all" is told apart from "Google refused", which need different fixes.
     */
    let asUserId: string | undefined;
    if (intent === 'save') {
      const acting = await resolveGoogleActingUser(meeting);
      if (!acting) {
        // `needsConnect` keeps a meeting with a pasted link quiet about it — see `syncGoogleConference`.
        return NextResponse.json({ error: await explainNoGoogleAccount(meeting), needsConnect: true }, { status: 409 });
      }
      asUserId = acting.userId;
    }

    const result = await syncMeetingToGoogle({ meetingId, intent, accessOnly, asUserId });

    // A failed sync is a 200 with `ok: false`: the request was understood and handled, and the
    // client needs the reason and the warnings, not an exception.
    return NextResponse.json(result);
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    if (!(error instanceof AccessDeniedError) && status === 500) {
      console.error('[office-hub] Google event sync failed', error);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
