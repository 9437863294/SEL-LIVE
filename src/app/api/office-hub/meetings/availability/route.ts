import { NextResponse } from 'next/server';

import { AccessDeniedError, accessErrorResponse, authenticateAccess } from '@/lib/access-control-server';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  OFFICE_HUB_COLLECTIONS,
  addDays,
  availabilityQueryDates,
  buildMeetingAvailability,
  isIsoDate,
  isKnownTimeZone,
  knownRoomsFrom,
  todayInZone,
  type AvailabilitySourceMeeting,
} from '@/lib/office-hub';
import { resolveOfficeHubCapabilities } from '@/lib/office-hub-permissions';

/**
 * Who is free on a day, and which rooms are booked — the meeting form's "Who's free".
 *
 * `POST { date, timeZone, excludeMeetingId?, includeRooms? }` →
 * `{ date, timeZone, busy: { [userId]: [{ startAt, endAt }] }, rooms: [{ room, location, busy }] }`.
 *
 * ── Why a route and not a browser query ─────────────────────────────────────────────────────────
 *
 * Most people may only read the meetings they are invited to, so a browser query would show
 * everyone else as free — confidently wrong, which is worse than no answer. The server reads every
 * meeting around the day and returns *when* people and rooms are taken, never *what* the meetings
 * are: no titles, no organizers, no links.
 *
 * Cost: one range read on `date` (three calendar days, single-field index), plus — at most once per
 * quarter of an hour per server — the last six months' rooms for the room chips.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AVAILABILITY_FIELDS = ['status', 'isDeleted', 'startAt', 'endAt', 'participantUserIds', 'mode', 'room', 'location'];
const ROOM_FIELDS = ['isDeleted', 'mode', 'room', 'location'];
const KNOWN_ROOMS_TTL_MS = 15 * 60_000;

let knownRoomsCache: { at: number; rooms: { room: string; location: string | null }[] } | null = null;

async function knownRooms(): Promise<{ room: string; location: string | null }[]> {
  if (knownRoomsCache && Date.now() - knownRoomsCache.at < KNOWN_ROOMS_TTL_MS) return knownRoomsCache.rooms;
  const today = todayInZone();
  const snapshot = await getFirebaseAdminFirestore()
    .collection(OFFICE_HUB_COLLECTIONS.meetings)
    .where('date', '>=', addDays(today, -180))
    .where('date', '<=', addDays(today, 90))
    .orderBy('date', 'desc')
    .select(...ROOM_FIELDS)
    .limit(800)
    .get();
  const rooms = knownRoomsFrom(
    snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<AvailabilitySourceMeeting, 'id'>) })),
  );
  knownRoomsCache = { at: Date.now(), rooms };
  return rooms;
}

export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    const viewer = { userId: context.userId, name: context.userName, email: context.userEmail };
    const capabilities = resolveOfficeHubCapabilities(context.access, viewer);
    if (!capabilities.canCreateMeeting && !capabilities.canViewMeetings && !capabilities.canEditAnyMeeting) {
      return NextResponse.json({ error: 'You do not have access to Office Hub meetings.' }, { status: 403 });
    }

    const payload = (await request.json().catch(() => ({}))) as {
      date?: unknown;
      timeZone?: unknown;
      excludeMeetingId?: unknown;
      includeRooms?: unknown;
    };
    const date = typeof payload.date === 'string' ? payload.date.trim() : '';
    const timeZone = typeof payload.timeZone === 'string' ? payload.timeZone.trim() : '';
    if (!isIsoDate(date)) {
      return NextResponse.json({ error: 'A date (yyyy-mm-dd) is required.' }, { status: 400 });
    }
    if (!timeZone || !isKnownTimeZone(timeZone)) {
      return NextResponse.json({ error: 'A known time zone is required.' }, { status: 400 });
    }
    const excludeMeetingId =
      typeof payload.excludeMeetingId === 'string' && payload.excludeMeetingId.trim() ? payload.excludeMeetingId.trim() : null;

    const { fromDate, toDate } = availabilityQueryDates(date);
    const [snapshot, rooms] = await Promise.all([
      getFirebaseAdminFirestore()
        .collection(OFFICE_HUB_COLLECTIONS.meetings)
        .where('date', '>=', fromDate)
        .where('date', '<=', toDate)
        .select(...AVAILABILITY_FIELDS)
        .limit(1500)
        .get(),
      // The chips are a convenience: a failed room read leaves the form working without them.
      payload.includeRooms === true
        ? knownRooms().catch((error) => {
            console.error('[office-hub] Known rooms could not be read', error);
            return [];
          })
        : Promise.resolve([]),
    ]);

    const availability = buildMeetingAvailability(
      snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<AvailabilitySourceMeeting, 'id'>) })),
      { date, timeZone, excludeMeetingIds: excludeMeetingId ? [excludeMeetingId] : [], knownRooms: rooms },
    );
    return NextResponse.json(availability);
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    if (!(error instanceof AccessDeniedError) && status === 500) {
      console.error('[office-hub] Availability read failed', error);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
