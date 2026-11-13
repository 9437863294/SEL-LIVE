"use client";

/**
 * "Planned against actual, by BOQ line" — every line in the period, each in its own unit. It is
 * also the table view of the dashboard's charts, so nothing a chart shows is colour-only.
 */

import type { DprBoardRow, DprLineStatus } from "@/lib/project-management-dpr-plan";
import { formatPct } from "@/components/project-management/dpr/dpr-shell";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type QtyFormatter = (value: number, unit: string) => string;

export const DPR_LINE_STATUS_BADGE: Record<DprLineStatus, { tone: StatusTone; label: string }> = {
  behind: { tone: "danger", label: "Behind" },
  "on-plan": { tone: "success", label: "On plan" },
  "not-due": { tone: "neutral", label: "Not due yet" },
  unplanned: { tone: "info", label: "Worked, no plan" },
};

function BoardRow({ row, qty, rate }: { row: DprBoardRow; qty: QtyFormatter; rate: QtyFormatter }) {
  const { item } = row;
  const badge = DPR_LINE_STATUS_BADGE[row.status];
  const barWidth = Math.min(100, Math.max(0, row.achievementPct ?? 0));
  return (
    <TableRow>
      <TableCell className="truncate text-sm font-semibold tabular-nums" title={item.boqSlNo}>
        {item.boqSlNo || "—"}
      </TableCell>
      <TableCell>
        {/* Bounded so the auto-sized column stays narrow; the full description is on hover. */}
        <div className="min-w-[180px] max-w-[360px] truncate text-sm" title={item.description}>
          {item.description || "BOQ line"}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm">{item.unit || "—"}</TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {qty(row.planToDate, item.unit)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
        {qty(row.actual, item.unit)}
      </TableCell>
      <TableCell className="min-w-[140px]">
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-sm tabular-nums">{formatPct(row.achievementPct)}</span>
          <div className="h-1.5 min-w-[60px] flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", row.status === "behind" ? "bg-rose-500" : "bg-primary")}
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {qty(row.fullPlan, item.unit)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {row.balance <= 0 ? (
          "0"
        ) : row.neededPerDay === null ? (
          <span className="text-muted-foreground">no days left</span>
        ) : (
          <>
            {rate(row.neededPerDay, item.unit)}{" "}
            <span className="text-xs text-muted-foreground">× {row.daysLeft}d</span>
          </>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <StatusBadge status={badge.label} tone={badge.tone} />
      </TableCell>
    </TableRow>
  );
}

export function DprBoardTable({
  rows,
  qty,
  rate,
}: {
  rows: DprBoardRow[];
  qty: QtyFormatter;
  rate: QtyFormatter;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border/60">
      <Table stickyHeader containerClassName="max-h-[65vh]" className="min-w-[932px]">
        <colgroup>
          <col className="w-[72px]" />
          <col />
          <col />
          <col />
          <col />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead className="truncate">SL No</TableHead>
            <TableHead>BOQ line</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Plan to date</TableHead>
            <TableHead className="text-right">Actual</TableHead>
            <TableHead>Achievement to date</TableHead>
            <TableHead className="text-right">Full period plan</TableHead>
            <TableHead className="text-right">Needed per day</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <BoardRow key={row.item.id} row={row} qty={qty} rate={rate} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
