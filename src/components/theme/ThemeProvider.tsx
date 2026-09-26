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
import { useFloatingNavTheme } from '@/components/navigation/use-floating-nav-theme';
import { db } from '@/lib/firebase';
import {
  ACCENT_STYLE_STORAGE_KEY,
  DEFAULT_THEME_MODE,
  THEME_MODE_STORAGE_KEY,
  isThemeMode,
  resolveThemeMode,
  type ResolvedThemeMode,
  type ThemeMode,
} from './theme-preferences';

interface ThemeContextValue {
  /** What the user chose. */
  mode: ThemeMode;
  /** What is on screen — `system` resolved against the device. */
  resolvedMode: ResolvedThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStoredMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
    return isThemeMode(stored) ? stored : DEFAULT_THEME_MODE;
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice still applies for this visit and is saved to the profile.
  }
}

function subscribeToSystem(onChange: () => void) {
  const mql = window.matchMedia(DARK_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * The one place the app's colour mode and accent are decided and applied.
 *
 * - The choice lives on the user's profile (`theme.mode`, `theme.navStyle`) so it follows them
 *   between devices, and is mirrored to localStorage so the inline script in the root layout can
 *   apply it before the first paint — including on the login screen.
 * - "System default" tracks the device live: flip the phone to dark mode and the app follows.
 * - The mode is applied as the `dark` class on `<html>` (what Tailwind's `dark:` and the `.dark`
 *   tokens key off) and the accent as `data-nav-style`, which the tab strips' indicator reads.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Starts at the default on both server and client so hydration matches; the stored value is
  // picked up before paint below. The inline script has already put the right class on <html>.
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_THEME_MODE);
  const [ready, setReady] = useState(false);
  const systemPrefersDark = useSyncExternalStore(subscribeToSystem, () => window.matchMedia(DARK_QUERY).matches, () => false);
  const resolvedMode = resolveThemeMode(mode, systemPrefersDark);

  useIsoLayoutEffect(() => {
    setModeState(readStoredMode());
    setReady(true);
  }, []);

  // The profile wins over this device's mirror, so a choice made on the laptop reaches the phone.
  const savedMode = user?.theme?.mode;
  useEffect(() => {
    if (!isThemeMode(savedMode)) return;
    setModeState(savedMode);
    store(THEME_MODE_STORAGE_KEY, savedMode);
  }, [savedMode]);

  // Also re-applies after React's development remount, which resets <html> to its JSX attributes.
  useIsoLayoutEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedMode === 'dark');
    root.style.colorScheme = resolvedMode;
  }, [resolvedMode, ready]);

  const accent = useFloatingNavTheme();
  const signedIn = Boolean(user);
  useIsoLayoutEffect(() => {
    // Signed out, `accent` is only the default — keep whatever the script restored.
    if (!signedIn) return;
    document.documentElement.setAttribute('data-nav-style', accent);
    store(ACCENT_STYLE_STORAGE_KEY, accent);
  }, [accent, signedIn]);

  const userId = user?.id;
  const setMode = useCallback(
    (next: ThemeMode) => {
      const apply = () => {
        setModeState(next);
        store(THEME_MODE_STORAGE_KEY, next);
      };
      // Cross-fade the whole page where the browser can; otherwise switch at once.
      const page = document as Document & { startViewTransition?: (update: () => void) => unknown };
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (page.startViewTransition && !reduceMotion) page.startViewTransition(() => flushSync(apply));
      else apply();

      if (userId) {
        updateDoc(doc(db, 'users', userId), { 'theme.mode': next }).catch((error) =>
          console.error('Could not save the theme mode to the profile:', error),
        );
      }
    },
    [userId],
  );

  const value = useMemo(() => ({ mode, resolvedMode, setMode }), [mode, resolvedMode, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return context;
}
