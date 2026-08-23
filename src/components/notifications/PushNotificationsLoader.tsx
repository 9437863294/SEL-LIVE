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

const NativePushNotifications = dynamic(
  () => import('./NativePushNotifications').then((m) => m.NativePushNotifications),
  { ssr: false }
);

const WebPushNotifications = dynamic(
  () => import('./WebPushNotifications').then((m) => m.WebPushNotifications),
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
