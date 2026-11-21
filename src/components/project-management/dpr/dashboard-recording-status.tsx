"use client";

/**
 * Recording status — one line per scope: its recording schedule, the last sheet filed, when the
 * next actual is due, and the gaps (past recording days with no submitted sheet), each gap a link
 * to record that day. Built by `buildDprRecordingStatus` (`project-management-dpr-due.ts`), which
 * holds the rules; this only lays the rows out.
 *
 * Status is always written out beside its colour.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DPR_BASE_PATH, parseIsoDate } from "@/lib/project-management-dpr";
import { dprShortDate } from "@/lib/project-management-dpr-plan";
import type { DprRecordingStatusRow } from "@/lib/project-management-dpr-due";
import { dprHref, dprScopeTone, formatDisplayDate } from "@/components/project-management/dpr/dpr-shell";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Gap dates named on the row before the rest are counted as "+N". */
const GAPS_SHOWN = 3;

/** "Fri 20 Nov" — the day of the week matters against a schedule. */
const dayLabel = (isoDate: string): string => {
  const date = parseIsoDate(isoDate);
  const weekday = date ? date.toLocaleDateString("en-IN", { weekday: "short" }) : "";
  return `${weekday ? `${weekday} ` : ""}${dprShortDate(isoDate)}`;
};

const PILL = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-bold";

export function DprRecordingStatusTable({
  rows,
  mappingId,
}: {
  rows: readonly DprRecordingStatusRow[];
  mappingId: string;
}) {
  const sheetHref = (scope: string, date?: string) =>
    dprHref(`${DPR_BASE_PATH}/entry`, mappingId, date ? { scope, date } : { scope });

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border/60">
      <Table className="min-w-full whitespace-nowrap">
        <TableHeader>
          <TableRow>
            <TableHead>SL No</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Schedule</TableHead>
            <TableHead>Last sheet</TableHead>
            <TableHead>Next due</TableHead>
            <TableHead>Gaps</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const latestGap = row.gaps[0]?.date ?? null;
            const action =
              row.due.state === "due-today"
                ? { href: sheetHref(row.scope, row.due.date ?? undefined), label: "Record today" }
                : row.due.state === "draft-today"
                  ? { href: sheetHref(row.scope, row.due.date ?? undefined), label: "Finish today's draft" }
                  : latestGap
                    ? { href: sheetHref(row.scope, latestGap), label: `Record ${dprShortDate(latestGap)}` }
                    : { href: sheetHref(row.scope), label: "Open sheet" };
            const hidden = row.gaps.slice(GAPS_SHOWN);
            return (
              <TableRow key={row.scope}>
                <TableCell className="text-sm tabular-nums text-muted-foreground">{index + 1}</TableCell>
                <TableCell>
                  <StatusBadge status={row.scope} tone={dprScopeTone(row.scope)} />
                </TableCell>
                <TableCell className="text-sm font-semibold">{row.scheduleText}</TableCell>
                <TableCell className="text-sm">
                  {row.lastSheet ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="font-semibold tabular-nums" title={formatDisplayDate(row.lastSheet.date)}>
                        {dayLabel(row.lastSheet.date)}
                      </span>
                      <span
                        className={cn(
                          "text-xs font-bold",
                          row.lastSheet.status === "Submitted" ? "text-emerald-700" : "text-amber-700",
                        )}
                      >
                        {row.lastSheet.status === "Submitted" ? "Submitted" : "Draft"}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">None yet</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {row.due.state === "due-today" ? (
                    <span className={cn(PILL, "border-blue-200 bg-blue-50 text-blue-700")}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                      Due today
                    </span>
                  ) : row.due.state === "draft-today" ? (
                    <span className={cn(PILL, "border-amber-200 bg-amber-50 text-amber-800")}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                      Draft — not submitted
                    </span>
                  ) : row.due.state === "next" && row.due.date ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="font-semibold tabular-nums" title={formatDisplayDate(row.due.date)}>
                        Next: {dayLabel(row.due.date)}
                      </span>
                      {row.todayDone ? (
                        <span className="text-xs font-bold text-emerald-700">today submitted</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No recording day left</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {!row.started ? (
                    <span
                      className="text-muted-foreground"
                      title="No projection or sheet for this scope yet — gaps are counted from the first one."
                    >
                      Not started
                    </span>
                  ) : row.gaps.length === 0 ? (
                    <span
                      className="text-xs font-bold text-emerald-700"
                      title={row.countedFrom ? `Every recording day since ${formatDisplayDate(row.countedFrom)} has a submitted sheet.` : undefined}
                    >
                      ✓ No gaps
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={cn(PILL, "border-rose-200 bg-rose-50 text-rose-700")}
                        title={row.countedFrom ? `Recording days since ${formatDisplayDate(row.countedFrom)} with no submitted sheet` : undefined}
                      >
                        {row.gaps.length} missing
                      </span>
                      {row.gaps.slice(0, GAPS_SHOWN).map((gap) => (
                        <Link
                          key={gap.date}
                          href={sheetHref(row.scope, gap.date)}
                          className="text-xs font-bold tabular-nums text-rose-700 underline-offset-2 hover:underline"
                          title={`${formatDisplayDate(gap.date)} — ${gap.draft ? "a draft, not submitted" : "nothing filed"}. Open the sheet.`}
                        >
                          {dprShortDate(gap.date)}
                          {gap.draft ? " (draft)" : ""}
                        </Link>
                      ))}
                      {hidden.length > 0 ? (
                        <span
                          className="text-xs font-bold text-muted-foreground"
                          title={hidden
                            .map((gap) => `${formatDisplayDate(gap.date)}${gap.draft ? " (draft)" : ""}`)
                            .join("\n")}
                        >
                          +{hidden.length} more
                        </span>
                      ) : null}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="outline" className="h-8 rounded-[10px] font-bold">
                    <Link href={action.href} aria-label={`${row.scope}: ${action.label}`}>
                      {action.label} <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
