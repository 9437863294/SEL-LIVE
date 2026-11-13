"use client";

/**
 * "Planned against actual, by BOQ line" — every line in the period, each in its own unit. It is
 * also the table view of the dashboard's charts, so nothing a chart shows is colour-only.
 *
 * With a work breakdown, a BOQ line (or sub-item) that has sub-items shows as a group row above
 * them, its figures rolled up from its leaves in its own unit — a 1 LOT line reads 0.4 LOT done.
 */

import { CornerDownRight } from "lucide-react";
import type { DprBoardRow, DprLineStatus } from "@/lib/project-management-dpr-plan";
import {
  arrangeByBreakdown,
  type DprBreakdown,
  type DprBreakdownNode,
} from "@/lib/project-management-dpr-breakdown";
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

/** The tooltip for a breakdown row's description: the lines above it, then its own text. */
const describe = (node: DprBreakdownNode | null, description: string): string =>
  node && node.ancestors.length > 0
    ? `${node.ancestors.map((ancestor) => `${ancestor.slNo} ${ancestor.description}`.trim()).join(" › ")} › ${description}`
    : description;

function DescriptionCell({
  description,
  depth,
  title,
  strong = false,
}: {
  description: string;
  depth: number;
  title: string;
  strong?: boolean;
}) {
  return (
    <TableCell>
      {/* Bounded so the auto-sized column stays narrow; the full description is on hover. */}
      <div
        className={cn(
          "flex min-w-[180px] max-w-[360px] items-center gap-1 text-sm",
          strong && "font-semibold",
        )}
        style={depth > 0 ? { paddingLeft: depth * 16 } : undefined}
        title={title}
      >
        {depth > 0 ? (
          <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
        <span className="min-w-0 truncate">{description || "BOQ line"}</span>
      </div>
    </TableCell>
  );
}

function AchievementCell({ pct, behind }: { pct: number | null; behind: boolean }) {
  const barWidth = Math.min(100, Math.max(0, pct ?? 0));
  return (
    <TableCell className="min-w-[140px]">
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-sm tabular-nums">{formatPct(pct)}</span>
        <div className="h-1.5 min-w-[60px] flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", behind ? "bg-rose-500" : "bg-primary")}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>
    </TableCell>
  );
}

function BoardRow({
  row,
  qty,
  rate,
  node,
}: {
  row: DprBoardRow;
  qty: QtyFormatter;
  rate: QtyFormatter;
  node: DprBreakdownNode | null;
}) {
  const { item } = row;
  const badge = DPR_LINE_STATUS_BADGE[row.status];
  return (
    <TableRow>
      <TableCell className="truncate text-sm font-semibold tabular-nums" title={item.boqSlNo}>
        {item.boqSlNo || "—"}
      </TableCell>
      <DescriptionCell
        description={item.description}
        depth={node?.depth ?? 0}
        title={describe(node, item.description)}
      />
      <TableCell className="whitespace-nowrap text-sm">{item.unit || "—"}</TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {qty(row.planToDate, item.unit)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
        {qty(row.actual, item.unit)}
      </TableCell>
      <AchievementCell pct={row.achievementPct} behind={row.status === "behind"} />
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

/** A BOQ line or sub-item with sub-items: its leaves' figures rolled up, read as a heading. */
function GroupRow({
  node,
  rolled,
  qty,
}: {
  node: DprBreakdownNode;
  rolled: Record<string, number>;
  qty: QtyFormatter;
}) {
  const planToDate = rolled.planToDate ?? 0;
  const actual = rolled.actual ?? 0;
  const fullPlan = rolled.fullPlan ?? 0;
  const pct = planToDate > 0 ? (actual / planToDate) * 100 : null;
  const status: DprLineStatus =
    fullPlan <= 0 ? "unplanned" : planToDate <= 0 ? "not-due" : actual >= planToDate - 1e-9 ? "on-plan" : "behind";
  const badge = DPR_LINE_STATUS_BADGE[status];
  return (
    <TableRow className="bg-muted/40">
      <TableCell className="truncate text-sm font-semibold tabular-nums" title={node.slNo}>
        {node.slNo || "—"}
      </TableCell>
      <DescriptionCell
        description={node.description}
        depth={node.depth}
        title={`${describe(node, node.description)} — rolled up from its sub-items`}
        strong
      />
      <TableCell className="whitespace-nowrap text-sm font-medium">{node.unit || "—"}</TableCell>
      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
        {qty(planToDate, node.unit)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
        {qty(actual, node.unit)}
      </TableCell>
      <AchievementCell pct={pct} behind={status === "behind"} />
      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
        {qty(fullPlan, node.unit)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right text-muted-foreground" title="Recorded on its sub-items">
        —
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
  breakdown,
}: {
  rows: DprBoardRow[];
  qty: QtyFormatter;
  rate: QtyFormatter;
  /** With the work breakdown, groups show above their sub-items with rolled-up figures. */
  breakdown?: DprBreakdown;
}) {
  const tree = breakdown
    ? arrangeByBreakdown(breakdown, new Map(rows.map((row) => [row.item.id, row])), {
        planToDate: (row) => row.planToDate,
        actual: (row) => row.actual,
        fullPlan: (row) => row.fullPlan,
      })
    : null;
  // Leaves the breakdown does not know (should not happen) still show, after the tree.
  const placed = new Set(tree?.map((entry) => entry.node.id) ?? []);
  const strays = tree ? rows.filter((row) => !placed.has(row.item.id)) : [];

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
          {tree
            ? [
                ...tree.map((entry) =>
                  entry.row ? (
                    <BoardRow key={entry.node.id} row={entry.row} qty={qty} rate={rate} node={entry.node} />
                  ) : (
                    <GroupRow key={entry.node.id} node={entry.node} rolled={entry.rolled} qty={qty} />
                  ),
                ),
                ...strays.map((row) => (
                  <BoardRow key={row.item.id} row={row} qty={qty} rate={rate} node={null} />
                )),
              ]
            : rows.map((row) => <BoardRow key={row.item.id} row={row} qty={qty} rate={rate} node={null} />)}
        </TableBody>
      </Table>
    </div>
  );
}
