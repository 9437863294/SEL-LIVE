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
import { useToast } from '@/hooks/use-toast';
import {
  AGEING_BASIS_LABELS,
  PAYMENT_STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
  WORKFLOW_STATUS_LABELS,
} from '@/lib/bill-tracking/types';

import { btFetch, useBtQuery, useLookups } from './bt-client';
import { BtToolbar, ToolbarSearch, ToolbarSelect } from './bt-toolbar';
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

/** A labelled dropdown for the "More filters" drawer (a vertical form, so labels sit above). */
function DrawerSelect({ label, value, onChange, options, placeholder = 'All' }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs font-medium text-slate-700">{label}</Label>
      <Select value={value || 'any'} onValueChange={(next) => onChange(next === 'any' ? '' : next)}>
        <SelectTrigger className={value ? 'h-9 border-emerald-400 bg-emerald-50' : 'h-9'}>
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

function DrawerInput({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs font-medium text-slate-700">{label}</Label>
      <Input {...props} className={props.value ? 'h-9 border-emerald-400 bg-emerald-50' : 'h-9'} />
    </div>
  );
}

const entries = <K extends string>(labels: Record<K, string>) => (Object.entries(labels) as [K, string][]).map(([value, label]) => ({ value, label }));

/**
 * The standard filter toolbar: search, FY, project and payment status inline; everything else in
 * the "More filters" drawer, shown as removable chips once set. `extra` adds page-specific
 * controls inline (use `ToolbarSelect` / `ToolbarDate` so they line up).
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
  const clientOptions = lookups.clients.map((client) => ({ value: client.id, label: client.name }));
  const categoryOptions = lookups.config.billCategories.map((category) => ({ value: category.id, label: category.name }));
  // Sub categories narrow to the chosen main category; names repeat across projects, so dedupe.
  const chosenCategory = filters.get('category');
  const billTypes = [...new Set(lookups.config.billTypes.filter((type) => !chosenCategory || type.categoryId === chosenCategory).map((type) => type.name))]
    .sort()
    .map((name) => ({ value: name, label: name }));
  const buckets = lookups.config.settings.ageingBuckets.map((bucket) => ({ value: bucket.label, label: `${bucket.label} days` }));
  const ownerOptions = lookups.users.map((user) => ({ value: user.id, label: user.name }));

  // Filters set in the drawer, as chips under the toolbar — so nothing filters the list unseen.
  const nameOf = (options: { value: string; label: string }[], value: string) => options.find((option) => option.value === value)?.label ?? value;
  const chipDefs: [string, string, (value: string) => string][] = [
    ['client', 'Client', (value) => nameOf(clientOptions, value)],
    ['dgm', 'DGM office', (value) => value],
    ['category', 'Main category', (value) => nameOf(categoryOptions, value)],
    ['billType', 'Sub category', (value) => value],
    ['txn', 'Type', (value) => nameOf(entries(TRANSACTION_TYPE_LABELS), value)],
    ['workflow', 'Workflow', (value) => nameOf(entries(WORKFLOW_STATUS_LABELS), value)],
    ['ageing', 'Ageing', (value) => `${value} days`],
    ['basis', 'Aged from', (value) => nameOf(entries(AGEING_BASIS_LABELS), value)],
    ['owner', 'Owner', (value) => nameOf(ownerOptions, value)],
    ['from', 'Bill date from', (value) => value],
    ['to', 'Bill date to', (value) => value],
    ['min', 'Outstanding ≥', (value) => `₹${Number(value).toLocaleString('en-IN')}`],
    ['max', 'Outstanding ≤', (value) => `₹${Number(value).toLocaleString('en-IN')}`],
    ['targetWeek', 'Target week', (value) => value],
    ['asOf', 'As on', (value) => value],
    ['ids', 'Selected bills', (value) => `${value.split(',').length}`],
  ];
  const chips = chipDefs
    .filter(([key]) => filters.get(key))
    .map(([key, label, show]) => ({ key, label, value: show(filters.get(key)), onRemove: () => filters.set({ [key]: undefined }) }));

  return (
    <>
      <BtToolbar
        search={
          <ToolbarSearch
            className="flex-1 sm:w-64 sm:flex-none"
            value={search}
            placeholder="Search invoice, bill no, project, client, amount, UTR…"
            onChange={(value) => {
              setSearch(value);
              pushSearch(value);
            }}
          />
        }
        controls={
          <>
            <FySelect value={filters.fy} onChange={(value) => filters.set({ fy: value })} />
            {!hide.includes('project') ? <ToolbarSelect label="Project" value={filters.get('project')} onChange={(value) => filters.set({ project: value })} options={projectOptions} allLabel="All projects" /> : null}
            {!hide.includes('payment') ? <ToolbarSelect label="Status" value={filters.get('payment')} onChange={(value) => filters.set({ payment: value })} options={entries(PAYMENT_STATUS_LABELS)} /> : null}
            {extra}
          </>
        }
        chips={chips}
        activeCount={filters.activeCount}
        onClear={() => {
          setSearch('');
          filters.clear();
        }}
        summary={summary}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setDrawer(true)}>
              <SlidersHorizontal className="h-4 w-4" /> More filters
              {chips.length ? <span className="rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold leading-4 text-white">{chips.length}</span> : null}
            </Button>
            <SavedViews page={page} filters={filters} />
            {actions}
          </>
        }
      />

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-slate-100 px-5 py-4">
            <SheetTitle>More filters</SheetTitle>
            <SheetDescription>Applied to the list, its totals and any export.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <fieldset className="space-y-3">
              <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Who and what</legend>
              <DrawerSelect label="Client" value={filters.get('client')} onChange={(value) => filters.set({ client: value })} options={clientOptions} placeholder="All clients" />
              <DrawerSelect label="DGM office" value={filters.get('dgm')} onChange={(value) => filters.set({ dgm: value })} options={lookups.dgmOffices.map((office) => ({ value: office, label: office }))} placeholder="All offices" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DrawerSelect label="Main category" value={filters.get('category')} onChange={(value) => filters.set({ category: value, billType: undefined })} options={categoryOptions} placeholder="All" />
                <DrawerSelect label="Sub category" value={filters.get('billType')} onChange={(value) => filters.set({ billType: value })} options={billTypes} placeholder="All" />
                <DrawerSelect label="Transaction type" value={filters.get('txn')} onChange={(value) => filters.set({ txn: value })} options={entries(TRANSACTION_TYPE_LABELS)} />
                <DrawerSelect label="Workflow status" value={filters.get('workflow')} onChange={(value) => filters.set({ workflow: value })} options={entries(WORKFLOW_STATUS_LABELS)} />
              </div>
              <DrawerSelect label="Collection owner" value={filters.get('owner')} onChange={(value) => filters.set({ owner: value })} options={ownerOptions} placeholder="Anyone" />
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Dates and ageing</legend>
              <div className="grid grid-cols-2 gap-3">
                <DrawerInput label="Bill date from" type="date" value={filters.get('from')} onChange={(event) => filters.set({ from: event.target.value })} />
                <DrawerInput label="Bill date to" type="date" value={filters.get('to')} onChange={(event) => filters.set({ to: event.target.value })} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DrawerSelect label="Ageing bucket" value={filters.get('ageing')} onChange={(value) => filters.set({ ageing: value })} options={buckets} placeholder="Any age" />
                <DrawerSelect label="Aged from" value={filters.get('basis')} onChange={(value) => filters.set({ basis: value })} options={entries(AGEING_BASIS_LABELS)} placeholder={`Default (${AGEING_BASIS_LABELS[lookups.config.settings.defaultAgeingBasis]})`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <DrawerInput label="As on date" type="date" value={filters.get('asOf')} onChange={(event) => filters.set({ asOf: event.target.value })} />
                <DrawerInput label="Target week" placeholder="2026-W41" value={filters.get('targetWeek')} onChange={(event) => filters.set({ targetWeek: event.target.value })} />
              </div>
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Amount outstanding</legend>
              <div className="grid grid-cols-2 gap-3">
                <DrawerInput label="At least (₹)" type="number" inputMode="decimal" value={filters.get('min')} onChange={(event) => filters.set({ min: event.target.value })} />
                <DrawerInput label="At most (₹)" type="number" inputMode="decimal" value={filters.get('max')} onChange={(event) => filters.set({ max: event.target.value })} />
              </div>
            </fieldset>
          </div>
          <SheetFooter className="flex-row justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <Button variant="outline" onClick={() => filters.clear()}>
              Reset all
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
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
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
