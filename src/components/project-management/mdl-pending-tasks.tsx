"use client";

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  ListTodo,
  ShoppingCart,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/shared/table-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { PmDataList, type PmListColumn } from "@/components/project-management/pm-shell";
import { pmStatusTone } from "@/components/project-management/pm-status-tones";
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
  mdlOutlineNo,
  type MdlGroupablePo,
  type MdlRollup,
  type MdlRow,
  type MdlSubDrawing,
} from "@/lib/mdl";

// A queue line as the phone renders it: one card per item, its sub-drawings nested beneath.
type PendingCardRow = MdlRow & { id: string; rollup: MdlRollup; outline: number[]; hasPo: boolean };
type PendingSubCardRow = { id: string; itemId: string; sub: MdlSubDrawing; outline: number[]; hasPo: boolean };

// Lighter nested cards, so a sub-drawing reads as part of its item's card rather than a second one.
const NESTED_CARD_CLASS = "border-border bg-muted/30 p-2.5 shadow-none";

/** Enter/Space on a `role="button"` strip — but not when the key was meant for a link inside it. */
const onStripKey = (event: KeyboardEvent, action: () => void) => {
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
};

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

  // Shared by the desktop rows and the phone cards, so both number a line the same.
  const sortPendingRows = (groupRows: MdlRow[]) =>
    groupRows
      .map((row) => ({ ...row, rollup: getMdlRollup(row.drawing) }))
      .sort((a, b) => {
        if (a.rollup.overdue !== b.rollup.overdue) return a.rollup.overdue ? -1 : 1;
        // Then whatever falls due soonest, with undated drawings last.
        return (a.rollup.plannedEndDate || "9999-12-31").localeCompare(
          b.rollup.plannedEndDate || "9999-12-31",
        );
      });

  // `prefix` carries the enclosing purchase order's index, so its items read 1.1, 1.2 and their
  // sub-drawings 1.1.1, 1.1.2. Rows with no PO get no prefix and simply read 1, 1.1.
  //
  // Item and sub-drawing rows stay click-to-update rather than click-to-expand: this is a
  // worklist, so a row's own click has to be the action you came to perform. Only the purchase
  // order above them collapses.
  const pendingRows = (groupRows: MdlRow[], prefix: number[], hasPo: boolean) =>
    sortPendingRows(groupRows)
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
                <Badge variant="neutral" className="whitespace-nowrap">
                  {rollup.subApproved}/{rollup.subTotal}
                  {rollup.subCollected > rollup.subApproved && ` · ${rollup.subCollected}c`}
                </Badge>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            {/* Assignment is a property of a sub-drawing, not of the BOQ item's own record. */}
            <TableCell>—</TableCell>
            <TableCell className="whitespace-nowrap">
              <span className={rollup.overdue ? "font-medium text-red-600" : ""}>
                {formatMdlDate(rollup.plannedEndDate)}
              </span>
              {rollup.overdue && (
                <StatusBadge
                  status="Overdue"
                  className="ml-1.5"
                  title={
                    rollup.subTotal
                      ? "This item has a drawing past its planned end date — see the rows below"
                      : undefined
                  }
                />
              )}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {cycleAgeDays != null ? (
                <span className={cycleAgeDays > 30 ? "font-medium text-amber-600" : ""}>{cycleAgeDays}d</span>
              ) : "—"}
            </TableCell>
            <TableCell />
            <TableCell className="whitespace-nowrap">
              <StatusBadge status={rollup.status} tone={pmStatusTone(rollup.status)} />
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
                <TableCell className="whitespace-nowrap tabular-nums">
                  {/* Indent lives on an inner span, so the cell keeps the table's own padding. */}
                  <span className="pl-3">{mdlOutlineNo(...prefix, index, subIndex)}.</span>
                </TableCell>
                <TableCell />
                <TableCell className="max-w-[240px]" title={sub.title}>
                  <div className="flex items-center gap-1.5 border-l-2 border-muted pl-3">
                    {subApproved && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                    <span className="truncate text-sm">{sub.title || "Untitled drawing"}</span>
                  </div>
                </TableCell>
                <TableCell>—</TableCell>
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
                <TableCell className="whitespace-nowrap">
                  <span className={subOverdue ? "font-medium text-red-600" : ""}>
                    {formatMdlDate(sub.plannedEndDate)}
                  </span>
                  {subOverdue && <StatusBadge status="Overdue" className="ml-1.5" />}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {subCycleAgeDays != null ? (
                    <span className={subCycleAgeDays > 30 ? "font-medium text-amber-600" : ""}>
                      {subCycleAgeDays}d
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <StatusBadge status={stage} tone={pmStatusTone(stage)} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <StatusBadge status={sub.status} tone={pmStatusTone(sub.status)} />
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

  /* ── Phone ──────────────────────────────────────────────────────────────────────────────────
     The desktop queue is one table across every purchase order, with full-width group rows —
     something PmDataList cannot draw — so below `sm` the same groups become tappable strips, and
     an open group lists its items as PmDataList cards with their sub-drawings nested inside. */

  const pendingCardColumns: PmListColumn<PendingCardRow>[] = [
    {
      header: "Item / Drawing",
      mobile: "title",
      cell: ({ item, outline }) => (
        <>
          <span className="mr-1 tabular-nums text-muted-foreground">{mdlOutlineNo(...outline)}.</span>
          {String(item.Description ?? "—")}
        </>
      ),
    },
    { header: "BOQ SL No", mobile: "title", cell: ({ item }) => `BOQ SL No ${String(item["BOQ SL No"] ?? "—")}` },
    {
      header: "Status",
      mobile: "aside",
      cell: ({ rollup }) => <StatusBadge status={rollup.status} tone={pmStatusTone(rollup.status)} />,
    },
    {
      header: "Overdue",
      mobile: "aside",
      cell: ({ rollup }) => (rollup.overdue ? <StatusBadge status="Overdue" /> : null),
    },
    {
      header: "Planned End",
      cell: ({ rollup }) => (
        <span className={rollup.overdue ? "font-medium text-red-600" : ""}>{formatMdlDate(rollup.plannedEndDate)}</span>
      ),
    },
    {
      header: "Cycle Age",
      cell: ({ rollup }) => {
        const cycleAgeDays = computeMdlCycleAgeDays(rollup);
        return cycleAgeDays != null ? (
          <span className={cycleAgeDays > 30 ? "font-medium text-amber-600" : ""}>{cycleAgeDays}d</span>
        ) : "—";
      },
    },
    {
      header: "Drawings",
      cell: ({ drawing, rollup }) =>
        getMdlSubDrawings(drawing).length > 0 ? (
          <Badge variant="neutral" className="whitespace-nowrap">
            {rollup.subApproved}/{rollup.subTotal}
            {rollup.subCollected > rollup.subApproved && ` · ${rollup.subCollected}c`}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      header: "Update",
      mobile: "footer",
      cell: ({ item }) => (
        <Button variant="outline" size="sm" onClick={() => onSelectItem(item.id)}>
          Update
        </Button>
      ),
    },
  ];

  const subCardColumns: PmListColumn<PendingSubCardRow>[] = [
    {
      header: "Drawing",
      mobile: "title",
      cell: ({ sub, outline }) => (
        <span className="flex items-start gap-1.5">
          <span className="text-xs tabular-nums text-muted-foreground">{mdlOutlineNo(...outline)}.</span>
          {isMdlApproved(sub.status) && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />}
          <span className="min-w-0 break-words">{sub.title || "Untitled drawing"}</span>
        </span>
      ),
    },
    {
      // Stage and status sit on this wrapping line rather than as asides: two pills as long as
      // "Re-collect from Vendor" beside the title would leave it a word wide.
      header: "Stage",
      mobile: "title",
      cell: ({ sub, hasPo }) => {
        const stage = computeMdlDrawingStage(sub, hasPo);
        return (
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={stage} tone={pmStatusTone(stage)} />
            <StatusBadge status={sub.status} tone={pmStatusTone(sub.status)} />
            <span className={cn(sub.assignedToName && "text-foreground")}>{sub.assignedToName || "Unassigned"}</span>
            {sub.collection?.fileUrl && (
              <a
                href={sub.collection.fileUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-primary underline underline-offset-2"
                title="Open the drawing collected from the vendor"
              >
                · Vendor
              </a>
            )}
          </span>
        );
      },
    },
    {
      header: "Planned End",
      cell: ({ sub }) => {
        const subOverdue = isMdlOverdue(sub);
        return (
          <>
            <span className={subOverdue ? "font-medium text-red-600" : ""}>{formatMdlDate(sub.plannedEndDate)}</span>
            {subOverdue && <StatusBadge status="Overdue" className="ml-1.5" />}
          </>
        );
      },
    },
    {
      header: "Cycle Age",
      cell: ({ sub }) => {
        const subCycleAgeDays = computeMdlCycleAgeDays(sub);
        return subCycleAgeDays != null ? (
          <span className={subCycleAgeDays > 30 ? "font-medium text-amber-600" : ""}>{subCycleAgeDays}d</span>
        ) : "—";
      },
    },
  ];

  // Sub-drawing cards stay click-to-update, like their desktop rows.
  const phoneCards = (groupRows: MdlRow[], prefix: number[], hasPo: boolean) => {
    const cardRows: PendingCardRow[] = sortPendingRows(groupRows).map((row, index) => ({
      ...row,
      id: row.item.id,
      outline: [...prefix, index],
      hasPo,
    }));
    return (
      <PmDataList
        cardsOnly
        rows={cardRows}
        columns={pendingCardColumns}
        // Always open, as on the desktop: the sub-drawings are the work.
        expandedIds={new Set(cardRows.filter((row) => getMdlSubDrawings(row.drawing).length).map((row) => row.id))}
        renderExpanded={(row) => (
          <PmDataList
            cardsOnly
            rows={getMdlSubDrawings(row.drawing).map((sub, subIndex) => ({
              id: sub.id,
              itemId: row.item.id,
              sub,
              outline: [...row.outline, subIndex],
              hasPo: row.hasPo,
            }))}
            columns={subCardColumns}
            onRowClick={(subRow) => onSelectItem(subRow.itemId, subRow.sub.id)}
            rowClassName={() => NESTED_CARD_CLASS}
          />
        )}
      />
    );
  };

  /** A collapsible purchase-order strip, and its cards when open. */
  const phoneGroup = (key: string, heading: ReactNode, cards: () => ReactNode) => {
    const isOpen = expandedGroups.has(key);
    return (
      <div key={key}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
          onClick={() => toggleGroup(key)}
          onKeyDown={(event) => onStripKey(event, () => toggleGroup(key))}
          className="cursor-pointer bg-muted/40 px-3 py-3"
        >
          {heading}
        </div>
        {isOpen && <div className="border-t bg-muted/30 p-2.5">{cards()}</div>}
      </div>
    );
  };

  if (!total) {
    return (
      <TableCard title="Pending Tasks" icon={ListTodo} scroll="natural">
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <ClipboardCheck className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nothing pending — every planned drawing, and every item with a purchase order placed, has already been
            approved.
          </p>
        </div>
      </TableCard>
    );
  }

  const groupBadges = (outstanding: number, overdue: number) => (
    <div className="ml-auto flex items-center gap-2">
      {overdue > 0 && (
        <Badge variant="danger" className="gap-1 whitespace-nowrap">
          <AlertTriangle className="h-3 w-3" />
          {overdue} overdue
        </Badge>
      )}
      <Badge variant="neutral" className="whitespace-nowrap">
        {outstanding} outstanding
      </Badge>
    </div>
  );

  /** A purchase order's group-row contents — the desktop table's full-width cell and the phone strip. */
  const poGroupHeading = (group: (typeof poGroups)[number], groupIndex: number, isOpen: boolean) => {
    const { outstanding, overdue } = groupStats(group.rows);
    return (
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
        {groupBadges(outstanding, overdue)}
      </div>
    );
  };

  const plannedOnlyHeading = (isOpen: boolean) => {
    const { outstanding, overdue } = groupStats(plannedOnlyRows);
    return (
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
        {groupBadges(outstanding, overdue)}
      </div>
    );
  };

  return (
    <TableCard
      title="Pending Tasks"
      icon={ListTodo}
      description={
        <>
          {total} pending item{total === 1 ? "" : "s"} across {poGroups.length} purchase order
          {poGroups.length === 1 ? "" : "s"}
          {plannedOnlyRows.length ? " · plus items not yet ordered" : ""}
        </>
      }
      // With every group closed by default there has to be a way to the full queue in one
      // action rather than N clicks.
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-2 text-xs sm:h-7"
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
            className="h-9 px-2 text-xs sm:h-7"
            onClick={() => setExpandedGroups(new Set())}
            disabled={expandedGroups.size === 0}
          >
            Collapse all
          </Button>
        </>
      }
    >
          <Table containerClassName="hidden sm:block">
            {pendingHead}
            <TableBody>
              {poGroups.map((group, groupIndex) => {
                const key = `po:${group.po.poId}`;
                const isOpen = expandedGroups.has(key);
                return [
                  <TableRow
                    key={key}
                    className={cn(
                      "cursor-pointer bg-muted/40",
                      isOpen && "border-b-0",
                    )}
                    onClick={() => toggleGroup(key)}
                  >
                    <TableCell colSpan={PENDING_COLUMN_COUNT}>
                      {poGroupHeading(group, groupIndex, isOpen)}
                    </TableCell>
                  </TableRow>,
                  ...(isOpen ? pendingRows(group.rows, [groupIndex], true) : []),
                ];
              })}

              {plannedOnlyRows.length > 0 &&
                (() => {
                  const isOpen = expandedGroups.has(PLANNED_ONLY_KEY);
                  return [
                    <TableRow
                      key={PLANNED_ONLY_KEY}
                      className={cn(
                        "cursor-pointer bg-muted/40",
                        isOpen && "border-b-0",
                      )}
                      onClick={() => toggleGroup(PLANNED_ONLY_KEY)}
                    >
                      <TableCell colSpan={PENDING_COLUMN_COUNT}>
                        {plannedOnlyHeading(isOpen)}
                      </TableCell>
                    </TableRow>,
                    ...(isOpen ? pendingRows(plannedOnlyRows, [], false) : []),
                  ];
                })()}
            </TableBody>
          </Table>

        <div className="divide-y sm:hidden">
          {poGroups.map((group, groupIndex) => {
            const key = `po:${group.po.poId}`;
            return phoneGroup(key, poGroupHeading(group, groupIndex, expandedGroups.has(key)), () =>
              phoneCards(group.rows, [groupIndex], true),
            );
          })}
          {plannedOnlyRows.length > 0 &&
            phoneGroup(PLANNED_ONLY_KEY, plannedOnlyHeading(expandedGroups.has(PLANNED_ONLY_KEY)), () =>
              phoneCards(plannedOnlyRows, [], false),
            )}
        </div>
    </TableCard>
  );
}
