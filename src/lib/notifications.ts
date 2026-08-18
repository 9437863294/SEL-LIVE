'use client';

import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  doc,
} from 'firebase/firestore';
import { db } from './firebase';
import { canonicalModuleName } from './activity-modules';

/**
 * The central notification system.
 *
 * All modules write here and the bell in @/components/app/Header reads here, so a
 * notification is delivered by naming its recipients rather than by each module
 * inventing its own delivery path. Before this was centralised, three
 * incompatible document shapes coexisted in `userNotifications`:
 *
 *   1. {userId, type, title, body,    read: false}   — the bell's shape
 *   2. {targetRoles, type, title, message, status: 'UNREAD'} — FD maturity alerts
 *   3. {targetRoles, type, title, message, pageUrl, status: 'ACTIVE'} — BG/LC
 *
 * The bell only ever queried `userId == me`, so shapes 2 and 3 — every alert the
 * bank-guarantee, letter-of-credit and fixed-deposit modules raised — were written
 * to Firestore and shown to nobody. Role-targeted recipients are now resolved to
 * concrete users at write time so that delivery stays a single indexed query, and
 * `normalizeNotification` still reads the two legacy shapes so alerts already in
 * the database render rather than being silently dropped.
 */

/* ── types ─────────────────────────────────────────────────────────────────── */

/**
 * Known notification types. Producers should use one of these; the type is a
 * plain string on the wire so adding a producer never requires a schema
 * migration, and the bell no longer filters on an allowlist.
 */
export type NotificationType =
  // workflow
  | 'tat_escalation'
  | 'step_entry'
  | 'workflow_complete'
  // budgets and money
  | 'budget_alert'
  | 'recurring_payment_workflow'
  | 'recurring_payment_reminder'
  | 'vendor_bank_change'
  // instruments
  | 'bank_guarantee'
  | 'letter_of_credit'
  | 'fd_maturity_alert'
  | 'fd_maturity_overdue'
  // general
  | 'chat_message'
  | 'record_assigned'
  | 'approval_required'
  | (string & {});

/** How loudly to present the notification. */
export type NotificationSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  /** Module identifier — use a constant from @/lib/activity-modules. */
  module: string;
  severity?: NotificationSeverity;
  /** Firestore document ID of the item the notification is about. */
  itemId?: string;
  /** Human-readable reference, e.g. requisitionId, jmcNo or fdNumber. */
  itemRef?: string;
  /** Name of the workflow step this notification relates to, when applicable. */
  stepName?: string;
  /** Deep-link path for the notification CTA. */
  link?: string;
  /** Scopes the notification when the app is used by more than one organization. */
  organizationId?: string;
}

/** Who should receive a notification. At least one field must be non-empty. */
export interface NotificationRecipients {
  /** Explicit user document IDs. */
  userIds?: string[];
  /**
   * Role names — resolved to the users holding them at write time, so delivery
   * reflects role membership when the event happened.
   */
  roles?: string[];
}

/* ── writing ───────────────────────────────────────────────────────────────── */

/**
 * Write a notification to a single user.
 *
 * Kept as-is for the call sites that already target one user directly; prefer
 * `dispatchNotification` when the recipients come from a role or a list.
 */
export async function createUserNotification(
  userId: string,
  payload: NotificationPayload,
): Promise<void> {
  await addDoc(collection(db, 'userNotifications'), {
    userId,
    ...payload,
    module: canonicalModuleName(payload.module),
    severity: payload.severity ?? 'INFO',
    read: false,
    createdAt: serverTimestamp(),
  });
}

/** Firestore caps `in` filters at 30 values. */
const IN_CHUNK = 30;

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Resolve role names to the IDs of the active users holding them.
 *
 * Inactive users are excluded — notifying a deactivated account produces unread
 * counts nobody will ever clear.
 */
export async function resolveRoleRecipients(roles: string[]): Promise<string[]> {
  const wanted = roles.map((role) => role.trim()).filter(Boolean);
  if (!wanted.length) return [];

  const ids = new Set<string>();
  for (const group of chunk(wanted, IN_CHUNK)) {
    try {
      const snap = await getDocs(
        query(collection(db, 'users'), where('role', 'in', group)),
      );
      snap.docs.forEach((entry) => {
        if ((entry.data() as { status?: string }).status !== 'Inactive') ids.add(entry.id);
      });
    } catch (err) {
      console.error('[notifications] Failed to resolve role recipients:', err);
    }
  }
  return [...ids];
}

/**
 * Deliver one notification to every recipient, one document per user.
 *
 * Fanning out at write time keeps the read side a single indexed
 * `userId == me` query, which is what makes the bell cheap enough to keep open as
 * a live listener on every page.
 *
 * Never throws: a notification that fails to send must not roll back the action
 * that triggered it.
 *
 * @returns the number of users the notification was delivered to.
 */
export async function dispatchNotification(
  recipients: NotificationRecipients,
  payload: NotificationPayload,
): Promise<number> {
  try {
    const fromRoles = recipients.roles?.length
      ? await resolveRoleRecipients(recipients.roles)
      : [];
    const targets = [...new Set([...(recipients.userIds ?? []), ...fromRoles])].filter(Boolean);

    if (!targets.length) return 0;

    const body = {
      ...payload,
      module: canonicalModuleName(payload.module),
      severity: payload.severity ?? 'INFO',
      read: false,
      createdAt: serverTimestamp(),
    };

    // One batch per 400 recipients, comfortably inside the 500-write limit.
    for (const group of chunk(targets, 400)) {
      const batch = writeBatch(db);
      group.forEach((userId) => {
        batch.set(doc(collection(db, 'userNotifications')), { ...body, userId });
      });
      await batch.commit();
    }
    return targets.length;
  } catch (err) {
    console.error('[notifications] Failed to dispatch notification:', err);
    return 0;
  }
}

/* ── reading ───────────────────────────────────────────────────────────────── */

/** A notification in the one shape the UI renders, whatever shape it was stored in. */
export interface NormalizedNotification {
  id: string;
  userId: string | null;
  type: string;
  title: string;
  body: string;
  module: string;
  severity: NotificationSeverity;
  itemId: string | null;
  itemRef: string | null;
  stepName: string | null;
  link: string | null;
  read: boolean;
  createdAt: { seconds: number; nanoseconds?: number } | null;
  /** Roles the notification was addressed to, for legacy role-targeted documents. */
  targetRoles: string[];
}

const SEVERITIES: NotificationSeverity[] = ['INFO', 'WARNING', 'CRITICAL'];

const toSeverity = (value: unknown): NotificationSeverity => {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  if (SEVERITIES.includes(upper as NotificationSeverity)) return upper as NotificationSeverity;
  // The FD daily-controls job graded alerts MEDIUM/HIGH before severity was shared.
  if (upper === 'HIGH') return 'WARNING';
  if (upper === 'MEDIUM' || upper === 'LOW') return 'INFO';
  return 'INFO';
};

/**
 * Read any notification document — current or legacy — into one shape.
 *
 * Handles the field names the three historical producers used: `body` vs
 * `message`, `link` vs `pageUrl`, and read state as either a boolean `read` or a
 * string `status` of 'UNREAD'/'ACTIVE'.
 */
export function normalizeNotification(
  id: string,
  data: Record<string, any>,
): NormalizedNotification {
  const status = typeof data.status === 'string' ? data.status.toUpperCase() : null;
  const read =
    typeof data.read === 'boolean'
      ? data.read
      // Legacy producers wrote status only. 'UNREAD' and 'ACTIVE' both mean unread;
      // anything else (READ, DISMISSED, RESOLVED) counts as read so it stops nagging.
      : status
        ? !['UNREAD', 'ACTIVE'].includes(status)
        : false;

  return {
    id,
    userId: data.userId ?? null,
    type: data.type ?? 'unknown',
    title: data.title ?? '',
    body: data.body ?? data.message ?? '',
    module: canonicalModuleName(data.module),
    severity: toSeverity(data.severity),
    itemId: data.itemId ?? data.fdId ?? data.bgId ?? data.recordId ?? null,
    itemRef: data.itemRef ?? null,
    stepName: data.stepName ?? null,
    link: data.link ?? data.pageUrl ?? null,
    read,
    createdAt: data.createdAt ?? null,
    targetRoles: Array.isArray(data.targetRoles) ? data.targetRoles : [],
  };
}

/**
 * Fetch unread notifications addressed to a role rather than to a user.
 *
 * `dispatchNotification` fans roles out to users at write time, but the
 * bank-guarantee and letter-of-credit services raise their alerts from inside a
 * Firestore transaction, where resolving roles is not possible — a transaction's
 * reads must all precede its writes, and the role membership lookup would have to
 * happen mid-write. Those producers therefore write one document carrying
 * `targetRoles`, and this is how it reaches a recipient. It also covers the
 * fixed-deposit alerts written that way before delivery was centralised.
 *
 * Deliberately not a live listener: role-targeted documents are written rarely and
 * an `array-contains` listener on a collection this size is not worth holding open
 * on every page.
 */
export async function fetchRoleTargetedNotifications(
  role: string | null | undefined,
  max = 30,
): Promise<NormalizedNotification[]> {
  if (!role) return [];
  try {
    const snap = await getDocs(
      query(
        collection(db, 'userNotifications'),
        where('targetRoles', 'array-contains', role),
        orderBy('createdAt', 'desc'),
        limit(max),
      ),
    );
    return snap.docs
      .map((entry) => normalizeNotification(entry.id, entry.data()))
      // Role-targeted documents carry no userId. Anything with one was already
      // delivered directly by the fan-out and would otherwise show twice.
      .filter((item) => !item.userId && !item.read);
  } catch (err) {
    if ((err as { code?: string }).code === 'failed-precondition') {
      console.error(
        'Role-targeted notifications need a Firestore composite index on '
        + 'userNotifications (targetRoles array-contains, createdAt desc) that has '
        + 'not been deployed yet. Run: firebase deploy --only firestore:indexes\n'
        + 'Original error:',
        err,
      );
      return [];
    }
    console.error('[notifications] Failed to read role notifications:', err);
    return [];
  }
}

/**
 * Mark a notification read, writing both the boolean and the string form so the
 * legacy documents that are filtered on `status` also stop showing as unread.
 */
export async function markNotificationRead(notificationId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'userNotifications', notificationId), {
      read: true,
      status: 'READ',
      readAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[notifications] Failed to mark notification read:', err);
  }
}

/** Mark many notifications read in one batch — backs the bell's "mark all read". */
export async function markNotificationsRead(notificationIds: string[]): Promise<void> {
  const ids = notificationIds.filter(Boolean);
  if (!ids.length) return;
  try {
    for (const group of chunk(ids, 400)) {
      const batch = writeBatch(db);
      group.forEach((id) => {
        batch.update(doc(db, 'userNotifications', id), {
          read: true,
          status: 'READ',
          readAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
  } catch (err) {
    console.error('[notifications] Failed to mark notifications read:', err);
  }
}
