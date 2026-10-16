'use client';

import { ArrowDownAZ, ArrowUpAZ, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { sortDirectionLabel, type SortDirection, type SortField, type SortSetting } from '@/lib/list-sort';

/** The shape any configurable-sort hook returns (see `@/lib/list-sort`). */
export interface ListSortControlState {
  sort: SortSetting;
  setField: (field: string) => void;
  toggleDirection: () => void;
  reset: () => void;
  fields: SortField[];
  atConfiguredDefault: boolean;
}

/**
 * "Sort by" for a list's filter row: a column picker and a direction toggle. The reset button
 * appears only once the user has moved away from the configured default, so the usual case stays a
 * two-control strip.
 */
export function ListSortControl({ control, className }: { control: ListSortControlState; className?: string }) {
  const { sort, setField, toggleDirection, reset, fields, atConfiguredDefault } = control;
  const type = fields.find((field) => field.key === sort.field)?.type ?? 'text';
  const ascending = sort.direction === 'asc';
  const other: SortDirection = ascending ? 'desc' : 'asc';
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <Select value={sort.field} onValueChange={setField}>
        <SelectTrigger aria-label="Sort by" className="min-w-0">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          {fields.map((field) => (
            <SelectItem key={field.key} value={field.key}>Sort: {field.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        onClick={toggleDirection}
        // Worded per column type: an arrow alone doesn't say which way "down" sorts a date.
        title={`${sortDirectionLabel(type, sort.direction)} — click for ${sortDirectionLabel(type, other).toLowerCase()}`}
        aria-label={sortDirectionLabel(type, sort.direction)}
      >
        {ascending ? <ArrowUpAZ className="h-4 w-4" /> : <ArrowDownAZ className="h-4 w-4" />}
      </Button>
      {!atConfiguredDefault && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          onClick={reset}
          title="Back to the default order"
          aria-label="Reset sort to default"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
