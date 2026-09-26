import type { NavShape } from './geometry';

/**
 * The three looks of the floating bottom navigation. Colours live in globals.css under `.fbn`
 * (so dark mode can override them); this is the list the component and the Appearance page share.
 */
export const FLOATING_NAV_THEMES = ['blue', 'teal', 'neon'] as const;

export type FloatingNavTheme = (typeof FLOATING_NAV_THEMES)[number];

export const DEFAULT_FLOATING_NAV_THEME: FloatingNavTheme = 'blue';

export const floatingNavThemeMeta: Record<
  FloatingNavTheme,
  { label: string; description: string; shape: NavShape; swatch: string }
> = {
  blue: {
    label: 'Blue Floating',
    description: 'White bar, indigo-violet button that rides a curved notch.',
    shape: 'notch',
    swatch: 'from-indigo-500 to-violet-600',
  },
  teal: {
    label: 'Teal Floating',
    description: 'White bar, teal button with a soft glow beneath it.',
    shape: 'notch',
    swatch: 'from-emerald-300 to-teal-500',
  },
  neon: {
    label: 'Red Neon',
    description: 'Near-black bar with a glowing red wave under the active tab.',
    shape: 'bump',
    swatch: 'from-rose-500 to-pink-600',
  },
};

export function isFloatingNavTheme(value: unknown): value is FloatingNavTheme {
  return typeof value === 'string' && (FLOATING_NAV_THEMES as readonly string[]).includes(value);
}
