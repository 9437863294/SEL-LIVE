"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardCheck, ListTodo, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  computeMdlCycleAgeDays,
  computeMdlDrawingStage,
  formatMdlDate,
  getMdlRollup,
  getMdlSubDrawings,
  groupMdlRowsByPo,
  isMdlApproved,
  isMdlOverdue,
  isMdlPendingTask,
  mdlDrawingStageStyles,
  mdlOutlineNo,
  mdlOverallStatusStyles,
  type MdlGroupablePo,
  type MdlRow,
} from "@/lib/mdl";

// Organised the way the work actually arrives: purchase order → BOQ item → sub-drawing. A PO is
// the commitment, the items are what it covers, and each item's drawings are what has to be
// produced, collected, submitted and approved.
//
// A drawing is outstanding once somebody has committed to it and it hasn't been approved — either
// a PO was placed for the item, or the drawing was planned in the register. Items merely flagged
// MDL = Yes and never touched stay out, so the queue doesn't fill with untouched lines.
export default function MdlPendingTasks({
  rows,
  purchaseOrders,
  mappingId,
  onSelectItem,
}: {
  rows: MdlRow[];
  purchaseOrders: MdlGroupablePo[];
  mappingId: string;
  onSelectItem: (boqItemId: string, subDrawingId?: string) => void;
}) {
  const { poGroups, plannedOnlyRows } = useMemo(() => {
    const { groups, ungrouped } = groupMdlRowsByPo(rows, purchaseOrders);
    return {
      poGroups: groups
        .map((group) => ({ ...group, rows: group.rows.filter((row) => isMdlPendingTask(row.drawing, true)) }))
        .filter((group) => group.rows.length),
      // Planned in the register but not ordered yet — real work, just not yet a commitment.
      plannedOnlyRows: ungrouped.filter((row) => isMdlPendingTask(row.drawing, false)),
    };
  }, [rows, purchaseOrders]);

  const total = useMemo(
    () => poGroups.reduce((sum, group) => sum + group.rows.length, 0) + plannedOnlyRows.length,
    [poGroups, plannedOnlyRows],
  );

  // `prefix` carries the enclosing purchase order's index, so its items read 1.1, 1.2 and their
  // sub-drawings 1.1.1, 1.1.2. Rows with no PO get no prefix and simply read 1, 1.1.
  const pendingTable = (groupRows: MdlRow[], prefix: number[], hasPo: boolean) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">SL NO</TableHead>
            <TableHead>BOQ SL No</TableHead>
            <TableHead className="min-w-[260px]">Item / Drawing</TableHead>
            <TableHead>Planned End</TableHead>
            <TableHead>Cycle Age</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupRows
            .map((row) => ({ ...row, rollup: getMdlRollup(row.drawing) }))
            .sort((a, b) => {
              if (a.rollup.overdue !== b.rollup.overdue) return a.rollup.overdue ? -1 : 1;
              // Then whatever falls due soonest, with undated drawings last.
              return (a.rollup.plannedEndDate || "9999-12-31").localeCompare(
                b.rollup.plannedEndDate || "9999-12-31",
              );
            })
            .map(({ item, drawing, rollup }, index) => {
              const cycleAgeDays = computeMdlCycleAgeDays(rollup);
              const subDrawings = getMdlSubDrawings(drawing);
              return [
                <TableRow
                  key={item.id}
                  className={cn("cursor-pointer", subDrawings.length && "border-b-0 bg-muted/30")}
                  onClick={() => onSelectItem(item.id)}
                >
                  <TableCell className="font-semibold">{mdlOutlineNo(...prefix, index)}.</TableCell>
                  <TableCell className="whitespace-nowrap">{String(item["BOQ SL No"] ?? "—")}</TableCell>
                  <TableCell className="max-w-sm truncate font-medium" title={String(item.Description ?? "")}>
                    {String(item.Description ?? "—")}
                    {subDrawings.length > 0 && (
                      <span className="ml-2 whitespace-nowrap rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                        {rollup.subApproved}/{rollup.subTotal} approved
                        {rollup.subCollected > rollup.subApproved && ` · ${rollup.subCollected} collected`}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className={rollup.overdue ? "font-medium text-red-600" : ""}>
                      {formatMdlDate(rollup.plannedEndDate)}
                    </span>
                    {rollup.overdue && (
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
                  <TableCell />
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
                  const stage = computeMdlDrawingStage(sub, hasPo);
                  return (
                    <TableRow
                      key={`${item.id}-${sub.id}`}
                      className={cn("cursor-pointer border-b-0 last:border-b", subApproved && "text-muted-foreground")}
                      onClick={() => onSelectItem(item.id, sub.id)}
                    >
                      <TableCell className="pl-6 text-xs tabular-nums text-muted-foreground">
                        {mdlOutlineNo(...prefix, index, subIndex)}.
                      </TableCell>
                      <TableCell />
                      <TableCell className="max-w-sm" title={sub.title}>
                        <div className="flex items-center gap-1.5 border-l-2 border-muted pl-3">
                          {subApproved && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                          <span className="truncate text-sm">{sub.title || "Untitled drawing"}</span>
                        </div>
                        <p className="truncate pl-3 text-[11px] text-muted-foreground">
                          {sub.assignedToName ? `Assigned to ${sub.assignedToName}` : "Unassigned"}
                          {sub.collection?.fileUrl && (
                            <>
                              {" · "}
                              <a
                                href={sub.collection.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-primary underline underline-offset-2"
                              >
                                Vendor drawing
                              </a>
                            </>
                          )}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        <span className={subOverdue ? "font-medium text-red-600" : ""}>
                          {formatMdlDate(sub.plannedEndDate)}
                        </span>
                        {subOverdue && (
                          <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                            Overdue
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {subCycleAgeDays != null ? (
                          <span className={subCycleAgeDays > 30 ? "font-medium text-amber-600" : ""}>
                            {subCycleAgeDays}d
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", mdlDrawingStageStyles[stage])}>
                          {stage}
                        </span>
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
  );

  if (!total) {
    return (
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListTodo className="h-4 w-4" /> Pending Tasks
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <ClipboardCheck className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nothing pending — every planned drawing, and every item with a purchase order placed, has already been
              approved.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {poGroups.map((group, groupIndex) => {
        const outstanding = group.rows.reduce((sum, row) => {
          const subs = getMdlSubDrawings(row.drawing);
          return sum + (subs.length ? subs.filter((sub) => !isMdlApproved(sub.status)).length : 1);
        }, 0);
        return (
          <Card key={group.po.poId} className="overflow-hidden border-border/60">
            <div className="h-1 w-full bg-gradient-to-r from-rose-500 to-orange-600" />
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <span className="text-muted-foreground">{mdlOutlineNo(groupIndex)}.</span>
                <ShoppingCart className="h-4 w-4 text-emerald-600" />
                <Link
                  href={`/project-management/purchase-orders/${group.po.poId}?project=${encodeURIComponent(mappingId)}`}
                  className="hover:underline"
                >
                  {group.po.poNumber}
                </Link>
                {group.po.vendorName && (
                  <span className="text-sm font-normal text-muted-foreground">{group.po.vendorName}</span>
                )}
              </CardTitle>
              <CardDescription>
                Ordered {formatMdlDate(group.po.poDate)} · {group.rows.length} item
                {group.rows.length === 1 ? "" : "s"} · {outstanding} drawing{outstanding === 1 ? "" : "s"} outstanding
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">{pendingTable(group.rows, [groupIndex], true)}</CardContent>
          </Card>
        );
      })}

      {plannedOnlyRows.length > 0 && (
        <Card className="overflow-hidden border-border/60">
          <div className="h-1 w-full bg-gradient-to-r from-slate-400 to-slate-600" />
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListTodo className="h-4 w-4" /> Not on a purchase order yet
            </CardTitle>
            <CardDescription>
              Planned in the register, but nothing is owed by a vendor until the item is ordered.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">{pendingTable(plannedOnlyRows, [], false)}</CardContent>
        </Card>
      )}
    </div>
  );
}
