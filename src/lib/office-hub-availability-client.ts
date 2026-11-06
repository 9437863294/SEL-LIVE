'use client';

/**
 * Office Hub — asking the server who is free (see `/api/office-hub/meetings/availability`).
 *
 * A route rather than a Firestore query because most people can only read the meetings they are
 * invited to, and a browser query would show everyone else as free.
 */

import { auth } from './firebase';
import type { MeetingAvailability } from './office-hub-availability';

const AVAILABILITY_ENDPOINT = '/api/office-hub/meetings/availability';

/** Throws with a sentence a person can read; the form shows it beside a Try again button. */
export async function fetchMeetingAvailability(input: {
  date: string;
  timeZone: string;
  excludeMeetingId?: string | null;
  includeRooms?: boolean;
}): Promise<MeetingAvailability> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Sign in again to see who is free.');

  const response = await fetch(AVAILABILITY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(input),
  });
  const data = (await response.json().catch(() => ({}))) as Partial<MeetingAvailability> & { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `The server answered ${response.status}.`);
  }
  return {
    date: data.date ?? input.date,
    timeZone: data.timeZone ?? input.timeZone,
    busy: data.busy && typeof data.busy === 'object' ? data.busy : {},
    rooms: Array.isArray(data.rooms) ? data.rooms : [],
  };
}
