/**
 * Module-level configuration for Daily Requisition: Field Control (the entry form's labels,
 * required and visible fields, and the Entry Sheet register's columns) and Data Control (the
 * reception-date window, when received entries may still be edited or deleted, entry rules, and
 * the register / import defaults).
 *
 * The shipped defaults reproduce the module exactly as it behaved before these settings existed —
 * nothing is required, every field and column shows, dates are unrestricted, every status can be
 * edited and deleted (a payment lock always applies regardless) — so installing this changes
 * nothing until an administrator saves a different configuration.
 *
 * `resolveDailyRequisitionSettings` is the load-bearing part: a stored document is merged over the
 * defaults rather than trusted wholesale, so a field or column added in a later release appears
 * instead of vanishing, and a hand-edited or legacy document cannot lock anyone out.
 *
 * Pure and importless — no React, no Firebase — so `node --experimental-strip-types --test` loads
 * it directly (tests/daily-requisition-settings.test.mjs). Hence no enums and no parameter
 * properties.
 */

/* ── storage ─────────────────────────────────────────────────────────────── */

/** Where the settings document lives. Field Control and Data Control share it. */
export const DAILY_REQUISITION_SETTINGS_PATH = {
  collection: 'dailyRequisitionSettings',
  doc: 'module-config',
} as const;

/* ── entry-form fields ───────────────────────────────────────────────────── */

export type DRFieldKey =
  | 'receptionDate'
  | 'depNo'
  | 'partyName'
  | 'projectId'
  | 'departmentId'
  | 'description'
  | 'grossAmount'
  | 'netAmount'
  | 'attachments';

export interface DRFieldDef {
  key: DRFieldKey;
  defaultLabel: string;
  defaultRequired: boolean;
  /** Can only be relabelled: always shown, required-ness fixed at the default. */
  locked?: boolean;
  /** Cannot be hidden, but may be made required or optional. */
  alwaysVisible?: boolean;
  /** Whether it is required is decided elsewhere (Data Control), so there is no Required switch. */
  requiredManagedElsewhere?: boolean;
  /** Shown under the row in Field Control. */
  helpText?: string;
  /** Which dialogs render it. */
  forms: ReadonlyArray<'add' | 'edit'>;
}

export const DR_FIELD_REGISTRY: readonly DRFieldDef[] = [
  {
    key: 'depNo',
    defaultLabel: 'DEP No. (expense request)',
    defaultRequired: false,
    requiredManagedElsewhere: true,
    helpText: 'The expense request being received. Whether one is mandatory is set in Data Control.',
    forms: ['add'],
  },
  {
    key: 'receptionDate',
    defaultLabel: 'Reception date',
    defaultRequired: true,
    locked: true,
    helpText: 'When the requisition came in. The Data Control date window restricts it.',
    forms: ['add', 'edit'],
  },
  {
    key: 'departmentId',
    defaultLabel: 'Department',
    defaultRequired: false,
    helpText: 'Drives the department analysis report.',
    forms: ['add', 'edit'],
  },
  {
    key: 'partyName',
    defaultLabel: 'Party name',
    defaultRequired: false,
    helpText: 'Who is being paid. Drives the party analysis report.',
    forms: ['add', 'edit'],
  },
  {
    key: 'projectId',
    defaultLabel: 'Project',
    defaultRequired: false,
    helpText: 'What the spend is charged to.',
    forms: ['add', 'edit'],
  },
  {
    key: 'grossAmount',
    defaultLabel: 'Gross amount',
    defaultRequired: false,
    helpText: 'The bill value before deductions.',
    forms: ['add', 'edit'],
  },
  {
    key: 'netAmount',
    defaultLabel: 'Net amount',
    defaultRequired: false,
    alwaysVisible: true,
    helpText: 'What is payable — Bank Balance pays against it, so it is always shown.',
    forms: ['add', 'edit'],
  },
  {
    key: 'description',
    defaultLabel: 'Description',
    defaultRequired: false,
    helpText: 'What the payment is for.',
    forms: ['add', 'edit'],
  },
  {
    key: 'attachments',
    defaultLabel: 'Attachments',
    defaultRequired: false,
    helpText: 'Bill, invoice or approval. Required means at least one file on a new entry.',
    forms: ['add'],
  },
];

export const DR_FIELD_KEYS: readonly DRFieldKey[] = DR_FIELD_REGISTRY.map((field) => field.key);

export const drFieldDef = (key: DRFieldKey): DRFieldDef =>
  DR_FIELD_REGISTRY.find((field) => field.key === key) as DRFieldDef;

export interface DRFieldSetting {
  visible: boolean;
  required: boolean;
  /** The label as stored. Blank means the shipped label. */
  label: string;
}

/** A field as the form should render it. */
export interface ResolvedDRField {
  key: DRFieldKey;
  visible: boolean;
  /** Only ever true when visible — a hidden field is never enforced. */
  required: boolean;
  /** Never blank. */
  label: string;
  helpText?: string;
}

export const MAX_LABEL_LENGTH = 60;

/* ── register columns ────────────────────────────────────────────────────── */

export type DRColumnKey =
  | 'createdAt'
  | 'receptionNo'
  | 'status'
  | 'date'
  | 'projectId'
  | 'departmentId'
  | 'partyName'
  | 'description'
  | 'grossAmount'
  | 'netAmount'
  | 'paid'
  | 'balance'
  | 'actions';

export interface DRColumnDef {
  key: DRColumnKey;
  label: string;
  numeric?: boolean;
  /** Cannot be hidden. */
  locked?: boolean;
  /** Cannot be moved either: always the last column. */
  pinnedLast?: boolean;
}

export const DR_COLUMN_REGISTRY: readonly DRColumnDef[] = [
  { key: 'createdAt', label: 'Created At' },
  { key: 'receptionNo', label: 'Reception No.', locked: true },
  { key: 'status', label: 'Status', locked: true },
  { key: 'date', label: 'Date' },
  { key: 'projectId', label: 'Project' },
  { key: 'departmentId', label: 'Department' },
  { key: 'partyName', label: 'Party Name' },
  { key: 'description', label: 'Description' },
  { key: 'grossAmount', label: 'Gross Amount', numeric: true },
  { key: 'netAmount', label: 'Net Amount', numeric: true },
  { key: 'paid', label: 'Paid', numeric: true },
  { key: 'balance', label: 'Balance', numeric: true },
  { key: 'actions', label: 'Actions', locked: true, pinnedLast: true },
];

export const drColumnDef = (key: string): DRColumnDef | undefined =>
  DR_COLUMN_REGISTRY.find((column) => column.key === key);

export interface DRColumnSetting {
  key: DRColumnKey;
  visible: boolean;
}

/* ── data control ────────────────────────────────────────────────────────── */

export interface DRDateControl {
  /** Master switch. Off — the default — means any reception date. */
  enabled: boolean;
  /** Calendar days before today that may be chosen. 0 = today only. */
  backdateDays: number;
  /** Calendar days after today that may be chosen. 0 = not in the future. */
  futureDays: number;
  /** Whether a bulk import's rows are held to the same window. */
  applyToImport: boolean;
}

export type DRDatePreset = 'all' | 'today' | 'this-week' | 'this-month' | 'last-30' | 'this-year';

export const DR_DATE_PRESETS: ReadonlyArray<{ value: DRDatePreset; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'this-week', label: 'This week' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-30', label: 'Last 30 days' },
  { value: 'this-year', label: 'This year' },
];

/** The back-dating presets Data Control offers, as SAS Date Control does. */
export const DR_BACKDATE_PRESETS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 0, label: 'Today only' },
  { days: 1, label: '1 day' },
  { days: 3, label: '3 days' },
  { days: 7, label: '7 days' },
  { days: 15, label: '15 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

export const MAX_WINDOW_DAYS = 3650;

export interface DRDataControl {
  dateControl: DRDateControl;
  /** Whether an entry can still be edited once its status has moved past Pending. */
  allowEditAfterReceived: boolean;
  /** Whether an entry can still be deleted once its status has moved past Pending. */
  allowDeleteAfterReceived: boolean;
  /** New entries must be received from an expense request (a DEP No). */
  requireExpenseRequest: boolean;
  /** Whether the net amount may be higher than the gross. */
  netMayExceedGross: boolean;
  /** Rows at or above this amount are highlighted in the register. 0 = off. */
  highValueThreshold: number;
  /** What the Entry Sheet filters to before the user touches anything. */
  defaultDateRange: DRDatePreset;
  /** Whether an import skips rows repeating an entry already recorded (by content). */
  importDuplicateDetection: boolean;
}

/* ── the whole document ──────────────────────────────────────────────────── */

export interface DailyRequisitionSettings {
  fields: Record<DRFieldKey, DRFieldSetting>;
  columns: DRColumnSetting[];
  data: DRDataControl;
}

/** Who last saved each section. Timestamps are left as whatever Firestore returns. */
export interface DRSectionMeta {
  updatedAt?: unknown;
  updatedById?: string;
  updatedByName?: string;
}

export interface DailyRequisitionSettingsMeta {
  fieldControl: DRSectionMeta;
  dataControl: DRSectionMeta;
}

/* ── defaults ────────────────────────────────────────────────────────────── */

export const defaultFieldSettings = (): Record<DRFieldKey, DRFieldSetting> => {
  const fields = {} as Record<DRFieldKey, DRFieldSetting>;
  for (const def of DR_FIELD_REGISTRY) {
    fields[def.key] = { visible: true, required: def.defaultRequired, label: '' };
  }
  return fields;
};

export const defaultColumnSettings = (): DRColumnSetting[] =>
  DR_COLUMN_REGISTRY.map((column) => ({ key: column.key, visible: true }));

export const DEFAULT_DATA_CONTROL: DRDataControl = {
  dateControl: { enabled: false, backdateDays: 7, futureDays: 0, applyToImport: true },
  allowEditAfterReceived: true,
  allowDeleteAfterReceived: true,
  requireExpenseRequest: false,
  netMayExceedGross: true,
  highValueThreshold: 0,
  defaultDateRange: 'all',
  importDuplicateDetection: true,
};

export const defaultDataControl = (): DRDataControl => ({
  ...DEFAULT_DATA_CONTROL,
  dateControl: { ...DEFAULT_DATA_CONTROL.dateControl },
});

export const defaultDailyRequisitionSettings = (): DailyRequisitionSettings => ({
  fields: defaultFieldSettings(),
  columns: defaultColumnSettings(),
  data: defaultDataControl(),
});

/* ── resolution ──────────────────────────────────────────────────────────── */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const wholeDays = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (value === null || value === '' || !Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(MAX_WINDOW_DAYS, Math.floor(parsed));
};

const amount = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (value === null || value === '' || !Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed * 100) / 100;
};

/** Applies the registry's rules to one stored field. */
function resolveFieldSetting(def: DRFieldDef, stored: unknown): DRFieldSetting {
  const saved = isRecord(stored) ? stored : {};
  const label = typeof saved.label === 'string' ? saved.label.trim().slice(0, MAX_LABEL_LENGTH) : '';
  // A label identical to the shipped one is stored as blank, so a later rename of the default flows through.
  const storedLabel = label === def.defaultLabel ? '' : label;
  if (def.locked) return { visible: true, required: def.defaultRequired, label: storedLabel };
  const visible = def.alwaysVisible ? true : bool(saved.visible, true);
  const requested = def.requiredManagedElsewhere ? def.defaultRequired : bool(saved.required, def.defaultRequired);
  // A hidden field can never be required: the form would refuse to submit with no way to satisfy it.
  return { visible, required: visible && requested, label: storedLabel };
}

export function resolveFieldSettings(stored: unknown): Record<DRFieldKey, DRFieldSetting> {
  const saved = isRecord(stored) ? stored : {};
  const fields = {} as Record<DRFieldKey, DRFieldSetting>;
  for (const def of DR_FIELD_REGISTRY) fields[def.key] = resolveFieldSetting(def, saved[def.key]);
  return fields;
}

/**
 * Merges a stored column layout over the shipped one: stored order wins for the columns it names,
 * columns added since are inserted at their shipped position, unknown keys are dropped, locked
 * columns are forced visible and Actions is always last.
 */
export function resolveColumnSettings(stored: unknown): DRColumnSetting[] {
  const resolved: DRColumnSetting[] = [];
  const seen = new Set<string>();
  if (Array.isArray(stored)) {
    for (const entry of stored) {
      const key = typeof entry === 'string' ? entry : isRecord(entry) ? entry.key : undefined;
      const def = typeof key === 'string' ? drColumnDef(key) : undefined;
      if (!def || seen.has(def.key) || def.pinnedLast) continue;
      const visible = typeof entry === 'string' ? true : (entry as Record<string, unknown>).visible !== false;
      resolved.push({ key: def.key, visible: def.locked ? true : visible });
      seen.add(def.key);
    }
  }
  // Columns the document never mentioned go in after the shipped column they follow.
  DR_COLUMN_REGISTRY.forEach((def, index) => {
    if (seen.has(def.key) || def.pinnedLast) return;
    let insertAt = 0;
    for (let prev = index - 1; prev >= 0; prev -= 1) {
      const at = resolved.findIndex((column) => column.key === DR_COLUMN_REGISTRY[prev].key);
      if (at !== -1) {
        insertAt = at + 1;
        break;
      }
    }
    resolved.splice(insertAt, 0, { key: def.key, visible: true });
    seen.add(def.key);
  });
  for (const def of DR_COLUMN_REGISTRY) {
    if (def.pinnedLast) resolved.push({ key: def.key, visible: true });
  }
  return resolved;
}

export function resolveDataControl(stored: unknown): DRDataControl {
  const saved = isRecord(stored) ? stored : {};
  const date = isRecord(saved.dateControl) ? saved.dateControl : {};
  const d = DEFAULT_DATA_CONTROL;
  const presets = DR_DATE_PRESETS.map((preset) => preset.value) as string[];
  return {
    dateControl: {
      enabled: date.enabled === true,
      backdateDays: wholeDays(date.backdateDays, d.dateControl.backdateDays),
      futureDays: wholeDays(date.futureDays, d.dateControl.futureDays),
      applyToImport: bool(date.applyToImport, d.dateControl.applyToImport),
    },
    allowEditAfterReceived: bool(saved.allowEditAfterReceived, d.allowEditAfterReceived),
    allowDeleteAfterReceived: bool(saved.allowDeleteAfterReceived, d.allowDeleteAfterReceived),
    requireExpenseRequest: bool(saved.requireExpenseRequest, d.requireExpenseRequest),
    netMayExceedGross: bool(saved.netMayExceedGross, d.netMayExceedGross),
    highValueThreshold: amount(saved.highValueThreshold, d.highValueThreshold),
    defaultDateRange: presets.includes(saved.defaultDateRange as string)
      ? (saved.defaultDateRange as DRDatePreset)
      : d.defaultDateRange,
    importDuplicateDetection: bool(saved.importDuplicateDetection, d.importDuplicateDetection),
  };
}

/** Everything the module reads, whatever shape the stored document is in (or none at all). */
export function resolveDailyRequisitionSettings(raw: unknown): DailyRequisitionSettings {
  const saved = isRecord(raw) ? raw : {};
  return {
    fields: resolveFieldSettings(saved.fields),
    columns: resolveColumnSettings(saved.columns),
    data: resolveDataControl(saved.data),
  };
}

const metaOf = (value: unknown): DRSectionMeta => {
  const saved = isRecord(value) ? value : {};
  return {
    updatedAt: saved.updatedAt ?? undefined,
    updatedById: typeof saved.updatedById === 'string' ? saved.updatedById : undefined,
    updatedByName: typeof saved.updatedByName === 'string' ? saved.updatedByName : undefined,
  };
};

/** Who last saved each section, read from the stored document's `meta`. */
export function resolveSettingsMeta(raw: unknown): DailyRequisitionSettingsMeta {
  const meta = isRecord(raw) && isRecord(raw.meta) ? raw.meta : {};
  return { fieldControl: metaOf(meta.fieldControl), dataControl: metaOf(meta.dataControl) };
}

/**
 * The plain object to write (without the audit stamp): only defined values, so Firestore never
 * sees `undefined`.
 */
export function toStoredSettings(settings: DailyRequisitionSettings): {
  fields: Record<string, DRFieldSetting>;
  columns: DRColumnSetting[];
  data: DRDataControl;
} {
  const clean = resolveDailyRequisitionSettings(settings);
  return {
    fields: Object.fromEntries(
      DR_FIELD_KEYS.map((key) => [key, { visible: clean.fields[key].visible, required: clean.fields[key].required, label: clean.fields[key].label }]),
    ),
    columns: clean.columns.map((column) => ({ key: column.key, visible: column.visible })),
    data: { ...clean.data, dateControl: { ...clean.data.dateControl } },
  };
}

/* ── consumption: fields ─────────────────────────────────────────────────── */

/** The label, visibility and required-ness the form should use for a field. */
export function resolveField(settings: DailyRequisitionSettings, key: DRFieldKey): ResolvedDRField {
  const def = drFieldDef(key);
  const setting = resolveFieldSetting(def, settings.fields?.[key]);
  return {
    key,
    visible: setting.visible,
    required: setting.visible && setting.required,
    label: setting.label || def.defaultLabel,
    helpText: def.helpText,
  };
}

/** A form label with its required marker. */
export const fieldLabel = (field: ResolvedDRField): string => (field.required ? `${field.label} *` : field.label);

/* ── consumption: columns ────────────────────────────────────────────────── */

/**
 * The columns the register renders, in order: only visible ones, locked ones always, Actions last.
 */
export function applyColumnSettings(columns: readonly DRColumnSetting[] | undefined): DRColumnDef[] {
  return resolveColumnSettings(columns ?? [])
    .filter((column) => column.visible)
    .map((column) => drColumnDef(column.key) as DRColumnDef);
}

/** Moves a column one place. Pinned columns never move, nor does anything move past them. */
export function moveColumn(
  columns: readonly DRColumnSetting[],
  index: number,
  direction: 'up' | 'down',
): DRColumnSetting[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  const next = [...columns];
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  if (drColumnDef(next[index].key)?.pinnedLast || drColumnDef(next[target].key)?.pinnedLast) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function setColumnVisibility(
  columns: readonly DRColumnSetting[],
  key: DRColumnKey,
  visible: boolean,
): DRColumnSetting[] {
  return columns.map((column) =>
    column.key === key ? { ...column, visible: drColumnDef(key)?.locked ? true : visible } : column,
  );
}

/** Whether a row is highlighted as high value. The larger of gross and net is compared. */
export function isHighValue(entry: { grossAmount?: unknown; netAmount?: unknown }, threshold: number): boolean {
  if (!(threshold > 0)) return false;
  const value = Math.max(Number(entry.grossAmount) || 0, Number(entry.netAmount) || 0);
  return value >= threshold;
}

/* ── consumption: dates ──────────────────────────────────────────────────── */

/** Today as `YYYY-MM-DD` in the viewer's timezone. */
export function todayLocal(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `YYYY-MM-DD` of a Date in local time. */
export const dateKey = (date: Date): string => todayLocal(date);

/** Shifts a `YYYY-MM-DD` string by whole calendar days (UTC arithmetic, so DST cannot move it). */
export function shiftDays(date: string, delta: number): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + delta);
  return shifted.toISOString().slice(0, 10);
}

export interface DRDateWindow {
  /** Earliest allowed `YYYY-MM-DD`, or null when unrestricted. */
  min: string | null;
  /** Latest allowed `YYYY-MM-DD`, or null when unrestricted. */
  max: string | null;
  enforced: boolean;
  backdateDays: number;
  futureDays: number;
}

/** The reception dates that may be chosen today. */
export function resolveDateWindow(today: string, settings: Pick<DailyRequisitionSettings, 'data'>): DRDateWindow {
  const control = resolveDataControl(settings.data).dateControl;
  if (!control.enabled) {
    return { min: null, max: null, enforced: false, backdateDays: control.backdateDays, futureDays: control.futureDays };
  }
  return {
    min: shiftDays(today, -control.backdateDays),
    max: shiftDays(today, control.futureDays),
    enforced: true,
    backdateDays: control.backdateDays,
    futureDays: control.futureDays,
  };
}

/** Whether a `YYYY-MM-DD` falls inside the window. Unrestricted windows admit everything. */
export const isDateInWindow = (date: string, window: DRDateWindow): boolean =>
  !window.enforced || ((!window.min || date >= window.min) && (!window.max || date <= window.max));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-09-23` → `23 Sep 2026`. */
export function formatDateKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year}`;
}

/** One line describing the window, for the hint under the date field and the settings preview. */
export function describeDateWindow(window: DRDateWindow): string | null {
  if (!window.enforced || !window.min || !window.max) return null;
  if (window.min === window.max) return `Entries can be dated ${formatDateKey(window.min)} only`;
  return `Entries can be dated ${formatDateKey(window.min)} – ${formatDateKey(window.max)}`;
}

export interface DRCheck {
  ok: boolean;
  reason?: string;
}

/** Checks one reception date (`YYYY-MM-DD`) against the window. */
export function validateReceptionDate(date: string, window: DRDateWindow, label = 'Reception date'): DRCheck {
  if (!date) return { ok: false, reason: `${label} is required.` };
  if (!window.enforced) return { ok: true };
  if (window.min && date < window.min) {
    const span =
      window.backdateDays === 0 ? 'today only' : window.backdateDays === 1 ? 'today or yesterday' : `the last ${window.backdateDays} days`;
    return {
      ok: false,
      reason: `${label} cannot be earlier than ${formatDateKey(window.min)} — back-dating is limited to ${span}.`,
    };
  }
  if (window.max && date > window.max) {
    return {
      ok: false,
      reason:
        window.futureDays === 0
          ? `${label} cannot be in the future.`
          : `${label} cannot be later than ${formatDateKey(window.max)}.`,
    };
  }
  return { ok: true };
}

/** Turns a register preset into a concrete range (local days). `all` means no range. */
export function resolveDatePreset(preset: DRDatePreset, today: Date = new Date()): { from: Date; to: Date } | undefined {
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  switch (preset) {
    case 'today':
      return { from: startOfDay(today), to: endOfDay(today) };
    case 'this-week': {
      const offset = (today.getDay() + 6) % 7; // Monday-based weeks
      const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
      return { from: monday, to: endOfDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)) };
    }
    case 'this-month':
      return {
        from: new Date(today.getFullYear(), today.getMonth(), 1),
        to: endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      };
    case 'last-30':
      return { from: startOfDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)), to: endOfDay(today) };
    case 'this-year':
      return { from: new Date(today.getFullYear(), 0, 1), to: endOfDay(new Date(today.getFullYear(), 11, 31)) };
    default:
      return undefined;
  }
}

/* ── consumption: entry rules ────────────────────────────────────────────── */

/**
 * Why an entry may not be edited or deleted under Data Control, or null when it may.
 * Only the status rule — the caller applies the payment lock first, and its message wins.
 */
export function receivedRuleBlock(
  status: unknown,
  data: Pick<DRDataControl, 'allowEditAfterReceived' | 'allowDeleteAfterReceived'>,
  action: 'edit' | 'delete',
): string | null {
  const current = typeof status === 'string' && status.trim() ? status.trim() : 'Pending';
  if (current === 'Pending') return null;
  const allowed = action === 'edit' ? data.allowEditAfterReceived : data.allowDeleteAfterReceived;
  if (allowed) return null;
  return action === 'edit'
    ? `This entry is ${current}. Entries cannot be edited once received (Daily Requisition › Settings › Data Control).`
    : `This entry is ${current}. Entries cannot be deleted once received (Daily Requisition › Settings › Data Control).`;
}

export interface DREntryValues {
  depNo?: string;
  /** `YYYY-MM-DD`, or blank. */
  receptionDate?: string;
  partyName?: string;
  projectId?: string;
  departmentId?: string;
  description?: string;
  grossAmount?: string | number;
  netAmount?: string | number;
}

export interface DREntryCheckOptions {
  mode: 'add' | 'edit';
  window: DRDateWindow;
  /** Files chosen on the Add dialog. */
  attachmentCount?: number;
  /** Edit only: the date as it was, so an unchanged old date is not re-judged against today's window. */
  originalReceptionDate?: string;
  /** Edit only: fields the payment lock makes read-only — never enforced, since they cannot be fixed. */
  lockedKeys?: readonly DRFieldKey[];
}

const blank = (value: unknown) => value === undefined || value === null || String(value).trim() === '';

/**
 * Every problem with an Add / Edit submission under the current settings, by field.
 * Empty when the entry may be saved.
 */
export function validateEntryValues(
  values: DREntryValues,
  settings: DailyRequisitionSettings,
  options: DREntryCheckOptions,
): Partial<Record<DRFieldKey, string>> {
  const errors: Partial<Record<DRFieldKey, string>> = {};
  const locked = new Set(options.lockedKeys ?? []);
  const inForm = (key: DRFieldKey) => drFieldDef(key).forms.includes(options.mode);

  for (const def of DR_FIELD_REGISTRY) {
    if (!inForm(def.key) || locked.has(def.key)) continue;
    const field = resolveField(settings, def.key);
    if (!field.required || def.key === 'receptionDate') continue;
    if (def.key === 'attachments') {
      if (!(options.attachmentCount && options.attachmentCount > 0)) errors.attachments = `${field.label} is required.`;
      continue;
    }
    if (blank(values[def.key as keyof DREntryValues])) errors[def.key] = `${field.label} is required.`;
  }

  const data = resolveDataControl(settings.data);
  const dep = resolveField(settings, 'depNo');
  if (options.mode === 'add' && data.requireExpenseRequest && dep.visible && blank(values.depNo)) {
    errors.depNo = 'New entries must be received from an expense request — pick a DEP No.';
  }

  const gross = resolveField(settings, 'grossAmount');
  if (!data.netMayExceedGross && gross.visible && !locked.has('netAmount') && !locked.has('grossAmount')) {
    const g = Number(values.grossAmount);
    const n = Number(values.netAmount);
    if (!blank(values.netAmount) && Number.isFinite(g) && Number.isFinite(n) && n > (blank(values.grossAmount) ? 0 : g)) {
      errors.netAmount = 'Net amount cannot be more than the gross amount.';
    }
  }

  if (!locked.has('receptionDate')) {
    const date = values.receptionDate ?? '';
    const unchanged = options.mode === 'edit' && Boolean(date) && date === options.originalReceptionDate;
    if (!unchanged) {
      const check = validateReceptionDate(date, options.window, resolveField(settings, 'receptionDate').label);
      if (!check.ok) errors.receptionDate = check.reason;
    }
  }

  return errors;
}

/* ── validation of a configuration ───────────────────────────────────────── */

export interface DRSettingsIssue {
  severity: 'error' | 'warning';
  message: string;
  /** Which settings page the issue belongs to. */
  section: 'fieldControl' | 'dataControl';
}

/**
 * What would go wrong if this configuration were saved. Errors block the save; warnings do not.
 * Checks the draft as given (not resolved), so it catches what the editor would otherwise quietly fix.
 */
export function validateDailyRequisitionSettings(settings: DailyRequisitionSettings): DRSettingsIssue[] {
  const issues: DRSettingsIssue[] = [];
  let section: DRSettingsIssue['section'] = 'fieldControl';
  const error = (message: string) => issues.push({ severity: 'error', message, section });
  const warn = (message: string) => issues.push({ severity: 'warning', message, section });

  for (const def of DR_FIELD_REGISTRY) {
    const field = settings.fields?.[def.key];
    if (!field) continue;
    const name = field.label?.trim() || def.defaultLabel;
    if ((field.label ?? '').trim().length > MAX_LABEL_LENGTH) error(`"${name}" label is longer than ${MAX_LABEL_LENGTH} characters.`);
    if ((def.locked || def.alwaysVisible) && field.visible === false) error(`"${def.defaultLabel}" cannot be hidden.`);
    if (def.locked && field.required !== def.defaultRequired) error(`"${def.defaultLabel}" can only be relabelled.`);
    if (field.visible === false && field.required === true) error(`"${def.defaultLabel}" is hidden but still required.`);
    if (field.visible === false && !def.locked && !def.alwaysVisible) warn(`"${def.defaultLabel}" is hidden — new entries will be saved without it.`);
  }

  const labels = new Map<string, string>();
  for (const def of DR_FIELD_REGISTRY) {
    const label = (settings.fields?.[def.key]?.label?.trim() || def.defaultLabel).toLowerCase();
    const other = labels.get(label);
    if (other) warn(`"${def.defaultLabel}" and "${other}" share the label "${label}".`);
    else labels.set(label, def.defaultLabel);
  }

  const columns = settings.columns ?? [];
  for (const def of DR_COLUMN_REGISTRY) {
    const column = columns.find((entry) => entry.key === def.key);
    if (def.locked && column && column.visible === false) error(`The "${def.label}" column cannot be hidden.`);
  }
  const lastKey = columns[columns.length - 1]?.key;
  if (columns.length && lastKey !== 'actions') error('The Actions column must stay last.');
  const visibleCount = columns.filter((column) => column.visible && column.key !== 'actions').length;
  if (columns.length && visibleCount < 3) warn(`The register shows only ${visibleCount} data columns.`);

  const data = settings.data;
  section = 'dataControl';
  if (data) {
    const dc = data.dateControl;
    for (const [name, value] of [['Days back', dc?.backdateDays], ['Days ahead', dc?.futureDays]] as const) {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_WINDOW_DAYS) {
        error(`${name} must be a whole number from 0 to ${MAX_WINDOW_DAYS}.`);
      }
    }
    if (typeof data.highValueThreshold !== 'number' || !Number.isFinite(data.highValueThreshold) || data.highValueThreshold < 0) {
      error('The high-value threshold must be zero (off) or a positive amount.');
    }
    if (data.requireExpenseRequest && settings.fields?.depNo?.visible === false) {
      error('An expense request is required, but the DEP No field is hidden — nobody could add an entry.');
    }
    if (dc?.enabled && dc.backdateDays === 0 && dc.futureDays === 0) warn('Entries can only be dated today.');
    if (data.allowEditAfterReceived === false) warn('Received entries can no longer be edited from the Entry Sheet.');
    if (data.allowDeleteAfterReceived === false) warn('Received entries can no longer be deleted from the Entry Sheet.');
    if (data.importDuplicateDetection === false) warn('Imports will not skip rows repeating an entry already recorded.');
  }

  return issues;
}

export const hasBlockingIssue = (issues: readonly DRSettingsIssue[]): boolean =>
  issues.some((issue) => issue.severity === 'error');

/* ── audit ───────────────────────────────────────────────────────────────── */

type Flat = Record<string, string | number | boolean>;

/**
 * Field Control as readable flat keys ("Party name · required"), for `diffFields` — so the audit
 * log shows exactly what changed rather than a nested blob.
 */
export function flattenFieldControl(settings: Pick<DailyRequisitionSettings, 'fields' | 'columns'>): Flat {
  const flat: Flat = {};
  const fields = resolveFieldSettings(settings.fields);
  for (const def of DR_FIELD_REGISTRY) {
    const field = fields[def.key];
    flat[`${def.defaultLabel} · label`] = field.label || def.defaultLabel;
    flat[`${def.defaultLabel} · visible`] = field.visible;
    flat[`${def.defaultLabel} · required`] = field.required;
  }
  const columns = resolveColumnSettings(settings.columns);
  for (const column of columns) {
    flat[`Column ${drColumnDef(column.key)?.label ?? column.key} · visible`] = column.visible;
  }
  flat['Column order'] = columns.map((column) => drColumnDef(column.key)?.label ?? column.key).join(', ');
  return flat;
}

/** Data Control as readable flat keys, for `diffFields`. */
export function flattenDataControl(data: DRDataControl): Flat {
  const d = resolveDataControl(data);
  return {
    'Reception date window · enabled': d.dateControl.enabled,
    'Reception date window · days back': d.dateControl.backdateDays,
    'Reception date window · days ahead': d.dateControl.futureDays,
    'Reception date window · applies to import': d.dateControl.applyToImport,
    'Allow edit after received': d.allowEditAfterReceived,
    'Allow delete after received': d.allowDeleteAfterReceived,
    'Require expense request': d.requireExpenseRequest,
    'Net may exceed gross': d.netMayExceedGross,
    'High-value threshold': d.highValueThreshold,
    'Default date range': DR_DATE_PRESETS.find((preset) => preset.value === d.defaultDateRange)?.label ?? d.defaultDateRange,
    'Import duplicate detection': d.importDuplicateDetection,
  };
}
