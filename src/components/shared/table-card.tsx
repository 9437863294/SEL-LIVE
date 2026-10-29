/**
 * The app's one register frame: a card with the table's title, its row count and actions, an
 * optional toolbar row (a `FilterBar`), the table in a scroll box with a sticky header, and an
 * optional footer (totals, pagination). Every register looks and scrolls the same because none of
 * them builds its own wrapper — the table inside takes its format from `ui/table`.
 */

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { InfoTip } from './info-tip';

export interface TableCardProps {
  title?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /** Rows shown; with `total` it reads "12 of 40". */
  count?: number;
  total?: number;
  /** Singular noun for the count ("vehicle" → "12 vehicles"). */
  noun?: string;
  actions?: ReactNode;
  /**
   * On a phone, lay `actions` out as an even two-column grid across the card — for a register with
   * several labelled actions, which otherwise wrap into rows of ragged widths. From `sm` they sit
   * in one wrapping row as usual. Keep each label short enough for half a phone's width.
   */
  actionsGrid?: boolean;
  /** `info` puts the description behind an (i) beside the title instead of an open line under it. */
  descriptionAs?: 'text' | 'info';
  /** A row under the title for the list's `FilterBar`. */
  toolbar?: ReactNode;
  footer?: ReactNode;
  /**
   * `contained` (default): the table scrolls inside the card with its header pinned — for long
   * registers. `natural`: the card grows with its rows — for short tables and printouts.
   * `fill`: the card is a flex column that takes whatever height its parent gives it (`flex-1` in a
   * column of fixed height) and the table scrolls inside with its header pinned — for a page that
   * fits the screen instead of scrolling. Where the parent's height is not fixed (a phone), the card
   * simply grows with its rows.
   */
  scroll?: 'contained' | 'natural' | 'fill';
  children: ReactNode;
  /** Placement only. */
  className?: string;
}

function countLabel(count: number, total: number | undefined, noun: string | undefined) {
  const plural = noun ? ` ${noun}${(total ?? count) === 1 ? '' : 's'}` : '';
  return total !== undefined && total !== count ? `${count} of ${total}${plural}` : `${count}${plural}`;
}

export function TableCard({
  title,
  description,
  icon: Icon,
  count,
  total,
  noun,
  actions,
  actionsGrid = false,
  descriptionAs = 'text',
  toolbar,
  footer,
  scroll = 'contained',
  children,
  className,
}: TableCardProps) {
  const hasHead = Boolean(title || description || actions || count !== undefined);
  return (
    <Card className={cn('table-card min-w-0 overflow-hidden', scroll === 'fill' && 'flex min-h-0 flex-col', className)}>
      {hasHead && (
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-1 basis-[14rem] items-start gap-2.5">
            {Icon && (
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
                <Icon className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                {title && <h2 className="min-w-0 break-words text-[15px] font-semibold leading-snug tracking-tight text-foreground sm:text-base">{title}</h2>}
                {description && descriptionAs === 'info' ? <InfoTip label={`About “${typeof title === 'string' ? title : 'this list'}”`}>{description}</InfoTip> : null}
                {count !== undefined && <Badge variant="neutral">{countLabel(count, total, noun)}</Badge>}
              </div>
              {description && descriptionAs === 'text' && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground sm:text-[13px]">{description}</div>}
            </div>
          </div>
          {actions && (
            <div
              className={cn(
                'print:hidden',
                actionsGrid
                  ? 'grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center [&>*]:min-w-0'
                  : 'flex flex-wrap items-center gap-2',
              )}
            >
              {actions}
            </div>
          )}
        </div>
      )}
      {toolbar && <div className="border-b px-4 py-3 print:hidden sm:px-5">{toolbar}</div>}
      <div
        className={cn(
          'table-card-body min-w-0',
          scroll === 'contained' &&
            // One scroller: the table's own wrapper steps aside so the pinned header is pinned to
            // this box, which scrolls both ways.
            'max-h-[min(70vh,42rem)] overflow-auto [&>div]:overflow-visible [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-slate-100 print:max-h-none',
          scroll === 'fill' &&
            // The same single scroller, reaching one level deeper: a `DataList` puts its own
            // sideways-scrolling wrapper around the table's, and either would capture the header.
            'min-h-0 flex-1 overflow-auto [&>div]:overflow-visible [&_[data-slot=data-list-table]]:overflow-visible [&_[data-slot=table-container]]:overflow-visible [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-slate-100 print:overflow-visible',
        )}
      >
        {children}
      </div>
      {footer && <div className="border-t px-4 py-2.5 text-xs text-muted-foreground sm:px-5">{footer}</div>}
    </Card>
  );
}
