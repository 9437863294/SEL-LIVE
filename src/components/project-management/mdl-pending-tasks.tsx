"use client";

import { useMemo } from "react";
import { CheckCircle2, ClipboardCheck, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  computeMdlCycleAgeDays,
  formatMdlDate,
  getMdlRollup,
  getMdlSubDrawings,
  isMdlApproved,
  isMdlOverdue,
  isMdlPendingTask,
  mdlOutlineNo,
  mdlOverallStatusStyles,
  type MdlRow,
} from "@/lib/mdl";

export type PoPlacement = {
  poNumbers: string[];
  vendorNames: string[];
  latestPoDate: string;
};

// A drawing is outstanding work once somebody has committed to it, and it hasn't reached an
// approved state. There are two ways to commit: a purchase order gets placed for the BOQ item
// (procurement is committed, the drawing has to be ready), or the drawing simply gets planned
// in the register — saving an item's own record or adding a sub-drawing to it. Items that are
// merely flagged MDL = Yes and never touched stay out, so the queue doesn't fill up with
// hundreds of untouched lines.
//
// Items that carry sub-drawings are judged on their rolled-up state and list every sub-drawing
// beneath them as 1.1, 1.2, … so the outstanding work is visible without opening each item.
export default function MdlPendingTasks({
  rows,
  poInfoByBoqItemId,
  onSelectItem,
}: {
  rows: MdlRow[];
  poInfoByBoqItemId: Map<string, PoPlacement>;
  onSelectItem: (boqItemId: string, subDrawingId?: string) => void;
}) {
  const pendingRows = useMemo(() => {
    return rows
      .map((row) => ({
        ...row,
        rollup: getMdlRollup(row.drawing),
        po: poInfoByBoqItemId.get(row.item.id),
      }))
      .filter((row) => isMdlPendingTask(row.drawing, Boolean(row.po)))
      .sort((a, b) => {
        if (a.rollup.overdue !== b.rollup.overdue) return a.rollup.overdue ? -1 : 1;
        // Procurement already committed outranks a drawing that has only been planned.
        if (!!a.po !== !!b.po) return a.po ? -1 : 1;
        if (a.po && b.po) return (b.po.latestPoDate || "").localeCompare(a.po.latestPoDate || "");
        // Planned-only rows queue by what falls due soonest, with undated ones last.
        return (a.rollup.plannedEndDate || "9999-12-31").localeCompare(b.rollup.plannedEndDate || "9999-12-31");
      });
  }, [rows, poInfoByBoqItemId]);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListTodo className="h-4 w-4" /> Pending Tasks
        </CardTitle>
        <CardDescription>
          Drawings that still need action — either a purchase order has already been placed for the item, or the drawing
          has been planned in the register.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {pendingRows.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">SL NO</TableHead>
                  <TableHead>BOQ SL No</TableHead>
                  <TableHead className="min-w-[240px]">Item / Drawing</TableHead>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>PO Date</TableHead>
                  <TableHead>Planned End</TableHead>
                  <TableHead>Cycle Age</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRows.map(({ item, drawing, rollup, po }, index) => {
                  const overdue = rollup.overdue;
                  const cycleAgeDays = computeMdlCycleAgeDays(rollup);
                  const subDrawings = getMdlSubDrawings(drawing);
                  return [
                    <TableRow
                      key={item.id}
                      className={cn("cursor-pointer", subDrawings.length && "border-b-0 bg-muted/30")}
                      onClick={() => onSelectItem(item.id)}
                    >
                      <TableCell className="font-semibold">{mdlOutlineNo(index)}.</TableCell>
                      <TableCell className="whitespace-nowrap">{String(item["BOQ SL No"] ?? "—")}</TableCell>
                      <TableCell className="max-w-xs truncate font-medium" title={String(item.Description ?? "")}>
                        {String(item.Description ?? "—")}
                        {subDrawings.length > 0 && (
                          <span className="ml-2 whitespace-nowrap rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                            {rollup.subApproved}/{rollup.subTotal} drawings approved
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {po ? (
                          po.poNumbers.join(", ")
                        ) : (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            No PO yet
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {po?.vendorNames.join(", ") || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{po ? formatMdlDate(po.latestPoDate) : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className={overdue ? "font-medium text-red-600" : ""}>{formatMdlDate(rollup.plannedEndDate)}</span>
                        {overdue && (
                          <span
                            className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
                            title={
                              rollup.subTotal
                                ? "This item has a drawing past its planned end date — see the rows below"
                                : undefined
                            }
                          >
                            Overdue
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {cycleAgeDays != null ? (
                          <span className={cycleAgeDays > 30 ? "font-medium text-amber-600" : ""}>{cycleAgeDays}d</span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", mdlOverallStatusStyles[rollup.status])}>
                          {rollup.status}
                        </span>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" onClick={() => onSelectItem(item.id)}>
                          Update
                        </Button>
                      </TableCell>
                    </TableRow>,
                    ...subDrawings.map((sub, subIndex) => {
                      const subOverdue = isMdlOverdue(sub);
                      const subCycleAgeDays = computeMdlCycleAgeDays(sub);
                      const subApproved = isMdlApproved(sub.status);
                      return (
                        <TableRow
                          key={`${item.id}-${sub.id}`}
                          className={cn(
                            "cursor-pointer border-b-0 last:border-b",
                            subApproved && "text-muted-foreground",
                          )}
                          onClick={() => onSelectItem(item.id, sub.id)}
                        >
                          <TableCell className="pl-6 text-xs tabular-nums text-muted-foreground">
                            {mdlOutlineNo(index, subIndex)}.
                          </TableCell>
                          <TableCell />
                          <TableCell className="max-w-xs" title={sub.title}>
                            <div className="flex items-center gap-1.5 border-l-2 border-muted pl-3">
                              {subApproved && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                              <span className="truncate text-sm">{sub.title || "Untitled drawing"}</span>
                            </div>
                            {sub.assignedToName && (
                              <p className="truncate pl-3 text-[11px] text-muted-foreground">
                                Assigned to {sub.assignedToName}
                              </p>
                            )}
                          </TableCell>
                          <TableCell />
                          <TableCell />
                          <TableCell />
                          <TableCell className="whitespace-nowrap text-sm">
                            <span className={subOverdue ? "font-medium text-red-600" : ""}>{formatMdlDate(sub.plannedEndDate)}</span>
                            {subOverdue && (
                              <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                                Overdue
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {subCycleAgeDays != null ? (
                              <span className={subCycleAgeDays > 30 ? "font-medium text-amber-600" : ""}>{subCycleAgeDays}d</span>
                            ) : "—"}
                          </TableCell>
                          <TableCell>
                            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", mdlOverallStatusStyles[sub.status])}>
                              {sub.status}
                            </span>
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" onClick={() => onSelectItem(item.id, sub.id)}>
                              Update
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    }),
                  ];
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <ClipboardCheck className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nothing pending — every planned drawing, and every item with a purchase order placed, has already been
              approved.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
