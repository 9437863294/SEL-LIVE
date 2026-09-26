/**
 * The inline script the root layout runs in <head>, before anything is painted.
 *
 * It reapplies the last appearance this device saw — the signed-in user's, or the company's on the
 * sign-in screen — from a localStorage cache that AppearanceProvider keeps current: the `dark`
 * class, the `data-*` attributes, and the token stylesheet. So a dark-mode, large-text user gets a
 * dark, large-text first frame instead of a white flash that reflows.
 *
 * Everything the script reads back is checked against the same fixed lists the provider writes
 * from; an unexpected value is ignored, and any exception leaves the page in its defaults.
 */
import {
  CONTRASTS,
  DENSITIES,
  FONTS,
  MOTIONS,
  NAV_STYLES,
  RADII,
  TEXT_SIZES,
  THEME_MODES,
  type ResolvedThemeMode,
  type ThemeMode,
} from './model.ts';

/** Whose cache applies: the uid signed in on this device, removed on sign-out. */
export const APPEARANCE_USER_KEY = 'sel-theme-user';
export const COMPANY_CACHE_KEY = 'sel-appearance:company';
export const userCacheKey = (uid: string) => `sel-appearance:${uid}`;
export const CACHE_VERSION = 1;

/** The first frame before anything is known: the built-in company default. */
export const FALLBACK_MODE: ThemeMode = 'light';

export interface AppearanceCache {
  v: typeof CACHE_VERSION;
  mode: ThemeMode;
  attrs: Record<string, string>;
  css: string;
}

export const CACHEABLE_ATTRIBUTES: Record<string, readonly string[]> = {
  density: DENSITIES,
  'text-size': TEXT_SIZES,
  font: FONTS,
  radius: RADII,
  motion: MOTIONS,
  contrast: CONTRASTS,
  'table-density': DENSITIES,
  'nav-style': NAV_STYLES,
};

export function resolveThemeMode(mode: ThemeMode, systemPrefersDark: boolean): ResolvedThemeMode {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

export function appearanceInitScript(): string {
  return [
    '(function(){try{',
    'var d=document.documentElement,s=window.localStorage;',
    `var u=s.getItem(${JSON.stringify(APPEARANCE_USER_KEY)});`,
    `var raw=(u&&s.getItem(${JSON.stringify('sel-appearance:')}+u))||s.getItem(${JSON.stringify(COMPANY_CACHE_KEY)});`,
    'var c=raw?JSON.parse(raw):null;',
    `if(!c||c.v!==${CACHE_VERSION})c={};`,
    `var m=${JSON.stringify(THEME_MODES)}.indexOf(c.mode)>=0?c.mode:${JSON.stringify(FALLBACK_MODE)};`,
    "var dark=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);",
    "d.classList.toggle('dark',dark);d.style.colorScheme=dark?'dark':'light';",
    `var A=${JSON.stringify(CACHEABLE_ATTRIBUTES)},a=c.attrs||{},k;`,
    "for(k in A){if(A[k].indexOf(a[k])>=0)d.setAttribute('data-'+k,a[k]);}",
    "if(typeof c.css==='string'&&c.css.length<200000){var st=document.createElement('style');st.id='sel-appearance';st.textContent=c.css;(document.head||d).appendChild(st);}",
    '}catch(e){}})()',
  ].join('');
}
