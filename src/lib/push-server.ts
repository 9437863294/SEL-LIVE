import 'server-only';

import type { DocumentReference } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore, getFirebaseAdminMessaging } from './firebase-admin';

/**
 * Shared FCM delivery for the central notification system.
 *
 * Push used to exist only for chat, wired directly into
 * `app/api/chat/notify/route.ts`, so a notification raised by any other module
 * reached the in-app bell and stopped there. This is that route's delivery logic —
 * device lookup, `sendEach`, invalid-token pruning — lifted out so every module
 * gets the same treatment on Android, iOS and the web.
 *
 * Notification documents remain the source of truth. Push is a best-effort nudge on
 * top: it never throws, because failing to light up a phone must not roll back the
 * action that raised the alert.
 */

/** Android channel for module alerts. Chat keeps its own, quieter-tagged channel. */
export const MODULE_PUSH_CHANNEL = 'sel_module_alerts';

export interface PushPayload {
  title: string;
  body: string;
  /** In-app path to open when the notification is tapped. */
  link?: string;
  /** Module the alert came from, surfaced to the client for routing/grouping. */
  module?: string;
  type?: string;
  itemId?: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  /**
   * Groups related alerts on the device. Android replaces a notification carrying the
   * same tag rather than stacking another one, which keeps a scheduled job that
   * raises many alerts for one record from burying everything else.
   */
  collapseKey?: string;
}

interface PushDevice {
  token: string;
  platform: string;
  ref: DocumentReference;
}

/** Tokens FCM tells us are dead — pruned so they aren't retried forever. */
const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

/** Concurrent per-user device reads, matching the chat route's batching. */
const DEVICE_QUERY_BATCH = 25;

/** FCM accepts at most 500 messages per sendEach call. */
const SEND_LIMIT = 500;

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Every enabled push device registered to the given users, deduplicated by token. */
async function loadDevices(userIds: string[]): Promise<PushDevice[]> {
  const firestore = getFirebaseAdminFirestore();
  const byToken = new Map<string, PushDevice>();

  for (const group of chunk(userIds, DEVICE_QUERY_BATCH)) {
    const snapshots = await Promise.all(
      group.map((userId) =>
        firestore
          .collection('users')
          .doc(userId)
          .collection('pushDevices')
          .where('enabled', '==', true)
          .get()
          .catch((err) => {
            console.error(`[push-server] Failed to read devices for ${userId}:`, err);
            return null;
          }),
      ),
    );
    snapshots.forEach((snapshot) => {
      snapshot?.docs.forEach((deviceDoc) => {
        const data = deviceDoc.data();
        const token = String(data.token || '').trim();
        // The same physical device can be registered under two users (shared
        // handset, or Switch User). Keying by token means it gets one push, not two.
        if (token) {
          byToken.set(token, {
            token,
            platform: String(data.platform || 'android'),
            ref: deviceDoc.ref,
          });
        }
      });
    });
  }
  return [...byToken.values()];
}

/**
 * Send one alert to every device belonging to the given users.
 *
 * @returns counts for logging — how many devices were targeted, delivered and failed.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<{ devices: number; sent: number; failed: number }> {
  const recipients = [...new Set(userIds.filter(Boolean))];
  if (!recipients.length) return { devices: 0, sent: 0, failed: 0 };

  try {
    const devices = await loadDevices(recipients);
    if (!devices.length) return { devices: 0, sent: 0, failed: 0 };

    const title = payload.title.slice(0, 120);
    const body = payload.body.slice(0, 240);
    // FCM data values must all be strings, and nulls are rejected outright.
    const data: Record<string, string> = {
      type: payload.type ?? 'module_alert',
      ...(payload.module ? { module: payload.module } : {}),
      ...(payload.itemId ? { itemId: payload.itemId } : {}),
      ...(payload.severity ? { severity: payload.severity } : {}),
      // Read by the tap handler on native and by the service worker on web, so a
      // notification opens the record it is about instead of the app's home page.
      ...(payload.link ? { link: payload.link } : {}),
    };

    const messaging = getFirebaseAdminMessaging();
    let sent = 0;
    let failed = 0;
    const invalidRefs: DocumentReference[] = [];

    for (const group of chunk(devices, SEND_LIMIT)) {
      const response = await messaging.sendEach(
        group.map((device) => ({
          token: device.token,
          notification: { title, body },
          data,
          android: {
            priority: 'high' as const,
            ...(payload.collapseKey ? { collapseKey: payload.collapseKey } : {}),
            notification: {
              channelId: MODULE_PUSH_CHANNEL,
              sound: 'default',
              // Same tag replaces rather than stacks — see PushPayload.collapseKey.
              ...(payload.collapseKey ? { tag: payload.collapseKey } : {}),
              visibility: 'private' as const,
            },
          },
          apns: {
            headers: {
              // 10 = deliver immediately. iOS throttles anything lower, which for an
              // approval or an escalation defeats the point of sending it.
              'apns-priority': '10',
            },
            payload: {
              aps: {
                sound: 'default',
                ...(payload.collapseKey ? { threadId: payload.collapseKey } : {}),
              },
            },
          },
          webpush: {
            notification: {
              title,
              body,
              icon: '/logo.png',
              ...(payload.collapseKey ? { tag: payload.collapseKey } : {}),
            },
            // How a browser notification knows where to navigate on click. Without
            // this the service worker gets a notification it cannot route.
            //
            // Spread rather than set to undefined: the admin SDK validates this block
            // by key presence, and an explicit undefined is not the same as absent.
            ...(payload.link ? { fcmOptions: { link: payload.link } } : {}),
          },
        })),
      );

      sent += response.successCount;
      failed += response.failureCount;
      response.responses.forEach((result, index) => {
        const code = result.error?.code;
        if (!result.success && code && INVALID_TOKEN_CODES.has(code)) {
          invalidRefs.push(group[index].ref);
        }
      });
    }

    // Uninstalled apps and cleared browser storage leave tokens behind that fail
    // forever. Dropping them keeps the per-alert send from growing without bound.
    if (invalidRefs.length) {
      await Promise.allSettled(invalidRefs.map((ref) => ref.delete()));
    }

    return { devices: devices.length, sent, failed };
  } catch (err) {
    console.error('[push-server] Push delivery failed:', err);
    return { devices: 0, sent: 0, failed: 0 };
  }
}
