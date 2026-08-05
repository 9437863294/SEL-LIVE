"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addMonths,
  addQuarters,
  addYears,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getQuarter,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subMonths,
  subQuarters,
  subYears,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type WorkplanCalendarEvent = {
  id: string;
  date: string; // yyyy-MM-dd (or any ISO date string — only the first 10 chars are used)
  label: string;
  colorClass: string; // resolved Tailwind color, e.g. "bg-blue-500"
};

export type WorkplanCalendarLegendItem = {
  label: string;
  colorClass: string;
};

type ViewMode = "month" | "quarter" | "year";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "month", label: "Monthly" },
  { value: "quarter", label: "Quarterly" },
  { value: "year", label: "Yearly" },
];

function MonthGrid({
  monthStart,
  eventsByDay,
  onSelectEvent,
  onDrillDown,
  compact,
}: {
  monthStart: Date;
  eventsByDay: Map<string, WorkplanCalendarEvent[]>;
  onSelectEvent: (id: string) => void;
  onDrillDown?: (day: Date) => void;
  compact: boolean;
}) {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(monthStart));
    const end = endOfWeek(endOfMonth(monthStart));
    return eachDayOfInterval({ start, end });
  }, [monthStart]);

  return (
    <div>
      {compact && (
        <button
          type="button"
          onClick={() => onDrillDown?.(monthStart)}
          className="mb-1.5 text-sm font-medium hover:underline"
        >
          {format(monthStart, "MMMM yyyy")}
        </button>
      )}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className={cn(
              "bg-muted text-center font-medium text-muted-foreground",
              compact ? "px-0.5 py-1 text-[10px]" : "px-2 py-1.5 text-xs",
            )}
          >
            {compact ? day.slice(0, 1) : day}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const events = eventsByDay.get(key) ?? [];
          const inMonth = isSameMonth(day, monthStart);

          if (compact) {
            return (
              <button
                type="button"
                key={key}
                onClick={() => onDrillDown?.(day)}
                className={cn(
                  "flex min-h-[30px] flex-col items-center justify-center gap-0.5 bg-background p-0.5 hover:bg-muted",
                  !inMonth && "bg-muted/30 text-muted-foreground",
                )}
              >
                <span className={cn("text-[10px]", isToday(day) && "font-semibold text-primary")}>{format(day, "d")}</span>
                {events.length > 0 && (
                  <span className="flex gap-0.5">
                    {events.slice(0, 3).map((event, index) => (
                      <span key={index} className={cn("h-1 w-1 rounded-full", event.colorClass)} />
                    ))}
                  </span>
                )}
              </button>
            );
          }

          return (
            <div
              key={key}
              className={cn("min-h-[92px] bg-background p-1.5", !inMonth && "bg-muted/30 text-muted-foreground")}
            >
              <p className={cn("mb-1 text-xs font-medium", isToday(day) && "text-primary")}>{format(day, "d")}</p>
              <div className="space-y-1">
                {events.slice(0, 3).map((event, index) => (
                  <button
                    key={`${event.id}-${index}`}
                    type="button"
                    onClick={() => onSelectEvent(event.id)}
                    className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted"
                    title={event.label}
                  >
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", event.colorClass)} />
                    <span className="truncate">{event.label}</span>
                  </button>
                ))}
                {events.length > 3 && (
                  <p className="px-1 text-[11px] text-muted-foreground">+{events.length - 3} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function WorkplanCalendar({
  events,
  onSelectEvent,
  legend,
}: {
  events: WorkplanCalendarEvent[];
  onSelectEvent: (id: string) => void;
  legend: WorkplanCalendarLegendItem[];
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [anchorDate, setAnchorDate] = useState(() => new Date());

  const eventsByDay = useMemo(() => {
    const map = new Map<string, WorkplanCalendarEvent[]>();
    for (const event of events) {
      if (!event.date) continue;
      const key = event.date.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [events]);

  const goPrev = () => {
    setAnchorDate((current) =>
      viewMode === "month" ? subMonths(current, 1) : viewMode === "quarter" ? subQuarters(current, 1) : subYears(current, 1),
    );
  };
  const goNext = () => {
    setAnchorDate((current) =>
      viewMode === "month" ? addMonths(current, 1) : viewMode === "quarter" ? addQuarters(current, 1) : addYears(current, 1),
    );
  };
  const goToday = () => setAnchorDate(new Date());

  const drillDown = (day: Date) => {
    setViewMode("month");
    setAnchorDate(day);
  };

  const periodLabel =
    viewMode === "month"
      ? format(anchorDate, "MMMM yyyy")
      : viewMode === "quarter"
        ? `Q${getQuarter(anchorDate)} ${format(anchorDate, "yyyy")} (${format(startOfQuarter(anchorDate), "MMM")} – ${format(
            addMonths(startOfQuarter(anchorDate), 2),
            "MMM",
          )})`
        : format(anchorDate, "yyyy");

  const monthsToRender = useMemo(() => {
    if (viewMode === "month") return [startOfMonth(anchorDate)];
    if (viewMode === "quarter") {
      const start = startOfQuarter(anchorDate);
      return [start, addMonths(start, 1), addMonths(start, 2)];
    }
    const start = startOfYear(anchorDate);
    return Array.from({ length: 12 }, (_, index) => addMonths(start, index));
  }, [viewMode, anchorDate]);

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">{periodLabel}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md bg-muted p-1">
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => setViewMode(mode.value)}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                  viewMode === mode.value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={goPrev} aria-label="Previous period">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={goToday}>
              Today
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={goNext} aria-label="Next period">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {legend.map((item) => (
            <span key={item.label} className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", item.colorClass)} /> {item.label}
            </span>
          ))}
        </div>

        {viewMode === "month" ? (
          <MonthGrid monthStart={monthsToRender[0]} eventsByDay={eventsByDay} onSelectEvent={onSelectEvent} compact={false} />
        ) : (
          <div className={cn("grid gap-4", viewMode === "quarter" ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")}>
            {monthsToRender.map((monthStart) => (
              <MonthGrid
                key={monthStart.toISOString()}
                monthStart={monthStart}
                eventsByDay={eventsByDay}
                onSelectEvent={onSelectEvent}
                onDrillDown={drillDown}
                compact
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
