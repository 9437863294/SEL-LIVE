"use client";

import { useMemo } from "react";
import { getMdlRollup, type MdlRow } from "@/lib/mdl";
import WorkplanCalendar, { type WorkplanCalendarEvent } from "@/components/project-management/workplan-calendar";

const LEGEND = [
  { label: "Planned start", colorClass: "bg-blue-500" },
  { label: "Planned due", colorClass: "bg-amber-500" },
  { label: "Overdue", colorClass: "bg-red-500" },
  { label: "Approved", colorClass: "bg-emerald-500" },
];

export default function MdlWorkplanCalendar({
  rows,
  onSelectItem,
}: {
  rows: MdlRow[];
  onSelectItem: (boqItemId: string) => void;
}) {
  const events = useMemo<WorkplanCalendarEvent[]>(() => {
    const list: WorkplanCalendarEvent[] = [];
    for (const { item, drawing } of rows) {
      if (!drawing) continue;
      // Rolled up so an item with sub-drawings plots the full window its drawings occupy,
      // not just the parent record's own dates.
      const rollup = getMdlRollup(drawing);
      const label = String(item.Description ?? "Untitled drawing");
      if (rollup.plannedStartDate) {
        list.push({ id: item.id, date: rollup.plannedStartDate, label, colorClass: "bg-blue-500" });
      }
      if (rollup.plannedEndDate) {
        list.push({
          id: item.id,
          date: rollup.plannedEndDate,
          label,
          colorClass: rollup.overdue ? "bg-red-500" : "bg-amber-500",
        });
      }
      if (rollup.approveDate) {
        list.push({ id: item.id, date: rollup.approveDate, label, colorClass: "bg-emerald-500" });
      }
    }
    return list;
  }, [rows]);

  return <WorkplanCalendar events={events} onSelectEvent={onSelectItem} legend={LEGEND} />;
}
