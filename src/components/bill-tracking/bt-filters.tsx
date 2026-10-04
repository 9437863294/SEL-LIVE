'use client';

/**
 * URL-driven filters for Bill Tracking registers and reports.
 *
 * The filter state lives in the query string, which is what makes the dashboard click-through work:
 * "91–180 days = ₹2.43 Cr" is simply a link to `/bill-tracking/outstanding?ageing=91–180`, and the
 * page opens already filtered. The same query string is forwarded to the API, so the server applies
 * exactly the filters the screen shows. Saved views store the query string per user.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bookmark, BookmarkPlus, SlidersHorizontal, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { FilterBar } from '@/components/shared/filter-bar';
import { useToast } from '@/hooks/use-toast';
import {
  AGEING_BASIS_LABELS,
  BILL_CATEGORY_LABELS,
  PAYMENT_STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
  WORKFLOW_STATUS_LABELS,
} from '@/lib/bill-tracking/types';

import { btFetch, useBtQuery, useLookups } from './bt-client';
import { FySelect } from './bt-ui';

/** Keys that are filters (counted as "active"); page, sort and size are not. */
const FILTER_KEYS = ['project', 'client', 'dgm', 'billType', 'category', 'txn', 'payment', 'workflow', 'ageing', 'basis', 'min', 'max', 'targetWeek', 'owner', 'from', 'to', 'asOf', 'chip', 'marker', 'ids', 'open'] as const;

export function useUrlFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() || '';
  const lookups = useLookups();
  const get = (key: string) => params.get(key) ?? '';
  const fy = params.get('fy') ?? lookups.currentFy;

  const set = (changes: Record<string, string | undefined | null>, resetPage = true) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === null || value === '' || value === 'any') next.delete(key);
      else next.set(key, value);
    }
    if (resetPage && !('page' in changes)) next.delete('page');
    const query = next.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  };

  const clear = () => {
    const next = new URLSearchParams();
    if (params.get('fy')) next.set('fy', params.get('fy') as string);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false });
  };

  /** Query string for the API: the page's own filters plus the FY (always explicit). */
  const apiQuery = (extra: Record<string, string | number | undefined> = {}) => {
    const next = new URLSearchParams(params.toString());
    next.set('fy', fy);
    for (const [key, value] of Object.entries(extra)) if (value !== undefined && value !== '') next.set(key, String(value));
    return next.toString();
  };

  const activeCount = FILTER_KEYS.filter((key) => params.get(key)).length;
  return { params, get, set, clear, fy, apiQuery, activeCount, queryString: params.toString() };
}

export type UrlFilters = ReturnType<typeof useUrlFilters>;

function FilterSelect({ label, value, onChange, options, placeholder = 'All' }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value || 'any'} onValueChange={onChange}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value="any">{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const entries = <K extends string>(labels: Record<K, string>) => (Object.entries(labels) as [K, string][]).map(([value, label]) => ({ value, label }));

/**
 * The standard filter bar: search, FY, project and payment status inline; everything else in the
 * advanced drawer. `extra` adds page-specific controls inline.
 */
export function BillFilterBar({ filters, page, extra, summary, actions, hide = [] }: { filters: UrlFilters; page: string; extra?: React.ReactNode; summary?: React.ReactNode; actions?: React.ReactNode; hide?: string[] }) {
  const lookups = useLookups();
  const [search, setSearch] = useState(filters.get('q'));
  const [drawer, setDrawer] = useState(false);

  // Debounced push of the search box into the URL, through a ref so the timer always applies the
  // search on top of the latest filters rather than the ones current when typing began.
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = filters;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pushSearch = (value: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current.set({ q: value || undefined }), 350);
  };

  const projectOptions = lookups.projects.map((project) => ({ value: project.id, label: project.name }));
  const billTypes = lookups.config.billTypes.filter((type) => type.active).map((type) => ({ value: type.name, label: type.name }));
  const buckets = lookups.config.settings.ageingBuckets.map((bucket) => ({ value: bucket.label, label: `${bucket.label} days` }));

  return (
    <>
      <FilterBar
        search={{
          value: search,
          onChange: (value) => {
            setSearch(value);
            pushSearch(value);
          },
          placeholder: 'Search invoice, bill no, project, client, amount, UTR…',
        }}
        activeCount={filters.activeCount}
        onClear={() => {
          setSearch('');
          filters.clear();
        }}
        summary={summary}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDrawer(true)}>
              <SlidersHorizontal className="h-4 w-4" /> More filters
            </Button>
            <SavedViews page={page} filters={filters} />
            {actions}
          </div>
        }
      >
        <div className="min-w-0 space-y-1">
          <Label className="text-xs text-muted-foreground">Financial year</Label>
          <FySelect value={filters.fy} onChange={(value) => filters.set({ fy: value })} />
        </div>
        {!hide.includes('project') ? <FilterSelect label="Project" value={filters.get('project')} onChange={(value) => filters.set({ project: value })} options={projectOptions} placeholder="All projects" /> : null}
        {!hide.includes('payment') ? <FilterSelect label="Payment status" value={filters.get('payment')} onChange={(value) => filters.set({ payment: value })} options={entries(PAYMENT_STATUS_LABELS)} /> : null}
        {extra}
      </FilterBar>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>Applied to the list, its totals and any export.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 grid grid-cols-1 gap-3">
            <FilterSelect label="Client" value={filters.get('client')} onChange={(value) => filters.set({ client: value })} options={lookups.clients.map((client) => ({ value: client.id, label: client.name }))} placeholder="All clients" />
            <FilterSelect label="DGM office" value={filters.get('dgm')} onChange={(value) => filters.set({ dgm: value })} options={lookups.dgmOffices.map((office) => ({ value: office, label: office }))} placeholder="All offices" />
            <FilterSelect label="Bill type" value={filters.get('billType')} onChange={(value) => filters.set({ billType: value })} options={billTypes} placeholder="All bill types" />
            <FilterSelect label="Category" value={filters.get('category')} onChange={(value) => filters.set({ category: value })} options={entries(BILL_CATEGORY_LABELS)} placeholder="All categories" />
            <FilterSelect label="Transaction type" value={filters.get('txn')} onChange={(value) => filters.set({ txn: value })} options={entries(TRANSACTION_TYPE_LABELS)} />
            <FilterSelect label="Workflow status" value={filters.get('workflow')} onChange={(value) => filters.set({ workflow: value })} options={entries(WORKFLOW_STATUS_LABELS)} />
            <FilterSelect label="Ageing bucket" value={filters.get('ageing')} onChange={(value) => filters.set({ ageing: value })} options={buckets} placeholder="Any age" />
            <FilterSelect label="Ageing measured from" value={filters.get('basis')} onChange={(value) => filters.set({ basis: value })} options={entries(AGEING_BASIS_LABELS)} placeholder={`Default (${AGEING_BASIS_LABELS[lookups.config.settings.defaultAgeingBasis]})`} />
            <FilterSelect label="Collection owner" value={filters.get('owner')} onChange={(value) => filters.set({ owner: value })} options={lookups.users.map((user) => ({ value: user.id, label: user.name }))} placeholder="Anyone" />
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Bill date from</Label>
                <Input type="date" value={filters.get('from')} onChange={(event) => filters.set({ from: event.target.value })} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">to</Label>
                <Input type="date" value={filters.get('to')} onChange={(event) => filters.set({ to: event.target.value })} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Outstanding ≥ (₹)</Label>
                <Input type="number" inputMode="decimal" value={filters.get('min')} onChange={(event) => filters.set({ min: event.target.value })} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Outstanding ≤ (₹)</Label>
                <Input type="number" inputMode="decimal" value={filters.get('max')} onChange={(event) => filters.set({ max: event.target.value })} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Target week</Label>
                <Input placeholder="2026-W41" value={filters.get('targetWeek')} onChange={(event) => filters.set({ targetWeek: event.target.value })} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">As on date</Label>
                <Input type="date" value={filters.get('asOf')} onChange={(event) => filters.set({ asOf: event.target.value })} className="h-9" />
              </div>
            </div>
          </div>
          <SheetFooter className="mt-6 gap-2">
            <Button variant="outline" onClick={() => filters.clear()}>
              Reset
            </Button>
            <Button onClick={() => setDrawer(false)}>Done</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

interface SavedView {
  id: string;
  name: string;
  query: string;
}

function SavedViews({ page, filters }: { page: string; filters: UrlFilters }) {
  const { toast } = useToast();
  const { data, reload } = useBtQuery<{ views: SavedView[] }>(`views?page=${encodeURIComponent(page)}`);
  const router = useRouter();
  const pathname = usePathname() || '';

  const save = async () => {
    const name = window.prompt('Name this view');
    if (!name) return;
    try {
      await btFetch('views', { body: { page, name, query: filters.queryString } });
      reload();
      toast({ title: 'View saved', description: name });
    } catch (error) {
      toast({ title: 'Could not save the view', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    }
  };
  const remove = async (id: string) => {
    await btFetch(`views/${id}`, { method: 'DELETE' }).catch(() => undefined);
    reload();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Bookmark className="h-4 w-4" /> Views
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Saved views</DropdownMenuLabel>
        {data?.views.length ? (
          data.views.map((view) => (
            <DropdownMenuItem key={view.id} className="flex items-center justify-between gap-2" onSelect={() => router.replace(`${pathname}${view.query ? `?${view.query}` : ''}`)}>
              <span className="truncate">{view.name}</span>
              <button
                type="button"
                aria-label={`Delete view ${view.name}`}
                className="text-muted-foreground hover:text-rose-600"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void remove(view.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuItem>
          ))
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet.</p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void save()}>
          <BookmarkPlus className="mr-2 h-4 w-4" /> Save current filters
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Toggle chips (Outstanding page): each adds a condition; all chips must hold. */
export function FilterChips({ filters, chips }: { filters: UrlFilters; chips: { value: string; label: string }[] }) {
  const active = new Set(filters.get('chip').split(',').filter(Boolean));
  const toggle = (value: string) => {
    const next = new Set(active);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    filters.set({ chip: [...next].join(',') || undefined });
  };
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
      {chips.map((chip) => {
        const on = active.has(chip.value);
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(chip.value)}
            className={on ? 'inline-flex items-center gap-1 rounded-full border border-emerald-600 bg-emerald-600 px-3 py-1 text-xs font-medium text-white' : 'inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:border-emerald-300'}
          >
            {chip.label}
            {on ? <X className="h-3 w-3" /> : null}
          </button>
        );
      })}
    </div>
  );
}
