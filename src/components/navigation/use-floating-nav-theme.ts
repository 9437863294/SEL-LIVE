'use client';

import { useAppearance } from '@/components/theme/ThemeProvider';
import type { FloatingNavTheme } from './themes';

/** The signed-in user's bottom-navigation style (Settings → Appearance), or the company default. */
export function useFloatingNavTheme(): FloatingNavTheme {
  return useAppearance().effective.navStyle;
}
