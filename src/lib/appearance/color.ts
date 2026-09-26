/**
 * Colour arithmetic for the appearance system: strict hex parsing, HSL token strings, and WCAG
 * contrast. Pure — used by the browser, the API routes and the node tests alike.
 *
 * Colours only ever enter the system as six-digit hex (`#1a2b3c`). Anything else — names, rgb(),
 * CSS functions, `var(...)`, a stray semicolon — is rejected rather than interpreted, because a
 * colour is interpolated into a stylesheet and an unvalidated one is a CSS injection.
 */

export type Hex = `#${string}`;

const HEX = /^#[0-9a-f]{6}$/i;

export function isHex(value: unknown): value is Hex {
  return typeof value === 'string' && HEX.test(value);
}

export function normalizeHex(value: unknown): Hex | null {
  return isHex(value) ? (value.toLowerCase() as Hex) : null;
}

export function hexToRgb(hex: Hex): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): Hex {
  const part = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}` as Hex;
}

/** HSL in degrees / percent. */
export function hexToHsl(hex: Hex): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): Hex {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

/** The `H S% L%` triplet shadcn tokens use (`hsl(var(--primary))`). */
export function hexToHslToken(hex: Hex): string {
  const [h, s, l] = hexToHsl(hex);
  const round = (n: number) => Math.round(n * 10) / 10;
  return `${round(h)} ${round(s)}% ${round(l)}%`;
}

function channel(v: number) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: Hex): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio, 1–21. */
export function contrastRatio(a: Hex, b: Hex): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on `background`. */
export function readableOn(background: Hex): Hex {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#0a0a0a') ? '#ffffff' : '#0a0a0a';
}

/**
 * Shift `hex`'s lightness until it reaches `target` contrast against `against` (or gives up at the
 * end of the range). Used to derive an accent that stays readable on dark surfaces and to keep a
 * custom colour honest instead of rejecting it outright.
 */
export function ensureContrast(hex: Hex, against: Hex, target: number): Hex {
  if (contrastRatio(hex, against) >= target) return hex;
  const [h, s, l] = hexToHsl(hex);
  const lighten = relativeLuminance(against) < 0.5;
  for (let step = 1; step <= 60; step += 1) {
    const next = hslToHex(h, s, Math.min(100, Math.max(0, l + (lighten ? step : -step))));
    if (contrastRatio(next, against) >= target) return next;
  }
  return lighten ? '#ffffff' : '#000000';
}

/** A slightly deeper shade for the second stop of an accent gradient. */
export function deepen(hex: Hex, amount = 8): Hex {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex((h + 12) % 360, s, Math.max(0, l - amount));
}
