import { NextResponse } from 'next/server';

import { AccessDeniedError, accessErrorResponse, authenticateAccess } from '@/lib/access-control-server';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { OFFICE_HUB_COLLECTIONS } from '@/lib/office-hub';
import type { OfficeHubMeeting } from '@/lib/office-hub-model';
import { canEditMeeting, resolveOfficeHubCapabilities } from '@/lib/office-hub-permissions';
import { sendMeetingInvitationEmails } from '@/lib/office-hub-server';

/**
 * Email a meeting's invitation to its participants.
 *
 * `POST { meetingId }`. Called by the browser right after a meeting is scheduled (or a draft is
 * sent), because the mail transport's credentials live on the server. Whether anything is sent is
 * decided from the meeting document, not by the caller: the organizer must have answered "send
 * email invitations", and a meeting Google Calendar already emailed is skipped.
 *
 * Authorised per meeting, by the same `canEditMeeting` the form's own Save relies on — the
 * organizer, whoever scheduled it, or Meetings Edit — so nobody can make Office Hub email the
 * participants of a meeting they do not run.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);

    const payload = (await request.json().catch(() => ({}))) as { meetingId?: unknown };
    const meetingId = typeof payload.meetingId === 'string' ? payload.meetingId.trim() : '';
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
    const viewer = { userId: context.userId, name: context.userName, email: context.userEmail };
    const verdict = canEditMeeting(meeting, viewer, resolveOfficeHubCapabilities(context.access, viewer));
    if (!verdict.allowed) {
      return NextResponse.json({ error: verdict.reason ?? 'Not permitted.' }, { status: 403 });
    }

    const result = await sendMeetingInvitationEmails({ meetingId, actorUserId: context.userId });
    return NextResponse.json(result);
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    if (!(error instanceof AccessDeniedError) && status === 500) {
      console.error('[office-hub] Invitation emails failed', error);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
