import { after, NextResponse } from 'next/server';

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { resolveAuthenticatedAppUserId } from '@/lib/chat-push-server';
import { sendPushToUsers } from '@/lib/push-server';
import { resolveRoleRecipientsServer } from '@/lib/notifications-server';

export const runtime = 'nodejs';

/**
 * POST /api/notifications/push
 *
 * Sends the mobile/web push for notifications a browser client has just written.
 *
 * The client cannot reach FCM itself — that needs admin credentials — so it creates
 * the `userNotifications` documents and then asks this route to deliver them by ID.
 *
 * It deliberately takes IDs rather than a title, body and recipient list. An
 * endpoint accepting those would let any signed-in user push arbitrary text to
 * anyone in the organisation; here the payload and the recipient are read back out
 * of the stored document, so a caller can only cause delivery of a notification that
 * already exists in the database.
 */

/** Enough for a large role fan-out in one call, small enough to bound the reads. */
const MAX_IDS = 500;

/**
 * How recently a notification must have been written to be pushable. Without this,
 * a replayed request could re-push notifications from weeks ago.
 */
const MAX_AGE_MS = 5 * 60 * 1000;

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  let callerId: string;
  try {
    const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
    callerId = await resolveAuthenticatedAppUserId(decoded);
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.notificationIds)
    ? body.notificationIds
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 1500)
        .slice(0, MAX_IDS)
    : [];

  if (!ids.length) {
    return NextResponse.json({ error: 'notificationIds is required.' }, { status: 400 });
  }

  // Delivery runs after the response so the form that raised the alert is not left
  // waiting on FCM. Failures are logged, never surfaced as a save failure.
  after(async () => {
    try {
      const firestore = getFirebaseAdminFirestore();
      const refs = ids.map((id: string) => firestore.collection('userNotifications').doc(id));
      const snapshots = await firestore.getAll(...refs);

      const cutoff = Date.now() - MAX_AGE_MS;
      // Recipients grouped per distinct alert, so one fan-out is one FCM batch
      // rather than one call per recipient.
      const byAlert = new Map<string, { userIds: string[]; data: Record<string, any> }>();

      // Role-targeted documents carry no userId: the bank-guarantee service raises
      // its alerts from inside a Firestore transaction, where a role cannot be
      // resolved to users (a transaction's reads must all precede its writes).
      // Gathered here and resolved after the loop so each distinct role set costs one
      // users query rather than one per document.
      const pendingRoles = new Map<string, { roles: string[]; data: Record<string, any> }>();

      snapshots.forEach((snapshot) => {
        if (!snapshot.exists) return;
        const data = snapshot.data();
        if (!data) return;

        const createdAtMs = data.createdAt?.toMillis?.() ?? 0;
        // A serverTimestamp() is still null on the client's own read-back, but by the
        // time this route reads it the write has landed, so 0 means genuinely absent.
        if (createdAtMs && createdAtMs < cutoff) return;

        // Group by the alert's content, not its document ID: a fan-out writes one
        // document per recipient, all carrying the same title/body.
        const key = [data.type, data.title, data.body, data.link, data.itemId].join(' ');

        const userId = String(data.userId || '');
        if (userId) {
          const existing = byAlert.get(key);
          if (existing) existing.userIds.push(userId);
          else byAlert.set(key, { userIds: [userId], data });
          return;
        }

        const roles = Array.isArray(data.targetRoles)
          ? data.targetRoles.filter((role: unknown): role is string => typeof role === 'string')
          : [];
        if (roles.length) pendingRoles.set(key, { roles, data });
      });

      for (const [key, { roles, data }] of pendingRoles) {
        const userIds = await resolveRoleRecipientsServer(roles);
        if (!userIds.length) continue;
        const existing = byAlert.get(key);
        if (existing) existing.userIds.push(...userIds);
        else byAlert.set(key, { userIds, data });
      }

      if (!byAlert.size) return;

      await Promise.all(
        [...byAlert.values()].map(({ userIds, data }) =>
          sendPushToUsers(userIds, {
            title: String(data.title || 'Notification'),
            // `message` and `pageUrl` are what the bank-guarantee service writes;
            // the rest of the app uses body/link.
            body: String(data.body || data.message || ''),
            link: data.link || data.pageUrl || undefined,
            module: data.module || undefined,
            type: data.type || undefined,
            itemId: data.itemId || data.recordId || undefined,
            severity: data.severity || 'INFO',
            collapseKey: data.itemId ? `${data.type}_${data.itemId}` : undefined,
          }),
        ),
      );
    } catch (error) {
      console.error(`Push delivery for notifications raised by ${callerId} failed:`, error);
    }
  });

  return NextResponse.json({ success: true, queued: ids.length }, { status: 202 });
}
