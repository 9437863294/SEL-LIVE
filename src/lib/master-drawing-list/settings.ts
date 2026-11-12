/**
 * Master Drawing List settings, configured in the module's own Settings (`/master-drawing-list/
 * settings`) and applied by the forms and, again, by the API:
 *
 *   - Schedules & Scopes — the lists an item is filed under (Supply / Civil / Electrical …,
 *     Substation / Transmission Line …). A value can be added, renamed, reordered or switched off;
 *     one already used on drawings can be switched off but not renamed or removed.
 *   - Field Control — per form, each field's label, whether it is shown and whether it is required.
 *     A locked field keeps its place (only the label changes): the form cannot work without it.
 *   - Date Control — how far back (and ahead) a submission, comments or approve date may be entered,
 *     for every drawing list or per list. Off by default; dates are never later than today unless
 *     the rule allows days ahead.
 *
 * Pure, so the screens, the API and the tests share one reading of the stored documents.
 */

import { SCHEDULES, SCOPES } from './types.ts';

/* ── Schedules & Scopes ──────────────────────────────────────────────────── */

export interface MasterValue {
  id: string;
  name: string;
  active: boolean;
}

export interface MasterData {
  schedules: MasterValue[];
  scopes: MasterValue[];
}

export const MASTER_KINDS = ['schedules', 'scopes'] as const;
export type MasterKind = (typeof MASTER_KINDS)[number];

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'value';

export const DEFAULT_MASTER_DATA: MasterData = {
  schedules: SCHEDULES.map((name) => ({ id: slug(name), name, active: true })),
  scopes: SCOPES.map((name) => ({ id: slug(name), name, active: true })),
};

function cleanValues(raw: unknown, fallback: MasterValue[]): MasterValue[] {
  if (!Array.isArray(raw)) return fallback;
  const seen = new Set<string>();
  const out: MasterValue[] = [];
  for (const entry of raw) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ id: typeof entry?.id === 'string' && entry.id ? entry.id : slug(name), name, active: entry?.active !== false });
  }
  return out.length ? out : fallback;
}

export function resolveMasterData(stored: unknown): MasterData {
  const data = (stored ?? {}) as Partial<Record<MasterKind, unknown>>;
  return { schedules: cleanValues(data.schedules, DEFAULT_MASTER_DATA.schedules), scopes: cleanValues(data.scopes, DEFAULT_MASTER_DATA.scopes) };
}

export const activeNames = (values: MasterValue[]) => values.filter((value) => value.active).map((value) => value.name);
export const allNames = (values: MasterValue[]) => values.map((value) => value.name);

/** Why a list cannot be saved, or null: a name each, no repeats, at least one value switched on. */
export function masterValuesError(kind: MasterKind, values: MasterValue[]): string | null {
  const label = kind === 'schedules' ? 'schedule' : 'scope';
  if (!values.length) return `Keep at least one ${label}.`;
  const seen = new Set<string>();
  for (const value of values) {
    const name = value.name.trim();
    if (!name) return `Every ${label} needs a name.`;
    if (name.length > 60) return `Keep ${label} names under 60 characters.`;
    if (seen.has(name.toLowerCase())) return `“${name}” is listed twice.`;
    seen.add(name.toLowerCase());
  }
  if (!values.some((value) => value.active)) return `Keep at least one ${label} switched on.`;
  return null;
}

/** A value that is on drawings and was renamed or removed — refused, since items keep the name they were filed under. */
export function usedValueChange(before: MasterValue[], after: MasterValue[], usage: Record<string, number>): string | null {
  for (const value of before) {
    if (!usage[value.name]) continue;
    const kept = after.find((entry) => entry.id === value.id);
    if (!kept) return `“${value.name}” is on ${usage[value.name]} drawing${usage[value.name] === 1 ? '' : 's'}; switch it off instead of removing it.`;
    if (kept.name.trim() !== value.name) return `“${value.name}” is on ${usage[value.name]} drawing${usage[value.name] === 1 ? '' : 's'} and cannot be renamed; add the new name and switch this one off.`;
  }
  return null;
}

/* ── Field Control ───────────────────────────────────────────────────────── */

export type MdlFormKey = 'item' | 'drawing' | 'sub' | 'round';

export interface MdlFieldDef {
  key: string;
  defaultLabel: string;
  defaultRequired: boolean;
  /** Shown and required as defined; only the label can change. */
  locked?: boolean;
  /** When "required" bites, for a field that only makes sense at some point. */
  note?: string;
}

export const MDL_FORM_REGISTRY: Record<MdlFormKey, { title: string; description: string; fields: MdlFieldDef[] }> = {
  item: {
    title: 'Drawing Item',
    description: 'Add Drawing Item, and the item fields at the top of Drawing Details.',
    fields: [
      { key: 'schedule', defaultLabel: 'Schedule', defaultRequired: true, locked: true },
      { key: 'scope', defaultLabel: 'Scope', defaultRequired: true, locked: true },
      { key: 'group', defaultLabel: 'Group', defaultRequired: false },
      { key: 'description', defaultLabel: 'Item Description', defaultRequired: true, locked: true },
    ],
  },
  drawing: {
    title: 'Drawing Details',
    description: 'The drawing record of an item or a sub-drawing: numbers, planned window, approval and remark.',
    fields: [
      { key: 'docNo', defaultLabel: 'Doc No.', defaultRequired: false },
      { key: 'drawingNo', defaultLabel: 'Drawing No.', defaultRequired: false },
      { key: 'plannedStartDate', defaultLabel: 'Planned Start Date', defaultRequired: false },
      { key: 'plannedEndDate', defaultLabel: 'Planned End Date', defaultRequired: false },
      { key: 'approveDate', defaultLabel: 'Approve Date', defaultRequired: false, note: 'Required only once the overall status is Approved or Approved with Comments.' },
      { key: 'status', defaultLabel: 'Overall Status', defaultRequired: true, locked: true },
      { key: 'remark', defaultLabel: 'Remark', defaultRequired: false },
    ],
  },
  sub: {
    title: 'Sub-drawing',
    description: 'The fields that only a sub-drawing has.',
    fields: [
      { key: 'title', defaultLabel: 'Sub-drawing Title', defaultRequired: true, locked: true },
      { key: 'assignedTo', defaultLabel: 'Assigned To', defaultRequired: false },
    ],
  },
  round: {
    title: 'Submission Round',
    description: 'Each round (R0, R1 …) under Submission to Client.',
    fields: [
      { key: 'submissionDate', defaultLabel: 'Submission Date', defaultRequired: true, locked: true },
      { key: 'transmittalNo', defaultLabel: 'Transmittal No.', defaultRequired: false, note: 'Required on every round that has a submission date.' },
      { key: 'status', defaultLabel: 'Status', defaultRequired: false, note: 'Required on every round that has a submission date.' },
      { key: 'commentsDate', defaultLabel: 'Comments Date', defaultRequired: false, note: 'Required once the round is marked Resubmission Required, Rejected or Approved with Comments.' },
      { key: 'file', defaultLabel: 'Drawing File', defaultRequired: true, note: 'Required on a round when it is first submitted; rounds already on record are not asked again.' },
      { key: 'comments', defaultLabel: 'Comments', defaultRequired: false, note: 'Required once the round is marked Resubmission Required, Rejected or Approved with Comments.' },
    ],
  },
};

export const MDL_FORM_KEYS = Object.keys(MDL_FORM_REGISTRY) as MdlFormKey[];

export interface FieldOverride {
  label?: string;
  visible?: boolean;
  required?: boolean;
}
export type FieldControl = Partial<Record<MdlFormKey, Record<string, FieldOverride>>>;

export interface FieldSetting {
  label: string;
  visible: boolean;
  required: boolean;
  locked: boolean;
}

/** One field as the form shows it: the configured label, and whether it is shown and required. */
export function fieldSetting(control: FieldControl | null | undefined, form: MdlFormKey, key: string): FieldSetting {
  const def = MDL_FORM_REGISTRY[form].fields.find((field) => field.key === key);
  const override = control?.[form]?.[key] ?? {};
  const label = override.label?.trim() || def?.defaultLabel || key;
  if (!def || def.locked) return { label, visible: true, required: def?.defaultRequired ?? false, locked: true };
  const visible = override.visible ?? true;
  return { label, visible, required: visible && (override.required ?? def.defaultRequired), locked: false };
}

/** The stored overrides with anything unknown dropped and labels trimmed. */
export function resolveFieldControl(stored: unknown): FieldControl {
  const raw = (stored ?? {}) as Record<string, Record<string, FieldOverride>>;
  const out: FieldControl = {};
  for (const form of MDL_FORM_KEYS) {
    const fields: Record<string, FieldOverride> = {};
    for (const def of MDL_FORM_REGISTRY[form].fields) {
      const entry = raw?.[form]?.[def.key];
      if (!entry || typeof entry !== 'object') continue;
      const clean: FieldOverride = {};
      if (typeof entry.label === 'string' && entry.label.trim()) clean.label = entry.label.trim().slice(0, 80);
      if (!def.locked && typeof entry.visible === 'boolean') clean.visible = entry.visible;
      if (!def.locked && typeof entry.required === 'boolean') clean.required = entry.required;
      if (Object.keys(clean).length) fields[def.key] = clean;
    }
    if (Object.keys(fields).length) out[form] = fields;
  }
  return out;
}

/* ── Date Control ────────────────────────────────────────────────────────── */

export type MdlDateKind = 'submission' | 'comments' | 'approval';

export interface MdlDateRule {
  /** Off: no back-dating limit (dates still cannot be later than today). */
  enabled: boolean;
  /** Days before today a date may be, today included; 0 = today only. */
  backdateDays: number;
  /** Days after today a date may be; 0 = not later than today. */
  futureDays: number;
  applySubmission: boolean;
  applyComments: boolean;
  applyApproval: boolean;
}

export interface MdlDateControl extends MdlDateRule {
  /** A drawing list's own rule, complete, by its code; lists without one follow the rule above. */
  projects?: Record<string, MdlDateRule>;
}

export const MAX_BACKDATE_DAYS = 3650;
export const MAX_FUTURE_DAYS = 365;

export const DEFAULT_DATE_RULE: MdlDateRule = {
  enabled: false,
  backdateDays: 7,
  futureDays: 0,
  applySubmission: true,
  applyComments: true,
  applyApproval: true,
};

const clamp = (value: unknown, max: number, fallback: number) => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(0, n));
};

export function resolveDateRule(stored: unknown): MdlDateRule {
  const raw = (stored ?? {}) as Partial<MdlDateRule>;
  return {
    enabled: raw.enabled === true,
    backdateDays: clamp(raw.backdateDays, MAX_BACKDATE_DAYS, DEFAULT_DATE_RULE.backdateDays),
    futureDays: clamp(raw.futureDays, MAX_FUTURE_DAYS, DEFAULT_DATE_RULE.futureDays),
    applySubmission: raw.applySubmission !== false,
    applyComments: raw.applyComments !== false,
    applyApproval: raw.applyApproval !== false,
  };
}

export function resolveDateControl(stored: unknown): MdlDateControl {
  const raw = (stored ?? {}) as Partial<MdlDateControl>;
  const projects: Record<string, MdlDateRule> = {};
  for (const [code, rule] of Object.entries(raw.projects ?? {})) projects[code] = resolveDateRule(rule);
  return { ...resolveDateRule(raw), projects };
}

/** The rule a drawing list follows: its own, or the one for every list. */
export function dateRuleFor(control: MdlDateControl | null | undefined, projectCode: string | null | undefined): MdlDateRule & { source: 'all' | 'project' } {
  const own = projectCode ? control?.projects?.[projectCode] : undefined;
  if (own) return { ...own, source: 'project' };
  return { ...resolveDateRule(control ?? {}), source: 'all' };
}

const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The dates allowed for one kind: never before `min` (when the rule is on) and never after `max`. */
export function dateWindow(rule: MdlDateRule, kind: MdlDateKind, today: string): { min: string | null; max: string } {
  const applies = rule.enabled && (kind === 'submission' ? rule.applySubmission : kind === 'comments' ? rule.applyComments : rule.applyApproval);
  return { min: applies ? shift(today, -rule.backdateDays) : null, max: shift(today, applies ? rule.futureDays : 0) };
}

/** The rule in words, for the form and Settings. */
export function describeDateRule(rule: MdlDateRule): string {
  if (!rule.enabled) return 'No back-dating limit; dates cannot be later than today.';
  const back = rule.backdateDays === 0 ? 'today only' : rule.backdateDays === 1 ? 'today or yesterday' : `the last ${rule.backdateDays} days`;
  const ahead = rule.futureDays ? `, or up to ${rule.futureDays} day${rule.futureDays === 1 ? '' : 's'} ahead` : '';
  return `Dates within ${back}${ahead}.`;
}

/* ── one bundle ──────────────────────────────────────────────────────────── */

export interface MdlSettings {
  masterData: MasterData;
  fieldControl: FieldControl;
  dateControl: MdlDateControl;
}

export const DEFAULT_SETTINGS: MdlSettings = { masterData: DEFAULT_MASTER_DATA, fieldControl: {}, dateControl: { ...DEFAULT_DATE_RULE, projects: {} } };
