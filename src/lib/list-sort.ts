/**
 * Configurable list sorting, independent of any one module.
 *
 * A module declares a registry — for each list, the columns that can be sorted and the order the
 * list opens in — and an administrator overrides that opening order from the module's Field
 * Control page. These functions resolve the override against the registry and order the rows.
 *
 * The same rules as Site Account Statement's sort registry (which predates this and keeps its own
 * copy): stored overrides are validated against the registry, blanks always sink to the bottom,
 * text compares with locale collation, and the input array is never mutated.
 *
 * Deliberately importless, so `node --test` can load it and exercise the comparator directly.
 */

export type SortDirection = 'asc' | 'desc';
export type SortType = 'text' | 'number' | 'date';

export interface SortField {
  key: string;
  label: string;
  type: SortType;
}

export interface SortSetting {
  field: string;
  direction: SortDirection;
}

export interface ListSortDef {
  title: string;
  description: string;
  fields: SortField[];
  /** Where the list opens when an administrator has not chosen otherwise. */
  defaultSort: SortSetting;
}

export type ListSortRegistry<K extends string> = Record<K, ListSortDef>;

/** What an administrator has stored, keyed by list. Any entry may be missing or stale. */
export type SortControlDoc<K extends string> = Partial<Record<K, Partial<SortSetting>>>;

/**
 * The opening sort for a list: the stored override if it still names a real column, else the
 * registry default. A stored field outlives the column it named, so it is checked, not trusted.
 */
export function resolveListSort<K extends string>(
  registry: ListSortRegistry<K>,
  listKey: K,
  stored: SortControlDoc<K> | undefined | null,
): SortSetting {
  const list = registry[listKey];
  const override = stored?.[listKey];
  const field = list.fields.some((f) => f.key === override?.field) ? override!.field! : list.defaultSort.field;
  const direction: SortDirection = override?.direction === 'asc' || override?.direction === 'desc'
    ? override.direction
    : list.defaultSort.direction;
  return { field, direction };
}

/** Wording for a direction that suits the column — "A to Z" on an amount column reads as nonsense. */
export function sortDirectionLabel(type: SortType, direction: SortDirection): string {
  if (type === 'number') return direction === 'asc' ? 'Smallest first' : 'Largest first';
  if (type === 'date') return direction === 'asc' ? 'Oldest first' : 'Newest first';
  return direction === 'asc' ? 'A to Z' : 'Z to A';
}

/** Firestore timestamps, Date objects and date strings all have to compare against each other. */
function toComparableDate(value: unknown): number {
  if (value == null) return NaN;
  if (typeof value === 'string') {
    // `YYYY-MM-DD` read as a local date, not UTC midnight — the order is the same either way, but
    // the value is then consistent with every other date this app parses.
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime();
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? NaN : parsed;
  }
  if (value instanceof Date) return value.getTime();
  const candidate = value as { toDate?: () => Date; seconds?: number };
  if (typeof candidate.toDate === 'function') return candidate.toDate().getTime();
  if (typeof candidate.seconds === 'number') return candidate.seconds * 1000;
  return NaN;
}

const isBlank = (value: unknown) =>
  value == null || value === '' || (typeof value === 'number' && Number.isNaN(value));

/**
 * Compares two rows on one column. Blanks sink to the bottom in both directions — floating them to
 * the top of a descending sort would bury the rows someone is looking for under every record that
 * happens to lack a value.
 */
export function compareRows(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  field: SortField,
  direction: SortDirection,
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

/** A new array in the given order; rows are never mutated. Unknown columns leave the order alone. */
export function sortListRows<K extends string, T>(
  registry: ListSortRegistry<K>,
  rows: T[],
  listKey: K,
  sort: SortSetting,
): T[] {
  const field = registry[listKey].fields.find((f) => f.key === sort.field);
  if (!field) return rows;
  // Domain interfaces have no index signature, so the rows are read through a cast; the
  // comparator only ever reads the one declared key.
  return [...rows].sort((a, b) =>
    compareRows(a as Record<string, unknown>, b as Record<string, unknown>, field, sort.direction));
}
