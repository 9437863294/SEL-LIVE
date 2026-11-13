"use client";

/**
 * The dashboard's lists: lines furthest behind, Civil against Erection, the next seven days'
 * plan, and the period's hindrances. Every row is read from the register — nothing here is
 * suggested or estimated beyond what the projections already say.
 */

import { TriangleAlert } from "lucide-react";
import type { DprBoardRow } from "@/lib/project-management-dpr-plan";
import type { DprComingUp, DprScopeSplitRow } from "@/lib/project-management-dpr-dashboard";
import type { DprHindranceRow } from "@/lib/project-management-dpr";
import type { DprBoqItem } from "@/components/project-management/dpr/use-dpr-data";
import { DprBoqText, formatDisplayDate, formatPct } from "@/components/project-management/dpr/dpr-shell";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { StatusBadge } from "@/components/shared/status-badge";
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

/* ── Furthest behind ────────────────────────────────────────────────────────────────────────── */

export function DprFurthestBehindList({
  rows,
  qty,
  rate,
}: {
  rows: DprBoardRow[];
  qty: QtyFormatter;
  rate: QtyFormatter;
}) {
  if (rows.length === 0) {
    return (
      <PmEmptyState
        icon={TriangleAlert}
        title="No line is behind plan"
        description="Every line due so far has met its plan to date."
      />
    );
  }
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((row) => {
        const { item } = row;
        return (
          <li key={item.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1 basis-56">
              <DprBoqText boqSlNo={item.boqSlNo} description={item.description} className="min-w-0 max-w-none" />
              <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {qty(row.actual, item.unit)} of {qty(row.planToDate, item.unit)} {item.unit} due ·{" "}
                {formatPct(row.achievementPct)}
              </div>
            </div>
            <div className="shrink-0 text-right text-xs tabular-nums">
              {row.balance <= 0 ? null : row.neededPerDay === null ? (
                <span className="font-medium text-destructive">No working days left</span>
              ) : (
                <>
                  <div className="text-sm font-semibold">
                    {rate(row.neededPerDay, item.unit)} {item.unit}/day
                  </div>
                  <div className="text-muted-foreground">needed × {row.daysLeft}d</div>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ── Civil against Erection ─────────────────────────────────────────────────────────────────── */

function ShareBar({ value, tone }: { value: number | null; tone: "primary" | "danger" }) {
  const width = Math.min(100, Math.max(0, value ?? 0));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full", tone === "danger" ? "bg-rose-500" : "bg-primary")}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export function DprScopeSplitPanel({ rows }: { rows: DprScopeSplitRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.scope} className="space-y-2 rounded-lg border border-border/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{row.scope}</span>
            {row.linesBehind > 0 ? (
              <StatusBadge status="Behind" tone="danger">
                {row.linesBehind} behind
              </StatusBadge>
            ) : row.linesDue > 0 ? (
              <StatusBadge status="On plan" tone="success" />
            ) : (
              <StatusBadge status="Not due" tone="neutral">
                Nothing due
              </StatusBadge>
            )}
          </div>
          {row.linesInPeriod === 0 ? (
            <div className="text-xs text-muted-foreground">Nothing planned or worked in this period.</div>
          ) : (
            <>
              <div className="space-y-1">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">Achievement to date</span>
                  <span className="text-sm font-semibold tabular-nums">{formatPct(row.achievementToDatePct)}</span>
                </div>
                <ShareBar
                  value={row.achievementToDatePct}
                  tone={row.linesBehind > 0 ? "danger" : "primary"}
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">Against the full period</span>
                  <span className="tabular-nums">{formatPct(row.achievementFullPct)}</span>
                </div>
                <ShareBar value={row.achievementFullPct} tone="primary" />
              </div>
              <div className="text-[11px] text-muted-foreground">
                {row.linesDue} of {row.linesInPeriod} line{row.linesInPeriod === 1 ? "" : "s"} due ·{" "}
                {row.basis === "value" ? "weighted by BOQ value" : "average of line percentages"}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Next seven days ────────────────────────────────────────────────────────────────────────── */

export function DprComingUpTable({
  comingUp,
  qty,
}: {
  comingUp: DprComingUp<DprBoqItem>;
  qty: QtyFormatter;
}) {
  if (comingUp.rows.length === 0) {
    return (
      <PmEmptyState
        title="Nothing is planned for the next seven days"
        description="Projections covering these days appear here line by line."
      />
    );
  }
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border/60">
      <Table stickyHeader containerClassName="max-h-[65vh]" className="min-w-[720px]">
        <TableHeader>
          <TableRow>
            <TableHead>BOQ line</TableHead>
            <TableHead>Unit</TableHead>
            {comingUp.days.map((day) => (
              <TableHead
                key={day.date}
                className={cn("text-right", !day.working && "text-muted-foreground/70")}
                title={day.working ? undefined : "Not a working day"}
              >
                {day.label}
              </TableHead>
            ))}
            <TableHead className="text-right">7 days</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {comingUp.rows.map((row) => (
            <TableRow key={row.item.id}>
              <TableCell>
                <DprBoqText boqSlNo={row.item.boqSlNo} description={row.item.description} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm">{row.item.unit || "—"}</TableCell>
              {row.perDay.map((value, index) => (
                <TableCell key={comingUp.days[index]!.date} className="whitespace-nowrap text-right tabular-nums">
                  {value > 0 ? qty(value, row.item.unit) : <span className="text-muted-foreground">—</span>}
                </TableCell>
              ))}
              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                {qty(row.total, row.item.unit)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ── Hindrances ─────────────────────────────────────────────────────────────────────────────── */

export function DprHindranceList({ rows, limit = 6 }: { rows: DprHindranceRow[]; limit?: number }) {
  if (rows.length === 0) {
    return (
      <PmEmptyState
        icon={TriangleAlert}
        title="No hindrances raised in this period"
        description="Hindrances written on submitted sheets are listed here, newest first."
      />
    );
  }
  const shown = rows.slice(0, limit);
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border/60">
        {shown.map((row) => (
          <li key={`${row.date}-${row.scope}`} className="space-y-1 py-2.5 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium tabular-nums">{formatDisplayDate(row.date)}</span>
              <StatusBadge status={row.scope} tone={row.scope === "Civil" ? "info" : "progress"} />
            </div>
            <div className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground" title={row.hindrances}>
              {row.hindrances}
            </div>
          </li>
        ))}
      </ul>
      {rows.length > shown.length ? (
        <div className="text-xs text-muted-foreground">
          {rows.length - shown.length} more in Reports › Delays.
        </div>
      ) : null}
    </div>
  );
}
