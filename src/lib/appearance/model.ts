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
import { sanitizeUserAnimations, type UserActionAnimations } from '../action-animations.ts';

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

/**
 * A user's own default dialog width. `auto` keeps each dialog's designed width whatever the company
 * chose; absent follows the company (Settings › Appearance › Layout, Text and Animations).
 */
export const DIALOG_SIZES = ['auto', 'sm', 'md', 'lg', 'xl'] as const;
export type DialogSizePreference = (typeof DIALOG_SIZES)[number];

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

/**
 * The look of the home page's Modules tab (every design keeps the "Your work" / "Modules" tabs).
 * `classic` is the card launcher; `command` is a work summary over category-grouped modules;
 * `launchpad` is a greeting with search over a grid of module tiles; `aurora` is the same layout as
 * frosted glass over a soft glow. Kept in step with `HOME_DESIGN_META` in src/components/home/home-designs.ts.
 */
export const HOME_DESIGNS = ['classic', 'command', 'launchpad', 'aurora'] as const;
export type HomeDesign = (typeof HOME_DESIGNS)[number];

/** Kept in step with `FLOATING_NAV_THEMES` in src/components/navigation/themes.ts. */
export const NAV_STYLES = ['blue', 'teal', 'neon', 'glass', 'sunset', 'graphite'] as const;
export type NavStyle = (typeof NAV_STYLES)[number];

/** `auto` leaves each collapsible sidebar opening the way it was designed to. */
export const SIDEBAR_DEFAULTS = ['auto', 'expanded', 'collapsed'] as const;
export type SidebarDefault = (typeof SIDEBAR_DEFAULTS)[number];

export const SIDEBAR_MODES = ['labels', 'icons'] as const;
export type SidebarMode = (typeof SIDEBAR_MODES)[number];

export const MODULE_GROUPINGS = ['none', 'category'] as const;
export type ModuleGrouping = (typeof MODULE_GROUPINGS)[number];

/**
 * Sign-in page designs, each a complete layout. Kept in step with `LOGIN_DESIGN_META` and the
 * layouts in src/components/auth/login/designs.tsx.
 */
export const LOGIN_DESIGNS = ['horizon', 'midnight', 'glass', 'minimal', 'blueprint'] as const;
export type LoginDesignId = (typeof LOGIN_DESIGNS)[number];

/**
 * What each design shows, so Settings can say which choices do nothing in it. The headline and
 * highlights appear on wide screens only; on a phone every design is the form.
 */
export const LOGIN_DESIGN_META: Record<LoginDesignId, { label: string; description: string; headline: boolean; clock: boolean; highlights: boolean }> = {
  horizon: { label: 'Horizon', description: 'Transmission towers at dusk, the form on frosted glass over the sky.', headline: true, clock: true, highlights: true },
  midnight: { label: 'Midnight', description: 'The original dark card with the glowing cyan clock.', headline: true, clock: true, highlights: true },
  glass: { label: 'Glass', description: 'A frosted card floating over drifting colour.', headline: true, clock: true, highlights: true },
  minimal: { label: 'Minimal', description: 'Light and quiet: the date, the logo and the form.', headline: false, clock: true, highlights: false },
  blueprint: { label: 'Blueprint', description: 'An engineering drawing sheet with a title block.', headline: true, clock: true, highlights: true },
};

export interface LoginHighlight {
  label: string;
  description: string;
}

export const MAX_LOGIN_HIGHLIGHTS = 3;
export const LOGIN_HIGHLIGHT_LABEL_MAX = 40;
export const LOGIN_HIGHLIGHT_DESCRIPTION_MAX = 80;

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

/** The colours a module group can take — each maps to a fixed set of classes in the launcher. */
export const GROUP_COLORS = ['blue', 'orange', 'teal', 'violet', 'sky', 'emerald', 'rose', 'amber', 'indigo', 'pink', 'slate', 'zinc'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

/**
 * A company-defined group of modules on the home page (Theme Management › Module groups). A module
 * sits in at most one group; any module in none is shown under "Other". Grouping only arranges what
 * a person may already open — it never grants a module.
 */
export interface ModuleGroup {
  /** Stable, set when the group is created; renaming a group keeps it. */
  id: string;
  label: string;
  color: GroupColor;
  modules: ModuleName[];
}

export const MAX_MODULE_GROUPS = 20;
/** Reserved for the implicit group of unassigned modules. */
export const OTHER_GROUP_ID = 'other';

/** The groups the launcher shipped with, used until the company publishes its own. */
export const DEFAULT_MODULE_GROUPS: ModuleGroup[] = [
  { id: 'finance', label: 'Finance & Treasury', color: 'blue', modules: ['Bank Balance', 'Fixed Deposit Management', 'Letter of Credit Management', 'Bank Guarantee Management', 'Loan', 'Recurring Payments', 'Bill Tracking', 'Expenses', 'Insurance'] },
  // Everything addressed to a site or a project, including the money that goes to one.
  { id: 'projects', label: 'Projects & Sites', color: 'orange', modules: ['Project Management', 'Subcontractors Management', 'Billing Recon', 'Site Account Statement', 'Site Fund Requisition', 'Site Fund Requisition 2', 'Site Fund Request'] },
  { id: 'procurement', label: 'Procurement & Stores', color: 'teal', modules: ['Daily Requisition', 'Store & Stock Management', 'Vendor Management'] },
  { id: 'people', label: 'People & HR', color: 'violet', modules: ['Employee', 'HR & Recruitment', 'Tour, Travel & Expense'] },
  { id: 'fleet', label: 'Fleet & Logistics', color: 'sky', modules: ['Vehicle Management', 'Driver Management'] },
  { id: 'workspace', label: 'Workspace & Communication', color: 'slate', modules: ['Chat System', 'Mail Hub', 'Office Hub', 'E-Approval'] },
  { id: 'administration', label: 'Administration', color: 'zinc', modules: ['Settings', 'Module Hub', 'Windows Agent'] },
];

// ── Stored shapes ────────────────────────────────────────────────────────────────────────────────

export interface LayoutPreferences {
  sidebarDefault?: SidebarDefault;
  sidebarMode?: SidebarMode;
  moduleGrouping?: ModuleGrouping;
  /** Permitted modules the user chose not to see on their launcher. Never grants anything. */
  hiddenModules?: ModuleName[];
  /** No longer read: pinning was removed from the launcher on 2026-10-30. */
  pinnedModules?: ModuleName[];
  /**
   * The Favourites row of the Command and Launchpad home designs, in the order they were starred.
   * A separate list from the retired pins, so pins removed then do not come back as favourites.
   */
  favouriteModules?: ModuleName[];
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
  homeDesign?: HomeDesign;
  navStyle?: NavStyle;
  layout?: LayoutPreferences;
  /** Overrides the company's default dialog width for this user. */
  dialogSize?: DialogSizePreference;
  /** Maximise and minimise buttons on dialogs; absent means shown. */
  dialogControls?: boolean;
  /** Dialogs open maximised; absent means they do not. */
  dialogOpenMaximised?: boolean;
  /** Scales the text inside dialogs only. */
  dialogTextSize?: TextSize;
  /**
   * Animated action buttons: `company` follows Settings › Company Profile's defaults, `custom` uses
   * the kinds set here over them, `off` plays nothing. Absent means `company`.
   */
  animations?: UserActionAnimations;
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
  homeDesign: HomeDesign;
  sidebarDefault: SidebarDefault;
  sidebarMode: SidebarMode;
  moduleGrouping: ModuleGrouping;
  breadcrumbs: boolean;
  stickyHeader: boolean;
  dashboardCardDensity: Density;
  /**
   * The home page's module groups, in order. Kept with the defaults so it is drafted, published and
   * restored with them — but it is company-only: no personal preference overrides it.
   */
  moduleGroups: ModuleGroup[];
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
  /** The sign-in design everyone sees. */
  loginDesign: LoginDesignId;
  loginShowClock: boolean;
  loginShowHighlights: boolean;
  /** Short points beside the form, in the designs that have room for them. */
  loginHighlights: LoginHighlight[];
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
  homeDesign: 'classic',
  sidebarDefault: 'auto',
  sidebarMode: 'labels',
  moduleGrouping: 'none',
  breadcrumbs: false,
  stickyHeader: true,
  dashboardCardDensity: 'standard',
  moduleGroups: DEFAULT_MODULE_GROUPS,
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
  loginDesign: 'horizon',
  loginShowClock: true,
  loginShowHighlights: true,
  loginHighlights: [
    { label: 'Live workflows', description: 'Real-time approvals and status tracking' },
    { label: 'Field operations', description: 'Monitor execution across all sites' },
    { label: 'Smart finance', description: 'Requisitions, billing and loan management' },
  ],
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
    favouriteModules: moduleList(layoutRaw.favouriteModules, knownModules),
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
    homeDesign: pick(HOME_DESIGNS, raw.homeDesign),
    navStyle: pick(NAV_STYLES, raw.navStyle),
    dialogSize: pick(DIALOG_SIZES, raw.dialogSize),
    dialogControls: bool(raw.dialogControls),
    dialogOpenMaximised: bool(raw.dialogOpenMaximised),
    dialogTextSize: pick(TEXT_SIZES, raw.dialogTextSize),
    animations: sanitizeUserAnimations(raw.animations),
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

/** Highlights with a label, plain text, capped; an empty list is a valid choice. */
export function sanitizeLoginHighlights(value: unknown[]): LoginHighlight[] {
  const out: LoginHighlight[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const label = cleanText(raw.label, LOGIN_HIGHLIGHT_LABEL_MAX);
    if (!label) continue;
    out.push({ label, description: cleanText(raw.description, LOGIN_HIGHLIGHT_DESCRIPTION_MAX) ?? '' });
    if (out.length >= MAX_LOGIN_HIGHLIGHTS) break;
  }
  return out;
}

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
    loginDesign: pick(LOGIN_DESIGNS, raw.loginDesign) ?? fallback.loginDesign,
    loginShowClock: bool(raw.loginShowClock) ?? fallback.loginShowClock,
    loginShowHighlights: bool(raw.loginShowHighlights) ?? fallback.loginShowHighlights,
    loginHighlights: Array.isArray(raw.loginHighlights) ? sanitizeLoginHighlights(raw.loginHighlights) : fallback.loginHighlights,
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
    homeDesign: pick(HOME_DESIGNS, raw.homeDesign) ?? fallback.homeDesign,
    sidebarDefault: pick(SIDEBAR_DEFAULTS, raw.sidebarDefault) ?? fallback.sidebarDefault,
    sidebarMode: pick(SIDEBAR_MODES, raw.sidebarMode) ?? fallback.sidebarMode,
    moduleGrouping: pick(MODULE_GROUPINGS, raw.moduleGrouping) ?? fallback.moduleGrouping,
    breadcrumbs: bool(raw.breadcrumbs) ?? fallback.breadcrumbs,
    stickyHeader: bool(raw.stickyHeader) ?? fallback.stickyHeader,
    dashboardCardDensity: pick(DENSITIES, raw.dashboardCardDensity) ?? fallback.dashboardCardDensity,
    moduleGroups: sanitizeModuleGroups(raw.moduleGroups, fallback.moduleGroups),
  };
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/**
 * Module groups, repaired: a name is required, ids are unique slugs (never the reserved "other"), a
 * colour comes from the list, and each module belongs to the first group that names it. Not an
 * array means nothing was saved, so `fallback` applies; an empty array is a real choice ("no
 * groups, everything under Other") and is kept.
 */
export function sanitizeModuleGroups(value: unknown, fallback: ModuleGroup[] = DEFAULT_MODULE_GROUPS): ModuleGroup[] {
  if (!Array.isArray(value)) return fallback;
  const out: ModuleGroup[] = [];
  const ids = new Set<string>([OTHER_GROUP_ID]);
  const placed = new Set<string>();
  for (const entry of value) {
    if (out.length >= MAX_MODULE_GROUPS) break;
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const label = cleanText(raw.label, 40);
    if (!label) continue;
    const base = (typeof raw.id === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.id) ? raw.id : slug(label)) || 'group';
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    const modules = (moduleList(raw.modules) ?? []).filter((name) => !placed.has(name));
    modules.forEach((name) => placed.add(name));
    out.push({ id, label, color: pick(GROUP_COLORS, raw.color) ?? 'slate', modules });
  }
  return out;
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
