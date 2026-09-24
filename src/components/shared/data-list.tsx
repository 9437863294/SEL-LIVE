'use client';

/**
 * The responsive register: one column spec, rendered as a card list on a phone and a table on a
 * desktop.
 *
 * Moved here from `@/components/hr/hr-ui`, unchanged apart from dropping the `Hr` prefix. It was
 * never HR-specific — nothing in it reads an HR type — and leaving it there meant that anything
 * wanting a responsive table also pulled in that file's dependency on `@/lib/hr-requirement`, and
 * through it the whole of `hr-policy.ts`. The home dashboard needs the table and has no business
 * loading the HR rulebook to get it.
 *
 * `hr-ui.tsx` re-exports all of this under the original names, so the fifty existing call sites are
 * untouched. New code should import from here.
 */

import Link from 'next/link';
import { Fragment, createContext, useContext } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Whether this subtree is already inside a link.
 *
 * `DataList` wraps each **phone card** in a `<Link>` when given `cardHref`, while the desktop
 * table does not — so the same `column.cell()` output renders inside an anchor on a phone and
 * outside one on a desktop. A cell that renders its own link is therefore correct on desktop and
 * produces `<a>` inside `<a>` on mobile, which React reports as a hydration error and browsers
 * "fix" by silently restructuring the DOM.
 *
 * A cell cannot detect that on its own, so the card announces it. Cells that may contain a link
 * read this and degrade to plain markup when it is true — the card itself is the tap target there,
 * so nothing is lost. Defaults to `false`, so every existing cell behaves exactly as before.
 */
const InsideLinkContext = createContext(false);

/** For a cell that renders a link: true when an ancestor is already an anchor. */
export function useInsideLink(): boolean {
  return useContext(InsideLinkContext);
}

/**
 * A link for use inside a list cell, which becomes plain text when the row is already a link.
 *
 * **Why a component and not a hook.** `DataList` calls `column.cell(row)` while building the
 * card, which happens *outside* the provider — so a `useInsideLink()` call written directly in a
 * cell function would run in the page's render and always read `false`. A component works because
 * the cell returns an *element*, and React runs that element's function later, inside the provider.
 * Any cell that renders a link should use this rather than `<Link>` for that reason alone.
 */
export function CellLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const insideLink = useInsideLink();

  // The card is the tap target and points at the same place, so the anchor is redundant — and
  // nesting it would be invalid HTML. The hover underline goes too: there is nothing to click.
  if (insideLink) return <span className={className}>{children}</span>;

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/**
 * One column of a register, declared once and rendered twice — as a table cell on desktop and as
 * part of a card on mobile.
 *
 * `mobile` decides where the value lands on the card:
 *   'title'  → the card's headline (first one wins the emphasis)
 *   'aside'  → top-right, for a status badge
 *   'detail' → the label/value grid in the card body (the default)
 *   'footer' → a full-width row at the bottom, for actions
 *   'omit'   → desktop only
 */
export interface ListColumn<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
  /** Extra classes for the desktop `<TableCell>`/`<TableHead>` — e.g. 'hidden md:table-cell'. */
  className?: string;
  mobile?: 'title' | 'aside' | 'detail' | 'footer' | 'omit';
}

/**
 * A register that reads well on a phone and on a desktop from a single column spec — a card list
 * under `sm:hidden`, the table under `hidden sm:block` — so the two can't drift apart and adding a
 * column doesn't mean writing it twice.
 */
export function DataList<T extends { id: string }>({
  rows,
  columns,
  rowClassName,
  empty,
  cardHref,
  tableClassName,
  fitContent,
  onRowClick,
  maxHeightClassName,
  expandedId,
  expandedIds,
  renderExpanded,
  dense,
}: {
  rows: T[];
  columns: Array<ListColumn<T>>;
  rowClassName?: (row: T) => string | undefined;
  empty?: React.ReactNode;
  /** When given, the whole mobile card becomes a link to this route. */
  cardHref?: (row: T) => string;
  /**
   * Extra classes for the `<table>` itself. Defaults (`w-full`, auto layout) stretch every column to
   * fill the container, which is right for a register meant to use the whole width but wrong for a
   * handful of short columns on a wide screen — those end up padded with dead space between values
   * instead of sitting close to their labels. Pass `'w-auto'` to let the table size itself to its
   * content, optionally with `'table-fixed'` and per-column width classes for exact control.
   */
  tableClassName?: string;
  /**
   * Shrinks the bordered card itself to the table's actual width instead of the full row width.
   *
   * `tableClassName="w-auto"` alone only narrows the `<table>` element — the card *around* it still
   * stretches edge to edge, so a short table on a wide screen ends up sitting in the left corner of a
   * mostly-empty box, which reads as data spilling across the page rather than as one contained
   * table. This collapses the card to match.
   */
  fitContent?: boolean;
  /**
   * Makes each desktop row and each phone card (one without `cardHref` or footer actions) a tap
   * target — for pickers where the row *is* the control. Controls inside the row that must not
   * also fire it (a checkbox) should stop propagation themselves.
   */
  onRowClick?: (row: T) => void;
  /**
   * Caps the desktop table's height, makes the table's own wrapper the element that scrolls, and
   * pins the header row to its top — `'sm:max-h-[30rem]'`.
   *
   * Use this instead of wrapping the list in a `ScrollArea`. The wrapper is already a scroll
   * container (`overflow-x-auto`), so a sticky header pins to *it* — and inside a ScrollArea it never
   * scrolls vertically, which is why headers scrolled away with the rows. The phone cards are not
   * affected; the page scrolls those.
   */
  maxHeightClassName?: string;
  /**
   * An expandable detail under a row — the audit trail's per-change permission lists. The caller
   * owns which row is open (`expandedId`, one at a time, usually toggled from `onRowClick`) and
   * renders it; the list places it as a full-width row under the table row on a desktop and as a
   * panel at the foot of the card on a phone.
   */
  expandedId?: string | null;
  /** Several rows open at once — takes precedence over `expandedId` when given. */
  expandedIds?: ReadonlySet<string>;
  renderExpanded?: (row: T) => React.ReactNode;
  /**
   * Tighter desktop cells (`px-3 py-1.5`, a shorter header) for a register that is scanned rather
   * than read. The default `p-4` puts 32px of padding around a row of badges, which made the user
   * directory ~60px a row; dense is ~40px. Phone cards are unaffected.
   */
  dense?: boolean;
}) {
  if (rows.length === 0) return <>{empty}</>;

  const titles = columns.filter(column => column.mobile === 'title');
  const asides = columns.filter(column => column.mobile === 'aside');
  const footers = columns.filter(column => column.mobile === 'footer');
  const details = columns.filter(column => !column.mobile || column.mobile === 'detail');

  return (
    <>
      {/* Mobile: one card per record. */}
      <div className="space-y-2.5 sm:hidden">
        {rows.map(row => {
          const href = cardHref?.(row);
          const isExpanded = !!renderExpanded && (expandedIds ? expandedIds.has(row.id) : expandedId === row.id);
          const body = (
            <>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  {titles.map((column, index) => (
                    <div key={column.header} className={index === 0 ? 'text-sm font-semibold text-slate-800' : 'text-xs text-muted-foreground'}>
                      {column.cell(row)}
                    </div>
                  ))}
                </div>
                {asides.length > 0 && (
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {asides.map(column => (
                      <div key={column.header}>{column.cell(row)}</div>
                    ))}
                  </div>
                )}
              </div>

              {details.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2">
                  {details.map(column => (
                    <div key={column.header} className={column.align === 'right' ? 'text-right' : undefined}>
                      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{column.header}</dt>
                      <dd className="truncate text-sm text-slate-800">{column.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {footers.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2 border-t border-slate-100 pt-2.5 [&_button]:min-h-11 [&_button]:flex-1">
                  {footers.map(column => (
                    <div key={column.header} className="flex flex-1 gap-2">{column.cell(row)}</div>
                  ))}
                </div>
              )}

              {isExpanded && renderExpanded && (
                // Stops the tap reaching a card that toggles on click, so reading the detail
                // does not close it.
                <div className="mt-2.5 border-t border-slate-100 pt-2.5" onClick={event => event.stopPropagation()}>
                  {renderExpanded(row)}
                </div>
              )}
            </>
          );

          const shell = cn(
            'rounded-xl border border-white/70 bg-white/85 p-3.5 shadow-sm transition-transform active:scale-[0.99]',
            rowClassName?.(row),
          );

          // A card wrapped in a link still has to let its footer buttons receive the tap, so the
          // link only covers the informational part when there are actions.
          if (href && footers.length === 0) {
            return (
              <Link key={row.id} href={href} className={cn(shell, 'block')}>
                {/* Tells the cells inside they are in an anchor — see `InsideLinkContext`. */}
                <InsideLinkContext.Provider value>{body}</InsideLinkContext.Provider>
              </Link>
            );
          }
          if (onRowClick && !href && footers.length === 0) {
            return (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => onRowClick(row)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onRowClick(row);
                  }
                }}
                className={cn(shell, 'cursor-pointer')}
              >
                {body}
              </div>
            );
          }
          return (
            <div key={row.id} className={shell}>
              {body}
            </div>
          );
        })}
      </div>

      {/* Desktop: the full table. */}
      <div
        className={cn(
          'hidden overflow-x-auto rounded-lg border border-white/60 bg-white/80 backdrop-blur-sm',
          fitContent ? 'sm:inline-block max-w-full' : 'sm:block',
          maxHeightClassName && cn('overflow-y-auto', maxHeightClassName),
        )}
      >
        {/*
          The kit's Table wraps <table> in its own `overflow-auto` div — a scroll container sitting
          between the pinned header cells and the wrapper above that actually scrolls, so the header
          pinned to *it* and rode away with the rows. Made visible when this list scrolls itself; the
          outer wrapper already handles sideways overflow.
        */}
        <Table className={tableClassName} containerClassName={maxHeightClassName ? 'overflow-visible' : undefined}>
          {/*
            The header row used to render with the same near-white background as the body and a
            `text-muted-foreground` weight barely darker than the page behind it — on a
            backdrop-blur card it all but disappeared. A tinted band, bolder small-caps labels and a
            firmer bottom border give it the contrast a header needs to read as one at a glance.
          */}
          <TableHeader className="bg-slate-100/80">
            <TableRow className="hover:bg-transparent">
              {columns.map(column => (
                <TableHead
                  key={column.header}
                  className={cn(
                    'h-10 text-[11px] font-semibold uppercase tracking-wide text-slate-600',
                    dense && 'h-9 px-3',
                    // Pinned per cell, not on <thead>: collapsed row borders do not travel with a
                    // sticky cell, so the rule under the header is an inset shadow instead.
                    maxHeightClassName && 'sticky top-0 z-10 bg-slate-100 shadow-[inset_0_-1px_0_#e2e8f0]',
                    column.align === 'right' && 'text-right',
                    column.className,
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => {
              const isExpanded = !!renderExpanded && (expandedIds ? expandedIds.has(row.id) : expandedId === row.id);
              return (
                <Fragment key={row.id}>
                  <TableRow
                    className={cn(rowClassName?.(row), onRowClick && 'cursor-pointer', isExpanded && 'bg-slate-50/70')}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map(column => (
                      <TableCell
                        key={column.header}
                        className={cn('text-sm', dense && 'px-3 py-1.5', column.align === 'right' && 'text-right', column.className)}
                      >
                        {column.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                  {isExpanded && renderExpanded && (
                    <TableRow className="hover:bg-transparent">
                      {/* Spans hidden columns too; browsers clamp a colSpan to what is rendered. */}
                      <TableCell colSpan={columns.length} className="bg-slate-50/60 p-0">
                        {renderExpanded(row)}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
