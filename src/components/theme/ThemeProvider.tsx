'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/components/auth/AuthProvider';
import { DEFAULT_FLOATING_NAV_THEME, isFloatingNavTheme } from '@/components/navigation/themes';
import { db } from '@/lib/firebase';
import {
  DEFAULT_THEME_MODE,
  THEME_USER_STORAGE_KEY,
  accentStyleStorageKey,
  isThemeMode,
  resolveThemeMode,
  themeModeStorageKey,
  type ResolvedThemeMode,
  type ThemeMode,
} from './theme-preferences';

interface ThemeContextValue {
  /** What the signed-in user chose. */
  mode: ThemeMode;
  /** What is on screen — `system` resolved against the device. */
  resolvedMode: ResolvedThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const DARK_QUERY = '(prefers-color-scheme: dark)';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice still applies for this visit and is saved to the profile.
  }
}

/** This device's mirror of `userId`'s mode, or the default. */
function mirroredMode(userId: string | null): ThemeMode {
  const stored = userId ? read(themeModeStorageKey(userId)) : null;
  return isThemeMode(stored) ? stored : DEFAULT_THEME_MODE;
}

function subscribeToSystem(onChange: () => void) {
  const mql = window.matchMedia(DARK_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * The one place the app's colour mode and accent are decided and applied — per user.
 *
 * - Each user's choice lives on their profile (`theme.mode`, `theme.navStyle`), so it follows them
 *   from device to device, and never leaks to the next person on a shared one: signing out
 *   returns the device to the default, and a user who never chose starts at the default.
 * - "The user" is whoever signed in, even while they are viewing the app as someone else through
 *   Switch User — an admin's theme stays theirs, and their clicks never rewrite the other person's.
 * - A per-user mirror in localStorage lets the inline script in the root layout apply the theme
 *   before the first paint, so a reload in dark mode does not flash white.
 * - "System default" tracks the device live: flip the phone to dark mode and the app follows.
 * - Applied as the `dark` class on `<html>` (what Tailwind's `dark:` and the `.dark` tokens key off)
 *   and the accent as `data-nav-style`, which the tab strips' indicator reads.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, originalUser, loading } = useAuth();
  const person = originalUser ?? user;
  const personId = person?.id ?? null;

  // Starts at the default on server and client alike so hydration matches; the mirror the inline
  // script applied is picked up before paint below.
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_THEME_MODE);
  const [ready, setReady] = useState(false);
  const systemPrefersDark = useSyncExternalStore(subscribeToSystem, () => window.matchMedia(DARK_QUERY).matches, () => false);
  const resolvedMode = resolveThemeMode(mode, systemPrefersDark);

  useIsoLayoutEffect(() => {
    setModeState(mirroredMode(read(THEME_USER_STORAGE_KEY)));
    setReady(true);
  }, []);

  // Who is signed in decides the theme. The profile wins over the mirror (a choice made on the
  // laptop reaches the phone); the mirror covers a choice whose profile write has not landed.
  const savedMode = person?.theme?.mode;
  useEffect(() => {
    if (loading) return;
    if (!personId) {
      write(THEME_USER_STORAGE_KEY, null);
      setModeState(DEFAULT_THEME_MODE);
      return;
    }
    const next = isThemeMode(savedMode) ? savedMode : mirroredMode(personId);
    write(THEME_USER_STORAGE_KEY, personId);
    write(themeModeStorageKey(personId), next);
    setModeState(next);
  }, [loading, personId, savedMode]);

  // Also re-applies after React's development remount, which resets <html> to its JSX attributes.
  useIsoLayoutEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedMode === 'dark');
    root.style.colorScheme = resolvedMode;
  }, [resolvedMode, ready]);

  const savedAccent = person?.theme?.navStyle;
  useIsoLayoutEffect(() => {
    if (loading) return;
    const root = document.documentElement;
    if (!personId) {
      root.removeAttribute('data-nav-style');
      return;
    }
    const accent = isFloatingNavTheme(savedAccent) ? savedAccent : DEFAULT_FLOATING_NAV_THEME;
    root.setAttribute('data-nav-style', accent);
    write(accentStyleStorageKey(personId), accent);
  }, [loading, personId, savedAccent]);

  const setMode = useCallback(
    (next: ThemeMode) => {
      const apply = () => {
        setModeState(next);
        if (personId) write(themeModeStorageKey(personId), next);
      };
      // Cross-fade the whole page where the browser can; otherwise switch at once.
      const page = document as Document & { startViewTransition?: (update: () => void) => unknown };
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (page.startViewTransition && !reduceMotion) page.startViewTransition(() => flushSync(apply));
      else apply();

      if (personId) {
        updateDoc(doc(db, 'users', personId), { 'theme.mode': next }).catch((error) =>
          console.error('Could not save the theme mode to the profile:', error),
        );
      }
    },
    [personId],
  );

  const value = useMemo(() => ({ mode, resolvedMode, setMode }), [mode, resolvedMode, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return context;
}
