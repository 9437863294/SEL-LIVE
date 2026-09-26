'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { DEFAULT_FLOATING_NAV_THEME, isFloatingNavTheme, type FloatingNavTheme } from './themes';

/** The signed-in user's chosen bottom-navigation look (Settings → Appearance), or the default. */
export function useFloatingNavTheme(): FloatingNavTheme {
  const { user } = useAuth();
  const chosen = user?.theme?.navStyle;
  return isFloatingNavTheme(chosen) ? chosen : DEFAULT_FLOATING_NAV_THEME;
}
