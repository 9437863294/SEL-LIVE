/**
 * Colour-mode helpers for the theme controls. The vocabulary itself lives in the appearance
 * model (`src/lib/appearance/model.ts`); this adds the labels the controls show.
 */
import { THEME_MODES, isOneOf, type ThemeMode } from '@/lib/appearance/model';

export { THEME_MODES, type ThemeMode, type ResolvedThemeMode } from '@/lib/appearance/model';
export { resolveThemeMode } from '@/lib/appearance/init-script';

export const themeModeMeta: Record<ThemeMode, { label: string; description: string }> = {
  light: { label: 'Light', description: 'Bright surfaces, best in daylight and for printing.' },
  dark: { label: 'Dark', description: 'Dim surfaces that are easier on the eyes at night.' },
  system: { label: 'Follow device', description: "Switches with this device's light or dark setting." },
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return isOneOf(THEME_MODES, value);
}
