/**
 * The appearance system's vocabulary: every option a user or an administrator can choose, the
 * shape of what is stored, the company defaults, and strict validators.
 *
 * The same validators run in the browser (so a control can never produce an unsaveable value) and
 * in the API routes (so a hand-crafted request cannot store one). Anything not on these lists is
 * dropped, never interpreted: no free-form CSS, no HTML, no external URLs, no unvalidated colours.
 *
 * Pure TypeScript — no React, no Firebase — so it is unit-tested with node
 * (`tests/appearance-model.test.mjs`); hence no enums and no constructor parameter properties.
 */
import { isHex, normalizeHex, type Hex } from './color.ts';

// ── Option lists ─────────────────────────────────────────────────────────────────────────────────

export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedThemeMode = 'light' | 'dark';

export const DENSITIES = ['comfortable', 'standard', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export const TEXT_SIZES = ['small', 'default', 'large'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const FONTS = ['inter', 'roboto', 'atkinson', 'system'] as const;
export type FontId = (typeof FONTS)[number];

export const RADII = ['soft', 'standard', 'sharp'] as const;
export type RadiusStyle = (typeof RADII)[number];

/** `system` follows the device's reduced-motion setting; `reduced` always reduces. */
export const MOTIONS = ['system', 'reduced'] as const;
export type MotionPreference = (typeof MOTIONS)[number];

export const CONTRASTS = ['standard', 'high'] as const;
export type ContrastPreference = (typeof CONTRASTS)[number];

/** `last` keeps the home page's existing behaviour: reopen whichever tab was used last. */
export const DASHBOARD_VIEWS = ['last', 'work', 'modules'] as const;
export type DashboardView = (typeof DASHBOARD_VIEWS)[number];

/** Kept in step with `FLOATING_NAV_THEMES` in src/components/navigation/themes.ts. */
export const NAV_STYLES = ['blue', 'teal', 'neon'] as const;
export type NavStyle = (typeof NAV_STYLES)[number];

/** `auto` leaves each collapsible sidebar opening the way it was designed to. */
export const SIDEBAR_DEFAULTS = ['auto', 'expanded', 'collapsed'] as const;
export type SidebarDefault = (typeof SIDEBAR_DEFAULTS)[number];

export const SIDEBAR_MODES = ['labels', 'icons'] as const;
export type SidebarMode = (typeof SIDEBAR_MODES)[number];

export const MODULE_GROUPINGS = ['none', 'category'] as const;
export type ModuleGrouping = (typeof MODULE_GROUPINGS)[number];

export const LIGHT_PRESETS = ['sel-classic', 'high-contrast', 'custom'] as const;
export type LightPresetId = (typeof LIGHT_PRESETS)[number];
export const DARK_PRESETS = ['sel-midnight', 'high-contrast', 'custom'] as const;
export type DarkPresetId = (typeof DARK_PRESETS)[number];

/**
 * Approved accents. `light` is used on light surfaces and must carry white text at 4.5:1; `dark` is
 * its counterpart for dark surfaces. `brand` is the company's own colour, set in Theme Management.
 */
export const ACCENTS = {
  violet: { label: 'SEL Violet', light: '#7c3aed', dark: '#a78bfa' },
  indigo: { label: 'Indigo', light: '#4f46e5', dark: '#818cf8' },
  blue: { label: 'Blue', light: '#2563eb', dark: '#60a5fa' },
  teal: { label: 'Teal', light: '#0f766e', dark: '#2dd4bf' },
  emerald: { label: 'Emerald', light: '#047857', dark: '#34d399' },
  amber: { label: 'Amber', light: '#b45309', dark: '#fbbf24' },
  rose: { label: 'Rose', light: '#e11d48', dark: '#fb7185' },
  red: { label: 'SEL Red', light: '#c8161d', dark: '#f87171' },
  slate: { label: 'Slate', light: '#334155', dark: '#94a3b8' },
} as const satisfies Record<string, { label: string; light: Hex; dark: Hex }>;
export type BuiltInAccentId = keyof typeof ACCENTS;
export type AccentId = BuiltInAccentId | 'brand';
export const BUILT_IN_ACCENTS = Object.keys(ACCENTS) as BuiltInAccentId[];
export const ALL_ACCENTS: AccentId[] = [...BUILT_IN_ACCENTS, 'brand'];

export const FONT_META: Record<FontId, { label: string; description: string }> = {
  inter: { label: 'Inter', description: 'The default: compact, clear figures for tables.' },
  roboto: { label: 'Roboto', description: 'Familiar from Android; slightly wider.' },
  atkinson: { label: 'Atkinson Hyperlegible', description: 'Designed for low-vision readers.' },
  system: { label: 'System font', description: "This device's own interface font." },
};

/** Tokens a custom company theme may override — nothing structural, nothing outside this list. */
export const CUSTOM_TOKENS = [
  'background',
  'foreground',
  'card',
  'muted',
  'muted-foreground',
  'border',
  'secondary',
  'success',
  'warning',
  'danger',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
] as const;
export type CustomToken = (typeof CUSTOM_TOKENS)[number];
export type TokenOverrides = Partial<Record<CustomToken, Hex>>;

/** Modules whose names can be pinned or hidden: the keys of `permissionModules`, passed in. */
export type ModuleName = string;

// ── Stored shapes ────────────────────────────────────────────────────────────────────────────────

export interface LayoutPreferences {
  sidebarDefault?: SidebarDefault;
  sidebarMode?: SidebarMode;
  moduleGrouping?: ModuleGrouping;
  /** Permitted modules the user chose not to see on their launcher. Never grants anything. */
  hiddenModules?: ModuleName[];
  /** Shown first, in this order. Only ever a subset of what the user may open. */
  pinnedModules?: ModuleName[];
  breadcrumbs?: boolean;
  stickyHeader?: boolean;
  dashboardCardDensity?: Density;
}

/**
 * One user's choices, stored at `userAppearance/{uid}`. Every field is optional: absent means
 * "use the company default", which is what lets a published company change reach everybody who
 * has not deliberately chosen otherwise — and what "Reset to company defaults" goes back to.
 */
export interface UserAppearancePreferences {
  mode?: ThemeMode;
  accent?: AccentId;
  density?: Density;
  textSize?: TextSize;
  font?: FontId;
  radius?: RadiusStyle;
  motion?: MotionPreference;
  contrast?: ContrastPreference;
  tableDensity?: Density;
  dashboardView?: DashboardView;
  navStyle?: NavStyle;
  layout?: LayoutPreferences;
}

export interface CompanyDefaults {
  mode: ThemeMode;
  accent: AccentId;
  density: Density;
  textSize: TextSize;
  font: FontId;
  radius: RadiusStyle;
  tableDensity: Density;
  navStyle: NavStyle;
  dashboardView: DashboardView;
  sidebarDefault: SidebarDefault;
  sidebarMode: SidebarMode;
  moduleGrouping: ModuleGrouping;
  breadcrumbs: boolean;
  stickyHeader: boolean;
  dashboardCardDensity: Density;
}

export interface BrandAsset {
  /** Storage object path under `branding/`. */
  path: string;
  /** Token download URL for that object — never an arbitrary external address. */
  url: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  size: number;
}

export const BRAND_ASSET_KINDS = ['logoLight', 'logoDark', 'favicon', 'appIcon'] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];

export interface CompanyBranding {
  companyName: string;
  shortName: string;
  logoLight: BrandAsset | null;
  logoDark: BrandAsset | null;
  favicon: BrandAsset | null;
  /** Kept for installable (PWA) contexts; the Android app's launcher icon is compiled in. */
  appIcon: BrandAsset | null;
  loginHeadline: string;
  loginHighlight: string;
  loginSubheadline: string;
}

export interface CompanyTheme {
  lightPreset: LightPresetId;
  darkPreset: DarkPresetId;
  custom: { light: TokenOverrides; dark: TokenOverrides };
  /** The company's own accent, offered to users as "Company" when set. */
  brandColor: Hex | null;
  approvedAccents: AccentId[];
  approvedFonts: FontId[];
}

export interface CompanyAppearanceConfig {
  branding: CompanyBranding;
  theme: CompanyTheme;
  defaults: CompanyDefaults;
}

/** What `settings/appearance` holds and every client applies. */
export interface PublishedAppearance extends CompanyAppearanceConfig {
  version: number;
  publishedAt: string | null;
  publishedBy: string | null;
  note: string;
}

// ── Defaults ─────────────────────────────────────────────────────────────────────────────────────

/** Built so that an installation with nothing published looks exactly as the app did before. */
export const DEFAULT_COMPANY_DEFAULTS: CompanyDefaults = {
  mode: 'light',
  accent: 'violet',
  density: 'standard',
  textSize: 'default',
  font: 'inter',
  radius: 'standard',
  tableDensity: 'standard',
  navStyle: 'blue',
  dashboardView: 'last',
  sidebarDefault: 'auto',
  sidebarMode: 'labels',
  moduleGrouping: 'none',
  breadcrumbs: false,
  stickyHeader: true,
  dashboardCardDensity: 'standard',
};

export const DEFAULT_BRANDING: CompanyBranding = {
  companyName: 'Siddhartha Engineering Limited',
  shortName: 'SEL Live',
  logoLight: null,
  logoDark: null,
  favicon: null,
  appIcon: null,
  loginHeadline: 'Powering every project through',
  loginHighlight: 'live intelligence',
  loginSubheadline: 'Monitor execution, approvals, and field operations from one control layer built for engineering teams.',
};

export const DEFAULT_THEME: CompanyTheme = {
  lightPreset: 'sel-classic',
  darkPreset: 'sel-midnight',
  custom: { light: {}, dark: {} },
  brandColor: null,
  approvedAccents: [...BUILT_IN_ACCENTS],
  approvedFonts: [...FONTS],
};

export const DEFAULT_CONFIG: CompanyAppearanceConfig = {
  branding: DEFAULT_BRANDING,
  theme: DEFAULT_THEME,
  defaults: DEFAULT_COMPANY_DEFAULTS,
};

export const DEFAULT_PUBLISHED: PublishedAppearance = {
  ...DEFAULT_CONFIG,
  version: 0,
  publishedAt: null,
  publishedBy: null,
  note: 'Built-in defaults',
};

// ── Validation ───────────────────────────────────────────────────────────────────────────────────

const pick = <T extends string>(list: readonly T[], value: unknown): T | undefined =>
  typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : undefined;

export const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => pick(list, value) !== undefined;

const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

/** Plain text only: trimmed, control characters and angle brackets removed, length capped. */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

const MODULE_NAME = /^[A-Za-z0-9 &,.()'-]{1,60}$/;

/** A list of module names, de-duplicated, limited to `known` when given, and capped. */
function moduleList(value: unknown, known?: readonly string[]): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !MODULE_NAME.test(entry)) continue;
    if (known && !known.includes(entry)) continue;
    if (!out.includes(entry)) out.push(entry);
    if (out.length >= 60) break;
  }
  return out;
}

const compact = <T extends object>(value: T): T => {
  for (const key of Object.keys(value) as (keyof T)[]) if (value[key] === undefined) delete value[key];
  return value;
};

/**
 * Keep only valid preference fields. `knownModules` (the permission catalogue's module names)
 * limits pinned/hidden lists to real modules; it is not a permission check — pinning a module the
 * user cannot open grants nothing, the launcher only ever shows modules the user may open.
 */
export function sanitizePreferences(input: unknown, knownModules?: readonly string[]): UserAppearancePreferences {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const layoutRaw = (raw.layout && typeof raw.layout === 'object' ? raw.layout : {}) as Record<string, unknown>;
  const layout = compact<LayoutPreferences>({
    sidebarDefault: pick(SIDEBAR_DEFAULTS, layoutRaw.sidebarDefault),
    sidebarMode: pick(SIDEBAR_MODES, layoutRaw.sidebarMode),
    moduleGrouping: pick(MODULE_GROUPINGS, layoutRaw.moduleGrouping),
    hiddenModules: moduleList(layoutRaw.hiddenModules, knownModules),
    pinnedModules: moduleList(layoutRaw.pinnedModules, knownModules),
    breadcrumbs: bool(layoutRaw.breadcrumbs),
    stickyHeader: bool(layoutRaw.stickyHeader),
    dashboardCardDensity: pick(DENSITIES, layoutRaw.dashboardCardDensity),
  });
  const prefs = compact<UserAppearancePreferences>({
    mode: pick(THEME_MODES, raw.mode),
    accent: pick(ALL_ACCENTS, raw.accent),
    density: pick(DENSITIES, raw.density),
    textSize: pick(TEXT_SIZES, raw.textSize),
    font: pick(FONTS, raw.font),
    radius: pick(RADII, raw.radius),
    motion: pick(MOTIONS, raw.motion),
    contrast: pick(CONTRASTS, raw.contrast),
    tableDensity: pick(DENSITIES, raw.tableDensity),
    dashboardView: pick(DASHBOARD_VIEWS, raw.dashboardView),
    navStyle: pick(NAV_STYLES, raw.navStyle),
  });
  if (Object.keys(layout).length) prefs.layout = layout;
  return prefs;
}

function tokenOverrides(value: unknown): TokenOverrides {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const out: TokenOverrides = {};
  for (const token of CUSTOM_TOKENS) {
    const hex = normalizeHex(raw[token]);
    if (hex) out[token] = hex;
  }
  return out;
}

const STORAGE_PATH = /^branding\/(logoLight|logoDark|favicon|appIcon)\/[A-Za-z0-9._-]{1,120}$/;
const TOKEN_URL = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[A-Za-z0-9._-]+\/o\/branding%2F[A-Za-z0-9%._-]+\?alt=media&token=[A-Za-z0-9-]{8,64}$/;

/** A brand asset only if it points at our own `branding/` storage objects, with sane metadata. */
export function sanitizeAsset(value: unknown): BrandAsset | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const path = typeof raw.path === 'string' && STORAGE_PATH.test(raw.path) ? raw.path : null;
  const url = typeof raw.url === 'string' && TOKEN_URL.test(raw.url) ? raw.url : null;
  const contentType = pick(['image/png', 'image/jpeg', 'image/webp'] as const, raw.contentType);
  const width = Number(raw.width);
  const height = Number(raw.height);
  const size = Number(raw.size);
  if (!path || !url || !contentType) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 4096 || height > 4096) return null;
  if (!Number.isInteger(size) || size <= 0 || size > MAX_ASSET_BYTES) return null;
  return { path, url, contentType, width, height, size };
}

export const MAX_ASSET_BYTES = 1024 * 1024;

export function sanitizeBranding(input: unknown, fallback: CompanyBranding = DEFAULT_BRANDING): CompanyBranding {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    companyName: cleanText(raw.companyName, 80) ?? fallback.companyName,
    shortName: cleanText(raw.shortName, 24) ?? fallback.shortName,
    logoLight: raw.logoLight === null ? null : sanitizeAsset(raw.logoLight) ?? fallback.logoLight,
    logoDark: raw.logoDark === null ? null : sanitizeAsset(raw.logoDark) ?? fallback.logoDark,
    favicon: raw.favicon === null ? null : sanitizeAsset(raw.favicon) ?? fallback.favicon,
    appIcon: raw.appIcon === null ? null : sanitizeAsset(raw.appIcon) ?? fallback.appIcon,
    loginHeadline: cleanText(raw.loginHeadline, 60) ?? fallback.loginHeadline,
    loginHighlight: cleanText(raw.loginHighlight, 40) ?? fallback.loginHighlight,
    loginSubheadline: cleanText(raw.loginSubheadline, 200) ?? fallback.loginSubheadline,
  };
}

export function sanitizeTheme(input: unknown, fallback: CompanyTheme = DEFAULT_THEME): CompanyTheme {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const customRaw = (raw.custom && typeof raw.custom === 'object' ? raw.custom : {}) as Record<string, unknown>;
  const brandColor = raw.brandColor === null ? null : normalizeHex(raw.brandColor) ?? fallback.brandColor;
  let approvedAccents = Array.isArray(raw.approvedAccents)
    ? ALL_ACCENTS.filter((id) => (raw.approvedAccents as unknown[]).includes(id))
    : fallback.approvedAccents;
  // "Company" is only offerable once there is a company colour to offer.
  if (!brandColor) approvedAccents = approvedAccents.filter((id) => id !== 'brand');
  if (!approvedAccents.length) approvedAccents = ['violet'];
  let approvedFonts = Array.isArray(raw.approvedFonts)
    ? FONTS.filter((id) => (raw.approvedFonts as unknown[]).includes(id))
    : fallback.approvedFonts;
  if (!approvedFonts.length) approvedFonts = ['inter'];
  return {
    lightPreset: pick(LIGHT_PRESETS, raw.lightPreset) ?? fallback.lightPreset,
    darkPreset: pick(DARK_PRESETS, raw.darkPreset) ?? fallback.darkPreset,
    custom: {
      light: 'light' in customRaw ? tokenOverrides(customRaw.light) : fallback.custom.light,
      dark: 'dark' in customRaw ? tokenOverrides(customRaw.dark) : fallback.custom.dark,
    },
    brandColor,
    approvedAccents,
    approvedFonts,
  };
}

export function sanitizeDefaults(input: unknown, theme: CompanyTheme, fallback: CompanyDefaults = DEFAULT_COMPANY_DEFAULTS): CompanyDefaults {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const accent = pick(ALL_ACCENTS, raw.accent) ?? fallback.accent;
  const font = pick(FONTS, raw.font) ?? fallback.font;
  return {
    mode: pick(THEME_MODES, raw.mode) ?? fallback.mode,
    // The default has to be something users are allowed to pick.
    accent: theme.approvedAccents.includes(accent) ? accent : theme.approvedAccents[0],
    density: pick(DENSITIES, raw.density) ?? fallback.density,
    textSize: pick(TEXT_SIZES, raw.textSize) ?? fallback.textSize,
    font: theme.approvedFonts.includes(font) ? font : theme.approvedFonts[0],
    radius: pick(RADII, raw.radius) ?? fallback.radius,
    tableDensity: pick(DENSITIES, raw.tableDensity) ?? fallback.tableDensity,
    navStyle: pick(NAV_STYLES, raw.navStyle) ?? fallback.navStyle,
    dashboardView: pick(DASHBOARD_VIEWS, raw.dashboardView) ?? fallback.dashboardView,
    sidebarDefault: pick(SIDEBAR_DEFAULTS, raw.sidebarDefault) ?? fallback.sidebarDefault,
    sidebarMode: pick(SIDEBAR_MODES, raw.sidebarMode) ?? fallback.sidebarMode,
    moduleGrouping: pick(MODULE_GROUPINGS, raw.moduleGrouping) ?? fallback.moduleGrouping,
    breadcrumbs: bool(raw.breadcrumbs) ?? fallback.breadcrumbs,
    stickyHeader: bool(raw.stickyHeader) ?? fallback.stickyHeader,
    dashboardCardDensity: pick(DENSITIES, raw.dashboardCardDensity) ?? fallback.dashboardCardDensity,
  };
}

/** A whole configuration, every part validated, anything missing filled from `fallback`. */
export function sanitizeConfig(input: unknown, fallback: CompanyAppearanceConfig = DEFAULT_CONFIG): CompanyAppearanceConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const theme = sanitizeTheme(raw.theme, fallback.theme);
  return {
    branding: sanitizeBranding(raw.branding, fallback.branding),
    theme,
    defaults: sanitizeDefaults(raw.defaults, theme, fallback.defaults),
  };
}

export function sanitizePublished(input: unknown): PublishedAppearance {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const version = Number(raw.version);
  return {
    ...sanitizeConfig(raw),
    version: Number.isInteger(version) && version >= 0 ? version : 0,
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : null,
    publishedBy: cleanText(raw.publishedBy, 120) ?? null,
    note: cleanText(raw.note, 200) ?? '',
  };
}

export { isHex };
