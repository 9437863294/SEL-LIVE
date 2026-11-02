'use client';

import { ArrowDownAZ, ArrowUpAZ, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { useBBSortControl } from './use-field-control';

/**
 * A list's sort, for the viewer: which column and which way, with a way back to the opening order
 * Field Control set. Changing it here changes nobody else's list. Site Account's control.
 */
export function BankSortControl({ control, className }: { control: ReturnType<typeof useBBSortControl>; className?: string }) {
  const { sort, setField, toggleDirection, reset, fields, atConfiguredDefault } = control;
  const ascending = sort.direction === 'asc';
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Select value={sort.field} onValueChange={setField}>
        <SelectTrigger aria-label="Sort by" className="w-full sm:w-[180px]">
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
        title={ascending ? 'Ascending — click for descending' : 'Descending — click for ascending'}
        aria-label={ascending ? 'Sorted ascending' : 'Sorted descending'}
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
