/**
 * Theme presets as full semantic token sets, one for light surfaces and one for dark.
 *
 * Values are `[hue, saturation%, lightness%]` because that is what shadcn's `hsl(var(--token))`
 * consumes. SEL Classic and SEL Midnight reproduce the values globals.css shipped with before the
 * appearance system existed, so an installation that never publishes anything looks unchanged —
 * except the destructive red, which moves one shade deeper so white text on it reads at 4.5:1.
 *
 * `primary` / `ring` are not part of a preset: they come from the accent (see resolve.ts).
 */
import { hexToHsl, type Hex } from './color.ts';
import type { CustomToken } from './model.ts';

export type Hsl = readonly [number, number, number];

export const SEMANTIC_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'border',
  'input',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'danger',
  'danger-foreground',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
] as const;
export type SemanticToken = (typeof SEMANTIC_TOKENS)[number];
export type TokenSet = Record<SemanticToken, Hsl>;

const WHITE: Hsl = [0, 0, 100];
const NEAR_WHITE: Hsl = [0, 0, 98];
const INK: Hsl = [222.2, 84, 4.9];

export const SEL_CLASSIC: TokenSet = {
  background: [220, 20, 98],
  foreground: INK,
  card: [220, 20, 100],
  'card-foreground': INK,
  popover: WHITE,
  'popover-foreground': INK,
  secondary: [210, 40, 96.1],
  'secondary-foreground': [222.2, 47.4, 11.2],
  muted: [210, 40, 96.1],
  'muted-foreground': [215.4, 16.3, 46.9],
  accent: [210, 40, 96.1],
  'accent-foreground': [222.2, 47.4, 11.2],
  border: [214.3, 31.8, 91.4],
  input: [214.3, 31.8, 91.4],
  success: [142.4, 71.8, 29.2],
  'success-foreground': WHITE,
  warning: [26, 90.5, 37.1],
  'warning-foreground': WHITE,
  danger: [0, 72.2, 50.6],
  'danger-foreground': NEAR_WHITE,
  'chart-1': [220, 70, 50],
  'chart-2': [160, 60, 45],
  'chart-3': [30, 80, 55],
  'chart-4': [280, 65, 60],
  'chart-5': [340, 75, 55],
};

export const SEL_MIDNIGHT: TokenSet = {
  background: [240, 10, 3.9],
  foreground: NEAR_WHITE,
  card: [240, 5, 12],
  'card-foreground': NEAR_WHITE,
  popover: [240, 6, 10],
  'popover-foreground': NEAR_WHITE,
  secondary: [240, 3.7, 15.9],
  'secondary-foreground': NEAR_WHITE,
  muted: [240, 3.7, 15.9],
  'muted-foreground': [0, 0, 63.9],
  accent: [240, 3.7, 15.9],
  'accent-foreground': NEAR_WHITE,
  // A step lighter than the old 15.9%, which sat at 1.1:1 against cards and all but vanished.
  border: [240, 4, 21],
  input: [240, 4, 21],
  success: [142.1, 70.6, 45.3],
  'success-foreground': [144, 61, 7],
  warning: [45.9, 96.7, 64.5],
  'warning-foreground': [26, 83, 14],
  danger: [0, 72.2, 50.6],
  'danger-foreground': NEAR_WHITE,
  'chart-1': [220, 70, 60],
  'chart-2': [160, 60, 50],
  'chart-3': [30, 80, 60],
  'chart-4': [280, 65, 68],
  'chart-5': [340, 75, 62],
};

/** Pure black on white, with every secondary surface still well past 7:1. */
export const HIGH_CONTRAST_LIGHT: TokenSet = {
  background: WHITE,
  foreground: [0, 0, 0],
  card: WHITE,
  'card-foreground': [0, 0, 0],
  popover: WHITE,
  'popover-foreground': [0, 0, 0],
  secondary: [0, 0, 92],
  'secondary-foreground': [0, 0, 0],
  muted: [0, 0, 94],
  'muted-foreground': [0, 0, 18],
  accent: [0, 0, 90],
  'accent-foreground': [0, 0, 0],
  border: [0, 0, 20],
  input: [0, 0, 20],
  success: [142.8, 64.2, 24.1],
  'success-foreground': WHITE,
  warning: [22.7, 82.5, 26.1],
  'warning-foreground': WHITE,
  danger: [0, 73.7, 35],
  'danger-foreground': WHITE,
  'chart-1': [220, 90, 32],
  'chart-2': [160, 90, 22],
  'chart-3': [26, 90, 34],
  'chart-4': [280, 70, 38],
  'chart-5': [340, 80, 36],
};

export const HIGH_CONTRAST_DARK: TokenSet = {
  background: [0, 0, 0],
  foreground: WHITE,
  card: [0, 0, 5],
  'card-foreground': WHITE,
  popover: [0, 0, 5],
  'popover-foreground': WHITE,
  secondary: [0, 0, 14],
  'secondary-foreground': WHITE,
  muted: [0, 0, 11],
  'muted-foreground': [0, 0, 86],
  accent: [0, 0, 16],
  'accent-foreground': WHITE,
  border: [0, 0, 78],
  input: [0, 0, 78],
  success: [141.9, 69.2, 58],
  'success-foreground': [0, 0, 0],
  warning: [47.9, 95.8, 53.1],
  'warning-foreground': [0, 0, 0],
  danger: [0, 93.5, 81.8],
  'danger-foreground': [0, 0, 0],
  'chart-1': [220, 90, 70],
  'chart-2': [160, 80, 55],
  'chart-3': [35, 95, 60],
  'chart-4': [280, 85, 78],
  'chart-5': [340, 90, 72],
};

export const PRESET_META = {
  'sel-classic': { label: 'SEL Classic', description: 'The professional light theme SEL Live ships with.', scheme: 'light' },
  'sel-midnight': { label: 'SEL Midnight', description: 'A professional dark theme for low light.', scheme: 'dark' },
  'high-contrast': { label: 'High Contrast', description: 'Maximum legibility: black and white with strong borders.', scheme: 'both' },
  custom: { label: 'Custom company theme', description: 'SEL Classic or Midnight with your own validated colours.', scheme: 'both' },
} as const;

/** How the tokens a custom theme overrides map onto the full set. */
const CUSTOM_TARGETS: Record<CustomToken, SemanticToken[]> = {
  background: ['background'],
  foreground: ['foreground', 'card-foreground', 'popover-foreground', 'secondary-foreground', 'accent-foreground'],
  card: ['card', 'popover'],
  muted: ['muted', 'accent'],
  'muted-foreground': ['muted-foreground'],
  border: ['border', 'input'],
  secondary: ['secondary'],
  success: ['success'],
  warning: ['warning'],
  danger: ['danger'],
  'chart-1': ['chart-1'],
  'chart-2': ['chart-2'],
  'chart-3': ['chart-3'],
  'chart-4': ['chart-4'],
  'chart-5': ['chart-5'],
};

export function withOverrides(base: TokenSet, overrides: Partial<Record<CustomToken, Hex>>): TokenSet {
  const out: Record<SemanticToken, Hsl> = { ...base };
  for (const [token, hex] of Object.entries(overrides) as [CustomToken, Hex][]) {
    if (!hex) continue;
    const hsl = hexToHsl(hex);
    for (const target of CUSTOM_TARGETS[token] ?? []) out[target] = hsl;
  }
  return out;
}
