"use client";

import { useMemo } from "react";
import { isMdlOverdue, type MdlRow } from "@/lib/mdl";
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
      const label = String(item.Description ?? "Untitled drawing");
      if (drawing.plannedStartDate) {
        list.push({ id: item.id, date: drawing.plannedStartDate, label, colorClass: "bg-blue-500" });
      }
      if (drawing.plannedEndDate) {
        const overdue = isMdlOverdue(drawing);
        list.push({ id: item.id, date: drawing.plannedEndDate, label, colorClass: overdue ? "bg-red-500" : "bg-amber-500" });
      }
      if (drawing.approveDate) {
        list.push({ id: item.id, date: drawing.approveDate, label, colorClass: "bg-emerald-500" });
      }
    }
    return list;
  }, [rows]);

  return <WorkplanCalendar events={events} onSelectEvent={onSelectItem} legend={LEGEND} />;
}
