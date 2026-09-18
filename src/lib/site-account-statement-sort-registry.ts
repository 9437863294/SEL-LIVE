/**
 * Sort registry for the Site Account Statement module.
 *
 * Every listing screen declares which of its columns can be sorted and what order it opens in.
 * An administrator overrides the opening order per list from Settings → Field Control → Sort Order,
 * and a user can re-sort within their own session without changing anyone else's default.
 *
 * Deliberately importless, like the date policy: a module with no imports can be loaded straight by
 * `node --test`, so the comparator — the part with real edge cases — is exercised directly.
 *
 * Not covered here, by design: Category Analysis and Day-wise Statement. Those are a tree and a
 * chronological ledger respectively, where row order carries meaning; re-sorting them would not
 * produce a different view of the same data, it would destroy the view.
 */

export type SASListKey =
  | 'expenses'
  | 'payments'
  | 'reportExpenses'
  | 'reportReceipts'
  | 'reportBalance'
  | 'reportSummary';

export type SASSortDirection = 'asc' | 'desc';

/**
 * How a column's values compare.
 *
 * `text` is compared case-insensitively with locale collation, so "Ådne" and "Zoe" land where a
 * reader expects rather than where their code points fall. `number` and `date` compare naturally —
 * dates are `YYYY-MM-DD` strings, which sort correctly as text, but are typed separately so the
 * blank handling below can tell "no date" from "empty name".
 */
export type SASSortType = 'text' | 'number' | 'date';

export interface SASSortField {
  key: string;
  label: string;
  type: SASSortType;
}

export interface SASSortSetting {
  field: string;
  direction: SASSortDirection;
}

export interface SASListDef {
  title: string;
  description: string;
  fields: SASSortField[];
  /** Where the list opens when an administrator has not chosen otherwise. */
  defaultSort: SASSortSetting;
}

export const SAS_LIST_REGISTRY: Record<SASListKey, SASListDef> = {
  expenses: {
    title: 'Site Expenses',
    description: 'The main expense list.',
    fields: [
      { key: 'expenseDate',        label: 'Expense Date',      type: 'date'   },
      { key: 'expenseAmount',      label: 'Amount',            type: 'number' },
      { key: 'projectName',        label: 'Project',           type: 'text'   },
      { key: 'expenseCategory',    label: 'Main Category',     type: 'text'   },
      { key: 'expenseSubCategory', label: 'Sub-Category',      type: 'text'   },
      { key: 'expensedBy',         label: 'Expensed By',       type: 'text'   },
      { key: 'paymentMode',        label: 'Payment Mode',      type: 'text'   },
      { key: 'vendorPartyName',    label: 'Vendor / Party',    type: 'text'   },
      { key: 'billNo',             label: 'Bill No.',          type: 'text'   },
      { key: 'createdAt',          label: 'Recorded At',       type: 'date'   },
    ],
    defaultSort: { field: 'expenseDate', direction: 'desc' },
  },
  payments: {
    title: 'Payments Received',
    description: 'The main receipt list.',
    fields: [
      { key: 'receiptDate',    label: 'Receipt Date',  type: 'date'   },
      { key: 'receivedAmount', label: 'Amount',        type: 'number' },
      { key: 'projectName',    label: 'Project',       type: 'text'   },
      { key: 'paymentMode',    label: 'Payment Mode',  type: 'text'   },
      { key: 'referenceNo',    label: 'Reference No.', type: 'text'   },
      { key: 'receivedBy',     label: 'Received By',   type: 'text'   },
      { key: 'createdAt',      label: 'Recorded At',   type: 'date'   },
    ],
    defaultSort: { field: 'receiptDate', direction: 'desc' },
  },
  reportExpenses: {
    title: 'Expense Report',
    description: 'The expense report table.',
    fields: [
      { key: 'expenseDate',     label: 'Expense Date',   type: 'date'   },
      { key: 'expenseAmount',   label: 'Amount',         type: 'number' },
      { key: 'projectName',     label: 'Project',        type: 'text'   },
      { key: 'expenseCategory', label: 'Main Category',  type: 'text'   },
      { key: 'expensedBy',      label: 'Expensed By',    type: 'text'   },
      { key: 'vendorPartyName', label: 'Vendor / Party', type: 'text'   },
    ],
    defaultSort: { field: 'expenseDate', direction: 'desc' },
  },
  reportReceipts: {
    title: 'Receipt Report',
    description: 'The receipt report table.',
    fields: [
      { key: 'receiptDate',    label: 'Receipt Date',  type: 'date'   },
      { key: 'receivedAmount', label: 'Amount',        type: 'number' },
      { key: 'projectName',    label: 'Project',       type: 'text'   },
      { key: 'paymentMode',    label: 'Payment Mode',  type: 'text'   },
      { key: 'referenceNo',    label: 'Reference No.', type: 'text'   },
    ],
    defaultSort: { field: 'receiptDate', direction: 'desc' },
  },
  reportBalance: {
    title: 'Balance Status',
    description: 'The per-project balance table.',
    fields: [
      { key: 'name',           label: 'Project',         type: 'text'   },
      { key: 'code',           label: 'Project Code',    type: 'text'   },
      { key: 'assignedPerson', label: 'Assigned Person', type: 'text'   },
      { key: 'received',       label: 'Received',        type: 'number' },
      { key: 'spent',          label: 'Spent',           type: 'number' },
      { key: 'balance',        label: 'Balance',         type: 'number' },
      { key: 'totalBudget',    label: 'Total Budget',    type: 'number' },
      { key: 'budgetUsedPct',  label: '% Used',          type: 'number' },
    ],
    defaultSort: { field: 'name', direction: 'asc' },
  },
  reportSummary: {
    title: 'Project Summary',
    description: 'The project summary table.',
    fields: [
      { key: 'name',            label: 'Project',          type: 'text'   },
      { key: 'openingBalance',  label: 'Opening Balance',  type: 'number' },
      { key: 'totalReceived',   label: 'Received',         type: 'number' },
      { key: 'totalExpenses',   label: 'Expenses',         type: 'number' },
      { key: 'closingBalance',  label: 'Closing Balance',  type: 'number' },
      { key: 'totalBudget',     label: 'Total Budget',     type: 'number' },
      { key: 'budgetUsedPct',   label: '% Used',           type: 'number' },
      { key: 'budgetRemaining', label: 'Budget Remaining', type: 'number' },
    ],
    defaultSort: { field: 'name', direction: 'asc' },
  },
};

export const SAS_LIST_KEYS = Object.keys(SAS_LIST_REGISTRY) as SASListKey[];

/** What an administrator has stored, keyed by list. Any shape may be missing or stale. */
export type SASSortControlDoc = Partial<Record<SASListKey, Partial<SASSortSetting>>>;

/**
 * The opening sort for a list: the stored override if it still names a real column, else the
 * registry default.
 *
 * Validating against the registry matters because a stored field outlives the column it named —
 * rename or drop a sortable column and every saved setting pointing at it would otherwise sort by
 * a property that no longer exists, silently producing arbitrary order.
 */
export function resolveSort(listKey: SASListKey, stored: SASSortControlDoc | undefined | null): SASSortSetting {
  const list = SAS_LIST_REGISTRY[listKey];
  const override = stored?.[listKey];
  const field = list.fields.some(f => f.key === override?.field) ? override!.field! : list.defaultSort.field;
  const direction: SASSortDirection = override?.direction === 'asc' || override?.direction === 'desc'
    ? override.direction
    : list.defaultSort.direction;
  return { field, direction };
}

/** The column definition behind a sort, or null when the key is not sortable on that list. */
export function sortFieldDef(listKey: SASListKey, field: string): SASSortField | null {
  return SAS_LIST_REGISTRY[listKey].fields.find(f => f.key === field) ?? null;
}

/** True when a sort matches the registry default — used to decide whether a list needs re-ordering. */
export function isDefaultSort(listKey: SASListKey, sort: SASSortSetting): boolean {
  const fallback = SAS_LIST_REGISTRY[listKey].defaultSort;
  return sort.field === fallback.field && sort.direction === fallback.direction;
}

/** Firestore timestamps, Date objects and date strings all have to compare against each other. */
function toComparableDate(value: unknown): number {
  if (value == null) return NaN;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? NaN : parsed;
  }
  if (value instanceof Date) return value.getTime();
  const candidate = value as { toDate?: () => Date; seconds?: number };
  if (typeof candidate.toDate === 'function') return candidate.toDate().getTime();
  if (typeof candidate.seconds === 'number') return candidate.seconds * 1000;
  return NaN;
}

function isBlank(value: unknown): boolean {
  return value == null || value === '' || (typeof value === 'number' && Number.isNaN(value));
}

/**
 * Compares two rows on one column.
 *
 * Blanks always sink to the bottom regardless of direction. Floating them to the top on a
 * descending sort would bury the rows someone is actually looking for under every record that
 * happens to be missing a vendor name.
 */
export function compareBy(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  field: SASSortField,
  direction: SASSortDirection,
): number {
  const a = left[field.key];
  const b = right[field.key];

  const aBlank = isBlank(a);
  const bBlank = isBlank(b);
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;

  let result: number;
  if (field.type === 'number') {
    result = Number(a) - Number(b);
  } else if (field.type === 'date') {
    const aTime = toComparableDate(a);
    const bTime = toComparableDate(b);
    // An unparseable date is as good as blank — push it down rather than ordering on NaN.
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
    if (Number.isNaN(aTime)) return 1;
    if (Number.isNaN(bTime)) return -1;
    result = aTime - bTime;
  } else {
    result = String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
  }

  if (result === 0) return 0;
  return direction === 'asc' ? result : -result;
}

/**
 * Returns a new array ordered by the given sort. The input is never mutated — these arrays come
 * from `useMemo` results that React assumes are stable.
 */
export function sortRows<T>(rows: T[], listKey: SASListKey, sort: SASSortSetting): T[] {
  const field = sortFieldDef(listKey, sort.field);
  if (!field) return rows;
  // Rows arrive as domain interfaces (SASExpense and friends). TypeScript does not give an
  // interface an implicit index signature, so constraining T to Record<string, unknown> would
  // reject every real caller. The comparator only ever reads one declared key, so the cast is
  // narrower in practice than the constraint would have been.
  return [...rows].sort((a, b) =>
    compareBy(a as Record<string, unknown>, b as Record<string, unknown>, field, sort.direction));
}
