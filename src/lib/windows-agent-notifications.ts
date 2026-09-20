import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from './firebase-admin';
import { WINDOWS_AGENT_COLLECTIONS, windowsAgentIds } from './windows-agent';
import { AgentRequestError, writeAudit } from './windows-agent-server';
import {
  NOTIFICATION_RECEIPT_RANK,
  type AgentNotificationAction,
  type AgentNotificationPriority,
  type AgentNotificationTarget,
  type AgentNotificationType,
  type NotificationReceiptStatus,
  type WindowsNotification,
} from './windows-agent-model';

/**
 * Desktop notifications: raising them, resolving who gets them, delivering them to the agent and
 * tracking what happened to each one (§23, §38, §39).
 *
 * ── Why the agent polls instead of being pushed to ─────────────────────────────────────────────
 *
 * §42 offers FCM, WebSockets, SignalR or Firestore listeners and asks for the most appropriate.
 * The answer here is **the heartbeat**, with a targeted fetch behind it, and it is worth saying
 * why rather than leaving it looking like the lazy option.
 *
 * An office PC sits behind NAT on a corporate LAN and cannot be connected to. Every push option
 * therefore means the *agent* holding a connection open to something. A SignalR hub means running
 * and scaling a second stateful service, on a host (Firebase App Hosting) built for stateless
 * request handling, and it means that service being reachable, authenticated and monitored — a
 * substantial new operational surface whose only job is to save up to ninety seconds of latency
 * on a notification that says a purchase requisition needs approving. FCM means embedding a
 * Firebase messaging client in a desktop executable, which is not a supported configuration.
 *
 * The heartbeat already runs every 90 seconds, already carries authentication, and already returns
 * a payload. Putting the pending notification ids on it costs nothing and adds no failure mode
 * that does not already exist: if the heartbeat is broken, the agent is offline anyway. Worst-case
 * latency is one interval, and an installation that wants it tighter lowers the interval on one
 * policy field.
 *
 * The one case where that is genuinely too slow — a meeting starting in five minutes — is handled
 * by *scheduling*, not by pushing: the reminder is raised with `startAt` set to when it should
 * appear, so the agent fetches it in advance and pops it at the right second even if the network
 * has dropped by then.
 *
 * ── Receipts move forwards only ────────────────────────────────────────────────────────────────
 *
 * §39's lifecycle is a ladder, and agents report out of order — a toast that was displayed, then
 * clicked, can easily arrive as CLICKED before DISPLAYED if the first report failed and was
 * retried. `NOTIFICATION_RECEIPT_RANK` is what stops a late DELIVERED from demoting a receipt that
 * has already been ACKNOWLEDGED, which would quietly corrupt the §39 delivery report.
 */

/** How many notifications one agent fetch may return. */
const MAX_FETCH = 25;

/** Nobody needs to see a notification raised a fortnight ago on next login. */
const MAX_AGE_DAYS = 14;

export interface RaiseNotificationInput {
  type: AgentNotificationType;
  priority?: AgentNotificationPriority;
  title: string;
  message: string;
  deepLink?: string | null;
  actions?: AgentNotificationAction[];
  target: AgentNotificationTarget;
  module: string;
  itemId?: string | null;
  itemRef?: string | null;
  startAt?: string;
  expiresAt?: string | null;
  requireAcknowledgement?: boolean;
  actor: { userId: string; userName: string };
  /** Supply to make the raise idempotent — the same id raised twice updates rather than duplicates. */
  notificationId?: string;
}

/**
 * Validate a deep link before it is stored.
 *
 * §23 wants the exact record, and a notification is a *clickable* thing arriving on a desktop, so
 * an attacker who could set an absolute URL would have a one-click phishing primitive pointed at
 * every employee. Only same-origin absolute paths are accepted: it must begin with a single `/`,
 * and `//evil.example` — which a browser reads as protocol-relative and would happily navigate to
 * — is rejected along with everything else that is not a path.
 */
export function sanitizeDeepLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//')) return null;
  if (trimmed.includes('\\')) return null;
  return trimmed.slice(0, 500);
}

/**
 * Resolve §38's targeting to concrete user ids.
 *
 * Resolved at raise time, not at delivery time, for the same reason the central notification
 * system resolves roles at write time: delivery should reflect who held the role when the event
 * happened. Somebody who joins a department tomorrow does not need this morning's alert, and
 * somebody who left should still have it in their trail.
 */
export async function resolveNotificationRecipients(
  target: AgentNotificationTarget,
): Promise<{ userIds: string[]; userNames: Map<string, string> }> {
  const firestore = getFirebaseAdminFirestore();
  const ids = new Set<string>(Array.isArray(target.userIds) ? target.userIds : []);
  const names = new Map<string, string>();

  const addFrom = (snapshot: FirebaseFirestore.QuerySnapshot | null) => {
    snapshot?.docs.forEach((doc) => {
      if (doc.get('status') === 'Inactive') return;
      ids.add(doc.id);
      names.set(doc.id, String(doc.get('name') || doc.get('email') || 'User'));
    });
  };

  const queries: Promise<FirebaseFirestore.QuerySnapshot | null>[] = [];

  if (target.allEmployees) {
    queries.push(firestore.collection('users').where('status', '==', 'Active').get().catch(() => null));
  }
  for (const role of target.roles ?? []) {
    queries.push(firestore.collection('users').where('role', '==', role).get().catch(() => null));
  }
  for (const departmentId of target.departmentIds ?? []) {
    queries.push(
      firestore.collection('users').where('departmentId', '==', departmentId).get().catch(() => null),
    );
  }
  // A device target means "whoever is signed in there" — resolved through the device document
  // rather than through a session, so a notification aimed at a PC still reaches the person who
  // signs in next rather than vanishing because nobody was logged in when it was raised.
  for (const deviceId of target.deviceIds ?? []) {
    const device = await firestore
      .collection(WINDOWS_AGENT_COLLECTIONS.devices)
      .doc(deviceId)
      .get()
      .catch(() => null);
    const assigned: string[] = device?.get('assignedUserIds') ?? [];
    const lastSeen = device?.get('lastSeenUserId');
    for (const userId of assigned) ids.add(userId);
    if (lastSeen) ids.add(String(lastSeen));
  }

  (await Promise.all(queries)).forEach(addFrom);

  // Fill in names for ids that came in directly rather than from a query.
  const missing = [...ids].filter((id) => !names.has(id));
  for (let index = 0; index < missing.length; index += 25) {
    const group = missing.slice(index, index + 25);
    const docs = await firestore.getAll(...group.map((id) => firestore.collection('users').doc(id)));
    docs.forEach((doc) => {
      if (!doc.exists) {
        ids.delete(doc.id);
        return;
      }
      if (doc.get('status') === 'Inactive') {
        ids.delete(doc.id);
        return;
      }
      names.set(doc.id, String(doc.get('name') || doc.get('email') || 'User'));
    });
  }

  return { userIds: [...ids], userNames: names };
}

/**
 * Raise a desktop notification and create a receipt per recipient.
 *
 * Receipts are created up front, at `CREATED`, rather than on first delivery. That is what makes
 * the §39 report able to say "delivered to 38 of 41" — without a row per intended recipient there
 * is no denominator, and "38 delivered" alone cannot distinguish a complete delivery from a
 * three-PC outage.
 */
export async function raiseAgentNotification(
  input: RaiseNotificationInput,
): Promise<{ notificationId: string; recipients: number }> {
  const firestore = getFirebaseAdminFirestore();
  const title = String(input.title || '').trim().slice(0, 120);
  const message = String(input.message || '').trim().slice(0, 1000);
  if (!title) throw new AgentRequestError('A title is required.', 400);
  if (!message) throw new AgentRequestError('A message is required.', 400);

  const { userIds, userNames } = await resolveNotificationRecipients(input.target);
  if (!userIds.length) throw new AgentRequestError('That target matches nobody.', 400);

  const nowIso = new Date().toISOString();
  const ref = input.notificationId
    ? firestore.collection(WINDOWS_AGENT_COLLECTIONS.notifications).doc(input.notificationId)
    : firestore.collection(WINDOWS_AGENT_COLLECTIONS.notifications).doc();

  const document: Omit<WindowsNotification, 'id'> = {
    type: input.type,
    priority: input.priority ?? 'NORMAL',
    title,
    message,
    deepLink: sanitizeDeepLink(input.deepLink),
    actions: (input.actions ?? []).slice(0, 4).map((action) => ({
      label: String(action.label || 'Open').slice(0, 40),
      action: action.action,
      deepLink: sanitizeDeepLink(action.deepLink),
      snoozeMinutes: Number.isFinite(Number(action.snoozeMinutes))
        ? Math.min(1440, Math.max(1, Math.round(Number(action.snoozeMinutes))))
        : undefined,
    })),
    target: input.target,
    recipientUserIds: userIds,
    module: input.module,
    itemId: input.itemId ?? null,
    itemRef: input.itemRef ?? null,
    startAt: input.startAt ?? nowIso,
    expiresAt: input.expiresAt ?? null,
    requireAcknowledgement: input.requireAcknowledgement === true,
    createdAtIso: nowIso,
    deliveryCounts: {
      recipients: userIds.length,
      delivered: 0,
      displayed: 0,
      clicked: 0,
      acknowledged: 0,
      expired: 0,
      failed: 0,
    },
    createdAt: FieldValue.serverTimestamp() as never,
    createdBy: input.actor.userId,
    createdByName: input.actor.userName,
  };

  await ref.set(document, { merge: true });

  // Receipts in chunks of 400: a broadcast to a whole company is more than one batch's worth.
  const receipts = firestore.collection(WINDOWS_AGENT_COLLECTIONS.notificationReceipts);
  for (let index = 0; index < userIds.length; index += 400) {
    const batch = firestore.batch();
    for (const userId of userIds.slice(index, index + 400)) {
      batch.set(
        receipts.doc(windowsAgentIds.notificationReceipt(ref.id, userId)),
        {
          notificationId: ref.id,
          userId,
          userName: userNames.get(userId) ?? 'User',
          deviceId: null,
          status: 'CREATED' satisfies NotificationReceiptStatus,
          createdAt: nowIso,
          sentAt: null,
          deliveredAt: null,
          displayedAt: null,
          clickedAt: null,
          acknowledgedAt: null,
          snoozedUntil: null,
          failureReason: null,
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  await writeAudit({
    action: 'NOTIFICATION_SENT',
    actorId: input.actor.userId,
    actorName: input.actor.userName,
    targetType: 'notification',
    targetId: ref.id,
    targetLabel: title,
    newValue: { type: input.type, recipients: userIds.length, target: input.target },
  });

  return { notificationId: ref.id, recipients: userIds.length };
}

export interface PendingNotification {
  id: string;
  type: AgentNotificationType;
  priority: AgentNotificationPriority;
  title: string;
  message: string;
  deepLink: string | null;
  actions: AgentNotificationAction[];
  requireAcknowledgement: boolean;
  module: string;
  itemRef: string | null;
  startAt: string;
}

/**
 * What this user's agent should show next.
 *
 * Driven by the *receipt*, not by the notification: "what has this person not yet seen" is a
 * query on one indexed collection keyed by user, whereas asking it of the notifications themselves
 * would mean scanning everything raised recently and testing each one's recipient array.
 *
 * A snoozed receipt is skipped until its `snoozedUntil` passes, which is how §23's "Remind later"
 * works without a scheduler.
 */
export async function fetchPendingNotifications(options: {
  userId: string;
  now?: Date;
}): Promise<PendingNotification[]> {
  const firestore = getFirebaseAdminFirestore();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const oldestIso = new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000).toISOString();

  const receipts = await firestore
    .collection(WINDOWS_AGENT_COLLECTIONS.notificationReceipts)
    .where('userId', '==', options.userId)
    .where('status', 'in', ['CREATED', 'SENT', 'DELIVERED', 'SNOOZED'])
    .limit(MAX_FETCH * 2)
    .get()
    .catch(() => null);
  if (!receipts || receipts.empty) return [];

  const due = receipts.docs.filter((doc) => {
    if (String(doc.get('createdAt') || '') < oldestIso) return false;
    const snoozedUntil = doc.get('snoozedUntil');
    return !snoozedUntil || String(snoozedUntil) <= nowIso;
  });
  if (!due.length) return [];

  const notificationIds = due.map((doc) => String(doc.get('notificationId')));
  const docs = await firestore.getAll(
    ...notificationIds
      .slice(0, MAX_FETCH)
      .map((id) => firestore.collection(WINDOWS_AGENT_COLLECTIONS.notifications).doc(id)),
  );

  const out: PendingNotification[] = [];
  for (const doc of docs) {
    if (!doc.exists) continue;
    const startAt = String(doc.get('startAt') || doc.get('createdAtIso') || '');
    if (startAt && startAt > nowIso) continue; // scheduled for later — §25's meeting reminders
    const expiresAt = doc.get('expiresAt');
    if (expiresAt && String(expiresAt) <= nowIso) continue;
    out.push({
      id: doc.id,
      type: doc.get('type'),
      priority: doc.get('priority') || 'NORMAL',
      title: String(doc.get('title') || ''),
      message: String(doc.get('message') || ''),
      deepLink: doc.get('deepLink') ?? null,
      actions: doc.get('actions') ?? [],
      requireAcknowledgement: doc.get('requireAcknowledgement') === true,
      module: String(doc.get('module') || ''),
      itemRef: doc.get('itemRef') ?? null,
      startAt,
    });
  }

  return out.sort((left, right) => {
    const priorityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    const byPriority = (priorityRank[left.priority] ?? 2) - (priorityRank[right.priority] ?? 2);
    return byPriority !== 0 ? byPriority : left.startAt.localeCompare(right.startAt);
  });
}

const STATUS_FIELD: Partial<Record<NotificationReceiptStatus, string>> = {
  SENT: 'sentAt',
  DELIVERED: 'deliveredAt',
  DISPLAYED: 'displayedAt',
  CLICKED: 'clickedAt',
  ACKNOWLEDGED: 'acknowledgedAt',
};

const COUNTER_FIELD: Partial<Record<NotificationReceiptStatus, string>> = {
  DELIVERED: 'deliveryCounts.delivered',
  DISPLAYED: 'deliveryCounts.displayed',
  CLICKED: 'deliveryCounts.clicked',
  ACKNOWLEDGED: 'deliveryCounts.acknowledged',
  EXPIRED: 'deliveryCounts.expired',
  FAILED: 'deliveryCounts.failed',
};

/**
 * Record what the agent did with a notification.
 *
 * Refuses to move a receipt backwards, and refuses to double-count a status it already holds —
 * so an agent that retries the same acknowledgement ten times leaves the delivery report showing
 * one acknowledgement, not ten.
 */
export async function recordNotificationReceipt(options: {
  notificationId: string;
  userId: string;
  deviceId: string | null;
  status: NotificationReceiptStatus;
  snoozeMinutes?: number;
  failureReason?: string | null;
  now?: Date;
}): Promise<{ applied: boolean }> {
  const firestore = getFirebaseAdminFirestore();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const ref = firestore
    .collection(WINDOWS_AGENT_COLLECTIONS.notificationReceipts)
    .doc(windowsAgentIds.notificationReceipt(options.notificationId, options.userId));

  const applied = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;

    const current = (snapshot.get('status') || 'CREATED') as NotificationReceiptStatus;
    const currentRank = NOTIFICATION_RECEIPT_RANK[current] ?? 0;
    const nextRank = NOTIFICATION_RECEIPT_RANK[options.status] ?? 0;
    // SNOOZED is the one status allowed to repeat: "remind me again" twice is two real events.
    if (nextRank < currentRank || (nextRank === currentRank && options.status !== 'SNOOZED')) {
      return false;
    }

    const update: Record<string, unknown> = {
      status: options.status,
      deviceId: options.deviceId,
    };
    const field = STATUS_FIELD[options.status];
    if (field) update[field] = nowIso;
    if (options.status === 'SNOOZED') {
      const minutes = Math.min(1440, Math.max(1, Math.round(Number(options.snoozeMinutes) || 15)));
      update.snoozedUntil = new Date(now.getTime() + minutes * 60_000).toISOString();
      // A snooze must not leave the receipt looking undelivered next time it is fetched.
      update.deliveredAt = snapshot.get('deliveredAt') ?? nowIso;
    } else {
      update.snoozedUntil = null;
    }
    if (options.status === 'FAILED') update.failureReason = options.failureReason ?? 'Unknown';

    transaction.update(ref, update);
    return true;
  });

  if (applied) {
    const counter = COUNTER_FIELD[options.status];
    if (counter) {
      await firestore
        .collection(WINDOWS_AGENT_COLLECTIONS.notifications)
        .doc(options.notificationId)
        .update({ [counter]: FieldValue.increment(1) })
        .catch(() => {});
    }
  }

  return { applied };
}

/** Expire receipts for notifications whose window has closed. Run from the cron route. */
export async function expireStaleNotifications(options: { now?: Date; limit?: number } = {}): Promise<number> {
  const firestore = getFirebaseAdminFirestore();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  const expired = await firestore
    .collection(WINDOWS_AGENT_COLLECTIONS.notifications)
    .where('expiresAt', '<=', nowIso)
    .limit(options.limit ?? 50)
    .get()
    .catch(() => null);
  if (!expired || expired.empty) return 0;

  let count = 0;
  for (const notification of expired.docs) {
    const receipts = await firestore
      .collection(WINDOWS_AGENT_COLLECTIONS.notificationReceipts)
      .where('notificationId', '==', notification.id)
      .where('status', 'in', ['CREATED', 'SENT', 'DELIVERED', 'SNOOZED'])
      .limit(400)
      .get()
      .catch(() => null);
    if (!receipts || receipts.empty) continue;

    const batch = firestore.batch();
    receipts.docs.forEach((doc) => batch.update(doc.ref, { status: 'EXPIRED', snoozedUntil: null }));
    batch.update(notification.ref, {
      'deliveryCounts.expired': FieldValue.increment(receipts.size),
    });
    await batch.commit();
    count += receipts.size;
  }
  return count;
}
