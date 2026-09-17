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
}

/* ── the whole settings document ─────────────────────────────────────────── */

export interface ExpensesModuleSettings {
  registers: Record<ExpenseRegisterId, ExpenseColumnSetting[]>;
  fields: ExpenseFieldSetting[];
  data: ExpenseDataControl;
  updatedAt?: string;
  updatedBy?: string;
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
  };
}

/** Everything the module reads, whatever shape the stored document happens to be in. */
export function resolveExpensesSettings(stored: unknown): ExpensesModuleSettings {
  const saved = (stored ?? {}) as Partial<ExpensesModuleSettings>;
  const registers = (saved.registers ?? {}) as Partial<Record<ExpenseRegisterId, unknown>>;
  return {
    registers: {
      all: resolveColumnSettings(registers.all, defaultColumns()),
      department: resolveColumnSettings(registers.department, defaultDepartmentColumns()),
    },
    fields: resolveFieldSettings(saved.fields),
    data: resolveDataControl(saved.data),
    updatedAt: typeof saved.updatedAt === 'string' ? saved.updatedAt : undefined,
    updatedBy: typeof saved.updatedBy === 'string' ? saved.updatedBy : undefined,
  };
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

  if (settings.data.highValueThreshold <= 0) {
    issues.push({ severity: 'warning', message: 'A high-value threshold of zero flags every request.' });
  }
  if (settings.data.allowEditAfterReception) {
    issues.push({
      severity: 'warning',
      message: 'Requests stay editable after a reception number is recorded.',
    });
  }
  if (!settings.data.importDuplicateDetection) {
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
