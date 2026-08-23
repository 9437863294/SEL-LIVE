'use client';

import { useMemo, useState } from 'react';
import { CalendarRange, Filter, RotateCcw, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { E_APPROVAL_PRIORITIES, E_APPROVAL_STATUSES, type EApprovalPriority } from '@/lib/e-approval';
import type { EApprovalAnalyticsFilter } from '@/lib/e-approval-analytics';
import { useEApprovalDirectory } from '../hooks';

const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'This financial year', days: null },
] as const;

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** April–March, matching the reference-number series. */
const financialYearStart = (now = new Date()) =>
  new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1);

/**
 * The single filter row that scopes every chart on a report page.
 *
 * One row above everything, never per-card: two charts on one screen answering the same question
 * from different slices is how a reader draws a false conclusion and blames the data. Collapsed to a
 * summary line on mobile, because six selects stacked vertically push the actual report below the
 * fold.
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
  const [open, setOpen] = useState(false);

  const set = (patch: Partial<EApprovalAnalyticsFilter>) => onChange({ ...value, ...patch });
  const one = (list: string[] | undefined) => (list?.length === 1 ? list[0] : 'ALL');
  const pick = (next: string): string[] | undefined => (next === 'ALL' ? undefined : [next]);

  const activeCount = useMemo(() => {
    let count = 0;
    if (value.from || value.to) count += 1;
    if (value.departmentIds?.length) count += 1;
    if (value.projectIds?.length) count += 1;
    if (value.approvalTypeIds?.length) count += 1;
    if (value.statuses?.length) count += 1;
    if (value.priorities?.length) count += 1;
    if (value.minAmount != null || value.maxAmount != null) count += 1;
    if (value.search?.trim()) count += 1;
    return count;
  }, [value]);

  const applyPreset = (days: number | null) => {
    const to = isoDay(new Date());
    const from = days == null ? isoDay(financialYearStart()) : isoDay(new Date(Date.now() - days * 86_400_000));
    set({ from, to });
  };

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="space-y-2 px-2.5 py-2.5 sm:px-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={open ? 'default' : 'outline'}
            className="h-8 gap-1.5 text-xs"
            onClick={() => setOpen((current) => !current)}
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
            {activeCount > 0 && (
              <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">
                {activeCount}
              </Badge>
            )}
          </Button>

          {PRESETS.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              onClick={() => applyPreset(preset.days)}
            >
              {preset.label}
            </Button>
          ))}

          <span className="ml-auto flex items-center gap-1.5">
            {(value.from || value.to) && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <CalendarRange className="h-3 w-3" />
                {value.from || '…'} → {value.to || 'today'}
              </Badge>
            )}
            {activeCount > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => onChange({})}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </span>
        </div>

        {open && (
          <div className="grid gap-2 border-t pt-2 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">From</Label>
              <Input
                type="date"
                value={value.from ?? ''}
                onChange={(event) => set({ from: event.target.value || null })}
                className="mt-1 h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">To</Label>
              <Input
                type="date"
                value={value.to ?? ''}
                onChange={(event) => set({ to: event.target.value || null })}
                className="mt-1 h-8 text-xs"
              />
            </div>

            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Department</Label>
              <Select value={one(value.departmentIds)} onValueChange={(next) => set({ departmentIds: pick(next) })}>
                <SelectTrigger className="mt-1 h-8 text-xs">
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
            </div>

            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Project / site</Label>
              <Select value={one(value.projectIds)} onValueChange={(next) => set({ projectIds: pick(next) })}>
                <SelectTrigger className="mt-1 h-8 text-xs">
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
            </div>

            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Approval type</Label>
              <Select
                value={one(value.approvalTypeIds)}
                onValueChange={(next) => set({ approvalTypeIds: pick(next) })}
              >
                <SelectTrigger className="mt-1 h-8 text-xs">
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
            </div>

            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</Label>
              <Select value={one(value.statuses)} onValueChange={(next) => set({ statuses: pick(next) })}>
                <SelectTrigger className="mt-1 h-8 text-xs">
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
            </div>

            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Priority</Label>
              <Select
                value={value.priorities?.length === 1 ? value.priorities[0] : 'ALL'}
                onValueChange={(next) =>
                  set({ priorities: next === 'ALL' ? undefined : [next as EApprovalPriority] })
                }
              >
                <SelectTrigger className="mt-1 h-8 text-xs">
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
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Min ₹</Label>
                <Input
                  type="number"
                  value={value.minAmount ?? ''}
                  onChange={(event) => set({ minAmount: event.target.value === '' ? null : Number(event.target.value) })}
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Max ₹</Label>
                <Input
                  type="number"
                  value={value.maxAmount ?? ''}
                  onChange={(event) => set({ maxAmount: event.target.value === '' ? null : Number(event.target.value) })}
                  className="mt-1 h-8 text-xs"
                />
              </div>
            </div>

            <div className="sm:col-span-2 lg:col-span-4">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Search</Label>
              <div className="relative mt-1">
                <Input
                  value={value.search ?? ''}
                  onChange={(event) => set({ search: event.target.value })}
                  placeholder="Reference, subject, requester, pending-with…"
                  className="h-8 pr-7 text-xs"
                />
                {value.search && (
                  <button
                    type="button"
                    onClick={() => set({ search: '' })}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
