'use client';

/**
 * Office Hub — asking the server to email a meeting's invitation.
 *
 * The mail transport's credentials are server-only, so the browser cannot send the email itself; it
 * asks `/api/office-hub/meetings/email-invitations`, which decides from the meeting document whether
 * to send at all (the organizer's answer, and whether Google Calendar already emailed).
 */

import { auth } from './firebase';

const EMAIL_INVITATIONS_ENDPOINT = '/api/office-hub/meetings/email-invitations';

export interface EmailInvitationsOutcome {
  sent: number;
  /** Things the organizer should be told, already written for a person. */
  warnings: string[];
}

/** Never throws: a failed email must not fail a meeting that is already saved. */
export async function requestMeetingInvitationEmails(meetingId: string): Promise<EmailInvitationsOutcome> {
  try {
    const user = auth.currentUser;
    if (!user) return { sent: 0, warnings: ['Your session expired before the invitation emails could be sent.'] };

    const response = await fetch(EMAIL_INVITATIONS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ meetingId }),
    });
    const data = (await response.json().catch(() => ({}))) as { sent?: unknown; notes?: unknown; error?: unknown };

    if (!response.ok) {
      const reason = typeof data.error === 'string' ? data.error : `the server answered ${response.status}`;
      return { sent: 0, warnings: [`The invitation emails were not sent (${reason}). Participants were notified in SEL Live.`] };
    }
    return {
      sent: typeof data.sent === 'number' ? data.sent : 0,
      warnings: Array.isArray(data.notes) ? data.notes.filter((note): note is string => typeof note === 'string') : [],
    };
  } catch (error) {
    console.error('[office-hub] Invitation emails could not be requested', error);
    return { sent: 0, warnings: ['The invitation emails could not be sent. Participants were notified in SEL Live.'] };
  }
}
