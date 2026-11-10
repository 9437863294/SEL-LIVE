'use client';

/**
 * The Entry Sheet's parts (entry-sheet.module.css): KPI cards, stage tabs, the filter bar's search,
 * pill selects, chips and density switch, the selection bar, the register with its pinned header,
 * totals and identity columns, phone cards, and a numbered pager.
 *
 * Presentational only — the page owns the entries, the filters, the permissions and Field Control's
 * columns, and hands these components what to show and what to call.
 */

import type { ButtonHTMLAttributes, MouseEvent, ReactNode, RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, List, Rows4, Search, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import type { StatusTone } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';
import styles from './entry-sheet.module.css';

export { styles as es };

/* ── KPI cards ────────────────────────────────────────────────────────────────────────────────── */

export type KpiTone = 'primary' | 'blue' | 'green' | 'orange' | 'violet';

const KPI_TONE: Record<KpiTone, string> = {
  primary: styles.tonePrimary,
  blue: styles.toneBlue,
  green: styles.toneGreen,
  orange: styles.toneOrange,
  violet: styles.toneViolet,
};

/**
 * One figure: its label and icon, the value, a line under it, and optionally a bar (0–100). With
 * `onClick` the whole card is a button, and `action` reads at the end of its line ("Receive →").
 */
export function Kpi({
  tone,
  icon: Icon,
  label,
  value,
  valueTitle,
  sub,
  progress,
  colourValue,
  onClick,
  action,
}: {
  tone: KpiTone;
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  /** The exact figure, where `value` is a compact one. */
  valueTitle?: string;
  sub: ReactNode;
  progress?: number;
  /** The value in the card's colour (a balance still due). */
  colourValue?: boolean;
  onClick?: () => void;
  action?: string;
}) {
  const body = (
    <>
      <span className={styles.kpiLabel}>
        <span className={styles.kpiIcon} aria-hidden="true">
          <Icon />
        </span>
        {label}
      </span>
      <span className={cn(styles.kpiValue, colourValue && styles.kpiValueTone)} title={valueTitle}>
        {value}
      </span>
      <span className={styles.kpiSub}>
        {sub}
        {action ? <span className={styles.kpiMore}>{action}</span> : null}
      </span>
      {progress !== undefined ? (
        <span className={styles.kpiBar} aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </span>
      ) : null}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(styles.kpi, styles.kpiLink, KPI_TONE[tone])}>
      {body}
    </button>
  ) : (
    <div className={cn(styles.kpi, KPI_TONE[tone])}>{body}</div>
  );
}

/* ── Stage tabs ───────────────────────────────────────────────────────────────────────────────── */

/** A stage's dot, in its status-badge tone. */
export const TONE_DOT: Record<StatusTone, string> = {
  neutral: '#94a3b8',
  info: '#0ea5e9',
  progress: '#8b5cf6',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#f43f5e',
};

export interface StageTab {
  value: string;
  label: string;
  tone: StatusTone;
  count: number;
}

/** "All entries" and one tab per stage, each with how many of the filtered entries are at it. */
export function StageTabs({ value, onChange, total, stages }: { value: string; onChange: (value: string) => void; total: number; stages: StageTab[] }) {
  return (
    <div className={styles.tabs} role="group" aria-label="Show entries at a stage">
      <button type="button" className={styles.tab} aria-pressed={!value} onClick={() => onChange('')}>
        All entries
        <span className={styles.tabCount}>{total.toLocaleString('en-IN')}</span>
      </button>
      <span className={styles.tabSep} aria-hidden="true" />
      {stages.map((stage) => (
        <button
          key={stage.value}
          type="button"
          className={cn(styles.tab, !stage.count && value !== stage.value && styles.tabQuiet)}
          aria-pressed={value === stage.value}
          onClick={() => onChange(value === stage.value ? '' : stage.value)}
        >
          <span className={styles.tabDot} style={{ background: TONE_DOT[stage.tone] }} aria-hidden="true" />
          {stage.label}
          <span className={styles.tabCount}>{stage.count.toLocaleString('en-IN')}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Filter bar ───────────────────────────────────────────────────────────────────────────────── */

/** The register's search. Shows "/" — the key that jumps here — until it has focus. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className={styles.search}>
      <Search aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className={styles.searchInput}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.stopPropagation();
            onChange('');
          }
        }}
      />
      {value ? (
        <button type="button" className={styles.searchClear} onClick={() => onChange('')} aria-label="Clear search">
          <X />
        </button>
      ) : (
        <kbd className={styles.searchKey} aria-hidden="true">
          /
        </kbd>
      )}
    </div>
  );
}

/** A filter as a pill reading "Project: All projects", with the native picker laid over it. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  allLabel: string;
}) {
  const current = options.find((option) => option.value === value)?.label ?? allLabel;
  return (
    <label className={cn(styles.sel, value && styles.selActive)} title={`${label}: ${current}`}>
      {label}:<b>{current}</b>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A filter bar button (More filters, Columns), with a count when something behind it is set. */
export function ToolbarButton({
  icon: Icon,
  children,
  count,
  className,
  ...props
}: { icon: LucideIcon; count?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cn(styles.tbtn, className)} {...props}>
      <Icon aria-hidden="true" />
      {children}
      {count ? <span className={styles.count}>{count}</span> : null}
    </button>
  );
}

export type Density = 'comfortable' | 'compact';

export function DensityToggle({ value, onChange }: { value: Density; onChange: (value: Density) => void }) {
  return (
    <div className={cn(styles.seg, styles.desktopOnly)} role="group" aria-label="Row height">
      <button type="button" aria-pressed={value === 'comfortable'} onClick={() => onChange('comfortable')} title="Comfortable rows">
        <List aria-hidden="true" />
      </button>
      <button type="button" aria-pressed={value === 'compact'} onClick={() => onChange('compact')} title="Compact rows">
        <Rows4 aria-hidden="true" />
      </button>
    </div>
  );
}

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/** Every filter in force, each removable; "Clear all" once there are two or more. */
export function FilterChips({ chips, onClearAll }: { chips: FilterChip[]; onClearAll: () => void }) {
  if (!chips.length) return null;
  return (
    <div className={styles.chips}>
      {chips.map((chip) => (
        <span key={chip.key} className={styles.chip}>
          <span title={chip.label}>{chip.label}</span>
          <button type="button" onClick={chip.onRemove} aria-label={`Remove filter: ${chip.label}`}>
            <X aria-hidden="true" />
          </button>
        </span>
      ))}
      {chips.length > 1 ? (
        <button type="button" className={styles.chipClear} onClick={onClearAll}>
          Clear all
        </button>
      ) : null}
    </div>
  );
}

/* ── Selection bar ────────────────────────────────────────────────────────────────────────────── */

export function BulkBar({ count, amount, children }: { count: number; amount: string; children: ReactNode }) {
  return (
    <div className={styles.bulk} role="region" aria-label="Selected entries">
      <span>
        <b>{count.toLocaleString('en-IN')}</b> selected · <span className="tabular-nums">{amount}</span>
      </span>
      <span className={styles.bulkSpacer} />
      {children}
    </div>
  );
}

export function BulkButton({ icon: Icon, children, ...props }: { icon: LucideIcon } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={styles.bulkBtn} {...props}>
      <Icon aria-hidden="true" />
      {children}
    </button>
  );
}

/* ── Cells ────────────────────────────────────────────────────────────────────────────────────── */

/** A day and, under it, the time. */
export function TwoLineDate({ date, time }: { date: string; time?: string }) {
  if (!date) return <span className={styles.zero}>—</span>;
  return (
    <span className={styles.date2}>
      <span className={styles.strong}>{date}</span>
      {time ? <small>{time}</small> : null}
    </span>
  );
}

export function RowAction({
  icon: Icon,
  label,
  danger,
  reason,
  ...props
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  /** Why it is not allowed — shown on hover, the button disabled. */
  reason?: string | null;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const button = (
    <button
      {...props}
      type="button"
      className={cn(styles.act, danger && styles.actDanger)}
      aria-label={reason ? `${label} — ${reason}` : label}
      title={reason ? undefined : label}
      disabled={Boolean(reason) || props.disabled}
    >
      <Icon aria-hidden="true" />
    </button>
  );
  // A disabled button takes no pointer events, so the reason sits on a wrapper.
  return reason ? <span title={reason}>{button}</span> : button;
}

/* ── The register ─────────────────────────────────────────────────────────────────────────────── */

export interface RegisterColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'right';
  /** What a click on the header sorts by; omitted, the column does not sort. */
  sortKey?: string;
  /** Kept in view while the register scrolls sideways — the identity column. */
  pin?: boolean;
  /** This column's figure in the totals row. */
  total?: ReactNode;
  className?: string;
}

/**
 * True for a click on the row itself. React bubbles clicks from portals (a dialog a row opened)
 * through the row, so only clicks inside its own DOM count, and never ones on its controls.
 */
function isRowOwnClick(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement;
  if (!event.currentTarget.contains(target)) return false;
  if (target.closest('a, button, input, label, select, textarea, [role="checkbox"], [role="menuitem"]')) return false;
  return !window.getSelection()?.toString();
}

export function Register<T extends { id: string }>({
  rows,
  columns,
  sort,
  onSort,
  selectable,
  selected,
  onSelectedChange,
  onRowClick,
  rowTone,
  totalLabel,
  card,
  empty,
}: {
  rows: T[];
  columns: RegisterColumn<T>[];
  sort: { key: string; dir: 'asc' | 'desc' };
  onSort: (key: string) => void;
  selectable?: boolean;
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  onRowClick: (row: T) => void;
  rowTone?: (row: T) => 'high' | undefined;
  /** The totals row's first cell; omitted, there is no totals row. */
  totalLabel?: ReactNode;
  /** A phone card's content; `select` is its tick box when rows can be ticked. */
  card: (row: T, select: ReactNode) => ReactNode;
  empty: ReactNode;
}) {
  if (!rows.length) return <>{empty}</>;

  const allTicked = rows.every((row) => selected.has(row.id));
  const someTicked = !allTicked && rows.some((row) => selected.has(row.id));
  const toggleAll = () => {
    const next = new Set(selected);
    rows.forEach((row) => (allTicked ? next.delete(row.id) : next.add(row.id)));
    onSelectedChange(next);
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };
  const tickBox = (row: T, label: string) => (
    <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggle(row.id)} aria-label={label} />
  );

  return (
    <>
      <div className={styles.scroll}>
        <table className={styles.table} style={{ ['--es-pin-left' as string]: selectable ? '44px' : '0px' }}>
          <thead>
            <tr>
              {selectable ? (
                <th className={styles.ck} scope="col">
                  <Checkbox
                    checked={allTicked ? true : someTicked ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select every entry on this page"
                  />
                </th>
              ) : null}
              {columns.map((column) => {
                const active = column.sortKey !== undefined && sort.key === column.sortKey;
                const SortIcon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(column.align === 'right' && styles.right, column.pin && styles.pin)}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {column.sortKey ? (
                      <button type="button" className={styles.sortBtn} onClick={() => onSort(column.sortKey as string)}>
                        {column.header}
                        <SortIcon aria-hidden="true" />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const ticked = selected.has(row.id);
              return (
                <tr
                  key={row.id}
                  className={cn(ticked ? styles.rowPicked : rowTone?.(row) === 'high' && styles.rowHigh)}
                  onClick={(event) => {
                    if (isRowOwnClick(event)) onRowClick(row);
                  }}
                >
                  {selectable ? <td className={styles.ck}>{tickBox(row, 'Select this entry')}</td> : null}
                  {columns.map((column) => (
                    <td key={column.key} className={cn(column.align === 'right' && styles.right, column.pin && styles.pin, column.className)}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {totalLabel !== undefined ? (
            <tfoot>
              <tr>
                {selectable ? <td className={styles.ck} /> : null}
                {columns.map((column, index) => (
                  <td key={column.key} className={cn(column.align === 'right' && styles.right, column.pin && styles.pin)}>
                    {column.total ?? (index === 0 ? totalLabel : null)}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <div className={styles.cards}>
        {rows.map((row) => (
          <div
            key={row.id}
            className={cn(styles.card, selected.has(row.id) ? styles.cardPicked : rowTone?.(row) === 'high' && styles.cardHigh)}
            onClick={(event) => {
              if (isRowOwnClick(event)) onRowClick(row);
            }}
          >
            {card(row, selectable ? tickBox(row, 'Select this entry') : null)}
          </div>
        ))}
      </div>
    </>
  );
}

export function RegisterEmpty({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon} aria-hidden="true">
        <Icon />
      </div>
      <p className={styles.emptyTitle}>{title}</p>
      {children}
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </div>
  );
}

/* ── Pager ────────────────────────────────────────────────────────────────────────────────────── */

const PAGE_SIZES = [10, 25, 50, 100, 200];

/** The first and last pages, this one and its neighbours, and "…" where pages are skipped. */
function pageList(page: number, pages: number): Array<number | 'gap'> {
  const list: Array<number | 'gap'> = [];
  for (let i = 1; i <= pages; i += 1) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) list.push(i);
    else if (list[list.length - 1] !== 'gap') list.push('gap');
  }
  return list;
}

export function NumberedPager({
  page,
  pages,
  total,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  if (!total) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav className={styles.pager} aria-label="Pages">
      <span>
        Showing{' '}
        <b>
          {from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')}
        </b>{' '}
        of <b>{total.toLocaleString('en-IN')}</b>
      </span>
      <span className={styles.pagerSpacer} />
      <label>
        Rows
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      {/* Nothing to page through on a single page. */}
      {pages > 1 ? (
        <div className={styles.pages}>
          <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
            <ChevronLeft aria-hidden="true" />
          </button>
          {pageList(page, pages).map((entry, index) =>
            entry === 'gap' ? (
              <span key={`gap-${index}`} aria-hidden="true">
                …
              </span>
            ) : (
              <button key={entry} type="button" aria-current={entry === page ? 'page' : undefined} onClick={() => onPage(entry)}>
                {entry}
              </button>
            ),
          )}
          <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </nav>
  );
}
