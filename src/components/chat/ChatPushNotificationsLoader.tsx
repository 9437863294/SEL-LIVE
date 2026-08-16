'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

/**
 * Platform gate for chat push registration.
 *
 * `ChatPushNotifications` statically imports `@capacitor/app`, `@capacitor/core`
 * and `@capacitor/push-notifications`. It's mounted from the root layout, so on
 * the web those native plugins were pulled into the first-paint bundle only to
 * have the component bail out at runtime. This wrapper checks the platform via
 * the global Capacitor injects into the native WebView — no static import — and
 * loads the real component only where it can actually do something.
 */

const ChatPushNotifications = dynamic(
  () => import('./ChatPushNotifications').then((m) => m.ChatPushNotifications),
  { ssr: false }
);

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

export function ChatPushNotificationsLoader() {
  const [isNativeAndroid, setIsNativeAndroid] = useState(false);

  useEffect(() => {
    const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    setIsNativeAndroid(
      Boolean(capacitor?.isNativePlatform?.() && capacitor?.getPlatform?.() === 'android')
    );
  }, []);

  if (!isNativeAndroid) return null;
  return <ChatPushNotifications />;
}
