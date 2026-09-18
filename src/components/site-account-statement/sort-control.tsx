'use client';

import { ArrowDownAZ, ArrowUpAZ, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { SortControl as SortControlState } from './use-sort-control';

/**
 * The "Sort by" control every Site Account Statement list shares.
 *
 * A column picker plus a direction toggle, sized to sit in the same filter row as the existing
 * selects. The reset button only appears once the user has moved away from the configured default,
 * so the common case stays a two-control strip.
 */
export function SortControl({
  control,
  className,
}: {
  control: SortControlState;
  className?: string;
}) {
  const { sort, setField, toggleDirection, reset, fields, atConfiguredDefault } = control;
  const ascending = sort.direction === 'asc';

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Select value={sort.field} onValueChange={setField}>
        <SelectTrigger className="h-9 text-sm" aria-label="Sort by">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          {fields.map(field => (
            <SelectItem key={field.key} value={field.key}>Sort: {field.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={toggleDirection}
        // Named rather than just arrowed: an icon alone does not say which way "down" sorts a date.
        title={ascending ? 'Ascending — click for descending' : 'Descending — click for ascending'}
        aria-label={ascending ? 'Sorted ascending' : 'Sorted descending'}
      >
        {ascending
          ? <ArrowUpAZ className="h-4 w-4" />
          : <ArrowDownAZ className="h-4 w-4" />}
      </Button>

      {!atConfiguredDefault && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground"
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
