"use client";

/**
 * Record progress: planned lines already finished before the sheet's day, collapsed under the
 * work-done table.
 *
 * The plan still spreads quantity on such a line — its BOQ quantity is reached, or the projection
 * owning the day was met early — so the sheet leaves it off rather than asking for a 0. It is
 * listed here instead of silently dropped, and can be put back if more was done after all. The
 * columns line up with the work-done table above (same widths, same minimum).
 */

import { CheckCircle2, ChevronRight, Plus } from "lucide-react";
import type { DprCompletion } from "@/lib/project-management-dpr-plan";
import type { DprBoqItem } from "@/components/project-management/dpr/use-dpr-data";
import { formatQtyAt, formatRangeCompact } from "@/components/project-management/dpr/dpr-shell";
import { breakdownTitle } from "@/components/project-management/dpr/dpr-indent";
import { DprSlNoPill } from "@/components/project-management/dpr/reports-parts";
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

/** Why a planned line needs nothing recorded today, in a few words. */
export function completionText(completion: DprCompletion, unit: string, decimals: number): string {
  if (completion.kind === "boq") return "BOQ quantity reached";
  return `Projection ${formatRangeCompact(completion.startDate, completion.endDate)} met early: ${formatQtyAt(
    completion.doneQty,
    decimals,
  )} of ${formatQtyAt(completion.plannedQty, decimals)} ${unit}`.trim();
}

export function DprCompletedLines({
  items,
  completed,
  open,
  onToggle,
  planned,
  doneBefore,
  decimalsFor,
  onAdd,
}: {
  items: readonly DprBoqItem[];
  completed: ReadonlyMap<string, DprCompletion>;
  open: boolean;
  onToggle: () => void;
  planned: (boqItemId: string) => number;
  doneBefore: (boqItemId: string) => number;
  decimalsFor: (unit: string) => number;
  onAdd: (boqItemId: string) => void;
}) {
  return (
    <div className="border-t border-border/60">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-muted/40"
      >
        <ChevronRight
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
        <span className="shrink-0 font-medium">Already complete</span>
        <span className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">
          · {items.length} planned line{items.length === 1 ? "" : "s"} finished before this day, left
          off the sheet
        </span>
      </button>
      {open ? (
        <Table stickyHeader containerClassName="max-h-[40vh]" className="min-w-[1252px] table-fixed">
          <colgroup>
            <col className="w-[72px]" />
            <col />
            <col className="w-[76px]" />
            <col className="w-[100px]" />
            <col className="w-[150px]" />
            <col className="w-[400px]" />
            <col className="w-[218px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className="truncate">SL No</TableHead>
              <TableHead className="truncate">BOQ line</TableHead>
              <TableHead className="truncate">Unit</TableHead>
              <TableHead className="truncate text-right" title="Planned for this day">
                Planned
              </TableHead>
              <TableHead className="truncate text-right">Done / BOQ</TableHead>
              <TableHead className="truncate">Why it needs nothing today</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Add back</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const completion = completed.get(item.id);
              const decimals = decimalsFor(item.unit);
              const why = completion ? completionText(completion, item.unit, decimals) : "";
              return (
                <TableRow key={item.id} className="text-muted-foreground">
                  <TableCell className="truncate">
                    <DprSlNoPill slNo={item.boqSlNo} seed={item.id} />
                  </TableCell>
                  <TableCell
                    className="truncate text-sm"
                    title={item.path ? breakdownTitle(item) : item.description}
                    style={(item.depth ?? 0) > 0 ? { paddingLeft: 16 + (item.depth ?? 0) * 16 } : undefined}
                  >
                    {item.description || "—"}
                  </TableCell>
                  <TableCell className="truncate text-sm" title={item.unit}>
                    {item.unit || "—"}
                  </TableCell>
                  <TableCell className="truncate text-right text-sm tabular-nums">
                    {formatQtyAt(planned(item.id), decimals)}
                  </TableCell>
                  <TableCell className="truncate text-right text-sm tabular-nums">
                    {formatQtyAt(doneBefore(item.id), decimals)}
                    {item.boqQty > 0 ? (
                      <span className="text-xs">
                        {" / "}
                        {formatQtyAt(item.boqQty, decimals)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="truncate text-sm" title={why}>
                    <span className="inline-flex max-w-full items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                      <span className="truncate">{why}</span>
                    </span>
                  </TableCell>
                  <TableCell className="py-1.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      aria-label={`Add ${item.boqSlNo || item.description} back to the sheet`}
                      onClick={() => onAdd(item.id)}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add to sheet
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
