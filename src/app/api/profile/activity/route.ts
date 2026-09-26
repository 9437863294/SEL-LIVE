import { NextResponse } from 'next/server';
import { FieldPath, Timestamp, type DocumentData, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { accessErrorResponse, authenticateAccess } from '@/lib/access-control-server';
import { canonicalModuleName } from '@/lib/activity-modules';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  PROFILE_ACTIVITY_DEFAULT_LIMIT,
  PROFILE_ACTIVITY_MAX_LIMIT,
  clipText,
  compareActivityDesc,
  decodeActivityCursor,
  encodeActivityCursor,
  maskIpAddress,
  normalizeActivitySource,
  summarizeUserAgent,
  type ActivityCursor,
  type ProfileActivityResponse,
  type ProfileActivityRow,
} from '@/components/profile/activity-format';

export const runtime = 'nodejs';

/**
 * How many of the caller's rows the no-index fallback reads before sorting them in memory. Without
 * `orderBy`, Firestore returns them in document-id order — effectively random in time — so past
 * this many the page is a sample, which is why the response says `approximate: true`.
 */
const FALLBACK_SCAN_LIMIT = 500;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * The signed-in user's own audit trail, newest first — for the Recent activity card on Profile.
 *
 * Whose rows is decided by the verified token alone; the request cannot name a user. Rows are
 * reduced to what is safe to show back: `details` can hold other people's data (an edited
 * employee's fields, a vendor's bank details), so it never leaves the server, and the IP address is
 * masked.
 *
 *   GET /api/profile/activity?limit=15&cursor=<nextCursor from the previous page>
 */
export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);

    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get('limit'));
    const rawCursor = url.searchParams.get('cursor');
    const cursor = decodeActivityCursor(rawCursor);
    if (rawCursor && !cursor) {
      return NextResponse.json({ error: 'The cursor is not valid.' }, { status: 400, headers: NO_STORE });
    }

    const userIds = await ownUserIds(request, context.userId);
    const firestore = getFirebaseAdminFirestore();
    const base = byUser(firestore.collection('userLogs'), userIds);

    let body: ProfileActivityResponse;
    try {
      body = await indexedPage(base, limit, cursor);
    } catch (error) {
      if (!isMissingIndex(error)) throw error;
      console.warn(
        '[profile/activity] userLogs (userId ASC, timestamp DESC) index unavailable; serving an approximate page.',
      );
      body = await fallbackPage(base, limit, cursor);
    }

    return NextResponse.json(body, { headers: NO_STORE });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status, headers: NO_STORE });
  }
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return PROFILE_ACTIVITY_DEFAULT_LIMIT;
  return Math.min(parsed, PROFILE_ACTIVITY_MAX_LIMIT);
}

/**
 * The ids the caller's rows can be filed under. Loggers write the users document id, which is
 * usually the auth uid but not for older accounts found by email — and a few pages fall back to the
 * uid when the id is missing. Both belong to the caller: a users document keyed by this uid would
 * have been the one `authenticateAccess` found first.
 */
async function ownUserIds(request: Request, userDocId: string): Promise<string[]> {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  // Already verified by authenticateAccess; verifying again is a local signature check against
  // cached keys, and is what makes the uid trustworthy.
  const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
  return [...new Set([userDocId, decoded.uid].filter(Boolean))];
}

function byUser(query: Query<DocumentData>, userIds: string[]): Query<DocumentData> {
  return userIds.length === 1 ? query.where('userId', '==', userIds[0]) : query.where('userId', 'in', userIds);
}

/**
 * The normal path, served by the `userLogs (userId ASC, timestamp DESC)` composite index. The
 * document-id ordering is the index's own implicit tie-breaker, made explicit so the cursor can
 * resume between two rows that share a timestamp.
 */
async function indexedPage(
  base: Query<DocumentData>,
  limit: number,
  cursor: ActivityCursor | null,
): Promise<ProfileActivityResponse> {
  let query = base.orderBy('timestamp', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (cursor) {
    const at = new Timestamp(cursor.seconds, cursor.nanoseconds);
    query = cursor.id ? query.startAfter(at, cursor.id) : query.startAfter(at);
  }
  // One extra row tells us whether "Load more" has anything to load.
  const snapshot = await query.limit(limit + 1).get();
  return toPage(snapshot.docs, limit, false);
}

/**
 * Without the index: read a bounded set of the caller's rows, order them in memory, and apply the
 * cursor there. Correct for anyone with fewer than FALLBACK_SCAN_LIMIT rows, a sample beyond that.
 */
async function fallbackPage(
  base: Query<DocumentData>,
  limit: number,
  cursor: ActivityCursor | null,
): Promise<ProfileActivityResponse> {
  const snapshot = await base.limit(FALLBACK_SCAN_LIMIT).get();
  let docs = [...snapshot.docs].sort((a, b) => compareActivityDesc(sortKey(a), sortKey(b)));
  if (cursor) {
    const after = { seconds: cursor.seconds, nanoseconds: cursor.nanoseconds, id: cursor.id ?? '' };
    // A bare ISO cursor (no id) resumes strictly before that instant, as the indexed path does.
    docs = docs.filter((doc) => {
      const key = sortKey(doc);
      return cursor.id
        ? compareActivityDesc(after, key) < 0
        : key.seconds < after.seconds || (key.seconds === after.seconds && key.nanoseconds < after.nanoseconds);
    });
  }
  return toPage(docs.slice(0, limit + 1), limit, true);
}

function toPage(
  docs: QueryDocumentSnapshot<DocumentData>[],
  limit: number,
  approximate: boolean,
): ProfileActivityResponse {
  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = docs.length > limit && last ? encodeActivityCursor({ ...sortKey(last), id: last.id }) : null;
  return { rows: page.map(toRow), nextCursor, approximate };
}

function timestampOf(doc: QueryDocumentSnapshot<DocumentData>): Timestamp | null {
  const value: unknown = doc.get('timestamp');
  return value instanceof Timestamp ? value : null;
}

/** Rows without a timestamp sort last, as if written at the epoch. */
function sortKey(doc: QueryDocumentSnapshot<DocumentData>) {
  const at = timestampOf(doc);
  return { seconds: at?.seconds ?? 0, nanoseconds: at?.nanoseconds ?? 0, id: doc.id };
}

function toRow(doc: QueryDocumentSnapshot<DocumentData>): ProfileActivityRow {
  const data = doc.data();
  return {
    id: doc.id,
    module: canonicalModuleName(typeof data.module === 'string' ? data.module : null),
    action: clipText(data.action, 120) ?? 'Activity',
    at: timestampOf(doc)?.toDate().toISOString() ?? null,
    source: normalizeActivitySource(data.source),
    device: summarizeUserAgent(data.userAgent),
    ipAddress: maskIpAddress(data.ipAddress),
    // The record's own reference (a PO or vehicle number) — never the free-form `details`.
    summary: clipText(data.recordRef, 80),
  };
}

/** Firestore's "this query requires an index" — gRPC FAILED_PRECONDITION (code 9). */
function isMissingIndex(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (code === 9 || code === 'failed-precondition' || code === 'FAILED_PRECONDITION') return true;
  return typeof message === 'string' && /FAILED_PRECONDITION|requires an index/i.test(message);
}
