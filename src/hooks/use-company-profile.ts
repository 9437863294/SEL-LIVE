'use client';

/**
 * The company profile for the browser: name, address, letterhead design, table/dialog design and
 * UI text. Shared by every component through one module-level store, so a page with ten letterheads
 * and fifty labels makes one request.
 *
 * Returns the shipped defaults at once and the stored profile once `/api/company-profile` answers —
 * nothing waits on it, and a failed read keeps the defaults. After a save, call
 * `invalidateCompanyProfile()` (or pass the saved profile) and every mounted consumer re-renders.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { auth } from '@/lib/firebase';
import { DEFAULT_COMPANY_PROFILE, sanitizeCompanyProfile, uiText, type CompanyProfile, type UiTextKey } from '@/lib/company-profile';

interface Store {
  profile: CompanyProfile;
  loaded: boolean;
  request: Promise<void> | null;
}

let store: Store = { profile: DEFAULT_COMPANY_PROFILE, loaded: false, request: null };
const listeners = new Set<() => void>();

const publish = (next: Partial<Store>) => {
  store = { ...store, ...next };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => store;
// Server render and hydration must agree, so both see the defaults; React re-renders with the live
// store right after hydration.
const SERVER_SNAPSHOT: Store = { profile: DEFAULT_COMPANY_PROFILE, loaded: false, request: null };
const getServerSnapshot = () => SERVER_SNAPSHOT;

async function fetchProfile(): Promise<void> {
  try {
    await auth.authStateReady();
    const user = auth.currentUser;
    // Signed out: the defaults stand, and the next mount after sign-in tries again.
    if (!user) return publish({ loaded: true, request: null });
    const token = await user.getIdToken();
    const response = await fetch('/api/company-profile', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    publish({ profile: sanitizeCompanyProfile(await response.json()), loaded: true, request: null });
  } catch (error) {
    console.warn('[company-profile] using defaults:', error);
    publish({ loaded: true, request: null });
  }
}

function ensureLoaded() {
  if (store.loaded || store.request) return;
  store.request = fetchProfile();
}

/**
 * Drop the cached profile and read it again — after a save. Passing the saved profile shows it at
 * once and skips the request.
 */
export function invalidateCompanyProfile(saved?: CompanyProfile): void {
  if (saved) {
    publish({ profile: sanitizeCompanyProfile(saved), loaded: true, request: null });
    return;
  }
  publish({ loaded: false, request: null });
  ensureLoaded();
}

export function useCompanyProfile(): { profile: CompanyProfile; loading: boolean } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    ensureLoaded();
  }, []);
  return { profile: snapshot.profile, loading: !snapshot.loaded };
}

/**
 * `t('save')` → the company's word for Save. A caller's own `fallback` ("Save voucher") is kept
 * unless an admin has changed that label in Settings › Company Profile.
 */
export function useUiText(): (key: UiTextKey, fallback?: string) => string {
  const { profile } = useCompanyProfile();
  const labels = profile.labels;
  return useCallback((key: UiTextKey, fallback?: string) => uiText(labels, key, fallback), [labels]);
}

export function useCompanyDesign(): CompanyProfile['design'] {
  return useCompanyProfile().profile.design;
}
