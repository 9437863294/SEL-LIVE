"use client";

/**
 * Page furniture for the Daily Progress screens.
 *
 * The shell parts are Project Management's own (see jmc-page-shell.tsx, where they were first
 * factored out), re-exported here under DPR names so these screens compose from the same
 * furniture instead of a hand-copy that drifts.
 */

import { useMemo } from "react";
import { CalendarRange } from "lucide-react";
import {
  DPR_PERIOD_TYPES,
  DPR_SCOPES,
  formatPeriodLabel,
  periodRangeFor,
  type DprDateRange,
  type DprPeriodType,
  type DprScope,
} from "@/lib/project-management-dpr";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export {
  JmcPageShell as DprPageShell,
  JmcLoadingState as DprLoadingState,
  JmcAccessDenied as DprAccessDenied,
  JmcProjectNotFound as DprProjectNotFound,
  JMC_MAIN_CLASS as DPR_MAIN_CLASS,
} from "@/components/jmc/jmc-page-shell";

/** DPR's accent — the amber the progress tiles carry across the module. */
export const DPR_GRADIENT = "from-amber-500 to-orange-600";

/** Quantities, not money: enough decimals to hold a measured figure, grouped Indian style. */
export const formatQty = (value: number): string =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(
    Math.round(value * 1000) / 1000,
  );

export const formatPct = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value * 10) / 10}%`;

export const formatDisplayDate = (isoDate: string): string => {
  if (!isoDate) return "—";
  const date = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? isoDate
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/** Today in the local ISO form the register stores dates in. */
export const todayIso = (): string => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
};

/** "Custom" is a picker state, not a stored period type, so it lives only in the UI. */
export type DprPeriodChoice = DprPeriodType | "Custom";

export interface DprPeriodSelection {
  choice: DprPeriodChoice;
  anchorDate: string;
  customStart: string;
  customEnd: string;
}

export const defaultPeriodSelection = (choice: DprPeriodChoice = "Week"): DprPeriodSelection => {
  const today = todayIso();
  const range = periodRangeFor(choice === "Custom" ? "Week" : choice, today);
  return { choice, anchorDate: today, customStart: range.startDate, customEnd: range.endDate };
};

/** The inclusive range a selection resolves to. */
export const resolvePeriodRange = (selection: DprPeriodSelection): DprDateRange =>
  selection.choice === "Custom"
    ? { startDate: selection.customStart, endDate: selection.customEnd }
    : periodRangeFor(selection.choice, selection.anchorDate);

/**
 * The granularity to bucket a trend at. A custom range is read by day when it is short enough to
 * stay legible, and by week beyond that — a 90-day range as 90 bars is unreadable.
 */
export const resolveTrendGranularity = (
  selection: DprPeriodSelection,
  range: DprDateRange,
): DprPeriodType => {
  if (selection.choice === "Day") return "Day";
  if (selection.choice === "Week") return "Day";
  if (selection.choice === "Month") return "Day";
  const days =
    (new Date(`${range.endDate}T00:00:00`).getTime() -
      new Date(`${range.startDate}T00:00:00`).getTime()) /
      86_400_000 +
    1;
  if (!Number.isFinite(days) || days <= 31) return "Day";
  return days <= 180 ? "Week" : "Month";
};

export function DprPeriodPicker({
  value,
  onChange,
  className,
}: {
  value: DprPeriodSelection;
  onChange: (next: DprPeriodSelection) => void;
  className?: string;
}) {
  const range = useMemo(() => resolvePeriodRange(value), [value]);
  const label =
    value.choice === "Custom"
      ? `${formatDisplayDate(range.startDate)} – ${formatDisplayDate(range.endDate)}`
      : formatPeriodLabel(value.choice, range.startDate);

  return (
    <div className={className}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="dpr-period-type">Period</Label>
          <Select
            value={value.choice}
            onValueChange={(next) => onChange({ ...value, choice: next as DprPeriodChoice })}
          >
            <SelectTrigger id="dpr-period-type" className="text-left">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DPR_PERIOD_TYPES.map((periodType) => (
                <SelectItem key={periodType} value={periodType}>
                  {periodType === "Day" ? "Daily" : periodType === "Week" ? "Weekly" : "Monthly"}
                </SelectItem>
              ))}
              <SelectItem value="Custom">Custom range</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {value.choice === "Custom" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="dpr-period-from">From</Label>
              <Input
                id="dpr-period-from"
                type="date"
                value={value.customStart}
                onChange={(event) => onChange({ ...value, customStart: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dpr-period-to">To</Label>
              <Input
                id="dpr-period-to"
                type="date"
                value={value.customEnd}
                onChange={(event) => onChange({ ...value, customEnd: event.target.value })}
              />
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="dpr-period-anchor">
              {value.choice === "Day" ? "Date" : `Any date in the ${value.choice.toLowerCase()}`}
            </Label>
            <Input
              id="dpr-period-anchor"
              type="date"
              value={value.anchorDate}
              onChange={(event) => onChange({ ...value, anchorDate: event.target.value })}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Showing</Label>
          <div className="flex h-10 items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 text-sm font-medium">
            <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Civil / Erection, with an "All" option where a screen reports across both. */
export function DprScopeTabs({
  value,
  onChange,
  includeAll = false,
  className,
}: {
  value: DprScope | "All";
  onChange: (next: DprScope | "All") => void;
  includeAll?: boolean;
  className?: string;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as DprScope | "All")} className={className}>
      <TabsList>
        {includeAll && <TabsTrigger value="All">All scopes</TabsTrigger>}
        {DPR_SCOPES.map((scope) => (
          <TabsTrigger key={scope} value={scope}>
            {scope}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
