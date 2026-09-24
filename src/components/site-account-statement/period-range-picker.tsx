'use client';

import { CalendarRange } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  clampRange,
  describeRange,
  matchPreset,
  periodLabel,
  RANGE_PRESETS,
  resolvePreset,
  type PeriodRange,
  type SASPeriod,
  type SASRangePreset,
} from '@/lib/site-account-statement-period-range';

/**
 * Month-range picker for the budget reports.
 *
 * A preset covers the question people actually ask nine times out of ten ("this quarter", "FY to
 * date"), and the two month pickers are there for the tenth. Choosing a preset fills the pickers in
 * rather than hiding them, so the range stays visible and can be nudged from there — a "Custom"
 * mode that blanks the fields makes you re-enter what you were already looking at.
 *
 * Months, not days: budgets are set per month, so a day range would invite a question the data
 * cannot answer. See `site-account-statement-period-range.ts`.
 */
export function PeriodRangePicker({
  range,
  onChange,
  options,
  className,
  compact = false,
}: {
  range: PeriodRange;
  onChange: (next: PeriodRange) => void;
  /** Months offered in the From/To lists, oldest first. */
  options: SASPeriod[];
  className?: string;
  /** Drops the trailing summary text, for tight filter bars. */
  compact?: boolean;
}) {
  const preset = matchPreset(range);

  function applyPreset(key: SASRangePreset) {
    const next = resolvePreset(key);
    // 'custom' resolves to null — it means "leave the range alone and edit it by hand".
    if (next) onChange(next);
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Select value={preset} onValueChange={v => applyPreset(v as SASRangePreset)}>
        <SelectTrigger className="h-8 w-full text-xs sm:w-auto sm:min-w-[150px]" aria-label="Date range preset">
          <div className="flex items-center gap-1.5">
            <CalendarRange className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <SelectValue />
          </div>
        </SelectTrigger>
        <SelectContent>
          {RANGE_PRESETS.map(({ key, label }) => (
            <SelectItem key={key} value={key}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1.5">
        <Select
          value={range.from}
          onValueChange={v => onChange(clampRange({ from: v, to: range.to }, 'from'))}
        >
          <SelectTrigger className="h-8 text-xs min-w-[110px]" aria-label="Range start month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {options.map(period => (
              <SelectItem key={period} value={period}>{periodLabel(period)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">to</span>

        <Select
          value={range.to}
          onValueChange={v => onChange(clampRange({ from: range.from, to: v }, 'to'))}
        >
          <SelectTrigger className="h-8 text-xs min-w-[110px]" aria-label="Range end month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {options.map(period => (
              <SelectItem key={period} value={period}>{periodLabel(period)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {preset !== 'thisMonth' && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs text-muted-foreground"
          onClick={() => applyPreset('thisMonth')}
        >
          This month
        </Button>
      )}

      {!compact && (
        <span className="text-xs font-medium text-slate-600">{describeRange(range)}</span>
      )}
    </div>
  );
}
