/**
 * "Driver app mode" in a browser: the SEL Driver phone experience — Fleet & Travel's own mobile
 * shell without the global header, and the driver sign-in page when signed out.
 *
 * Signing in at /driver-login sets `driver_app_mode` in both storages, for a driver who uses a
 * phone's browser rather than the app. It is honoured only on a touch-first device: the flag never
 * expires, so a desktop browser that opened the driver sign-in once lost the global header on every
 * Fleet & Travel page for good. Signing in through the normal /login clears it. The native app and
 * its Android WebView are recognised directly by the callers and need no flag.
 */

export const DRIVER_APP_MODE_KEY = 'driver_app_mode';

function flagSet(): boolean {
  try {
    return window.sessionStorage.getItem(DRIVER_APP_MODE_KEY) === '1' || window.localStorage.getItem(DRIVER_APP_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

/** A phone or tablet (its primary pointer is a finger), where the driver shell is meant to be. */
function touchFirst(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** Whether this browser asked for the driver experience, and is a device it is made for. */
export function driverAppModeActive(): boolean {
  if (typeof window === 'undefined') return false;
  return flagSet() && touchFirst();
}

/** The full app was chosen (a sign-in through /login): back to the normal layout. */
export function clearDriverAppMode(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(DRIVER_APP_MODE_KEY);
    window.localStorage.removeItem(DRIVER_APP_MODE_KEY);
  } catch {
    // Storage blocked: nothing was stored either.
  }
}
