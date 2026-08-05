"use client";

import { useMemo } from "react";
import { isMdlOverdue, type MdlRow } from "@/lib/mdl";
import GanttChart, { type GanttRow } from "@/components/project-management/gantt-chart";

const STATUS_BAR_COLORS: Record<string, string> = {
  Pending: "bg-slate-400",
  "In Progress": "bg-blue-500",
  Approved: "bg-emerald-500",
  "Approved with Comments": "bg-amber-500",
  Rejected: "bg-red-500",
};

const LEGEND = [
  { label: "Pending", colorClass: "bg-slate-400" },
  { label: "In Progress", colorClass: "bg-blue-500" },
  { label: "Approved", colorClass: "bg-emerald-500" },
  { label: "Approved w/ Comments", colorClass: "bg-amber-500" },
  { label: "Rejected", colorClass: "bg-red-500" },
  { label: "Overdue", colorClass: "bg-red-700" },
];

export default function MdlGanttChart({
  rows,
  onSelectItem,
}: {
  rows: MdlRow[];
  onSelectItem: (boqItemId: string) => void;
}) {
  const ganttRows = useMemo<GanttRow[]>(
    () =>
      rows
        .filter((row) => row.drawing?.plannedStartDate && row.drawing?.plannedEndDate)
        .map(({ item, drawing }) => {
          const status = drawing?.status ?? "Pending";
          const overdue = isMdlOverdue(drawing);
          const boqSlNo = item["BOQ SL No"];
          return {
            id: item.id,
            label: String(item.Description ?? "Untitled drawing"),
            sublabel: boqSlNo ? `SL ${boqSlNo} · ${status}` : status,
            start: drawing?.plannedStartDate ?? "",
            end: drawing?.plannedEndDate ?? "",
            barLabel: status,
            colorClass: overdue ? "bg-red-700" : STATUS_BAR_COLORS[status] ?? "bg-slate-400",
          };
        }),
    [rows],
  );

  return (
    <GanttChart
      rows={ganttRows}
      onSelectRow={onSelectItem}
      legend={LEGEND}
      emptyMessage="Set planned start & end dates on drawings to see them here."
    />
  );
}
