'use client';

import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { nativeTrackingAvailable, resumeIfActive } from '@/lib/trip-tracking/tracking';

/**
 * The watchdog's app-side half (docs/BACKGROUND-TRACKING-PLAN.md): on launch and every time the app
 * comes back to the foreground, a trip the native recorder still holds but is no longer running —
 * the phone killed the service and Android did not restart it — is started again. The recorder
 * records the gap itself. Mounted once in the Driver Management shell, so it runs on whichever page
 * the driver opens; renders nothing.
 */
export function ResumeTracking() {
  useEffect(() => {
    if (!nativeTrackingAvailable()) return undefined;
    void resumeIfActive().catch(() => null);
    const appState = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void resumeIfActive().catch(() => null);
    });
    return () => {
      void appState.then((handle) => handle.remove()).catch(() => undefined);
    };
  }, []);
  return null;
}
