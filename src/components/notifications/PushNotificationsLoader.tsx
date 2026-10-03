'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

/**
 * Platform gate for push registration.
 *
 * `NativePushNotifications` statically imports `@capacitor/app`, `@capacitor/core`
 * and `@capacitor/push-notifications`. This is mounted from the root layout, so on
 * the web those native plugins would be pulled into the first-paint bundle only to
 * have the component bail out at runtime. The platform is read from the global
 * Capacitor injects into the native WebView — no static import — and only the
 * component that can actually do something is loaded.
 *
 * Replaces ChatPushNotificationsLoader, which gated on `getPlatform() === 'android'`
 * and had no web branch at all.
 */

// Push registration is best-effort. Mounted from the root layout, a rejected chunk
// load (a stale tab after a deploy, a dev server slow to serve) would otherwise throw
// a ChunkLoadError through RootLayout and take down every page.
const renderNothing = () => null;

const NativePushNotifications = dynamic(
  () =>
    import('./NativePushNotifications')
      .then((m) => m.NativePushNotifications)
      .catch((error) => {
        console.warn('[push] native push module failed to load', error);
        return renderNothing;
      }),
  { ssr: false }
);

const WebPushNotifications = dynamic(
  () =>
    import('./WebPushNotifications')
      .then((m) => m.WebPushNotifications)
      .catch((error) => {
        console.warn('[push] web push module failed to load', error);
        return renderNothing;
      }),
  { ssr: false }
);

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

export function PushNotificationsLoader() {
  // 'pending' until the effect has run: rendering the web branch during that window
  // would register a service worker inside the native WebView, where the native
  // plugin is already handling push.
  const [target, setTarget] = useState<'pending' | 'native' | 'web'>('pending');

  useEffect(() => {
    const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    const platform = capacitor?.getPlatform?.();
    const isNative = Boolean(capacitor?.isNativePlatform?.());
    setTarget(isNative && (platform === 'android' || platform === 'ios') ? 'native' : 'web');
  }, []);

  if (target === 'native') return <NativePushNotifications />;
  if (target === 'web') return <WebPushNotifications />;
  return null;
}
