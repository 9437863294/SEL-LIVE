"use client";

import { useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, endOfMonth, endOfYear, format, startOfMonth } from "date-fns";
import { cn } from "@/lib/utils";

export type GanttRow = {
  id: string;
  label: string;
  sublabel?: string;
  start: string; // yyyy-MM-dd
  end: string; // yyyy-MM-dd
  barLabel?: string;
  colorClass: string; // solid Tailwind bg-* class for the bar
};

export type GanttLegendItem = {
  label: string;
  colorClass: string;
};

type ZoomLevel = "day" | "week" | "month" | "year" | "all";

type Band = { key: string; label: string; days: number };

const LABEL_WIDTH = 240;
const ROW_HEIGHT = 40;
const TIER1_HEIGHT = 24;
const TIER2_HEIGHT = 28;

// Pixels-per-day used for every zoom level except "all", which instead scales the
// whole range to fit the available width (no horizontal scroll).
const PIXELS_PER_DAY: Record<Exclude<ZoomLevel, "all">, number> = {
  day: 32,
  week: 12,
  month: 4,
  year: 1.2,
};

const ZOOM_LEVELS: { value: ZoomLevel; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "all", label: "All" },
];

const toDate = (value: string) => new Date(`${value}T00:00:00`);
const isValidRow = (row: GanttRow) =>
  Boolean(row.start) && Boolean(row.end) && !Number.isNaN(toDate(row.start).getTime()) && !Number.isNaN(toDate(row.end).getTime());

function buildMonthBands(rangeStart: Date, rangeEnd: Date): Band[] {
  const bands: Band[] = [];
  let cursor = rangeStart;
  while (cursor <= rangeEnd) {
    const monthEnd = endOfMonth(cursor);
    const segmentEnd = monthEnd < rangeEnd ? monthEnd : rangeEnd;
    bands.push({ key: format(cursor, "yyyy-MM"), label: format(cursor, "MMM yyyy"), days: differenceInCalendarDays(segmentEnd, cursor) + 1 });
    cursor = addDays(monthEnd, 1);
  }
  return bands;
}

function buildYearBands(rangeStart: Date, rangeEnd: Date): Band[] {
  const bands: Band[] = [];
  let cursor = rangeStart;
  while (cursor <= rangeEnd) {
    const yearEnd = endOfYear(cursor);
    const segmentEnd = yearEnd < rangeEnd ? yearEnd : rangeEnd;
    bands.push({ key: format(cursor, "yyyy"), label: format(cursor, "yyyy"), days: differenceInCalendarDays(segmentEnd, cursor) + 1 });
    cursor = addDays(yearEnd, 1);
  }
  return bands;
}

function buildWeekBands(rangeStart: Date, rangeEnd: Date): Band[] {
  const bands: Band[] = [];
  let cursor = rangeStart;
  while (cursor <= rangeEnd) {
    const weekEnd = addDays(cursor, 6);
    const segmentEnd = weekEnd < rangeEnd ? weekEnd : rangeEnd;
    bands.push({ key: format(cursor, "yyyy-MM-dd"), label: format(cursor, "dd MMM"), days: differenceInCalendarDays(segmentEnd, cursor) + 1 });
    cursor = addDays(cursor, 7);
  }
  return bands;
}

function buildDayBands(rangeStart: Date, rangeEnd: Date): Band[] {
  const bands: Band[] = [];
  let cursor = rangeStart;
  while (cursor <= rangeEnd) {
    bands.push({ key: format(cursor, "yyyy-MM-dd"), label: format(cursor, "d"), days: 1 });
    cursor = addDays(cursor, 1);
  }
  return bands;
}

function getHeaderTiers(zoom: ZoomLevel, rangeStart: Date, rangeEnd: Date, totalDays: number): { tier1?: Band[]; tier2: Band[] } {
  if (zoom === "day") return { tier1: buildMonthBands(rangeStart, rangeEnd), tier2: buildDayBands(rangeStart, rangeEnd) };
  if (zoom === "week") return { tier1: buildMonthBands(rangeStart, rangeEnd), tier2: buildWeekBands(rangeStart, rangeEnd) };
  if (zoom === "month") return { tier1: buildYearBands(rangeStart, rangeEnd), tier2: buildMonthBands(rangeStart, rangeEnd) };
  if (zoom === "year") return { tier2: buildYearBands(rangeStart, rangeEnd) };
  return { tier2: totalDays > 730 ? buildYearBands(rangeStart, rangeEnd) : buildMonthBands(rangeStart, rangeEnd) };
}

export default function GanttChart({
  rows,
  onSelectRow,
  legend,
  emptyMessage,
}: {
  rows: GanttRow[];
  onSelectRow: (id: string) => void;
  legend: GanttLegendItem[];
  emptyMessage?: string;
}) {
  const [zoom, setZoom] = useState<ZoomLevel>("month");

  const validRows = useMemo(() => rows.filter(isValidRow).sort((a, b) => a.start.localeCompare(b.start)), [rows]);
  const skippedCount = rows.length - validRows.length;

  const { rangeStart, rangeEnd, totalDays } = useMemo(() => {
    if (!validRows.length) {
      const today = new Date();
      return { rangeStart: startOfMonth(today), rangeEnd: endOfMonth(today), totalDays: 30 };
    }
    const starts = validRows.map((row) => toDate(row.start).getTime());
    const ends = validRows.map((row) => toDate(row.end).getTime());
    const start = startOfMonth(new Date(Math.min(...starts)));
    const end = endOfMonth(new Date(Math.max(...ends)));
    return { rangeStart: start, rangeEnd: end, totalDays: Math.max(differenceInCalendarDays(end, start) + 1, 1) };
  }, [validRows]);

  const isFit = zoom === "all";
  const pixelsPerDay = isFit ? null : PIXELS_PER_DAY[zoom];
  const timelineWidth = pixelsPerDay ? totalDays * pixelsPerDay : null;

  // Converts a day-count (offset or duration) into a CSS length, always relative to the
  // timeline column's own width: fixed pixels for scrollable zoom levels, or a percentage
  // of the range for "All" (which fits the range to the available width, no scroll).
  const toSize = (days: number) => (pixelsPerDay ? `${days * pixelsPerDay}px` : `${(days / totalDays) * 100}%`);

  const { tier1, tier2 } = useMemo(() => getHeaderTiers(zoom, rangeStart, rangeEnd, totalDays), [zoom, rangeStart, rangeEnd, totalDays]);
  const headerHeight = (tier1 ? TIER1_HEIGHT : 0) + TIER2_HEIGHT;

  const todayOffsetDays = differenceInCalendarDays(new Date(), rangeStart);
  const showToday = todayOffsetDays >= 0 && todayOffsetDays <= totalDays;

  if (!validRows.length) {
    return <p className="p-6 text-center text-sm text-muted-foreground">{emptyMessage ?? "Nothing scheduled yet."}</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {legend.map((item) => (
            <span key={item.label} className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", item.colorClass)} /> {item.label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {skippedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {skippedCount} item{skippedCount === 1 ? "" : "s"} without both dates not shown.
            </p>
          )}
          <div className="flex items-center gap-1 rounded-md bg-muted p-1">
            {ZOOM_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                onClick={() => setZoom(level.value)}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                  zoom === level.value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {level.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <div className="flex">
          {/* Sticky item-label column */}
          <div className="sticky left-0 z-20 flex-none border-r bg-background" style={{ width: LABEL_WIDTH }}>
            <div
              className="sticky top-0 z-20 flex items-center bg-muted px-3 text-xs font-medium text-muted-foreground"
              style={{ height: headerHeight }}
            >
              Item
            </div>
            {validRows.map((row) => (
              <div key={row.id} className="flex flex-col justify-center border-t px-3" style={{ height: ROW_HEIGHT }}>
                <p className="truncate text-xs font-medium" title={row.label}>
                  {row.label}
                </p>
                {row.sublabel && (
                  <p className="truncate text-[11px] text-muted-foreground" title={row.sublabel}>
                    {row.sublabel}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Timeline column */}
          <div className={cn("relative", isFit && "flex-1")} style={isFit ? undefined : { width: timelineWidth ?? undefined }}>
            <div className="sticky top-0 z-10 bg-muted">
              {tier1 && (
                <div className="flex" style={{ height: TIER1_HEIGHT }}>
                  {tier1.map((band) => (
                    <div
                      key={band.key}
                      className="truncate border-r border-b px-2 text-center text-[11px] font-medium leading-6 text-muted-foreground"
                      style={{ width: toSize(band.days), minWidth: toSize(band.days) }}
                    >
                      {band.label}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex border-b" style={{ height: TIER2_HEIGHT }}>
                {tier2.map((band) => (
                  <div
                    key={band.key}
                    className="truncate border-r px-1 text-center text-[11px] font-medium leading-7 text-muted-foreground"
                    style={{ width: toSize(band.days), minWidth: toSize(band.days) }}
                  >
                    {band.label}
                  </div>
                ))}
              </div>
            </div>

            {showToday && (
              <div
                className="pointer-events-none absolute z-0 border-l-2 border-dashed border-red-400"
                style={{ left: toSize(todayOffsetDays), top: headerHeight, bottom: 0 }}
              />
            )}

            {validRows.map((row) => {
              const left = toSize(differenceInCalendarDays(toDate(row.start), rangeStart));
              const width = toSize(differenceInCalendarDays(toDate(row.end), toDate(row.start)) + 1);
              return (
                <div key={row.id} className="relative border-t" style={{ height: ROW_HEIGHT }}>
                  <button
                    type="button"
                    onClick={() => onSelectRow(row.id)}
                    className={cn(
                      "absolute top-1/2 flex h-5 -translate-y-1/2 items-center overflow-hidden rounded px-2 text-[11px] font-medium text-white shadow-sm hover:opacity-90",
                      row.colorClass,
                    )}
                    style={{ left, width, minWidth: 6 }}
                    title={`${row.label} · ${format(toDate(row.start), "dd MMM yyyy")} – ${format(toDate(row.end), "dd MMM yyyy")}`}
                  >
                    <span className="truncate">{row.barLabel}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
