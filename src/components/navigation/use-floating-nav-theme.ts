'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { DEFAULT_FLOATING_NAV_THEME, isFloatingNavTheme, type FloatingNavTheme } from './themes';

/**
 * The signed-in user's chosen bottom-navigation look (Settings → Appearance), or the default.
 * "Signed-in" as in ThemeProvider: while an admin views the app as someone else, it stays theirs.
 */
export function useFloatingNavTheme(): FloatingNavTheme {
  const { user, originalUser } = useAuth();
  const chosen = (originalUser ?? user)?.theme?.navStyle;
  return isFloatingNavTheme(chosen) ? chosen : DEFAULT_FLOATING_NAV_THEME;
}
