"use client";

import { useMemo } from "react";
import { isPoOverdue, type PurchaseOrder } from "@/lib/purchase-orders";
import GanttChart, { type GanttRow } from "@/components/project-management/gantt-chart";

const STATUS_BAR_COLORS: Record<string, string> = {
  Draft: "bg-slate-400",
  Issued: "bg-blue-500",
  Received: "bg-emerald-500",
  Cancelled: "bg-red-400",
};

const LEGEND = [
  { label: "Draft", colorClass: "bg-slate-400" },
  { label: "Issued", colorClass: "bg-blue-500" },
  { label: "Received", colorClass: "bg-emerald-500" },
  { label: "Cancelled", colorClass: "bg-red-400" },
  { label: "Overdue", colorClass: "bg-red-700" },
];

export default function PoGanttChart({
  purchaseOrders,
  onSelectPo,
}: {
  purchaseOrders: PurchaseOrder[];
  onSelectPo: (poId: string) => void;
}) {
  const rows = useMemo<GanttRow[]>(
    () =>
      purchaseOrders
        .filter((po) => po.startDate && po.endDate)
        .map((po) => {
          const overdue = isPoOverdue(po);
          return {
            id: po.id,
            label: po.poNumber,
            sublabel: `${po.vendorName} · ${po.status}`,
            start: po.startDate ?? "",
            end: po.endDate ?? "",
            barLabel: po.status,
            colorClass: overdue ? "bg-red-700" : STATUS_BAR_COLORS[po.status] ?? "bg-slate-400",
          };
        }),
    [purchaseOrders],
  );

  return (
    <GanttChart
      rows={rows}
      onSelectRow={onSelectPo}
      legend={LEGEND}
      emptyMessage="Add start & end dates on purchase orders to see them here."
    />
  );
}
