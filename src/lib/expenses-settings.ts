/**
 * Module-level configuration for Expenses: which columns the registers show and in what order,
 * which fields the request form asks for, and the data rules the module enforces.
 *
 * These used to live as toolbar controls each user set for themselves, which meant every person
 * arranged the same register differently and nobody could say what "the register" looked like.
 * Here they are an organisation default an administrator sets once. A user's personal column
 * tweaks still win where they exist — the default is a starting point, not a straitjacket — but
 * a fresh user, a printout and a support conversation all start from the same layout.
 *
 * `resolveExpensesSettings` is the load-bearing part: stored settings are merged over the defaults
 * rather than trusted wholesale, so a column added to the module in a later release appears for
 * everyone instead of vanishing because it was missing from a document saved last year.
 *
 * Pure — no Firebase, no DOM — so the merge, the validation and the locking rules are unit-testable.
 */

/* ── columns ─────────────────────────────────────────────────────────────── */

/** Every column the registers can show, in the order they ship in. */
export const EXPENSE_REGISTER_COLUMNS = [
  'Request No',
  'Timestamp',
  'Department',
  'Project Name',
  'Amount',
  'Head of A/c',
  'Sub-Head of A/c',
  'Remarks',
  'Description',
  'Name of the party',
  'Reception No',
  'Reception Date',
  // Where the request stands downstream (Daily Requisition stage, Bank Balance payments) — read
  // live from the linked requisition by the registers, never stored on the request.
  'Stage',
  'Paid / Balance',
] as const;

export type ExpenseRegisterColumnKey = (typeof EXPENSE_REGISTER_COLUMNS)[number];

/**
 * Columns that cannot be hidden. A register whose rows carry no identifier and no value is not a
 * register — and both are what every other screen refers back to.
 */
export const LOCKED_COLUMNS: readonly string[] = ['Request No', 'Amount'];

/** Which register a column layout applies to. The two differ: one is scoped to a department. */
export type ExpenseRegisterId = 'all' | 'department';

export const EXPENSE_REGISTERS: { id: ExpenseRegisterId; label: string; description: string }[] = [
  { id: 'department', label: 'Department Register', description: 'The table on a single department page.' },
  { id: 'all', label: 'Consolidated Register', description: 'The table on the all-departments page.' },
];

export interface ExpenseColumnSetting {
  key: string;
  visible: boolean;
}

/* ── form fields ─────────────────────────────────────────────────────────── */

export type ExpenseFieldKey =
  | 'projectId'
  | 'amount'
  | 'subHeadOfAccount'
  | 'headOfAccount'
  | 'partyName'
  | 'description'
  | 'remarks';

export interface ExpenseFieldDefinition {
  key: ExpenseFieldKey;
  label: string;
  /** Why it exists, shown under the control in settings. */
  hint: string;
  /** Cannot be hidden or made optional — the record is meaningless without it. */
  locked?: boolean;
  /** Cannot be hidden, but may be optional. */
  alwaysVisible?: boolean;
}

export const EXPENSE_FORM_FIELDS: ExpenseFieldDefinition[] = [
  {
    key: 'projectId',
    label: 'Project Name',
    hint: 'What the spend is charged to. Every report groups by it.',
    locked: true,
  },
  {
    key: 'amount',
    label: 'Amount',
    hint: 'The value of the request.',
    locked: true,
  },
  {
    key: 'subHeadOfAccount',
    label: 'Sub-Head of A/c',
    hint: 'The chart-of-accounts line. The head of account is derived from it.',
    locked: true,
  },
  {
    key: 'headOfAccount',
    label: 'Head of A/c',
    hint: 'Filled in automatically from the sub-head; shown read-only on the form.',
    alwaysVisible: true,
  },
  {
    key: 'partyName',
    label: 'Name of the Party',
    hint: 'Who is being paid. Drives the party ledger report.',
  },
  {
    key: 'description',
    label: 'Description',
    hint: 'What the expense is for.',
  },
  {
    key: 'remarks',
    label: 'Remarks',
    hint: 'Anything else worth recording.',
  },
];

export interface ExpenseFieldSetting {
  key: ExpenseFieldKey;
  visible: boolean;
  required: boolean;
  /** Replaces the shipped label on the form. Blank keeps the default. */
  label?: string;
  /** Shown under the field on the form. */
  helpText?: string;
}

/* ── data rules ──────────────────────────────────────────────────────────── */

export type ExpenseDatePreset = 'all' | 'today' | 'this-week' | 'this-month' | 'last-30' | 'this-year';

export const EXPENSE_DATE_PRESETS: { value: ExpenseDatePreset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'this-week', label: 'This week' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-30', label: 'Last 30 days' },
  { value: 'this-year', label: 'This year' },
];

export interface ExpenseDataControl {
  /** What a register filters to before the user touches anything. */
  defaultDateRange: ExpenseDatePreset;
  /** Whether a request that already carries a reception number can still be edited. */
  allowEditAfterReception: boolean;
  /** Restrict the party picker to names already on record instead of accepting new ones. */
  restrictPartyToExisting: boolean;
  /** What the High Value report flags, in rupees. */
  highValueThreshold: number;
  /** Whether a bulk import skips rows that repeat an existing request. */
  importDuplicateDetection: boolean;
  /** Where a bulk import takes request numbers from. */
  importRequestNoSource: 'generate' | 'file';
  /**
   * Whether the GST, TDS and deductions of a request may still be changed once it carries a
   * reception number. Only meaningful while `allowEditAfterReception` is on. Today no edit screen
   * changes a request's statutory figures — they are fixed at New Request — so this is stored
   * for the screen that will, rather than enforced anywhere yet.
   */
  allowStatutoryEditAfterReception: boolean;
  /** Whether New Request shows the GST & TDS section at all. */
  gstTdsCapture: boolean;
  /** The largest amount a single request may be raised for, in rupees. 0 means no limit. */
  maxRequestAmount: number;
  /**
   * How many days back New Request looks for a request to the same party for the same amount
   * before saving, asking the user to confirm when it finds one. 0 turns the check off.
   */
  duplicateRequestWarningDays: number;
}

/* ── the whole settings document ─────────────────────────────────────────── */

/** Who last saved one part of the document, and when. */
export interface ExpenseSettingsStamp {
  updatedAt?: string;
  /** User id. Documents written before the split stored a display name here. */
  updatedBy?: string;
  updatedByName?: string;
}

/** The two parts of the document that are edited — and stamped — separately. */
export type ExpenseSettingsPart = 'fieldControl' | 'dataControl';

export interface ExpensesModuleSettings {
  registers: Record<ExpenseRegisterId, ExpenseColumnSetting[]>;
  fields: ExpenseFieldSetting[];
  data: ExpenseDataControl;
  updatedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
  /** Per-part stamps, so each settings page can say who last changed what it shows. */
  stamps?: Partial<Record<ExpenseSettingsPart, ExpenseSettingsStamp>>;
}

/** Where the settings document lives. */
export const EXPENSES_SETTINGS_PATH = { collection: 'expensesSettings', doc: 'module-config' } as const;

const defaultColumns = (): ExpenseColumnSetting[] =>
  EXPENSE_REGISTER_COLUMNS.map(key => ({ key, visible: true }));

/** The department register already knows its department, so that column is off by default there. */
const defaultDepartmentColumns = (): ExpenseColumnSetting[] =>
  EXPENSE_REGISTER_COLUMNS.map(key => ({ key, visible: key !== 'Department' }));

export const DEFAULT_EXPENSE_FIELDS: ExpenseFieldSetting[] = EXPENSE_FORM_FIELDS.map(field => ({
  key: field.key,
  visible: true,
  // Remarks is the one field the shipped form has always treated as optional.
  required: field.key !== 'remarks' && field.key !== 'headOfAccount',
}));

export const DEFAULT_EXPENSE_DATA_CONTROL: ExpenseDataControl = {
  defaultDateRange: 'all',
  allowEditAfterReception: false,
  restrictPartyToExisting: false,
  highValueThreshold: 100000,
  importDuplicateDetection: true,
  importRequestNoSource: 'generate',
  allowStatutoryEditAfterReception: false,
  gstTdsCapture: true,
  maxRequestAmount: 0,
  duplicateRequestWarningDays: 0,
};

export const defaultExpensesSettings = (): ExpensesModuleSettings => ({
  registers: { all: defaultColumns(), department: defaultDepartmentColumns() },
  fields: DEFAULT_EXPENSE_FIELDS.map(field => ({ ...field })),
  data: { ...DEFAULT_EXPENSE_DATA_CONTROL },
});

/* ── resolution ──────────────────────────────────────────────────────────── */

const clampThreshold = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return DEFAULT_EXPENSE_DATA_CONTROL.highValueThreshold;
  return Math.round(numeric);
};

/** A non-negative whole number, or `fallback` when the stored value is not one. */
const clampWhole = (value: unknown, fallback: number): number => {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.round(numeric);
};

/**
 * A stored stamp as an ISO string. The document has been written both ways — an ISO string by the
 * old combined page, a Firestore Timestamp (`serverTimestamp()`) since — and a snapshot may carry
 * either. Duck-typed so this file stays free of Firebase.
 */
export function toIsoStamp(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (value && typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: unknown };
    if (typeof candidate.toDate === 'function') {
      const date = candidate.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
    }
    if (typeof candidate.seconds === 'number') return new Date(candidate.seconds * 1000).toISOString();
  }
  return undefined;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

function resolveStamp(stored: unknown): ExpenseSettingsStamp | undefined {
  if (!stored || typeof stored !== 'object') return undefined;
  const saved = stored as Record<string, unknown>;
  const stamp: ExpenseSettingsStamp = {};
  const at = toIsoStamp(saved.updatedAt);
  if (at) stamp.updatedAt = at;
  const by = text(saved.updatedBy);
  if (by) stamp.updatedBy = by;
  const byName = text(saved.updatedByName);
  if (byName) stamp.updatedByName = byName;
  return Object.keys(stamp).length ? stamp : undefined;
}

/**
 * Merges a stored column layout over the shipped one.
 *
 * Stored order wins for the columns it names; anything the module has added since is appended in
 * its shipped position rather than disappearing, and anything the module has removed is dropped.
 * A locked column is forced visible however it was saved — otherwise one bad save leaves every
 * register without a request number and no obvious way to get it back.
 */
export function resolveColumnSettings(
  stored: unknown,
  fallback: ExpenseColumnSetting[] = defaultColumns(),
): ExpenseColumnSetting[] {
  const known = new Set<string>(EXPENSE_REGISTER_COLUMNS);
  const byKey = new Map(fallback.map(column => [column.key, column]));
  const resolved: ExpenseColumnSetting[] = [];
  const seen = new Set<string>();

  if (Array.isArray(stored)) {
    for (const entry of stored) {
      const key = typeof entry === 'string' ? entry : (entry as ExpenseColumnSetting)?.key;
      if (typeof key !== 'string' || !known.has(key) || seen.has(key)) continue;
      const visible =
        typeof entry === 'string' ? true : (entry as ExpenseColumnSetting)?.visible !== false;
      resolved.push({ key, visible: LOCKED_COLUMNS.includes(key) ? true : visible });
      seen.add(key);
    }
  }

  for (const column of fallback) {
    if (!seen.has(column.key)) {
      resolved.push({ ...column, visible: LOCKED_COLUMNS.includes(column.key) ? true : column.visible });
      seen.add(column.key);
    }
  }

  return resolved;
}

function resolveFieldSettings(stored: unknown): ExpenseFieldSetting[] {
  const storedByKey = new Map<string, Partial<ExpenseFieldSetting>>();
  if (Array.isArray(stored)) {
    for (const entry of stored) {
      const key = (entry as ExpenseFieldSetting)?.key;
      if (typeof key === 'string') storedByKey.set(key, entry as Partial<ExpenseFieldSetting>);
    }
  }

  return EXPENSE_FORM_FIELDS.map(definition => {
    const saved = storedByKey.get(definition.key) ?? {};
    const shipped = DEFAULT_EXPENSE_FIELDS.find(field => field.key === definition.key);
    const visible = definition.locked || definition.alwaysVisible ? true : saved.visible !== false;

    // A stored value wins; a field the document never mentioned keeps the shipped default rather
    // than silently becoming optional.
    const requested =
      definition.locked ? true : typeof saved.required === 'boolean' ? saved.required : shipped?.required === true;

    return {
      key: definition.key,
      visible,
      // A hidden field can never be required — the form would refuse to submit with no way to
      // satisfy it, which is the classic way a config screen locks everyone out of a workflow.
      required: visible && requested,
      label: typeof saved.label === 'string' && saved.label.trim() ? saved.label.trim() : undefined,
      helpText:
        typeof saved.helpText === 'string' && saved.helpText.trim() ? saved.helpText.trim() : undefined,
    };
  });
}

function resolveDataControl(stored: unknown): ExpenseDataControl {
  const saved = (stored ?? {}) as Partial<ExpenseDataControl>;
  const presets = EXPENSE_DATE_PRESETS.map(preset => preset.value);
  return {
    defaultDateRange: presets.includes(saved.defaultDateRange as ExpenseDatePreset)
      ? (saved.defaultDateRange as ExpenseDatePreset)
      : DEFAULT_EXPENSE_DATA_CONTROL.defaultDateRange,
    allowEditAfterReception: saved.allowEditAfterReception === true,
    restrictPartyToExisting: saved.restrictPartyToExisting === true,
    highValueThreshold: clampThreshold(saved.highValueThreshold),
    importDuplicateDetection: saved.importDuplicateDetection !== false,
    importRequestNoSource: saved.importRequestNoSource === 'file' ? 'file' : 'generate',
    // Rules added after the first release: a document that predates them reads as the shipped
    // behaviour — GST & TDS shown, no amount cap, no duplicate prompt, statutory figures fixed.
    allowStatutoryEditAfterReception: saved.allowStatutoryEditAfterReception === true,
    gstTdsCapture: saved.gstTdsCapture !== false,
    maxRequestAmount: clampWhole(saved.maxRequestAmount, DEFAULT_EXPENSE_DATA_CONTROL.maxRequestAmount),
    duplicateRequestWarningDays: clampWhole(
      saved.duplicateRequestWarningDays,
      DEFAULT_EXPENSE_DATA_CONTROL.duplicateRequestWarningDays,
    ),
  };
}

/** Everything the module reads, whatever shape the stored document happens to be in. */
export function resolveExpensesSettings(stored: unknown): ExpensesModuleSettings {
  const saved = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const registers = (saved.registers && typeof saved.registers === 'object' ? saved.registers : {}) as Partial<
    Record<ExpenseRegisterId, unknown>
  >;
  const top = resolveStamp(saved);
  const storedStamps = (saved.stamps && typeof saved.stamps === 'object' ? saved.stamps : {}) as Record<string, unknown>;
  const stamps: Partial<Record<ExpenseSettingsPart, ExpenseSettingsStamp>> = {};
  for (const part of ['fieldControl', 'dataControl'] as const) {
    const stamp = resolveStamp(storedStamps[part]);
    if (stamp) stamps[part] = stamp;
  }
  return {
    registers: {
      all: resolveColumnSettings(registers.all, defaultColumns()),
      department: resolveColumnSettings(registers.department, defaultDepartmentColumns()),
    },
    fields: resolveFieldSettings(saved.fields),
    data: resolveDataControl(saved.data),
    updatedAt: top?.updatedAt,
    updatedBy: top?.updatedBy,
    updatedByName: top?.updatedByName,
    stamps,
  };
}

/**
 * Who last changed one part of the settings. A document saved before the parts were stamped
 * separately has only the whole-document stamp, which is the best answer there is for either.
 */
export function settingsStampFor(
  settings: ExpensesModuleSettings,
  part: ExpenseSettingsPart,
): { at?: string; by?: string } {
  const own = settings.stamps?.[part];
  const stamp = own?.updatedAt ? own : settings;
  return { at: stamp.updatedAt, by: stamp.updatedByName || stamp.updatedBy };
}

/* ── editing helpers ─────────────────────────────────────────────────────── */

/** Moves a column one place up or down. Out-of-range moves are a no-op, not a crash. */
export function moveColumn(
  columns: readonly ExpenseColumnSetting[],
  index: number,
  direction: 'up' | 'down',
): ExpenseColumnSetting[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= columns.length || target < 0 || target >= columns.length) {
    return [...columns];
  }
  const next = [...columns];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function setColumnVisibility(
  columns: readonly ExpenseColumnSetting[],
  key: string,
  visible: boolean,
): ExpenseColumnSetting[] {
  return columns.map(column =>
    column.key === key ? { ...column, visible: LOCKED_COLUMNS.includes(key) ? true : visible } : column,
  );
}

export interface ExpenseSettingsIssue {
  severity: 'error' | 'warning';
  message: string;
}

/** What would go wrong if this configuration were saved. Errors block the save; warnings do not. */
export function validateExpensesSettings(settings: ExpensesModuleSettings): ExpenseSettingsIssue[] {
  return [...validateFieldControl(settings), ...validateDataControl(settings.data)];
}

/** The register layouts and form fields — what the Field Control page saves. */
export function validateFieldControl(
  settings: Pick<ExpensesModuleSettings, 'registers' | 'fields'>,
): ExpenseSettingsIssue[] {
  const issues: ExpenseSettingsIssue[] = [];

  for (const register of EXPENSE_REGISTERS) {
    const columns = settings.registers[register.id] ?? [];
    const visible = columns.filter(column => column.visible);
    if (visible.length < 2) {
      issues.push({
        severity: 'error',
        message: `${register.label} needs at least two visible columns.`,
      });
    }
    for (const locked of LOCKED_COLUMNS) {
      if (!columns.find(column => column.key === locked)?.visible) {
        issues.push({ severity: 'error', message: `${register.label} must show "${locked}".` });
      }
    }
    if (visible.length > 8) {
      issues.push({
        severity: 'warning',
        message: `${register.label} shows ${visible.length} columns — it will scroll sideways on a laptop.`,
      });
    }
  }

  for (const field of settings.fields) {
    const definition = EXPENSE_FORM_FIELDS.find(entry => entry.key === field.key);
    if (!definition) continue;
    if (definition.locked && (!field.visible || !field.required)) {
      issues.push({ severity: 'error', message: `"${definition.label}" cannot be hidden or made optional.` });
    }
    if (!field.visible && field.required) {
      issues.push({ severity: 'error', message: `"${definition.label}" is hidden but still required.` });
    }
    if (!field.visible) {
      issues.push({
        severity: 'warning',
        message: `"${definition.label}" is hidden — new requests will be saved without it.`,
      });
    }
  }

  return issues;
}

/** The longest look-back the duplicate-request check accepts. */
export const MAX_DUPLICATE_WARNING_DAYS = 365;

/** The module's data rules — what the Data Control page saves. */
export function validateDataControl(data: ExpenseDataControl): ExpenseSettingsIssue[] {
  const issues: ExpenseSettingsIssue[] = [];
  const whole = (value: number) => Number.isFinite(value) && value >= 0 && Math.round(value) === value;

  if (!whole(data.highValueThreshold)) {
    issues.push({ severity: 'error', message: 'The high-value threshold must be a whole number of rupees, zero or more.' });
  } else if (data.highValueThreshold <= 0) {
    issues.push({ severity: 'warning', message: 'A high-value threshold of zero flags every request.' });
  }
  if (!whole(data.maxRequestAmount)) {
    issues.push({ severity: 'error', message: 'The largest request amount must be a whole number of rupees (0 for no limit).' });
  } else if (data.maxRequestAmount > 0 && data.highValueThreshold > 0 && data.maxRequestAmount < data.highValueThreshold) {
    issues.push({
      severity: 'warning',
      message: 'The largest request amount is below the high-value threshold — the High Value report will never flag anything.',
    });
  }
  if (!whole(data.duplicateRequestWarningDays)) {
    issues.push({ severity: 'error', message: 'The duplicate-request window must be a whole number of days (0 to turn it off).' });
  } else if (data.duplicateRequestWarningDays > MAX_DUPLICATE_WARNING_DAYS) {
    issues.push({
      severity: 'error',
      message: `The duplicate-request window cannot be more than ${MAX_DUPLICATE_WARNING_DAYS} days.`,
    });
  }
  if (data.allowEditAfterReception) {
    issues.push({
      severity: 'warning',
      message: 'Requests stay editable after a reception number is recorded.',
    });
  }
  if (data.allowStatutoryEditAfterReception && !data.allowEditAfterReception) {
    issues.push({
      severity: 'warning',
      message: 'GST & TDS editing after reception has no effect while editing after reception is off.',
    });
  }
  if (!data.importDuplicateDetection) {
    issues.push({ severity: 'warning', message: 'Imports will not skip rows that repeat an existing request.' });
  }

  return issues;
}

export const hasBlockingIssue = (issues: readonly ExpenseSettingsIssue[]): boolean =>
  issues.some(issue => issue.severity === 'error');

/* ── consumption ─────────────────────────────────────────────────────────── */

/**
 * The order and visibility a register should actually render with.
 *
 * The organisation layout is the base; a user's own saved preference overrides it where one
 * exists, so configuring the module never silently undoes an arrangement somebody relies on.
 */
export function applyColumnSettings(
  configured: readonly ExpenseColumnSetting[],
  personal?: { order?: string[]; visibility?: Record<string, boolean> } | null,
): { order: string[]; visibility: Record<string, boolean> } {
  const order = configured.map(column => column.key);
  const visibility: Record<string, boolean> = {};
  configured.forEach(column => {
    visibility[column.key] = column.visible;
  });

  if (personal?.order?.length) {
    const known = new Set(order);
    const personalOrder = personal.order.filter(key => known.has(key));
    order.splice(0, order.length, ...personalOrder, ...order.filter(key => !personalOrder.includes(key)));
  }
  if (personal?.visibility) {
    for (const [key, value] of Object.entries(personal.visibility)) {
      if (key in visibility) visibility[key] = LOCKED_COLUMNS.includes(key) ? true : value !== false;
    }
  }

  return { order, visibility };
}

/** Turns the configured default period into a concrete range. `all` means no range at all. */
export function resolveDatePreset(
  preset: ExpenseDatePreset,
  today: Date = new Date(),
): { from: Date; to: Date } | undefined {
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const endOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

  switch (preset) {
    case 'today':
      return { from: startOfDay(today), to: endOfDay(today) };
    case 'this-week': {
      // Weeks run Monday to Sunday, which is how the site reports its work.
      const day = (today.getDay() + 6) % 7;
      const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - day);
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
    case 'all':
    default:
      return undefined;
  }
}

/** The label and required-ness the form should use for a field. */
export function resolveFormField(
  settings: ExpensesModuleSettings,
  key: ExpenseFieldKey,
): { visible: boolean; required: boolean; label: string; helpText?: string } {
  const definition = EXPENSE_FORM_FIELDS.find(entry => entry.key === key);
  const setting = settings.fields.find(entry => entry.key === key);
  return {
    visible: setting?.visible !== false,
    required: setting?.required === true,
    label: setting?.label || definition?.label || key,
    helpText: setting?.helpText,
  };
}

/* ── saving one part ─────────────────────────────────────────────────────── */

/**
 * The Field Control part of the document, ready to write: register layouts and form fields, with
 * blank labels and help text left out rather than written as `undefined` (which Firestore
 * refuses). Written with `merge`, so it never touches the data rules.
 */
export function fieldControlPayload(
  settings: Pick<ExpensesModuleSettings, 'registers' | 'fields'>,
): Pick<ExpensesModuleSettings, 'registers' | 'fields'> {
  const columns = (list: readonly ExpenseColumnSetting[]) =>
    list.map(column => ({ key: column.key, visible: column.visible === true }));
  return {
    registers: { all: columns(settings.registers.all), department: columns(settings.registers.department) },
    fields: settings.fields.map(field => {
      const entry: ExpenseFieldSetting = { key: field.key, visible: field.visible, required: field.visible && field.required };
      const label = text(field.label);
      const helpText = text(field.helpText);
      if (label) entry.label = label;
      if (helpText) entry.helpText = helpText;
      return entry;
    }),
  };
}

/** The Data Control part of the document, ready to write — every rule, nothing else. */
export function dataControlPayload(data: ExpenseDataControl): ExpenseDataControl {
  return resolveDataControl(data);
}

/* ── describing a change ─────────────────────────────────────────────────── */

/** Readable names for the data rules, as they appear in the activity log. */
export const DATA_CONTROL_LABELS: Record<keyof ExpenseDataControl, string> = {
  defaultDateRange: 'Registers open on',
  highValueThreshold: 'High-value threshold (₹)',
  allowEditAfterReception: 'Allow editing after reception',
  allowStatutoryEditAfterReception: 'Allow GST & TDS editing after reception',
  restrictPartyToExisting: 'Restrict parties to existing names',
  gstTdsCapture: 'Capture GST & TDS on new requests',
  maxRequestAmount: 'Largest request amount (₹, 0 = no limit)',
  duplicateRequestWarningDays: 'Duplicate request warning (days, 0 = off)',
  importDuplicateDetection: 'Detect duplicates on import',
  importRequestNoSource: 'Imports take request numbers from',
};

/**
 * The Field Control part flattened to one readable key per setting — "Name of the Party ·
 * required" — so a shallow before/after diff of two of these reads as a list of edits.
 */
export function flattenFieldControl(
  settings: Pick<ExpensesModuleSettings, 'registers' | 'fields'>,
): Record<string, string | boolean> {
  const flat: Record<string, string | boolean> = {};
  for (const definition of EXPENSE_FORM_FIELDS) {
    const field = settings.fields.find(entry => entry.key === definition.key);
    if (!field) continue;
    flat[`${definition.label} · shown`] = field.visible;
    flat[`${definition.label} · required`] = field.required;
    flat[`${definition.label} · label`] = text(field.label) ?? '';
    flat[`${definition.label} · help text`] = text(field.helpText) ?? '';
  }
  for (const register of EXPENSE_REGISTERS) {
    const columns = settings.registers[register.id] ?? [];
    flat[`${register.label} · column order`] = columns.map(column => column.key).join(' › ');
    for (const column of columns) flat[`${register.label} · ${column.key} shown`] = column.visible;
  }
  return flat;
}

/** The data rules under their readable names, for the same kind of diff. */
export function flattenDataControl(data: ExpenseDataControl): Record<string, string | number | boolean> {
  const flat: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(DATA_CONTROL_LABELS) as (keyof ExpenseDataControl)[]) {
    flat[DATA_CONTROL_LABELS[key]] = data[key];
  }
  return flat;
}

/* ── New Request rules ───────────────────────────────────────────────────── */

/** Why an amount may not be requested, or undefined when it may. */
export function requestAmountError(amount: number, data: Pick<ExpenseDataControl, 'maxRequestAmount'>): string | undefined {
  const limit = data.maxRequestAmount;
  if (!(limit > 0) || !(amount > limit)) return undefined;
  return `A single request cannot be more than ₹${limit.toLocaleString('en-IN')}. Split it, or ask an administrator to raise the limit in Expenses › Settings › Data Control.`;
}

export interface DuplicateCandidate {
  requestNo?: string;
  partyName?: string;
  amount?: unknown;
  createdAt?: unknown;
}

/**
 * The most recent request to the same party for the same amount raised within `days` of `now`,
 * or undefined. Party names compare without regard to case or spacing; amounts to the paisa.
 * `days` of 0 (or less) turns the check off. A request with no readable date is not counted —
 * the check is a nudge, and a false alarm on an undated legacy row would only teach people to
 * click through it.
 */
export function findDuplicateRequest<T extends DuplicateCandidate>(
  existing: readonly T[],
  draft: { partyName?: string; amount: number },
  days: number,
  now: Date = new Date(),
): T | undefined {
  if (!(days > 0)) return undefined;
  const key = (name: unknown) => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const party = key(draft.partyName);
  const paise = Math.round(Number(draft.amount) * 100);
  if (!party || !Number.isFinite(paise) || paise <= 0) return undefined;
  const since = now.getTime() - days * 24 * 60 * 60 * 1000;

  let match: T | undefined;
  let matchTime = -Infinity;
  for (const candidate of existing) {
    if (key(candidate.partyName) !== party) continue;
    if (Math.round(Number(candidate.amount) * 100) !== paise) continue;
    const stamp = toIsoStamp(candidate.createdAt);
    const time = stamp ? new Date(stamp).getTime() : NaN;
    if (!Number.isFinite(time) || time < since || time > now.getTime() + 60_000) continue;
    if (time > matchTime) {
      match = candidate;
      matchTime = time;
    }
  }
  return match;
}
