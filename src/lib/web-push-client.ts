'use client';

import { auth } from './firebase';

/**
 * Web push registration.
 *
 * The mobile app receives push through the native Capacitor plugin; browsers need
 * this instead — a service worker plus an FCM registration token minted with the
 * project's VAPID key. Tokens land in the same `users/{id}/pushDevices` collection
 * the native path uses, tagged `platform: 'web'`, so the server sends to a phone and
 * a laptop through one code path.
 *
 * Requires NEXT_PUBLIC_FIREBASE_VAPID_KEY (Firebase Console → Project settings →
 * Cloud Messaging → Web Push certificates). Without it, registration is skipped with
 * a warning rather than throwing — web push simply stays off.
 */

const STORED_TOKEN_KEY = 'sel_web_push_token';
const SERVICE_WORKER_PATH = '/firebase-messaging-sw.js';

/** Firebase Messaging is unavailable in some browsers and all SSR contexts. */
export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'Notification' in window
    && 'PushManager' in window
  );
}

async function authorizedRequest(url: string, init: RequestInit) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error('No authenticated Firebase user.');
  const idToken = await firebaseUser.getIdToken();
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...(init.headers || {}),
    },
  });
}

/**
 * Register this browser for push, if permission allows.
 *
 * Returns the token on success, or null when push is unsupported, unconfigured, or
 * the user has not granted permission.
 *
 * Never prompts on its own beyond the browser's own permission dialog, and only
 * requests permission when it has not already been decided — re-asking a user who
 * said no is both futile (browsers remember) and hostile.
 */
export async function registerWebPushDevice(): Promise<string | null> {
  if (!isWebPushSupported()) return null;

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    console.warn(
      'Web push is not configured: NEXT_PUBLIC_FIREBASE_VAPID_KEY is unset. '
      + 'Add the Web Push certificate key pair from Firebase Console → Project '
      + 'settings → Cloud Messaging to enable browser notifications.',
    );
    return null;
  }

  try {
    // Imported on demand: firebase/messaging is only needed by browsers that
    // actually support push, and the header renders on every page.
    const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) return null;

    if (Notification.permission === 'denied') return null;
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return null;
    }

    // Registered explicitly rather than relying on FCM's implicit lookup, so the
    // scope is predictable and the same worker is reused across reloads.
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);

    const token = await getToken(getMessaging(), {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) return null;

    // FCM returns the same token for a given browser until it rotates, so skip the
    // write when nothing has changed.
    if (localStorage.getItem(STORED_TOKEN_KEY) === token) return token;

    const response = await authorizedRequest('/api/chat/push-device', {
      method: 'POST',
      body: JSON.stringify({ token, platform: 'web' }),
    });
    if (!response.ok) throw new Error(`Web push registration failed (${response.status}).`);

    localStorage.setItem(STORED_TOKEN_KEY, token);
    return token;
  } catch (error) {
    console.warn('Unable to register this browser for push notifications:', error);
    return null;
  }
}

/**
 * Drop this browser's registration — on sign-out, so the next person to use the
 * machine does not receive the previous user's alerts.
 */
export async function unregisterWebPushDevice(): Promise<void> {
  if (typeof window === 'undefined') return;
  const token = localStorage.getItem(STORED_TOKEN_KEY);
  if (!token) return;

  try {
    if (auth.currentUser) {
      await authorizedRequest('/api/chat/push-device', {
        method: 'DELETE',
        body: JSON.stringify({ token }),
        keepalive: true,
      });
    }
    // Cleared even if the request failed: leaving it behind would make the next
    // registerWebPushDevice() short-circuit on the stale token and never re-register.
    localStorage.removeItem(STORED_TOKEN_KEY);

    const { getMessaging, deleteToken } = await import('firebase/messaging');
    await deleteToken(getMessaging()).catch(() => {});
  } catch (error) {
    console.warn('Unable to unregister this browser from push notifications:', error);
  }
}
