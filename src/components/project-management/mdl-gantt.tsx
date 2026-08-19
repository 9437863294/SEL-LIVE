"use client";

import { useMemo } from "react";
import { getMdlRollup, type MdlRow } from "@/lib/mdl";
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
        // Rolled up so an item with sub-drawings spans the full window its drawings occupy.
        .map(({ item, drawing }) => ({ item, rollup: getMdlRollup(drawing) }))
        .filter(({ rollup }) => rollup.plannedStartDate && rollup.plannedEndDate)
        .map(({ item, rollup }) => {
          const { status, overdue } = rollup;
          const boqSlNo = item["BOQ SL No"];
          const progress = rollup.subTotal ? ` · ${rollup.subApproved}/${rollup.subTotal} drawings` : "";
          return {
            id: item.id,
            label: String(item.Description ?? "Untitled drawing"),
            sublabel: `${boqSlNo ? `SL ${boqSlNo} · ` : ""}${status}${progress}`,
            start: rollup.plannedStartDate,
            end: rollup.plannedEndDate,
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
