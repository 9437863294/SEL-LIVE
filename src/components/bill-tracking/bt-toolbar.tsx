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
import { CalendarRange, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

/* ── period ──────────────────────────────────────────────────────────────── */

const ymd = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseYmd = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const shortDate = (value: string, withYear: boolean) =>
  parseYmd(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });

/** The quick ranges, each worked out from today. A quarter is a calendar quarter — the FY's quarters too. */
function periodPresets(today: string): { key: string; label: string; from: string; to: string }[] {
  const now = parseYmd(today);
  const year = now.getFullYear();
  const month = now.getMonth();
  const quarter = Math.floor(month / 3) * 3;
  const fyStart = month >= 3 ? year : year - 1;
  const minus29 = new Date(now);
  minus29.setDate(now.getDate() - 29);
  return [
    { key: 'this-month', label: 'This month', from: ymd(new Date(year, month, 1)), to: ymd(new Date(year, month + 1, 0)) },
    { key: 'last-month', label: 'Last month', from: ymd(new Date(year, month - 1, 1)), to: ymd(new Date(year, month, 0)) },
    { key: 'this-quarter', label: 'This quarter', from: ymd(new Date(year, quarter, 1)), to: ymd(new Date(year, quarter + 3, 0)) },
    { key: 'last-quarter', label: 'Last quarter', from: ymd(new Date(year, quarter - 3, 1)), to: ymd(new Date(year, quarter, 0)) },
    { key: 'last-30', label: 'Last 30 days', from: ymd(minus29), to: today },
    { key: 'fy-to-date', label: 'FY to date', from: ymd(new Date(fyStart, 3, 1)), to: today },
  ];
}

/**
 * One control for a date range, in place of a "From" and a "To" box side by side: the button says
 * the range ("Period: 01 Oct – 31 Oct 2026", or the whole year when none is set), and opens on the
 * quick ranges a finance team reaches for, with exact dates beneath. Outlined while a range is set,
 * like the dropdowns beside it.
 */
export function ToolbarPeriod({
  from,
  to,
  today,
  onChange,
  emptyLabel = 'Whole year',
  className,
}: {
  from: string;
  to: string;
  today: string;
  onChange: (range: { from?: string; to?: string }) => void;
  emptyLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const presets = periodPresets(today);
  const active = presets.find((preset) => preset.from === from && preset.to === to);
  const set = Boolean(from || to);
  const sameYear = from && to && from.slice(0, 4) === to.slice(0, 4);
  const label = !set
    ? emptyLabel
    : active
      ? active.label
      : from && to
        ? `${shortDate(from, !sameYear)} – ${shortDate(to, true)}`
        : from
          ? `From ${shortDate(from, true)}`
          : `Until ${shortDate(to, true)}`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-9 w-full items-center gap-1.5 rounded-md border border-input bg-white px-2.5 text-sm shadow-sm outline-none transition hover:bg-slate-50 focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20 sm:w-auto sm:min-w-[10rem]',
            set && 'border-emerald-400 bg-emerald-50 text-emerald-900 hover:bg-emerald-50',
            className,
          )}
          aria-label={`Period: ${label}`}
        >
          <CalendarRange className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="shrink-0 text-muted-foreground">Period:</span>
          <span className="min-w-0 flex-1 truncate text-left font-medium">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="grid grid-cols-2 gap-1.5 border-b border-slate-100 p-3">
          {presets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => {
                onChange({ from: preset.from, to: preset.to });
                setOpen(false);
              }}
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
                active?.key === preset.key ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50',
              )}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onChange({ from: undefined, to: undefined });
              setOpen(false);
            }}
            className={cn(
              'col-span-2 rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
              !set ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50',
            )}
          >
            {emptyLabel} <span className={cn('font-normal', !set ? 'text-white/80' : 'text-slate-500')}>— no date limit</span>
          </button>
        </div>
        <div className="space-y-2 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Exact dates</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-slate-600">
              From
              <input type="date" value={from} max={to || undefined} onChange={(event) => onChange({ from: event.target.value || undefined, to: to || undefined })} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm text-slate-900 outline-none focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20" />
            </label>
            <label className="space-y-1 text-xs text-slate-600">
              To
              <input type="date" value={to} min={from || undefined} onChange={(event) => onChange({ from: from || undefined, to: event.target.value || undefined })} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm text-slate-900 outline-none focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20" />
            </label>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The filters a page uses less often, behind one "More filters" button with a count of those set —
 * so the bar keeps to one row. What is set also shows as a removable chip under the bar.
 */
export function ToolbarMoreFilters({ count, children, title = 'More filters' }: { count: number; children: React.ReactNode; title?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={cn('h-9 w-full gap-1.5 shadow-sm sm:w-auto', count > 0 && 'border-emerald-400 bg-emerald-50 text-emerald-900 hover:bg-emerald-50')}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> {title}
          {count ? <span className="rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold leading-4 text-white">{count}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] space-y-2.5 p-3 [&_button[role=combobox]]:w-full [&_button[role=combobox]]:max-w-none">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        {children}
      </PopoverContent>
    </Popover>
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
