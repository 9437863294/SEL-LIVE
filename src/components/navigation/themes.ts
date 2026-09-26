import type { NavShape } from './geometry';

/**
 * The looks of the floating bottom navigation. Colours live in globals.css under `.fbn` (so dark
 * mode can override them); this is the list the component and the Appearance page share. Each one
 * also colours the app's tab strips (`html[data-nav-style]` in globals.css).
 */
export const FLOATING_NAV_THEMES = ['blue', 'teal', 'neon', 'glass', 'sunset', 'graphite'] as const;

export type FloatingNavTheme = (typeof FLOATING_NAV_THEMES)[number];

export const DEFAULT_FLOATING_NAV_THEME: FloatingNavTheme = 'blue';

export const floatingNavThemeMeta: Record<
  FloatingNavTheme,
  {
    label: string;
    description: string;
    shape: NavShape;
    swatch: string;
    /** A dark bar whatever the app's mode — its previews sit on a dark backdrop. */
    darkBar: boolean;
  }
> = {
  blue: {
    label: 'Blue Floating',
    description: 'White bar, indigo-violet button that rides a curved notch.',
    shape: 'notch',
    swatch: 'from-indigo-500 to-violet-600',
    darkBar: false,
  },
  teal: {
    label: 'Teal Floating',
    description: 'White bar, teal button with a soft glow beneath it.',
    shape: 'notch',
    swatch: 'from-emerald-300 to-teal-500',
    darkBar: false,
  },
  neon: {
    label: 'Red Neon',
    description: 'Near-black bar with a glowing red wave under the active tab.',
    shape: 'bump',
    swatch: 'from-rose-500 to-pink-600',
    darkBar: true,
  },
  glass: {
    label: 'Ocean Glass',
    description: 'Frosted see-through bar; a sky-blue capsule glides behind the active tab.',
    shape: 'pill',
    swatch: 'from-sky-400 to-blue-600',
    darkBar: false,
  },
  sunset: {
    label: 'Sunset Line',
    description: 'Clean white bar; a glowing orange line slides along the top edge.',
    shape: 'line',
    swatch: 'from-amber-400 to-orange-600',
    darkBar: false,
  },
  graphite: {
    label: 'Graphite Tile',
    description: 'Graphite bar; the active tab rises onto a bright lime tile.',
    shape: 'tile',
    swatch: 'from-lime-300 to-lime-500',
    darkBar: true,
  },
};

export function isFloatingNavTheme(value: unknown): value is FloatingNavTheme {
  return typeof value === 'string' && (FLOATING_NAV_THEMES as readonly string[]).includes(value);
}
