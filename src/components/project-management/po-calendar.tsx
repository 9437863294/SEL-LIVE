"use client";

import { useMemo } from "react";
import { isPoOverdue, type PurchaseOrder } from "@/lib/purchase-orders";
import WorkplanCalendar, { type WorkplanCalendarEvent } from "@/components/project-management/workplan-calendar";

const LEGEND = [
  { label: "Start", colorClass: "bg-blue-500" },
  { label: "Due", colorClass: "bg-amber-500" },
  { label: "Overdue", colorClass: "bg-red-500" },
];

export default function PoWorkplanCalendar({
  purchaseOrders,
  onSelectPo,
}: {
  purchaseOrders: PurchaseOrder[];
  onSelectPo: (poId: string) => void;
}) {
  const events = useMemo<WorkplanCalendarEvent[]>(() => {
    const list: WorkplanCalendarEvent[] = [];
    for (const po of purchaseOrders) {
      const label = `${po.poNumber} · ${po.vendorName}`;
      if (po.startDate) {
        list.push({ id: po.id, date: po.startDate, label, colorClass: "bg-blue-500" });
      }
      if (po.endDate) {
        const overdue = isPoOverdue(po);
        list.push({ id: po.id, date: po.endDate, label, colorClass: overdue ? "bg-red-500" : "bg-amber-500" });
      }
    }
    return list;
  }, [purchaseOrders]);

  return <WorkplanCalendar events={events} onSelectEvent={onSelectPo} legend={LEGEND} />;
}
