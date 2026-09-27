'use client';

/**
 * The app's one filter bar, and the search box inside it.
 *
 * Search first, then the page's filter controls (Selects, date inputs), a Clear button once
 * something is set, and actions (Export…) at the end. On a phone the filter controls fold behind a
 * "Filters (n)" button so the list is not pushed off-screen; from `sm` everything sits on one
 * wrapping row. Pages pass their controls as children and never style the bar themselves.
 */

import { useId, useState, type ReactNode } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name; defaults to the placeholder. */
  label?: string;
  className?: string;
  autoFocus?: boolean;
}

/** A search field with its icon and a clear button — the same in every list. */
export function SearchInput({ value, onChange, placeholder = 'Search…', label, className, autoFocus }: SearchInputProps) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        autoFocus={autoFocus}
        className="pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export interface FilterBarProps {
  /** The list's search box. */
  search?: SearchInputProps;
  /** The page's filter controls — Selects, date inputs, toggles — in display order. */
  children?: ReactNode;
  /** How many filters are set (not counting search): shown on the phone toggle, enables Clear. */
  activeCount?: number;
  /** Resets every filter (and usually the search). */
  onClear?: () => void;
  /** Export, a column picker… — at the end of the bar. */
  actions?: ReactNode;
  /** A short result line ("12 of 40 shown"). */
  summary?: ReactNode;
  /** Placement only. */
  className?: string;
}

export function FilterBar({ search, children, activeCount = 0, onClear, actions, summary, className }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const fieldsId = useId();
  const hasFields = Boolean(children);
  const canClear = Boolean(onClear) && (activeCount > 0 || Boolean(search?.value));

  return (
    <div className={cn('filter-bar flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center', className)}>
      {(search || hasFields) && (
        <div className="flex min-w-0 items-center gap-2 sm:contents">
          {search && <SearchInput {...search} className={cn('flex-1 sm:w-64 sm:flex-none', search.className)} />}
          {hasFields && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0 gap-1.5 sm:hidden"
              aria-expanded={open}
              aria-controls={fieldsId}
              onClick={() => setOpen((value) => !value)}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Filters{activeCount > 0 ? ` (${activeCount})` : ''}
            </Button>
          )}
        </div>
      )}
      {hasFields && (
        <div
          id={fieldsId}
          className={cn(
            'filter-bar-fields flex-col gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-center [&>*]:w-full sm:[&>*]:w-auto sm:[&>*]:min-w-[10rem]',
            open ? 'flex' : 'hidden',
          )}
        >
          {children}
        </div>
      )}
      {canClear && (
        <Button type="button" variant="ghost" className="gap-1.5 self-start text-muted-foreground sm:self-auto" onClick={onClear}>
          <X className="h-4 w-4" aria-hidden="true" />
          Clear
        </Button>
      )}
      {(summary || actions) && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:ml-auto">
          {summary && <span className="text-xs text-muted-foreground">{summary}</span>}
          {actions}
        </div>
      )}
    </div>
  );
}
