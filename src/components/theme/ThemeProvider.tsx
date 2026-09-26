'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import {
  DEFAULT_PUBLISHED,
  sanitizePreferences,
  sanitizePublished,
  type CompanyAppearanceConfig,
  type PublishedAppearance,
  type ResolvedThemeMode,
  type ThemeMode,
  type UserAppearancePreferences,
} from '@/lib/appearance/model';
import { appearanceAttributes, buildAppearanceCss, resolveAppearance, type EffectiveAppearance } from '@/lib/appearance/resolve';
import {
  APPEARANCE_USER_KEY,
  CACHE_VERSION,
  COMPANY_CACHE_KEY,
  resolveThemeMode,
  userCacheKey,
  type AppearanceCache,
} from '@/lib/appearance/init-script';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** An administrator's unpublished theme, shown in place of the published one on this page only. */
export interface AppearancePreview {
  config: CompanyAppearanceConfig;
  mode?: ThemeMode;
  contrast?: 'standard' | 'high';
  /** Show the company's defaults as everyone else would see them, not this user's own choices. */
  ignorePreferences?: boolean;
}

interface AppearanceContextValue {
  /** The published company appearance (branding, theme, defaults). */
  company: PublishedAppearance;
  /** The signed-in user's own choices; `{}` means "all company defaults". */
  preferences: UserAppearancePreferences;
  /** What applies after precedence — see `resolveAppearance`. */
  effective: EffectiveAppearance;
  resolvedMode: ResolvedThemeMode;
  signedIn: boolean;
  /** Preferences have been loaded (or there is no user). Controls wait for this. */
  ready: boolean;
  saveStatus: SaveStatus;
  saveError: string | null;
  updatePreferences: (change: UserAppearancePreferences | ((current: UserAppearancePreferences) => UserAppearancePreferences)) => void;
  resetPreferences: () => void;
  retrySave: () => void;
  /** Re-read the published appearance (after an administrator publishes). */
  refreshCompany: () => Promise<void>;
  setPreview: (preview: AppearancePreview | null) => void;
  preview: AppearancePreview | null;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const DARK_QUERY = '(prefers-color-scheme: dark)';
const COMPANY_CONFIG_KEY = 'sel-appearance:company-config';
const prefsKey = (uid: string) => `sel-appearance-prefs:${uid}`;
const SAVE_DELAY_MS = 450;

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    // Storage blocked or full: the appearance still applies for this visit and saves to the profile.
  }
}

/** This device's copy of a user's preferences; `dirty` marks a change the server has not confirmed. */
interface PrefsMirror {
  preferences: UserAppearancePreferences;
  dirty: boolean;
}

function subscribeToSystem(onChange: () => void) {
  const mql = window.matchMedia(DARK_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

async function authorizedFetch(user: FirebaseUser, input: string, init: RequestInit = {}) {
  const token = await user.getIdToken();
  return fetch(input, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
}

/**
 * The one place appearance is decided and applied, for the whole app and the sign-in page.
 *
 * - The company's published appearance comes from `/api/appearance/company` (public, so the
 *   sign-in page is branded too) and is cached for the next visit's first frame.
 * - The signed-in person's preferences — keyed by their Firebase uid, so Switch User never mixes
 *   an administrator's appearance with the account they are viewing — load from the profile and
 *   follow them to every device.
 * - Changes apply at once and save shortly after. Until the server confirms, the change is kept
 *   on this device marked unsaved and retried on the next load, so a failed save is never lost
 *   silently; the Saving / Saved / Error state is exposed for the settings screens to show.
 * - Everything on screen is set on <html>: the `dark` class, `data-*` attributes for density, text
 *   size, font, radius, motion and contrast, and one generated token stylesheet. The inline script
 *   in the root layout replays the cached copy before the first paint.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [company, setCompany] = useState<PublishedAppearance>(DEFAULT_PUBLISHED);
  const [preferences, setPreferences] = useState<UserAppearancePreferences>({});
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authKnown, setAuthKnown] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AppearancePreview | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const latestPrefs = useRef<UserAppearancePreferences>({});
  const uid = firebaseUser?.uid ?? null;

  const systemPrefersDark = useSyncExternalStore(subscribeToSystem, () => window.matchMedia(DARK_QUERY).matches, () => false);

  // Before paint on first mount: the cached company appearance and, if someone is signed in on this
  // device, their cached preferences — the same values the inline script already applied.
  useIsoLayoutEffect(() => {
    const cachedCompany = read<unknown>(COMPANY_CONFIG_KEY);
    if (cachedCompany) setCompany(sanitizePublished(cachedCompany));
    const pointer = (() => {
      try {
        return window.localStorage.getItem(APPEARANCE_USER_KEY);
      } catch {
        return null;
      }
    })();
    const mirror = pointer ? read<PrefsMirror>(prefsKey(pointer)) : null;
    if (mirror) {
      const prefs = sanitizePreferences(mirror.preferences);
      latestPrefs.current = prefs;
      setPreferences(prefs);
    }
    setHydrated(true);
  }, []);

  const refreshCompany = useCallback(async () => {
    try {
      const response = await fetch('/api/appearance/company', { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await response.json()) as { published?: unknown; fallback?: boolean };
      // A fallback answer means the server could not read the real one; keep what we have.
      if (body.fallback) return;
      const published = sanitizePublished(body.published);
      setCompany(published);
      write(COMPANY_CONFIG_KEY, published);
    } catch {
      // Offline: the cached appearance stays.
    }
  }, []);

  useEffect(() => {
    void refreshCompany();
  }, [refreshCompany]);

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        setFirebaseUser(user);
        setAuthKnown(true);
      }),
    [],
  );

  const persistMirror = useCallback((userId: string, prefs: UserAppearancePreferences, dirty: boolean) => {
    write(prefsKey(userId), { preferences: prefs, dirty } satisfies PrefsMirror);
  }, []);

  const saveNow = useCallback(async () => {
    if (!firebaseUser) return;
    const prefs = latestPrefs.current;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const response = await authorizedFetch(firebaseUser, '/api/appearance/preferences', {
        method: 'PUT',
        body: JSON.stringify({ preferences: prefs }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `The server answered ${response.status}.`);
      }
      // Only mark clean if nothing changed while the request was in flight.
      if (latestPrefs.current === prefs) persistMirror(firebaseUser.uid, prefs, false);
      setSaveStatus('saved');
    } catch (error) {
      setSaveStatus('error');
      setSaveError(error instanceof Error ? error.message : 'Your appearance could not be saved.');
    }
  }, [firebaseUser, persistMirror]);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveNow(), SAVE_DELAY_MS);
  }, [saveNow]);

  // Who is signed in decides whose preferences apply.
  useEffect(() => {
    if (!authKnown) return;
    if (!firebaseUser) {
      write(APPEARANCE_USER_KEY, null);
      latestPrefs.current = {};
      setPreferences({});
      setPrefsLoaded(true);
      setSaveStatus('idle');
      return;
    }
    const userId = firebaseUser.uid;
    write(APPEARANCE_USER_KEY, userId);
    const mirror = read<PrefsMirror>(prefsKey(userId));
    if (mirror) {
      const prefs = sanitizePreferences(mirror.preferences);
      latestPrefs.current = prefs;
      setPreferences(prefs);
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await authorizedFetch(firebaseUser, '/api/appearance/preferences');
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { preferences?: unknown };
        if (cancelled) return;
        if (mirror?.dirty) {
          // A change made here never reached the server: it wins, and is sent again now.
          scheduleSave();
        } else {
          const prefs = sanitizePreferences(body.preferences);
          latestPrefs.current = prefs;
          setPreferences(prefs);
          persistMirror(userId, prefs, false);
        }
      } catch {
        // Offline or the server is unavailable: the device copy applies; nothing is lost.
      } finally {
        if (!cancelled) setPrefsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authKnown, firebaseUser, persistMirror, scheduleSave]);

  const updatePreferences = useCallback<AppearanceContextValue['updatePreferences']>(
    (change) => {
      const next = sanitizePreferences(typeof change === 'function' ? change(latestPrefs.current) : { ...latestPrefs.current, ...change });
      latestPrefs.current = next;
      const apply = () => setPreferences(next);
      // A change of colour mode cross-fades the page where the browser can.
      const page = document as Document & { startViewTransition?: (update: () => void) => unknown };
      const modeChanged = next.mode !== preferences.mode;
      const reduce = document.documentElement.dataset.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (modeChanged && page.startViewTransition && !reduce) page.startViewTransition(() => flushSync(apply));
      else apply();
      if (uid) {
        persistMirror(uid, next, true);
        setSaveStatus('saving');
        scheduleSave();
      }
    },
    [uid, persistMirror, scheduleSave, preferences.mode],
  );

  const resetPreferences = useCallback(() => updatePreferences(() => ({})), [updatePreferences]);
  const retrySave = useCallback(() => void saveNow(), [saveNow]);

  // ── What is on screen ──────────────────────────────────────────────────────────────────────────
  const baseConfig: CompanyAppearanceConfig = preview?.config ?? company;
  const effective = useMemo(() => {
    const resolved = resolveAppearance(baseConfig, preview?.ignorePreferences ? {} : preferences);
    if (preview?.mode) resolved.mode = preview.mode;
    if (preview?.contrast) resolved.contrast = preview.contrast;
    return resolved;
  }, [baseConfig, preferences, preview]);
  const resolvedMode = resolveThemeMode(effective.mode, systemPrefersDark);
  const css = useMemo(() => buildAppearanceCss(baseConfig, effective.accent), [baseConfig, effective.accent]);

  useIsoLayoutEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedMode === 'dark');
    root.style.colorScheme = resolvedMode;
    for (const [name, value] of Object.entries(appearanceAttributes(effective))) root.setAttribute(`data-${name}`, value);
    let style = document.getElementById('sel-appearance') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'sel-appearance';
      document.head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
  }, [hydrated, resolvedMode, effective, css]);

  // Keep the first-frame caches current — but never from an unpublished preview.
  useEffect(() => {
    if (!hydrated || preview) return;
    const entry: AppearanceCache = { v: CACHE_VERSION, mode: effective.mode, attrs: appearanceAttributes(effective), css };
    if (uid) write(userCacheKey(uid), entry);
    const companyEffective = resolveAppearance(company, {});
    write(COMPANY_CACHE_KEY, {
      v: CACHE_VERSION,
      mode: companyEffective.mode,
      attrs: appearanceAttributes(companyEffective),
      css: buildAppearanceCss(company, companyEffective.accent),
    } satisfies AppearanceCache);
  }, [hydrated, preview, uid, effective, css, company]);

  // The company favicon, where one is published.
  const favicon = company.branding.favicon?.url ?? null;
  useEffect(() => {
    if (!favicon) return;
    let link = document.querySelector<HTMLLinkElement>('link[data-sel-favicon]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.setAttribute('data-sel-favicon', '');
      document.head.appendChild(link);
    }
    link.type = 'image/png';
    link.href = favicon;
  }, [favicon]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      company,
      preferences,
      effective,
      resolvedMode,
      signedIn: Boolean(uid),
      ready: authKnown && prefsLoaded,
      saveStatus,
      saveError,
      updatePreferences,
      resetPreferences,
      retrySave,
      refreshCompany,
      setPreview,
      preview,
    }),
    [company, preferences, effective, resolvedMode, uid, authKnown, prefsLoaded, saveStatus, saveError, updatePreferences, resetPreferences, retrySave, refreshCompany, preview],
  );
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('useAppearance must be used inside <ThemeProvider>.');
  return context;
}

/** The colour-mode slice, for the header switch and the Appearance cards. */
export function useTheme() {
  const { effective, resolvedMode, updatePreferences } = useAppearance();
  const setMode = useCallback((mode: ThemeMode) => updatePreferences({ mode }), [updatePreferences]);
  return { mode: effective.mode, resolvedMode, setMode };
}

/** Reduced motion from either the user's own setting or the device's. */
export function useReducedMotion(): boolean {
  const context = useContext(AppearanceContext);
  const device = useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
  return context?.effective.motion === 'reduced' || device;
}
