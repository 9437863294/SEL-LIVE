/**
 * The company's own identity — legal name, address, tax numbers, contacts, logo — plus the shared
 * look of documents (letterhead, tables, dialogs, print) and the app's common words ("Save",
 * "Prepared by"), all edited once in Settings › Company Profile instead of hard-coded per page.
 *
 * Stored at `settings/companyProfile`, written only by `/api/company-profile` (Admin SDK). Every
 * read goes through `sanitizeCompanyProfile`, so a missing or half-written document still yields a
 * complete profile and every consumer can use any field without a guard.
 *
 * Pure (no imports but the equally pure statutory rules) so it runs under plain node for tests.
 */

import { checkGstin, isValidPan, normaliseTaxId } from './statutory.ts';

/** The permission resource: View opens the settings screen, Edit saves it. Reading needs neither. */
export const COMPANY_PROFILE_RESOURCE = 'Settings.Company Profile';

/* ── shape ──────────────────────────────────────────────────────────────────────────────────── */

export interface CompanyGstRegistration {
  gstin: string;
  state: string;
  label: string;
  primary: boolean;
}

export type LetterheadLayout = 'left' | 'center' | 'split';
export type LetterheadTitleSize = 'sm' | 'md' | 'lg';
export type LetterheadDivider = 'none' | 'line' | 'double' | 'bar';
/** 'auto' leaves row height to each user's Appearance › Table rows setting. */
export type TableDensity = 'auto' | 'compact' | 'standard' | 'comfortable';
export type TableHeaderStyle = 'muted' | 'accent' | 'plain';
/** 'auto' keeps each dialog's own size; the others are 24 / 32 / 42 / 64rem for dialogs that set none. */
export type DialogSize = 'auto' | 'sm' | 'md' | 'lg' | 'xl';
export type DialogFooterAlign = 'end' | 'between' | 'stretch';
export type SidebarStyle = 'solid' | 'soft' | 'minimal';
export type SidebarWidth = 'narrow' | 'standard' | 'wide';
export type SidebarActiveIndicator = 'bar' | 'pill' | 'background';
/** 'standard' draws the letterhead from the toggles below; 'custom' prints the designed HTML. */
export type LetterheadMode = 'standard' | 'custom';
export type LetterheadHeaderOn = 'first' | 'every';
export type LetterheadFooterOn = 'every' | 'last' | 'first';

/**
 * A letterhead designed like a Word header and footer: sanitised HTML with `{{field}}` merge
 * fields (see LETTERHEAD_FIELDS), plus the page options. Heights null mean "as tall as the content".
 */
export interface CustomLetterhead {
  headerHtml: string;
  footerHtml: string;
  headerHeightMm: number | null;
  footerHeightMm: number | null;
  headerOn: LetterheadHeaderOn;
  footerOn: LetterheadFooterOn;
  /** Page margin for documents that opt in to the repeating letterhead; null keeps the page's own. */
  marginMm: number | null;
}

export interface CompanyDesign {
  letterhead: {
    mode: LetterheadMode;
    custom: CustomLetterhead;
    layout: LetterheadLayout;
    showLogo: boolean;
    showAddress: boolean;
    showGstin: boolean;
    showCin: boolean;
    showContacts: boolean;
    /** Six-digit hex. */
    accentColor: string;
    titleSize: LetterheadTitleSize;
    divider: LetterheadDivider;
    /** A line above the name, e.g. "An ISO 9001:2015 company". */
    headerNote: string | null;
    /** A line in print footers, e.g. "Subject to Bhubaneswar jurisdiction". */
    footerNote: string | null;
    /** Faint diagonal text behind printed documents, e.g. "CONFIDENTIAL". */
    watermark: string | null;
  };
  tables: {
    density: TableDensity;
    striped: boolean;
    bordered: boolean;
    headerStyle: TableHeaderStyle;
    stickyHeader: boolean;
  };
  dialogs: {
    defaultSize: DialogSize;
    footerAlign: DialogFooterAlign;
  };
  /** The module sidebar (ModuleShell) every module with a sidebar shares. */
  sidebar: {
    style: SidebarStyle;
    width: SidebarWidth;
    showIcons: boolean;
    showGroupLabels: boolean;
    collapsible: boolean;
    activeIndicator: SidebarActiveIndicator;
  };
  print: {
    showPrintedOn: boolean;
    showPageNumbers: boolean;
    /** Empty means the Prepared / Checked / Approved labels. */
    signatureLabels: string[];
  };
}

export const UI_TEXT_KEYS = [
  'save', 'cancel', 'confirm', 'delete', 'close', 'edit', 'add', 'search', 'filter', 'export', 'print',
  'refresh', 'loading', 'noRecords', 'noResults', 'confirmDeleteTitle', 'confirmDeleteDescription',
  'unsavedChanges', 'required', 'preparedBy', 'checkedBy', 'approvedBy', 'authorisedSignatory',
  'printedOn', 'page', 'of', 'total', 'grandTotal', 'remarks', 'date', 'amount', 'status', 'actions',
  'menu', 'collapseMenu', 'expandMenu', 'accessDenied', 'noPermissionModule', 'home',
] as const;

export type UiTextKey = (typeof UI_TEXT_KEYS)[number];

export const UI_TEXT_DEFAULTS: Record<UiTextKey, string> = {
  save: 'Save',
  cancel: 'Cancel',
  confirm: 'Confirm',
  delete: 'Delete',
  close: 'Close',
  edit: 'Edit',
  add: 'Add',
  search: 'Search',
  filter: 'Filter',
  export: 'Export',
  print: 'Print',
  refresh: 'Refresh',
  loading: 'Loading…',
  noRecords: 'No records yet.',
  noResults: 'No results match your search.',
  confirmDeleteTitle: 'Delete this record?',
  confirmDeleteDescription: 'This cannot be undone.',
  unsavedChanges: 'You have unsaved changes.',
  required: 'Required',
  preparedBy: 'Prepared by',
  checkedBy: 'Checked by',
  approvedBy: 'Approved by',
  authorisedSignatory: 'Authorised Signatory',
  printedOn: 'Printed on',
  page: 'Page',
  of: 'of',
  total: 'Total',
  grandTotal: 'Grand Total',
  remarks: 'Remarks',
  date: 'Date',
  amount: 'Amount',
  status: 'Status',
  actions: 'Actions',
  menu: 'Menu',
  collapseMenu: 'Collapse menu',
  expandMenu: 'Expand menu',
  accessDenied: 'Access Denied',
  noPermissionModule: 'You do not have permission to access {module}.',
  home: 'Home',
};

/** What the settings screen calls each label, so an admin knows where it shows. */
export const UI_TEXT_HINTS: Partial<Record<UiTextKey, string>> = {
  noRecords: 'An empty table or list',
  noResults: 'A search or filter that matched nothing',
  confirmDeleteTitle: 'Heading of a delete confirmation',
  confirmDeleteDescription: 'Body of a delete confirmation',
  printedOn: 'Print footer, before the date',
  page: 'Print footer, “Page 1 of 3”',
  of: 'Print footer, “Page 1 of 3”',
  menu: 'Module sidebar button on phones',
  noPermissionModule: '{module} is replaced with the module name',
};

export interface CompanyProfile {
  legalName: string;
  shortName: string;
  tagline: string | null;
  cin: string | null;
  pan: string | null;
  addressLines: string[];
  city: string;
  state: string;
  pincode: string;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  gstRegistrations: CompanyGstRegistration[];
  logoUrl: string | null;
  design: CompanyDesign;
  labels: Record<UiTextKey, string>;
}

/* ── defaults: the values printed on the JMC / MVAC sheets and the app's current look ──────── */

/**
 * The standard letterhead (centred, medium name, thin rule, accent #1e293b) as editable HTML, so
 * switching to the designer starts from today's look. Blocks whose fields all come out empty (no
 * tagline, no document title) are dropped when rendered — see `renderLetterheadTemplate`.
 */
export const STANDARD_LETTERHEAD_HEADER_HTML =
  '<div style="text-align:center;padding-bottom:8px;border-bottom:1px solid #1e293b">' +
  '<p style="margin:0 0 4px">{{logo}}</p>' +
  '<p style="margin:0;font-size:20px;font-weight:800;letter-spacing:0.02em;color:#1e293b">{{legalName}}</p>' +
  '<p style="margin:2px 0 0;font-size:11px;font-weight:600;color:#334155">{{tagline}}</p>' +
  '<p style="margin:2px 0 0;font-size:11px;color:#334155">{{addressSingleLine}}</p>' +
  '<p style="margin:2px 0 0;font-size:11px;color:#334155">{{taxLine}}</p>' +
  '<p style="margin:2px 0 0;font-size:11px;color:#334155">{{contactLine}}</p>' +
  '</div>' +
  '<p style="margin:10px 0 0;text-align:center;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#0f172a">{{documentTitle}}</p>' +
  '<p style="margin:2px 0 0;text-align:center;font-size:12px;color:#475569">{{documentSubtitle}}</p>';

/** The standard footer line: name · address · contacts · tax numbers, then the footer note. */
export const STANDARD_LETTERHEAD_FOOTER_HTML =
  '<p style="margin:0;text-align:center;font-size:10px;line-height:1.4;color:#475569">{{legalName}} · {{addressSingleLine}} · {{contactLine}} · {{taxLine}}</p>' +
  '<p style="margin:0;text-align:center;font-size:10px;line-height:1.4;font-style:italic;color:#475569">{{footerNote}}</p>';

export const DEFAULT_CUSTOM_LETTERHEAD: CustomLetterhead = {
  headerHtml: STANDARD_LETTERHEAD_HEADER_HTML,
  footerHtml: STANDARD_LETTERHEAD_FOOTER_HTML,
  headerHeightMm: null,
  footerHeightMm: null,
  headerOn: 'first',
  footerOn: 'every',
  marginMm: null,
};

export const DEFAULT_COMPANY_DESIGN: CompanyDesign = {
  letterhead: {
    mode: 'standard',
    custom: DEFAULT_CUSTOM_LETTERHEAD,
    layout: 'center',
    showLogo: true,
    showAddress: true,
    showGstin: true,
    showCin: true,
    showContacts: true,
    accentColor: '#1e293b',
    titleSize: 'md',
    divider: 'line',
    headerNote: null,
    footerNote: null,
    watermark: null,
  },
  // 'auto' everywhere it exists, so nothing changes until an admin picks something.
  tables: { density: 'auto', striped: false, bordered: false, headerStyle: 'muted', stickyHeader: false },
  dialogs: { defaultSize: 'auto', footerAlign: 'end' },
  // The Project Management sidebar (sidebar-tabs-list.tsx): a bordered panel, w-56, group headings, the active entry filled with the primary colour. Most module sidebars
  // have no collapse toggle, so collapsing is off.
  sidebar: { style: 'soft', width: 'standard', showIcons: true, showGroupLabels: true, collapsible: false, activeIndicator: 'background' },
  print: { showPrintedOn: false, showPageNumbers: false, signatureLabels: [] },
};

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  legalName: 'Siddhartha Engineering Limited',
  shortName: 'SEL',
  tagline: 'Electrical Engineers, Contractors (EHV) & Consultants',
  cin: null,
  pan: null,
  addressLines: ['Plot No. 1015, Nayapalli, N.H. 5'],
  city: 'Bhubaneswar',
  state: 'Odisha',
  pincode: '751012',
  country: 'India',
  phone: '0674-2561911-914, 3291287 · Fax 0674-2561915',
  email: 'sel.techhead@gmail.com',
  website: null,
  // The real registrations live in Expenses › GST registrations; the settings screen imports them.
  gstRegistrations: [],
  logoUrl: null,
  design: DEFAULT_COMPANY_DESIGN,
  labels: { ...UI_TEXT_DEFAULTS },
};

/* ── sanitising ─────────────────────────────────────────────────────────────────────────────── */

const LIMITS = {
  legalName: 160,
  shortName: 40,
  tagline: 160,
  addressLine: 120,
  addressLines: 4,
  city: 60,
  state: 60,
  pincode: 12,
  country: 60,
  phone: 120,
  email: 120,
  website: 200,
  logoUrl: 2000,
  gstRegistrations: 20,
  gstLabel: 80,
  note: 200,
  watermark: 40,
  signatureLabel: 40,
  signatureLabels: 6,
  label: 120,
  longLabel: 300,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Trimmed, whitespace-collapsed and capped; '' when not a string. */
const clean = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** A required string: the cleaned value, else the fallback. */
const text = (value: unknown, max: number, fallback: string) => clean(value, max) || fallback;

/** An optional string: absent keeps the fallback; null or blank clears it. */
const optional = (value: unknown, max: number, fallback: string | null): string | null => {
  if (value === undefined) return fallback;
  return clean(value, max) || null;
};

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;

const HEX = /^#[0-9a-f]{6}$/i;
const CIN = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeGstRegistrations(raw: unknown, fallback: CompanyGstRegistration[]): CompanyGstRegistration[] {
  if (!Array.isArray(raw)) return fallback;
  const out: CompanyGstRegistration[] = [];
  const seen = new Set<string>();
  let hasPrimary = false;
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const gstin = normaliseTaxId(typeof entry.gstin === 'string' ? entry.gstin : '');
    const check = checkGstin(gstin);
    if (!check.valid || seen.has(gstin)) continue;
    seen.add(gstin);
    const state = clean(entry.state, LIMITS.state) || check.stateName || '';
    // At most one primary: the first one marked wins.
    const primary = entry.primary === true && !hasPrimary;
    if (primary) hasPrimary = true;
    out.push({ gstin, state, label: clean(entry.label, LIMITS.gstLabel) || state, primary });
    if (out.length >= LIMITS.gstRegistrations) break;
  }
  return out;
}

/** Cap on each of the header and footer markup, in characters — a logo, a table and some text fit in a few KB. */
export const LETTERHEAD_HTML_MAX_LENGTH = 40_000;

/** A millimetre value within bounds, rounded to 0.5mm; null/blank clears it, junk keeps the fallback. */
const millimetres = (value: unknown, min: number, max: number, fallback: number | null): number | null => {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)) * 2) / 2;
};

/**
 * Shape and size only. The markup itself is cleaned by the HTML sanitisers — `sanitizeLetterheadHtml`
 * (sanitize-html, on save and on every server read) and `purifyLetterheadHtml` (DOMPurify, before
 * the browser renders it) — which this pure module cannot import.
 */
function sanitizeCustomLetterhead(raw: unknown, fallback: CustomLetterhead): CustomLetterhead {
  const source = isRecord(raw) ? raw : {};
  const html = (value: unknown, fb: string) =>
    typeof value === 'string' ? (value.length <= LETTERHEAD_HTML_MAX_LENGTH ? value : fb) : fb;
  return {
    headerHtml: html(source.headerHtml, fallback.headerHtml),
    footerHtml: html(source.footerHtml, fallback.footerHtml),
    headerHeightMm: millimetres(source.headerHeightMm, 5, 120, fallback.headerHeightMm),
    footerHeightMm: millimetres(source.footerHeightMm, 5, 80, fallback.footerHeightMm),
    headerOn: oneOf(source.headerOn, ['first', 'every'] as const, fallback.headerOn),
    footerOn: oneOf(source.footerOn, ['every', 'last', 'first'] as const, fallback.footerOn),
    marginMm: millimetres(source.marginMm, 0, 40, fallback.marginMm),
  };
}

export function sanitizeCompanyDesign(raw: unknown, fallback: CompanyDesign = DEFAULT_COMPANY_DESIGN): CompanyDesign {
  const source = isRecord(raw) ? raw : {};
  const lh = isRecord(source.letterhead) ? source.letterhead : {};
  const tb = isRecord(source.tables) ? source.tables : {};
  const dg = isRecord(source.dialogs) ? source.dialogs : {};
  const pr = isRecord(source.print) ? source.print : {};
  const sb = isRecord(source.sidebar) ? source.sidebar : {};
  const f = fallback;
  const accent = typeof lh.accentColor === 'string' && HEX.test(lh.accentColor.trim()) ? lh.accentColor.trim().toLowerCase() : f.letterhead.accentColor;
  const signatureLabels = Array.isArray(pr.signatureLabels)
    ? pr.signatureLabels.map((label) => clean(label, LIMITS.signatureLabel)).filter(Boolean).slice(0, LIMITS.signatureLabels)
    : f.print.signatureLabels;
  return {
    letterhead: {
      mode: oneOf(lh.mode, ['standard', 'custom'] as const, f.letterhead.mode ?? 'standard'),
      custom: sanitizeCustomLetterhead(lh.custom, f.letterhead.custom ?? DEFAULT_CUSTOM_LETTERHEAD),
      layout: oneOf(lh.layout, ['left', 'center', 'split'] as const, f.letterhead.layout),
      showLogo: bool(lh.showLogo, f.letterhead.showLogo),
      showAddress: bool(lh.showAddress, f.letterhead.showAddress),
      showGstin: bool(lh.showGstin, f.letterhead.showGstin),
      showCin: bool(lh.showCin, f.letterhead.showCin),
      showContacts: bool(lh.showContacts, f.letterhead.showContacts),
      accentColor: accent,
      titleSize: oneOf(lh.titleSize, ['sm', 'md', 'lg'] as const, f.letterhead.titleSize),
      divider: oneOf(lh.divider, ['none', 'line', 'double', 'bar'] as const, f.letterhead.divider),
      headerNote: optional(lh.headerNote, LIMITS.note, f.letterhead.headerNote),
      footerNote: optional(lh.footerNote, LIMITS.note, f.letterhead.footerNote),
      watermark: optional(lh.watermark, LIMITS.watermark, f.letterhead.watermark),
    },
    tables: {
      density: oneOf(tb.density, ['auto', 'compact', 'standard', 'comfortable'] as const, f.tables.density),
      striped: bool(tb.striped, f.tables.striped),
      bordered: bool(tb.bordered, f.tables.bordered),
      headerStyle: oneOf(tb.headerStyle, ['muted', 'accent', 'plain'] as const, f.tables.headerStyle),
      stickyHeader: bool(tb.stickyHeader, f.tables.stickyHeader),
    },
    dialogs: {
      defaultSize: oneOf(dg.defaultSize, ['auto', 'sm', 'md', 'lg', 'xl'] as const, f.dialogs.defaultSize),
      footerAlign: oneOf(dg.footerAlign, ['end', 'between', 'stretch'] as const, f.dialogs.footerAlign),
    },
    sidebar: {
      style: oneOf(sb.style, ['solid', 'soft', 'minimal'] as const, f.sidebar.style),
      width: oneOf(sb.width, ['narrow', 'standard', 'wide'] as const, f.sidebar.width),
      showIcons: bool(sb.showIcons, f.sidebar.showIcons),
      showGroupLabels: bool(sb.showGroupLabels, f.sidebar.showGroupLabels),
      collapsible: bool(sb.collapsible, f.sidebar.collapsible),
      activeIndicator: oneOf(sb.activeIndicator, ['bar', 'pill', 'background'] as const, f.sidebar.activeIndicator),
    },
    print: {
      showPrintedOn: bool(pr.showPrintedOn, f.print.showPrintedOn),
      showPageNumbers: bool(pr.showPageNumbers, f.print.showPageNumbers),
      signatureLabels,
    },
  };
}

/** Every key present: unknown keys dropped, blank or missing ones from the fallback (else the default). */
export function sanitizeUiText(raw: unknown, fallback: Partial<Record<UiTextKey, string>> = UI_TEXT_DEFAULTS): Record<UiTextKey, string> {
  const source = isRecord(raw) ? raw : {};
  const out = {} as Record<UiTextKey, string>;
  for (const key of UI_TEXT_KEYS) {
    const max = key === 'confirmDeleteDescription' ? LIMITS.longLabel : LIMITS.label;
    out[key] = clean(source[key], max) || fallback[key] || UI_TEXT_DEFAULTS[key];
  }
  return out;
}

export function sanitizeCompanyProfile(raw: unknown, fallback: CompanyProfile = DEFAULT_COMPANY_PROFILE): CompanyProfile {
  const source = isRecord(raw) ? raw : {};
  const f = fallback;
  const addressLines = Array.isArray(source.addressLines)
    ? source.addressLines.map((line) => clean(line, LIMITS.addressLine)).filter(Boolean).slice(0, LIMITS.addressLines)
    : f.addressLines;

  const cinRaw = optional(source.cin, 21, f.cin);
  const cin = cinRaw && CIN.test(normaliseTaxId(cinRaw)) ? normaliseTaxId(cinRaw) : null;
  const panRaw = optional(source.pan, 10, f.pan);
  const pan = panRaw && isValidPan(panRaw) ? normaliseTaxId(panRaw) : null;
  const emailRaw = optional(source.email, LIMITS.email, f.email);
  const email = emailRaw && EMAIL.test(emailRaw) ? emailRaw : null;
  const logoRaw = optional(source.logoUrl, LIMITS.logoUrl, f.logoUrl);
  // Only an https address (a Storage download URL, typically) — never javascript: or data:.
  const logoUrl = logoRaw && /^https:\/\/[^\s"'<>]+$/i.test(logoRaw) ? logoRaw : null;
  const websiteRaw = optional(source.website, LIMITS.website, f.website);
  const website = websiteRaw && /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+([/?#][^\s"'<>]*)?$/i.test(websiteRaw) ? websiteRaw : null;

  return {
    legalName: text(source.legalName, LIMITS.legalName, f.legalName),
    shortName: text(source.shortName, LIMITS.shortName, f.shortName),
    tagline: optional(source.tagline, LIMITS.tagline, f.tagline),
    cin,
    pan,
    addressLines,
    city: text(source.city, LIMITS.city, f.city),
    state: text(source.state, LIMITS.state, f.state),
    pincode: text(source.pincode, LIMITS.pincode, f.pincode),
    country: text(source.country, LIMITS.country, f.country),
    phone: optional(source.phone, LIMITS.phone, f.phone),
    email,
    website,
    gstRegistrations: sanitizeGstRegistrations(source.gstRegistrations, f.gstRegistrations),
    logoUrl,
    design: sanitizeCompanyDesign(source.design, f.design),
    labels: sanitizeUiText(source.labels, f.labels),
  };
}

/* ── formatting ─────────────────────────────────────────────────────────────────────────────── */

/**
 * "Plot No. 1015, Nayapalli, N.H. 5, Bhubaneswar - 751012, Odisha". The country is left out unless
 * asked for — every document so far is domestic.
 */
export function formatCompanyAddress(p: CompanyProfile, opts: { singleLine?: boolean; includeCountry?: boolean } = {}): string {
  const cityLine = [p.city, p.pincode].filter(Boolean).join(' - ');
  const parts = [...p.addressLines, cityLine, p.state, opts.includeCountry ? p.country : ''].filter(Boolean);
  if (opts.singleLine) return parts.join(', ');
  // Multi-line: the street lines, then "City - PIN, State".
  return [...p.addressLines, [cityLine, p.state, opts.includeCountry ? p.country : ''].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join('\n');
}

/** The registration marked primary, else the first one, else null. */
export function primaryGstin(p: CompanyProfile): string | null {
  const primary = p.gstRegistrations.find((registration) => registration.primary) ?? p.gstRegistrations[0];
  return primary?.gstin ?? null;
}

/** "GSTIN 21ABCDE1234F1Z5 · CIN … · PAN …" — the tax line under the address, honouring the design toggles. */
export function companyTaxLine(p: CompanyProfile): string {
  const lh = p.design.letterhead;
  const gstin = lh.showGstin ? primaryGstin(p) : null;
  return [gstin && `GSTIN ${gstin}`, lh.showCin && p.cin && `CIN ${p.cin}`, lh.showCin && p.pan && `PAN ${p.pan}`].filter(Boolean).join(' · ');
}

/** "Phone … · email · website", honouring the design toggle. */
export function companyContactLine(p: CompanyProfile): string {
  if (!p.design.letterhead.showContacts) return '';
  return [p.phone && `Phone ${p.phone}`, p.email, p.website].filter(Boolean).join(' · ');
}

/** The UI text for a key; a caller's own wording wins unless an admin has changed the label. */
export function uiText(labels: Record<UiTextKey, string>, key: UiTextKey, fallback?: string): string {
  const stored = labels[key];
  if (stored && stored !== UI_TEXT_DEFAULTS[key]) return stored;
  return fallback ?? stored ?? UI_TEXT_DEFAULTS[key];
}

/** The signature captions for print: the design's list, else Prepared / Checked / Approved. */
export function signatureLabelsFor(p: CompanyProfile): string[] {
  const configured = p.design.print.signatureLabels;
  return configured.length ? configured : [p.labels.preparedBy, p.labels.checkedBy, p.labels.approvedBy];
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const TITLE_PX: Record<LetterheadTitleSize, number> = { sm: 16, md: 20, lg: 24 };

const DIVIDER_CSS: Record<LetterheadDivider, string> = {
  none: '',
  line: 'border-bottom:1px solid {c};',
  double: 'border-bottom:3px double {c};',
  bar: 'border-bottom:4px solid {c};',
};

/**
 * The letterhead as an HTML string with inline styles — for emails and for print documents built as
 * strings. Every value is escaped; the logo is included only when it is an https URL (the sanitiser
 * guarantees that for a stored profile).
 */
export function companyLetterheadHtml(p: CompanyProfile, opts: { title?: string; subtitle?: string; meta?: { label: string; value: string }[] } = {}): string {
  const lh = p.design.letterhead;
  if (lh.mode === 'custom') {
    // The stored markup was cleaned by sanitize-html on save and again on the server read
    // (company-profile-server.ts); every merge field is escaped here.
    const body = renderLetterheadTemplate(lh.custom.headerHtml, p, { documentTitle: opts.title, documentSubtitle: opts.subtitle, meta: opts.meta });
    return `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;">${body}</div>`;
  }
  const accent = HEX.test(lh.accentColor) ? lh.accentColor : DEFAULT_COMPANY_DESIGN.letterhead.accentColor;
  const align = lh.layout === 'center' ? 'center' : 'left';
  const small = 'margin:2px 0 0;font-size:11px;line-height:1.4;color:#334155;';
  const lines: string[] = [];
  if (lh.headerNote) lines.push(`<p style="${small}text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(lh.headerNote)}</p>`);
  lines.push(`<p style="margin:0;font-size:${TITLE_PX[lh.titleSize]}px;font-weight:800;letter-spacing:0.02em;color:${accent};">${escapeHtml(p.legalName)}</p>`);
  if (p.tagline) lines.push(`<p style="${small}font-weight:600;">${escapeHtml(p.tagline)}</p>`);
  const details: string[] = [];
  if (lh.showAddress) details.push(`<p style="${small}">${escapeHtml(formatCompanyAddress(p, { singleLine: true }))}</p>`);
  const tax = companyTaxLine(p);
  if (tax) details.push(`<p style="${small}">${escapeHtml(tax)}</p>`);
  const contact = companyContactLine(p);
  if (contact) details.push(`<p style="${small}">${escapeHtml(contact)}</p>`);

  const logo =
    lh.showLogo && p.logoUrl && /^https:\/\//i.test(p.logoUrl)
      ? `<img src="${escapeHtml(p.logoUrl)}" alt="${escapeHtml(p.shortName)}" style="height:48px;width:auto;display:block;${align === 'center' ? 'margin:0 auto 6px;' : ''}" />`
      : '';
  const divider = DIVIDER_CSS[lh.divider].replace('{c}', accent);

  let head: string;
  if (lh.layout === 'split') {
    head =
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>` +
      `<td style="vertical-align:top;text-align:left;">${logo}${lines.join('')}</td>` +
      `<td style="vertical-align:top;text-align:right;">${details.join('')}</td></tr></table>`;
  } else if (lh.layout === 'left' && logo) {
    head =
      `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>` +
      `<td style="vertical-align:top;padding-right:12px;">${logo}</td>` +
      `<td style="vertical-align:top;text-align:left;">${lines.join('')}${details.join('')}</td></tr></table>`;
  } else {
    head = `${logo}${lines.join('')}${details.join('')}`;
  }

  const title = opts.title
    ? `<p style="margin:10px 0 0;text-align:center;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#0f172a;">${escapeHtml(opts.title)}</p>`
    : '';
  const subtitle = opts.subtitle ? `<p style="margin:2px 0 0;text-align:center;font-size:12px;color:#475569;">${escapeHtml(opts.subtitle)}</p>` : '';
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;text-align:${align};">` +
    `<div style="padding-bottom:8px;${divider}">${head}</div>${title}${subtitle}</div>`
  );
}

/** The footer line as an HTML string with inline styles — the standard line, or the designed footer. */
export function companyFooterHtml(p: CompanyProfile, ctx: LetterheadContext = {}): string {
  const lh = p.design.letterhead;
  const template = lh.mode === 'custom' ? lh.custom.footerHtml : STANDARD_LETTERHEAD_FOOTER_HTML;
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;">${renderLetterheadTemplate(template, p, ctx)}</div>`;
}

/* ── the designed letterhead: merge fields, template rendering, sanitiser allow-lists ─────────── */

/** What a document passes in for the document-specific fields. */
export interface LetterheadContext {
  documentTitle?: string;
  documentSubtitle?: string;
  documentNumber?: string;
  date?: string;
  printedOn?: string;
  preparedBy?: string;
  /** CompanyLetterhead's `meta` entries, available as `{{meta.<label>}}`. */
  meta?: { label: string; value: string }[];
}

export interface LetterheadField {
  name: string;
  label: string;
  group: 'Company' | 'Document' | 'Page';
}

/** Every `{{field}}` the designer offers. `meta.<label>` is accepted on top of these. */
export const LETTERHEAD_FIELDS: readonly LetterheadField[] = [
  { name: 'logo', label: 'Logo', group: 'Company' },
  { name: 'legalName', label: 'Legal name', group: 'Company' },
  { name: 'shortName', label: 'Short name', group: 'Company' },
  { name: 'tagline', label: 'Tagline', group: 'Company' },
  { name: 'address', label: 'Address (lines)', group: 'Company' },
  { name: 'addressSingleLine', label: 'Address (one line)', group: 'Company' },
  { name: 'city', label: 'City', group: 'Company' },
  { name: 'state', label: 'State', group: 'Company' },
  { name: 'pincode', label: 'PIN code', group: 'Company' },
  { name: 'country', label: 'Country', group: 'Company' },
  { name: 'gstin', label: 'GSTIN (primary)', group: 'Company' },
  { name: 'allGstins', label: 'All GSTINs', group: 'Company' },
  { name: 'cin', label: 'CIN', group: 'Company' },
  { name: 'pan', label: 'PAN', group: 'Company' },
  { name: 'taxLine', label: 'Tax line (GSTIN · CIN · PAN)', group: 'Company' },
  { name: 'phone', label: 'Phone', group: 'Company' },
  { name: 'email', label: 'Email', group: 'Company' },
  { name: 'website', label: 'Website', group: 'Company' },
  { name: 'contactLine', label: 'Contact line (phone · email · web)', group: 'Company' },
  { name: 'footerNote', label: 'Footer note', group: 'Company' },
  { name: 'documentTitle', label: 'Document title', group: 'Document' },
  { name: 'documentSubtitle', label: 'Document subtitle', group: 'Document' },
  { name: 'documentNumber', label: 'Document number', group: 'Document' },
  { name: 'date', label: 'Document date', group: 'Document' },
  { name: 'preparedBy', label: 'Prepared by', group: 'Document' },
  { name: 'printedOn', label: 'Printed on', group: 'Page' },
  { name: 'page', label: 'Page number', group: 'Page' },
  { name: 'pages', label: 'Page count', group: 'Page' },
];

const FIELD_NAMES = new Set(LETTERHEAD_FIELDS.map((field) => field.name));

/** `{{ name }}` — a field name, or `meta.` and a label. No braces or angle brackets inside. */
const TOKEN = /\{\{\s*([^{}<>]{1,80}?)\s*\}\}/g;

/** The text a field stands for, unescaped; '' for unknown or empty fields. `logo` is handled apart. */
function fieldValue(name: string, p: CompanyProfile, ctx: LetterheadContext): string {
  if (name.startsWith('meta.')) {
    const label = name.slice(5).trim().toLowerCase();
    return ctx.meta?.find((entry) => entry.label.trim().toLowerCase() === label)?.value ?? '';
  }
  switch (name) {
    case 'legalName': return p.legalName;
    case 'shortName': return p.shortName;
    case 'tagline': return p.tagline ?? '';
    case 'address': return formatCompanyAddress(p);
    case 'addressSingleLine': return formatCompanyAddress(p, { singleLine: true });
    case 'city': return p.city;
    case 'state': return p.state;
    case 'pincode': return p.pincode;
    case 'country': return p.country;
    case 'gstin': return primaryGstin(p) ?? '';
    case 'allGstins': return p.gstRegistrations.map((r) => `${r.label || r.state}: ${r.gstin}`).join(' · ');
    case 'cin': return p.cin ?? '';
    case 'pan': return p.pan ?? '';
    case 'taxLine': return [primaryGstin(p) && `GSTIN ${primaryGstin(p)}`, p.cin && `CIN ${p.cin}`, p.pan && `PAN ${p.pan}`].filter(Boolean).join(' · ');
    case 'phone': return p.phone ?? '';
    case 'email': return p.email ?? '';
    case 'website': return p.website ?? '';
    case 'contactLine': return [p.phone && `Phone ${p.phone}`, p.email, p.website].filter(Boolean).join(' · ');
    case 'footerNote': return p.design.letterhead.footerNote ?? '';
    case 'documentTitle': return ctx.documentTitle ?? '';
    case 'documentSubtitle': return ctx.documentSubtitle ?? '';
    case 'documentNumber': return ctx.documentNumber ?? '';
    case 'date': return ctx.date ?? '';
    case 'printedOn': return ctx.printedOn ?? '';
    case 'preparedBy': return ctx.preparedBy ?? '';
    // Page numbers are not known to the HTML: in-flow counter(page) is always 0 in Chrome. They
    // print through an @page margin box where the browser has them (see LetterheadPage).
    case 'page':
    case 'pages':
    default:
      return '';
  }
}

/** Whether the template uses a field (`meta` matches any `meta.<label>`). */
export function letterheadUsesField(html: string, name: string): boolean {
  for (const match of html.matchAll(TOKEN)) {
    const token = match[1].trim();
    if (token === name || (name === 'meta' && token.startsWith('meta.'))) return true;
  }
  return false;
}

/** Field names in a template that LETTERHEAD_FIELDS does not know (they render empty). */
export function unknownLetterheadFields(html: string): string[] {
  const out = new Set<string>();
  for (const match of html.matchAll(TOKEN)) {
    const token = match[1].trim();
    if (!FIELD_NAMES.has(token) && !token.startsWith('meta.')) out.add(token);
  }
  return [...out];
}

/** A block element containing no other block — a paragraph, heading or list item. */
const LEAF_BLOCK = /<(p|h[1-4]|li)\b([^>]*)>((?:(?!<\/?(?:p|h[1-4]|li|div|table)\b)[\s\S])*?)<\/\1>/gi;

/**
 * Fills a (sanitised) template: every `{{field}}` becomes its escaped value, `{{logo}}` the logo
 * image (https only), unknown fields nothing. Only text is touched — a token inside a tag's
 * attributes is left as written. A paragraph, heading or list item that held fields and comes out
 * with no text (no tagline, no title on this document) is dropped, so it leaves no gap.
 */
export function renderLetterheadTemplate(html: string, p: CompanyProfile, ctx: LetterheadContext = {}): string {
  if (!html) return '';
  const logoUrl = p.logoUrl && /^https:\/\/[^\s"'<>]+$/i.test(p.logoUrl) ? p.logoUrl : null;
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(p.shortName)}" style="height:48px;width:auto;max-width:100%;" />`
    : '';
  const fill = (segment: string) =>
    segment.replace(/(<[^>]*>)|\{\{\s*([^{}<>]{1,80}?)\s*\}\}/g, (whole, tag: string | undefined, name: string | undefined) => {
      if (tag) return tag;
      const field = (name ?? '').trim();
      return field === 'logo' ? logo : escapeHtml(fieldValue(field, p, ctx));
    });
  const withoutEmptyBlocks = html.replace(LEAF_BLOCK, (whole, _tag: string, _attrs: string, inner: string) => {
    if (!/\{\{/.test(inner)) return whole;
    const filled = fill(inner);
    const hasImage = /<img\b/i.test(filled);
    const text = filled.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/[\s·|,–—-]+/g, '');
    return hasImage || text ? whole : '';
  });
  return fill(withoutEmptyBlocks)
    // "A ·  · B" left by empty fields between separators.
    .replace(/ · (?: · )+/g, ' · ')
    .replace(/(>)\s*· /g, '$1')
    .replace(/ ·\s*(<)/g, '$1');
}

/* Allow-lists shared by both HTML sanitisers (sanitize-html on the server, DOMPurify in the browser). */

export const LETTERHEAD_TAGS = [
  'p', 'div', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'h1', 'h2', 'h3', 'h4',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr', 'img', 'a',
] as const;

/** Per-tag attributes; `style` everywhere goes through `filterLetterheadStyle`. */
export const LETTERHEAD_ATTRIBUTES: Record<string, readonly string[]> = {
  '*': ['style'],
  td: ['colspan', 'rowspan', 'width'],
  th: ['colspan', 'rowspan', 'width'],
  table: ['width'],
  img: ['src', 'alt', 'width', 'height'],
  a: ['href', 'target', 'rel'],
};

/** Fonts the app ships (Inter, Roboto, Atkinson) plus the ones every Windows PC prints with. */
export const LETTERHEAD_FONTS = [
  'Inter', 'Roboto', 'Atkinson Hyperlegible', 'Arial', 'Helvetica', 'Calibri', 'Cambria', 'Georgia',
  'Times New Roman', 'Verdana', 'Tahoma', 'Segoe UI', 'Trebuchet MS', 'Garamond', 'Courier New',
  'sans-serif', 'serif', 'monospace',
] as const;

const FONT_SET = new Set(LETTERHEAD_FONTS.map((font) => font.toLowerCase()));

const STYLE_PROPERTIES = new Set([
  'text-align', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line',
  'text-transform', 'color', 'background-color', 'line-height', 'letter-spacing', 'width', 'height', 'max-width',
  'vertical-align', 'border-collapse',
]);
const STYLE_PREFIXES = ['border', 'padding', 'margin'];

/** Splits `a:b; c:"x;y"` on the semicolons outside quotes and brackets. */
function splitDeclarations(style: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < style.length; i += 1) {
    const ch = style[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) { out.push(style.slice(start, i)); start = i + 1; }
  }
  out.push(style.slice(start));
  return out;
}

/**
 * An inline style reduced to the allowed properties. Values may not carry `url(`, `expression(`,
 * `javascript:`, backslash escapes, comments, `@`, angle brackets or `!important`; font families
 * not in LETTERHEAD_FONTS are dropped (a declaration left with none is dropped too).
 */
export function filterLetterheadStyle(style: string | null | undefined): string {
  if (!style) return '';
  const kept: string[] = [];
  for (const declaration of splitDeclarations(String(style))) {
    const colon = declaration.indexOf(':');
    if (colon < 1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    let value = declaration.slice(colon + 1).trim();
    if (!value || value.length > 200) continue;
    if (!STYLE_PROPERTIES.has(property) && !STYLE_PREFIXES.some((prefix) => property === prefix || property.startsWith(`${prefix}-`))) continue;
    if (/url\s*\(|expression\s*\(|javascript|vbscript|\\|\/\*|@|<|>|!\s*important/i.test(value)) continue;
    if (property === 'font-family') {
      const families = value.split(',').map((family) => family.trim().replace(/^["']|["']$/g, '').trim()).filter((family) => FONT_SET.has(family.toLowerCase()));
      if (!families.length) continue;
      value = families.map((family) => (/\s/.test(family) ? `'${family}'` : family)).join(', ');
    } else if (/["']/.test(value)) {
      continue;
    }
    kept.push(`${property}:${value}`);
  }
  return kept.join(';');
}

/**
 * Whether an <img src> may stay: https, from this project's Firebase Storage bucket (or any bucket
 * when none is configured), or exactly the profile's logo.
 */
export function isAllowedLetterheadImage(src: string | null | undefined, opts: { buckets?: string[]; logoUrl?: string | null } = {}): boolean {
  if (!src) return false;
  const url = src.trim();
  if (opts.logoUrl && url === opts.logoUrl) return true;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  const buckets = (opts.buckets ?? []).filter(Boolean);
  if (parsed.hostname === 'firebasestorage.googleapis.com') {
    if (!buckets.length) return parsed.pathname.startsWith('/v0/b/');
    return buckets.some((bucket) => parsed.pathname.startsWith(`/v0/b/${encodeURIComponent(bucket)}/`) || parsed.pathname.startsWith(`/v0/b/${bucket}/`));
  }
  if (parsed.hostname === 'storage.googleapis.com' && buckets.length) {
    return buckets.some((bucket) => parsed.pathname.startsWith(`/${bucket}/`));
  }
  return false;
}

/** Links: https only. */
export const isAllowedLetterheadLink = (href: string | null | undefined): boolean => !!href && /^https:\/\/[^\s"'<>]+$/i.test(href.trim());

/** A plain-text signature for the foot of an email. */
export function companyEmailSignature(p: CompanyProfile): string {
  return [p.legalName, formatCompanyAddress(p), p.phone && `Phone: ${p.phone}`, p.email && `Email: ${p.email}`, p.website, primaryGstin(p) && `GSTIN: ${primaryGstin(p)}`]
    .filter(Boolean)
    .join('\n');
}
