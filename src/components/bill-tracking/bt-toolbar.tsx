'use client';

/**
 * Bill Tracking's filter toolbar: one framed row of controls that all share a 36px height and a
 * centre line — search, then dropdowns that carry their own label inside ("Project: All projects"),
 * then the page's actions on the right. Labels above some controls but not others is what threw the
 * old bar out of line, so nothing in the toolbar has a label outside itself.
 *
 * A control showing a filter that is set is outlined, so a filtered list is obvious at a glance; the
 * filters behind "More filters" show as removable chips under the row. On a phone the dropdowns fold
 * behind a "Filters (n)" button.
 */

import { useState } from 'react';
import { CalendarRange, Search, SlidersHorizontal, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export const TOOLBAR_CONTROL = 'h-9 text-sm';

export function ToolbarSearch({ value, onChange, placeholder, className }: { value: string; onChange: (value: string) => void; placeholder: string; className?: string }) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-md border border-input bg-white pl-8 pr-8 text-sm shadow-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-slate-100 hover:text-slate-900">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export interface ToolbarOption {
  value: string;
  label: string;
}

/**
 * A dropdown that names itself: "Project: All projects". `allLabel` is the unfiltered choice; any
 * other choice outlines the control.
 */
export function ToolbarSelect({
  label,
  value,
  onChange,
  options,
  allLabel = 'All',
  showAll = true,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ToolbarOption[];
  allLabel?: string;
  /** False for a choice that always has a value (Group by, FY). */
  showAll?: boolean;
  className?: string;
}) {
  const active = showAll && Boolean(value);
  return (
    <Select value={value || 'any'} onValueChange={(next) => onChange(next === 'any' ? '' : next)}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          'h-9 w-full gap-1.5 bg-white text-sm shadow-sm sm:w-auto sm:min-w-[9.5rem] sm:max-w-[16rem]',
          active && 'border-emerald-400 bg-emerald-50 text-emerald-900',
          className,
        )}
      >
        <span className="shrink-0 text-muted-foreground">{label}:</span>
        <span className="min-w-0 flex-1 truncate text-left font-medium">
          <SelectValue placeholder={allLabel} />
        </span>
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {showAll ? <SelectItem value="any">{allLabel}</SelectItem> : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A date control that names itself, same height and frame as the dropdowns. */
export function ToolbarDate({ label, value, onChange, className }: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <label
      className={cn(
        'flex h-9 w-full items-center gap-1.5 rounded-md border border-input bg-white px-2.5 text-sm shadow-sm focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 sm:w-auto',
        value && 'border-emerald-400 bg-emerald-50',
        className,
      )}
    >
      <CalendarRange className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} className="min-w-0 flex-1 bg-transparent font-medium outline-none" />
      {value ? (
        <button type="button" aria-label={`Clear ${label}`} onClick={(event) => {
            event.preventDefault();
            onChange('');
          }} className="text-muted-foreground hover:text-slate-900">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </label>
  );
}

export interface FilterChipItem {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
}

/**
 * The framed toolbar. `controls` fold behind a toggle on a phone; `actions` stay on the right from
 * `sm` up; `chips` (filters set elsewhere) show as a removable row underneath.
 */
export function BtToolbar({
  search,
  controls,
  actions,
  summary,
  chips = [],
  activeCount = 0,
  onClear,
}: {
  search?: React.ReactNode;
  controls?: React.ReactNode;
  actions?: React.ReactNode;
  summary?: React.ReactNode;
  chips?: FilterChipItem[];
  activeCount?: number;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-slate-200 bg-white/90 p-2.5 shadow-sm print:hidden" aria-label="Filters">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex items-center gap-2 sm:contents">
            {search}
            {controls ? (
              <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 sm:hidden" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                <SlidersHorizontal className="h-4 w-4" />
                Filters{activeCount ? ` (${activeCount})` : ''}
              </Button>
            ) : null}
          </div>
          {controls ? <div className={cn('flex-col gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-center', open ? 'flex' : 'hidden')}>{controls}</div> : null}
          {onClear && activeCount > 0 ? (
            <Button type="button" variant="ghost" size="sm" className="h-9 gap-1 self-start text-muted-foreground sm:self-auto" onClick={onClear}>
              <X className="h-4 w-4" /> Clear
            </Button>
          ) : null}
        </div>
        {summary || actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-100 pt-2 lg:border-t-0 lg:pt-0">
            {summary ? <span className="mr-1 whitespace-nowrap text-xs font-medium text-slate-500">{summary}</span> : null}
            {actions}
          </div>
        ) : null}
      </div>
      {chips.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Also filtered by</span>
          {chips.map((chip) => (
            <span key={chip.key} className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 py-0.5 pl-2.5 pr-1 text-xs text-emerald-900">
              <span className="text-emerald-700/80">{chip.label}:</span>
              <span className="max-w-[14rem] truncate font-medium">{chip.value}</span>
              <button type="button" onClick={chip.onRemove} aria-label={`Remove ${chip.label} filter`} className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-emerald-200">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
