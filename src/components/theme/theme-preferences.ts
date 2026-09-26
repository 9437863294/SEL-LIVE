/**
 * The app-wide appearance preferences that have to be applied to `<html>` before the first paint:
 * the colour mode (light / dark / follow the device) and the accent style shared by the floating
 * bottom navigation and every tab strip.
 *
 * Plain TypeScript with no React or DOM imports, so the resolution rules and the inline script can
 * be tested with node (`tests/theme-preferences.test.mjs`).
 */

export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedThemeMode = 'light' | 'dark';

/**
 * Light until a user picks otherwise. Most screens were built light-only and reach dark through the
 * compatibility layer (dark-compat.css); following every phone that happens to be in dark mode
 * would put that layer in front of people who never asked for it.
 */
export const DEFAULT_THEME_MODE: ThemeMode = 'light';

/**
 * The choices belong to the user — they live on the profile (`theme.mode`, `theme.navStyle`). This
 * device keeps a mirror of each user's, keyed by user id, for the inline script to read before
 * React and Firebase Auth have loaded. `THEME_USER_STORAGE_KEY` says whose mirror applies: the user
 * signed in here, or nobody after a sign-out — so a shared machine never hands one person's dark
 * mode to the next, and the sign-in screen is always in the default.
 */
export const THEME_USER_STORAGE_KEY = 'sel-theme-user';
const THEME_MODE_PREFIX = 'sel-theme-mode:';
const ACCENT_STYLE_PREFIX = 'sel-nav-style:';
export const themeModeStorageKey = (userId: string) => THEME_MODE_PREFIX + userId;
export const accentStyleStorageKey = (userId: string) => ACCENT_STYLE_PREFIX + userId;

/** Kept in step with `FLOATING_NAV_THEMES` in `src/components/navigation/themes.ts`. */
export const ACCENT_STYLES = ['blue', 'teal', 'neon'] as const;

export const themeModeMeta: Record<ThemeMode, { label: string; description: string }> = {
  light: { label: 'Light', description: 'Bright surfaces, best in daylight and for printing.' },
  dark: { label: 'Dark', description: 'Dim surfaces that are easier on the eyes at night.' },
  system: { label: 'System default', description: "Follows this device's light or dark setting." },
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
}

export function resolveThemeMode(mode: ThemeMode, systemPrefersDark: boolean): ResolvedThemeMode {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

/**
 * Runs synchronously in `<head>` while the HTML is parsed, so a dark-mode user never sees a white
 * flash and the accent is right on the first frame. Everything is inlined — the script cannot
 * import — and wrapped in try/catch because storage can be unavailable (private mode, blocked).
 */
export function themeInitScript(): string {
  const modes = JSON.stringify(THEME_MODES);
  const accents = JSON.stringify(ACCENT_STYLES);
  return [
    '(function(){try{',
    'var d=document.documentElement,s=window.localStorage;',
    `var u=s.getItem(${JSON.stringify(THEME_USER_STORAGE_KEY)});`,
    `var m=u?s.getItem(${JSON.stringify(THEME_MODE_PREFIX)}+u):null;`,
    `if(${modes}.indexOf(m)<0)m=${JSON.stringify(DEFAULT_THEME_MODE)};`,
    "var dark=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);",
    "d.classList.toggle('dark',dark);d.style.colorScheme=dark?'dark':'light';",
    `var a=u?s.getItem(${JSON.stringify(ACCENT_STYLE_PREFIX)}+u):null;`,
    `if(${accents}.indexOf(a)>=0)d.setAttribute('data-nav-style',a);`,
    '}catch(e){}})()',
  ].join('');
}
