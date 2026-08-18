import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from './firebase-admin';
import { canonicalModuleName } from './activity-modules';
import type { NotificationPayload, NotificationRecipients } from './notifications';

/**
 * Server-side twin of @/lib/notifications.
 *
 * Writes the same document shape to the same `userNotifications` collection, so a
 * notification raised by an hourly cron and one raised by a form are
 * indistinguishable to the bell. Use this from API routes and admin-SDK services;
 * the client module cannot run there.
 */

export type { NotificationPayload, NotificationRecipients } from './notifications';

/** Firestore caps `in` filters at 30 values. */
const IN_CHUNK = 30;

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Resolve role names to the IDs of the active users holding them. */
export async function resolveRoleRecipientsServer(roles: string[]): Promise<string[]> {
  const wanted = roles.map((role) => role.trim()).filter(Boolean);
  if (!wanted.length) return [];

  const db = getFirebaseAdminFirestore();
  const ids = new Set<string>();

  for (const group of chunk(wanted, IN_CHUNK)) {
    try {
      const snap = await db.collection('users').where('role', 'in', group).get();
      snap.docs.forEach((entry) => {
        if ((entry.data() as { status?: string }).status !== 'Inactive') ids.add(entry.id);
      });
    } catch (err) {
      console.error('[notifications-server] Failed to resolve role recipients:', err);
    }
  }
  return [...ids];
}

/**
 * Deliver one notification to every recipient, one document per user.
 *
 * Never throws — a scheduled job must finish its remaining work even if one
 * notification cannot be written.
 *
 * @returns the number of users the notification was delivered to.
 */
export async function dispatchNotificationServer(
  recipients: NotificationRecipients,
  payload: NotificationPayload,
): Promise<number> {
  try {
    const fromRoles = recipients.roles?.length
      ? await resolveRoleRecipientsServer(recipients.roles)
      : [];
    const targets = [...new Set([...(recipients.userIds ?? []), ...fromRoles])].filter(Boolean);
    if (!targets.length) return 0;

    const db = getFirebaseAdminFirestore();
    const body = {
      ...payload,
      module: canonicalModuleName(payload.module),
      severity: payload.severity ?? 'INFO',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    };

    for (const group of chunk(targets, 400)) {
      const batch = db.batch();
      group.forEach((userId) => {
        batch.set(db.collection('userNotifications').doc(), { ...body, userId });
      });
      await batch.commit();
    }
    return targets.length;
  } catch (err) {
    console.error('[notifications-server] Failed to dispatch notification:', err);
    return 0;
  }
}

/**
 * Deliver a notification at most once for a given event.
 *
 * Scheduled jobs re-run over the same data, so a maturity or escalation alert
 * would otherwise be re-sent on every pass. The caller supplies a stable
 * `dedupeKey` identifying the event (record + milestone, not the run time); the
 * recipient's ID is folded in so each user still gets their own copy.
 *
 * @returns the number of users the notification was newly delivered to.
 */
export async function dispatchNotificationOnce(
  recipients: NotificationRecipients,
  payload: NotificationPayload,
  dedupeKey: string,
): Promise<number> {
  try {
    const fromRoles = recipients.roles?.length
      ? await resolveRoleRecipientsServer(recipients.roles)
      : [];
    const targets = [...new Set([...(recipients.userIds ?? []), ...fromRoles])].filter(Boolean);
    if (!targets.length) return 0;

    const db = getFirebaseAdminFirestore();
    const safeKey = dedupeKey.replace(/[^A-Za-z0-9_-]/g, '_');
    const body = {
      ...payload,
      module: canonicalModuleName(payload.module),
      severity: payload.severity ?? 'INFO',
      dedupeKey: safeKey,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    };

    let delivered = 0;
    // Deterministic document ID per (event, recipient), written with create() so a
    // repeat run is a no-op. set({merge:false}) would also avoid duplicates, but it
    // would overwrite the stored document — resetting `read` to false and
    // resurrecting an alert the user had already dismissed on every scheduled pass.
    // These have to be individual writes: one create() failing inside a batch
    // aborts the whole batch, and on a partial re-run most of them will fail.
    for (const group of chunk(targets, 50)) {
      const results = await Promise.all(
        group.map(async (userId) => {
          const id = `${safeKey}__${userId}`.slice(0, 1500);
          try {
            await db.collection('userNotifications').doc(id).create({ ...body, userId });
            return true;
          } catch (err) {
            // ALREADY_EXISTS (code 6) means this recipient was notified on an
            // earlier run — the expected path, not a failure.
            if ((err as { code?: number }).code === 6) return false;
            console.error('[notifications-server] Failed to create notification:', err);
            return false;
          }
        }),
      );
      delivered += results.filter(Boolean).length;
    }
    return delivered;
  } catch (err) {
    console.error('[notifications-server] Failed to dispatch deduped notification:', err);
    return 0;
  }
}
