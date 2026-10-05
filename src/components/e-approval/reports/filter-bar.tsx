'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FilterBar } from '@/components/shared/filter-bar';
import { E_APPROVAL_PRIORITIES, E_APPROVAL_STATUSES, type EApprovalPriority } from '@/lib/e-approval';
import { eApprovalPresetRange, type EApprovalAnalyticsFilter } from '@/lib/e-approval-analytics';
import { useEApprovalDirectory } from '../hooks';

const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'This financial year', days: null },
] as const;


/**
 * The single filter row that scopes every chart on a report page.
 *
 * One row above everything, never per-card: two charts on one screen answering the same question
 * from different slices is how a reader draws a false conclusion and blames the data. Built on the
 * app's `FilterBar`, which folds the controls behind a "Filters" button on a phone, because six
 * selects stacked vertically push the actual report below the fold.
 */
export function EApprovalFilterBar({
  value,
  onChange,
  className,
}: {
  value: EApprovalAnalyticsFilter;
  onChange: (next: EApprovalAnalyticsFilter) => void;
  className?: string;
}) {
  const { directory } = useEApprovalDirectory();
  const fieldId = useId();

  const set = (patch: Partial<EApprovalAnalyticsFilter>) => onChange({ ...value, ...patch });

  /**
   * The search box types locally and reports upward on a pause.
   *
   * Reporting on every keystroke re-ran the filter over the whole reporting corpus — up to 2,000
   * requests plus 8,000 steps plus 8,000 history rows — and, because that produces three new arrays,
   * re-rendered every Recharts surface on the page with it. The result was a search field that
   * dropped characters on any organisation with real data in it.
   *
   * The controlled `value.search` still wins whenever it changes from outside (the Clear button, a
   * preset, a page that seeds an initial filter), so this stays a controlled input in every sense
   * that matters — it just does not make the page re-derive itself mid-word.
   */
  const [searchDraft, setSearchDraft] = useState(value.search ?? '');
  const searchRef = useRef(value.search ?? '');
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  useEffect(() => {
    onChangeRef.current = onChange;
    valueRef.current = value;
  });

  useEffect(() => {
    const incoming = value.search ?? '';
    if (incoming === searchRef.current) return;
    searchRef.current = incoming;
    setSearchDraft(incoming);
  }, [value.search]);

  useEffect(() => {
    if (searchDraft === searchRef.current) return;
    const timer = setTimeout(() => {
      searchRef.current = searchDraft;
      onChangeRef.current({ ...valueRef.current, search: searchDraft });
    }, 250);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const one = (list: string[] | undefined) => (list?.length === 1 ? list[0] : 'ALL');
  const pick = (next: string): string[] | undefined => (next === 'ALL' ? undefined : [next]);

  /** Filters set, not counting the search — `FilterBar` counts that on its own. */
  const activeCount = useMemo(() => {
    let count = 0;
    if (value.from || value.to) count += 1;
    if (value.departmentIds?.length) count += 1;
    if (value.projectIds?.length) count += 1;
    if (value.approvalTypeIds?.length) count += 1;
    if (value.statuses?.length) count += 1;
    if (value.priorities?.length) count += 1;
    if (value.minAmount != null || value.maxAmount != null) count += 1;
    return count;
  }, [value]);

  const applyPreset = (days: number | null) => {
    // Local calendar days, read off the clock at the click. The previous helpers printed dates in UTC,
    // which in India put the start of the financial year on 31 March.
    set(eApprovalPresetRange(days, new Date()));
  };

  return (
    <FilterBar
      className={className}
      search={{
        value: searchDraft,
        onChange: (next) => {
          setSearchDraft(next);
          // Clearing the box reports at once rather than after the typing pause.
          if (!next) {
            searchRef.current = '';
            set({ search: '' });
          }
        },
        placeholder: 'Reference, subject, requester, pending-with…',
        label: 'Search approvals',
      }}
      activeCount={activeCount}
      onClear={() => {
        setSearchDraft('');
        searchRef.current = '';
        onChange({});
      }}
      summary={
        value.from || value.to ? (
          <span className="inline-flex items-center gap-1">
            <CalendarRange className="h-3 w-3" aria-hidden="true" />
            {value.from || '…'} → {value.to || 'today'}
          </span>
        ) : undefined
      }
      actions={PRESETS.map((preset) => (
        <Button key={preset.label} type="button" variant="ghost" onClick={() => applyPreset(preset.days)}>
          {preset.label}
        </Button>
      ))}
    >
      <div className="flex items-center gap-1.5">
        <Label htmlFor={`${fieldId}-from`} className="shrink-0 text-xs text-muted-foreground">From</Label>
        <Input
          id={`${fieldId}-from`}
          type="date"
          value={value.from ?? ''}
          onChange={(event) => set({ from: event.target.value || null })}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <Label htmlFor={`${fieldId}-to`} className="shrink-0 text-xs text-muted-foreground">To</Label>
        <Input
          id={`${fieldId}-to`}
          type="date"
          value={value.to ?? ''}
          onChange={(event) => set({ to: event.target.value || null })}
        />
      </div>

      <Select value={one(value.departmentIds)} onValueChange={(next) => set({ departmentIds: pick(next) })}>
        <SelectTrigger aria-label="Department">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All departments</SelectItem>
          {directory.departments.map((row) => (
            <SelectItem key={row.id} value={row.id}>
              {row.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={one(value.projectIds)} onValueChange={(next) => set({ projectIds: pick(next) })}>
        <SelectTrigger aria-label="Project / site">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All projects</SelectItem>
          {directory.projects.map((row) => (
            <SelectItem key={row.id} value={row.id}>
              {row.projectName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={one(value.approvalTypeIds)} onValueChange={(next) => set({ approvalTypeIds: pick(next) })}>
        <SelectTrigger aria-label="Approval type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All types</SelectItem>
          {directory.types.map((row) => (
            <SelectItem key={row.id} value={row.id}>
              {row.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={one(value.statuses)} onValueChange={(next) => set({ statuses: pick(next) })}>
        <SelectTrigger aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All statuses</SelectItem>
          {E_APPROVAL_STATUSES.map((row) => (
            <SelectItem key={row} value={row}>
              {row}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.priorities?.length === 1 ? value.priorities[0] : 'ALL'}
        onValueChange={(next) => set({ priorities: next === 'ALL' ? undefined : [next as EApprovalPriority] })}
      >
        <SelectTrigger aria-label="Priority">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">Any priority</SelectItem>
          {E_APPROVAL_PRIORITIES.map((row) => (
            <SelectItem key={row} value={row}>
              {row}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1.5">
        <Label htmlFor={`${fieldId}-min`} className="shrink-0 text-xs text-muted-foreground">Min ₹</Label>
        <Input
          id={`${fieldId}-min`}
          type="number"
          value={value.minAmount ?? ''}
          onChange={(event) => set({ minAmount: event.target.value === '' ? null : Number(event.target.value) })}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <Label htmlFor={`${fieldId}-max`} className="shrink-0 text-xs text-muted-foreground">Max ₹</Label>
        <Input
          id={`${fieldId}-max`}
          type="number"
          value={value.maxAmount ?? ''}
          onChange={(event) => set({ maxAmount: event.target.value === '' ? null : Number(event.target.value) })}
        />
      </div>
    </FilterBar>
  );
}
