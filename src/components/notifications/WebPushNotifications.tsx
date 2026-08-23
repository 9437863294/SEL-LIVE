'use client';

import { useEffect } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { registerWebPushDevice } from '@/lib/web-push-client';

/**
 * Web push registration for browser users.
 *
 * The web app had no push at all — notifications only appeared in the bell, and only
 * while a tab was open. This registers an FCM token against the service worker at
 * public/firebase-messaging-sw.js so alerts arrive with the tab closed.
 *
 * Silently does nothing when NEXT_PUBLIC_FIREBASE_VAPID_KEY is unset or the browser
 * has denied notifications; see lib/web-push-client for the specifics.
 */
export function WebPushNotifications() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;
    // Deferred past first paint: registration touches the service worker and mints a
    // token over the network, neither of which should compete with rendering the page.
    const timer = window.setTimeout(() => {
      if (!cancelled) void registerWebPushDevice();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [user?.id]);

  // Sign-out cleanup lives in AuthProvider, which calls unregisterWebPushDevice as
  // part of the teardown. Doing it here as well would also fire on first mount,
  // before the user has loaded, and delete the token that had just been minted.
  return null;
}
