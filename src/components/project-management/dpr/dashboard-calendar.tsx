"use client";

/**
 * The filing calendar: one cell per day of the period, one mark per scope — submitted, draft,
 * missing on a working day, not expected, or not yet due.
 *
 * Status is never colour alone: every mark carries a glyph (✓ ✎ !), the legend names each one,
 * and each cell's label reads the day out in words. A mark for a day that has happened opens that
 * scope's sheet for the date.
 */

import Link from "next/link";
import { DPR_BASE_PATH, formatPeriodLabel, type DprScope } from "@/lib/project-management-dpr";
import type {
  DprFilingCalendar,
  DprFilingDay,
  DprFilingState,
} from "@/lib/project-management-dpr-dashboard";
import { dprHref } from "@/components/project-management/dpr/dpr-shell";
import { DPR_STATUS_COLOURS, useDprChartPalette } from "@/components/project-management/dpr/dashboard-charts";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATE_TEXT: Record<DprFilingState, string> = {
  submitted: "Submitted",
  draft: "Draft",
  missing: "Not recorded",
  off: "Not expected",
  future: "Not yet due",
};

const STATE_GLYPH: Record<DprFilingState, string> = {
  submitted: "✓",
  draft: "✎",
  missing: "!",
  off: "",
  future: "",
};

function useStateStyle() {
  const palette = useDprChartPalette();
  return (state: DprFilingState): { backgroundColor?: string; color?: string; borderColor?: string } => {
    switch (state) {
      case "submitted":
        return { backgroundColor: DPR_STATUS_COLOURS.good, color: "#ffffff" };
      case "draft":
        return { backgroundColor: DPR_STATUS_COLOURS.warning, color: "#0b0b0b" };
      case "missing":
        return { backgroundColor: DPR_STATUS_COLOURS.critical, color: "#ffffff" };
      case "off":
        return { backgroundColor: palette.neutral };
      default:
        return { borderColor: "hsl(var(--border))" };
    }
  };
}

function DayCell({
  day,
  scopes,
  mappingId,
}: {
  day: DprFilingDay;
  scopes: DprScope[];
  mappingId: string;
}) {
  const styleFor = useStateStyle();
  const label = `${formatPeriodLabel("Day", day.date)} · ${scopes
    .map((scope) => `${scope}: ${STATE_TEXT[day.states[scope] ?? "off"].toLowerCase()}`)
    .join(" · ")}`;
  return (
    <div
      className={cn(
        "flex min-h-[52px] flex-col gap-1 rounded-md border p-1",
        day.isToday ? "border-primary ring-1 ring-primary" : "border-border/60",
      )}
      title={label}
    >
      <span className={cn("text-[11px] leading-none tabular-nums", day.isToday ? "font-bold text-primary" : "text-muted-foreground")}>
        {day.day}
      </span>
      <div className="flex flex-col gap-0.5">
        {scopes.map((scope) => {
          const state = day.states[scope] ?? "off";
          const mark = (
            <span
              className={cn(
                "flex h-4 items-center justify-center gap-0.5 rounded-sm text-[10px] font-semibold leading-none",
                state === "future" && "border border-dashed",
              )}
              style={styleFor(state)}
            >
              {scopes.length > 1 ? <span aria-hidden="true">{scope.charAt(0)}</span> : null}
              <span aria-hidden="true">{STATE_GLYPH[state]}</span>
            </span>
          );
          // A day that has happened links to its sheet — to record it, finish the draft, or read it.
          return state === "future" || state === "off" ? (
            <div key={scope} aria-hidden="true">
              {mark}
            </div>
          ) : (
            <Link
              key={scope}
              href={dprHref(`${DPR_BASE_PATH}/entry`, mappingId, { scope, date: day.date })}
              aria-label={`${scope}, ${formatPeriodLabel("Day", day.date)}: ${STATE_TEXT[state]}. Open the sheet.`}
              className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {mark}
            </Link>
          );
        })}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function DprFilingCalendarView({
  calendar,
  mappingId,
}: {
  calendar: DprFilingCalendar;
  mappingId: string;
}) {
  const styleFor = useStateStyle();
  if (calendar.weeks.length === 0) return null;
  return (
    <div className="space-y-3">
      {calendar.truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the most recent {formatPeriodLabel("Day", calendar.range.startDate)} –{" "}
          {formatPeriodLabel("Day", calendar.range.endDate)} of a longer period.
        </p>
      ) : null}
      <div className="grid grid-cols-7 gap-1" role="group" aria-label="Daily sheets filed">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} aria-hidden="true" className="text-center text-[11px] font-medium text-muted-foreground">
            {weekday}
          </div>
        ))}
        {calendar.weeks.flatMap((week, weekIndex) =>
          week.map((day, dayIndex) =>
            day ? (
              <DayCell key={day.date} day={day} scopes={calendar.scopes} mappingId={mappingId} />
            ) : (
              <div key={`pad-${weekIndex}-${dayIndex}`} aria-hidden="true" />
            ),
          ),
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {(["submitted", "draft", "missing", "off", "future"] as const).map((state) => (
          <span key={state} className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex h-4 w-4 items-center justify-center rounded-sm text-[10px] font-semibold",
                state === "future" && "border border-dashed",
              )}
              style={styleFor(state)}
              aria-hidden="true"
            >
              {STATE_GLYPH[state]}
            </span>
            {STATE_TEXT[state]}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {calendar.scopes.map((scope) => {
          const counts = calendar.counts[scope];
          if (!counts) return null;
          return (
            <div key={scope} className="rounded-md bg-muted/40 px-3 py-2 text-xs">
              <span className="font-semibold">{scope}</span>{" "}
              <span className="text-muted-foreground tabular-nums">
                {counts.submitted} submitted · {counts.draft} draft · {counts.missing} not recorded
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
