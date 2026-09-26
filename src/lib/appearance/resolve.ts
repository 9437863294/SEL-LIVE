/**
 * From "what the company published" and "what this user chose" to "what is on screen".
 *
 * Precedence, highest first:
 *   1. Accessibility — a user's high-contrast or reduced-motion choice beats every theme, and a
 *      device asking for reduced motion is honoured unless nothing says otherwise (see CSS).
 *   2. Company rules — a user's accent or font counts only while the company still approves it.
 *   3. The user's saved preferences.
 *   4. The company defaults.
 *   5. The device, for "Follow device" and reduced motion.
 *
 * Pure, so the rules are unit-tested (`tests/appearance-model.test.mjs`).
 */
import { contrastRatio, deepen, ensureContrast, hexToHslToken, hexToRgb, hslToHex, readableOn, type Hex } from './color.ts';
import {
  ACCENTS,
  DEFAULT_COMPANY_DEFAULTS,
  type AccentId,
  type CompanyAppearanceConfig,
  type ContrastPreference,
  type DashboardView,
  type Density,
  type FontId,
  type LayoutPreferences,
  type MotionPreference,
  type NavStyle,
  type RadiusStyle,
  type TextSize,
  type ThemeMode,
  type UserAppearancePreferences,
} from './model.ts';
import {
  HIGH_CONTRAST_DARK,
  HIGH_CONTRAST_LIGHT,
  SEL_CLASSIC,
  SEL_MIDNIGHT,
  SEMANTIC_TOKENS,
  withOverrides,
  type Hsl,
  type TokenSet,
} from './presets.ts';

export interface EffectiveAppearance {
  mode: ThemeMode;
  accent: AccentId;
  density: Density;
  textSize: TextSize;
  font: FontId;
  radius: RadiusStyle;
  motion: MotionPreference;
  contrast: ContrastPreference;
  tableDensity: Density;
  dashboardView: DashboardView;
  navStyle: NavStyle;
  layout: Required<LayoutPreferences>;
}

export function resolveAppearance(
  company: CompanyAppearanceConfig,
  prefs: UserAppearancePreferences | null | undefined,
): EffectiveAppearance {
  const d = { ...DEFAULT_COMPANY_DEFAULTS, ...company.defaults };
  const p = prefs ?? {};
  const l = p.layout ?? {};
  const accent = p.accent && company.theme.approvedAccents.includes(p.accent) ? p.accent : d.accent;
  const font = p.font && company.theme.approvedFonts.includes(p.font) ? p.font : d.font;
  return {
    mode: p.mode ?? d.mode,
    accent,
    density: p.density ?? d.density,
    textSize: p.textSize ?? d.textSize,
    font,
    radius: p.radius ?? d.radius,
    motion: p.motion ?? 'system',
    contrast: p.contrast ?? 'standard',
    tableDensity: p.tableDensity ?? d.tableDensity,
    dashboardView: p.dashboardView ?? d.dashboardView,
    navStyle: p.navStyle ?? d.navStyle,
    layout: {
      sidebarDefault: l.sidebarDefault ?? d.sidebarDefault,
      sidebarMode: l.sidebarMode ?? d.sidebarMode,
      moduleGrouping: l.moduleGrouping ?? d.moduleGrouping,
      hiddenModules: l.hiddenModules ?? [],
      pinnedModules: l.pinnedModules ?? [],
      breadcrumbs: l.breadcrumbs ?? d.breadcrumbs,
      stickyHeader: l.stickyHeader ?? d.stickyHeader,
      dashboardCardDensity: l.dashboardCardDensity ?? d.dashboardCardDensity,
    },
  };
}

/** The `data-*` attributes set on <html>; names and values both come from fixed lists. */
export function appearanceAttributes(effective: EffectiveAppearance): Record<string, string> {
  return {
    density: effective.density,
    'text-size': effective.textSize,
    font: effective.font,
    radius: effective.radius,
    motion: effective.motion,
    contrast: effective.contrast,
    'table-density': effective.tableDensity,
    'nav-style': effective.navStyle,
  };
}

export const APPEARANCE_ATTRIBUTE_NAMES = ['density', 'text-size', 'font', 'radius', 'motion', 'contrast', 'table-density', 'nav-style'] as const;

// ── Tokens ─────────────────────────────────────────────────────────────────────────────────────

const toHex = ([h, s, l]: Hsl) => hslToHex(h, s, l);

/** Foregrounds re-derived so a custom success/warning/danger colour always carries readable text. */
function withReadableForegrounds(set: TokenSet): TokenSet {
  const out: Record<string, Hsl> = { ...set };
  for (const pair of ['success', 'warning', 'danger'] as const) {
    const fg = readableOn(toHex(set[pair]));
    out[`${pair}-foreground`] = fg === '#ffffff' ? [0, 0, 100] : [0, 0, 4];
  }
  return out as TokenSet;
}

export function lightTokens(company: CompanyAppearanceConfig): TokenSet {
  const { lightPreset, custom } = company.theme;
  if (lightPreset === 'high-contrast') return HIGH_CONTRAST_LIGHT;
  if (lightPreset === 'custom') return withReadableForegrounds(withOverrides(SEL_CLASSIC, custom.light));
  return SEL_CLASSIC;
}

export function darkTokens(company: CompanyAppearanceConfig): TokenSet {
  const { darkPreset, custom } = company.theme;
  if (darkPreset === 'high-contrast') return HIGH_CONTRAST_DARK;
  if (darkPreset === 'custom') return withReadableForegrounds(withOverrides(SEL_MIDNIGHT, custom.dark));
  return SEL_MIDNIGHT;
}

/**
 * The accent colour for a scheme, adjusted until it reads as text on that scheme's cards (4.5:1) —
 * or 7:1 for high contrast. Built-in accents already pass; a company colour is nudged if needed.
 */
export function accentFor(company: CompanyAppearanceConfig, accent: AccentId, scheme: 'light' | 'dark', surface: Hex, target = 4.5): Hex {
  const base: Hex =
    accent === 'brand' && company.theme.brandColor
      ? company.theme.brandColor
      : ACCENTS[accent === 'brand' ? 'violet' : accent][scheme];
  return ensureContrast(base, surface, target);
}

function tokenLines(set: TokenSet): string[] {
  const lines = SEMANTIC_TOKENS.map((token) => `--${token}:${hsl(set[token])}`);
  // shadcn components read `destructive`; the appearance system calls it `danger`.
  lines.push(`--destructive:${hsl(set.danger)}`, `--destructive-foreground:${hsl(set['danger-foreground'])}`);
  return lines;
}

const hsl = ([h, s, l]: Hsl) => `${round(h)} ${round(s)}% ${round(l)}%`;
const round = (n: number) => Math.round(n * 10) / 10;

function accentLines(primary: Hex, solid = false): string[] {
  const on = readableOn(primary);
  const [r, g, b] = hexToRgb(primary);
  const gradient = solid ? primary : `linear-gradient(135deg, ${primary} 0%, ${deepen(primary)} 100%)`;
  return [
    `--primary:${hexToHslToken(primary)}`,
    `--primary-foreground:${hexToHslToken(on)}`,
    `--ring:${hexToHslToken(primary)}`,
    `--sel-tab-gradient:${gradient}`,
    `--sel-tab-glow:rgba(${r}, ${g}, ${b}, 0.42)`,
    `--sel-tab-on:${on}`,
  ];
}

const block = (selector: string, lines: string[]) => `${selector}{${lines.join(';')}}`;

/**
 * The stylesheet that puts a company's theme and one accent on screen.
 *
 * Selectors carry an extra type selector (`html:root`, `html.dark`) so they win over globals.css
 * whatever order the two stylesheets land in. Dark rules are screen-only: a printout always uses
 * the light tokens, whatever mode the person printing is in.
 */
export function buildAppearanceCss(company: CompanyAppearanceConfig, accent: AccentId): string {
  const light = lightTokens(company);
  const dark = darkTokens(company);
  const lightPrimary = accentFor(company, accent, 'light', toHex(light.card));
  const darkPrimary = accentFor(company, accent, 'dark', toHex(dark.card));
  const hcLightPrimary = accentFor(company, accent, 'light', '#ffffff', 7);
  const hcDarkPrimary = accentFor(company, accent, 'dark', '#000000', 7);
  return [
    block('html:root', [...tokenLines(light), ...accentLines(lightPrimary)]),
    `@media screen{${block('html.dark', [...tokenLines(dark), ...accentLines(darkPrimary)])}}`,
    block("html[data-contrast='high']:root", [...tokenLines(HIGH_CONTRAST_LIGHT), ...accentLines(hcLightPrimary, true)]),
    `@media screen{${block("html.dark[data-contrast='high']", [...tokenLines(HIGH_CONTRAST_DARK), ...accentLines(hcDarkPrimary, true)])}}`,
  ].join('\n');
}

export interface ContrastCheck {
  label: string;
  ratio: number;
  required: number;
  pass: boolean;
}

/** The pairs an administrator is shown before publishing a custom theme. */
export function themeContrastReport(company: CompanyAppearanceConfig, scheme: 'light' | 'dark'): ContrastCheck[] {
  const set = scheme === 'light' ? lightTokens(company) : darkTokens(company);
  const primary = accentFor(company, company.defaults.accent, scheme, toHex(set.card));
  const pairs: [string, Hex, Hex, number][] = [
    ['Text on page', toHex(set.foreground), toHex(set.background), 4.5],
    ['Text on cards', toHex(set['card-foreground']), toHex(set.card), 4.5],
    ['Secondary text', toHex(set['muted-foreground']), toHex(set.card), 4.5],
    ['Accent text on cards', primary, toHex(set.card), 4.5],
    ['Button label on accent', readableOn(primary), primary, 4.5],
    ['Success label', toHex(set['success-foreground']), toHex(set.success), 4.5],
    ['Warning label', toHex(set['warning-foreground']), toHex(set.warning), 4.5],
    ['Danger label', toHex(set['danger-foreground']), toHex(set.danger), 4.5],
    ['Borders against cards', toHex(set.border), toHex(set.card), 1.2],
  ];
  return pairs.map(([label, a, b, required]) => {
    const ratio = Math.round(contrastRatio(a, b) * 100) / 100;
    return { label, ratio, required, pass: ratio >= required };
  });
}
