"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  ListTodo,
  ShoppingCart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  // Groups start closed, so the queue opens as a list of orders to chase. The overdue count sits
  // on the closed row precisely so triage does not require expanding anything.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const PLANNED_ONLY_KEY = "planned-only";

  const allGroupKeys = useMemo(
    () => [
      ...poGroups.map((group) => `po:${group.po.poId}`),
      ...(plannedOnlyRows.length ? [PLANNED_ONLY_KEY] : []),
    ],
    [poGroups, plannedOnlyRows],
  );

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Outstanding drawings and how many are already past their planned end date. */
  const groupStats = (groupRows: MdlRow[]) => {
    let outstanding = 0;
    let overdue = 0;
    for (const row of groupRows) {
      const subs = getMdlSubDrawings(row.drawing);
      if (subs.length) {
        outstanding += subs.filter((sub) => !isMdlApproved(sub.status)).length;
        overdue += subs.filter((sub) => !isMdlApproved(sub.status) && isMdlOverdue(sub)).length;
      } else {
        outstanding += 1;
        if (getMdlRollup(row.drawing).overdue) overdue += 1;
      }
    }
    return { outstanding, overdue };
  };

  // The queue is one table, not one per purchase order: a PO is a single collapsible row, so it
  // reads as a list of orders needing attention rather than every outstanding drawing at once.
  //
  // Every cell holds one line. The drawing roll-up and a sub-drawing's assignee and vendor link
  // used to sit stacked under the description; each now has its own column, so a row is one line
  // tall and a column can be scanned down rather than re-read per row.
  const PENDING_COLUMN_COUNT = 10;

  // Compacted here rather than in components/ui/table.tsx, which every other table in the app
  // shares. `[&_td]` beats a cell's own `py-*`, so cells no longer set vertical padding at all.
  const PENDING_TABLE_DENSITY =
    "[&_th]:h-8 [&_th]:whitespace-nowrap [&_th]:px-2 [&_th]:text-xs [&_td]:px-2 [&_td]:py-1";

  const pendingHead = (
    <TableHeader>
      <TableRow>
        <TableHead className="w-16">SL NO</TableHead>
        <TableHead>BOQ SL No</TableHead>
        <TableHead className="min-w-[220px]">Item / Drawing</TableHead>
        <TableHead>Drawings</TableHead>
        <TableHead>Assigned To</TableHead>
        <TableHead>Planned End</TableHead>
        <TableHead>Cycle Age</TableHead>
        <TableHead>Stage</TableHead>
        <TableHead>Status</TableHead>
        <TableHead className="w-20" />
      </TableRow>
    </TableHeader>
  );

  // `prefix` carries the enclosing purchase order's index, so its items read 1.1, 1.2 and their
  // sub-drawings 1.1.1, 1.1.2. Rows with no PO get no prefix and simply read 1, 1.1.
  //
  // Item and sub-drawing rows stay click-to-update rather than click-to-expand: this is a
  // worklist, so a row's own click has to be the action you came to perform. Only the purchase
  // order above them collapses.
  const pendingRows = (groupRows: MdlRow[], prefix: number[], hasPo: boolean) =>
    groupRows
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
            <TableCell className="whitespace-nowrap font-semibold">{mdlOutlineNo(...prefix, index)}.</TableCell>
            <TableCell className="whitespace-nowrap">{String(item["BOQ SL No"] ?? "—")}</TableCell>
            <TableCell className="max-w-[240px] truncate font-medium" title={String(item.Description ?? "")}>
              {String(item.Description ?? "—")}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {subDrawings.length > 0 ? (
                <span className="whitespace-nowrap rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                  {rollup.subApproved}/{rollup.subTotal}
                  {rollup.subCollected > rollup.subApproved && ` · ${rollup.subCollected}c`}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            {/* Assignment is a property of a sub-drawing, not of the BOQ item's own record. */}
            <TableCell className="text-muted-foreground">—</TableCell>
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
              <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => onSelectItem(item.id)}>
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
                <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  {/* Indent lives on an inner span: the table's `[&_td]:px-2` would override a
                      `pl-*` set on the cell itself. */}
                  <span className="pl-3">{mdlOutlineNo(...prefix, index, subIndex)}.</span>
                </TableCell>
                <TableCell />
                <TableCell className="max-w-[240px]" title={sub.title}>
                  <div className="flex items-center gap-1.5 border-l-2 border-muted pl-3">
                    {subApproved && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                    <span className="truncate text-sm">{sub.title || "Untitled drawing"}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">—</TableCell>
                <TableCell className="max-w-[140px] whitespace-nowrap">
                  <span className="flex items-center gap-1 truncate text-xs">
                    <span className={cn("truncate", !sub.assignedToName && "text-muted-foreground")}>
                      {sub.assignedToName || "Unassigned"}
                    </span>
                    {sub.collection?.fileUrl && (
                      <a
                        href={sub.collection.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0 text-primary underline underline-offset-2"
                        title="Open the drawing collected from the vendor"
                      >
                        · Vendor
                      </a>
                    )}
                  </span>
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
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onSelectItem(item.id, sub.id)}>
                    Update
                  </Button>
                </TableCell>
              </TableRow>
            );
          }),
        ];
      });

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
    <Card className="overflow-hidden border-border/60">
      <div className="h-1 w-full bg-gradient-to-r from-rose-500 to-orange-600" />
      {/* With every group closed by default there has to be a way to the full queue in one
          action rather than N clicks. */}
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ListTodo className="h-3.5 w-3.5" />
          {total} pending item{total === 1 ? "" : "s"} across {poGroups.length} purchase order
          {poGroups.length === 1 ? "" : "s"}
          {plannedOnlyRows.length ? " · plus items not yet ordered" : ""}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setExpandedGroups(new Set(allGroupKeys))}
            // Checked per key, not by size: a reload that removes a PO would otherwise leave a
            // stale key making the count match while a group is still closed.
            disabled={allGroupKeys.every((key) => expandedGroups.has(key))}
          >
            Expand all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setExpandedGroups(new Set())}
            disabled={expandedGroups.size === 0}
          >
            Collapse all
          </Button>
        </div>
      </div>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className={PENDING_TABLE_DENSITY}>
            {pendingHead}
            <TableBody>
              {poGroups.map((group, groupIndex) => {
                const { outstanding, overdue } = groupStats(group.rows);
                const key = `po:${group.po.poId}`;
                const isOpen = expandedGroups.has(key);
                return [
                  <TableRow
                    key={key}
                    className={cn(
                      "cursor-pointer bg-muted/40 hover:bg-muted/70",
                      isOpen && "border-b-0",
                    )}
                    onClick={() => toggleGroup(key)}
                  >
                    <TableCell colSpan={PENDING_COLUMN_COUNT}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <ChevronRight
                          aria-hidden
                          className={cn(
                            "h-4 w-4 shrink-0 transition-transform",
                            isOpen && "rotate-90",
                          )}
                        />
                        <span className="text-xs font-medium tabular-nums text-muted-foreground">
                          {mdlOutlineNo(groupIndex)}.
                        </span>
                        <ShoppingCart className="h-4 w-4 shrink-0 text-emerald-600" />
                        {/* The PO number is a link, so it must not also toggle the row. */}
                        <Link
                          href={`/project-management/purchase-orders/${group.po.poId}?project=${encodeURIComponent(mappingId)}`}
                          className="font-semibold hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {group.po.poNumber}
                        </Link>
                        {group.po.vendorName && (
                          <span className="text-sm text-muted-foreground">
                            {group.po.vendorName}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          Ordered {formatMdlDate(group.po.poDate)}
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                          {overdue > 0 && (
                            <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                              <AlertTriangle className="h-3 w-3" />
                              {overdue} overdue
                            </span>
                          )}
                          <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                            {outstanding} outstanding
                          </span>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>,
                  ...(isOpen ? pendingRows(group.rows, [groupIndex], true) : []),
                ];
              })}

              {plannedOnlyRows.length > 0 &&
                (() => {
                  const { outstanding, overdue } = groupStats(plannedOnlyRows);
                  const isOpen = expandedGroups.has(PLANNED_ONLY_KEY);
                  return [
                    <TableRow
                      key={PLANNED_ONLY_KEY}
                      className={cn(
                        "cursor-pointer bg-muted/40 hover:bg-muted/70",
                        isOpen && "border-b-0",
                      )}
                      onClick={() => toggleGroup(PLANNED_ONLY_KEY)}
                    >
                      <TableCell colSpan={PENDING_COLUMN_COUNT}>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <ChevronRight
                            aria-hidden
                            className={cn(
                              "h-4 w-4 shrink-0 transition-transform",
                              isOpen && "rotate-90",
                            )}
                          />
                          <ListTodo className="h-4 w-4 shrink-0 text-slate-500" />
                          <span className="font-semibold">Not on a purchase order yet</span>
                          <span className="text-xs text-muted-foreground">
                            Planned in the register, but nothing is owed by a vendor until the item
                            is ordered.
                          </span>
                          <div className="ml-auto flex items-center gap-2">
                            {overdue > 0 && (
                              <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                <AlertTriangle className="h-3 w-3" />
                                {overdue} overdue
                              </span>
                            )}
                            <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                              {outstanding} outstanding
                            </span>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>,
                    ...(isOpen ? pendingRows(plannedOnlyRows, [], false) : []),
                  ];
                })()}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
