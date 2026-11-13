"use client";

/**
 * The DPR BOQ register as a tree table: every BOQ line of a scope as a top row, its sub-items under
 * it, theirs under those. One line per row, SL No in its own column, indented by level.
 *
 * Figures on a group are rolled up from the leaves under it (`breakdown.rollUp`), in the group's
 * own unit — a 1 LOT line whose sub-items are 40% done reads "0.4 LOT". Lump units (LOT, LS, job,
 * set) carry their unit beside the figure, so a fraction of a lot never reads as a bare decimal.
 */

import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { DprBreakdownNode } from "@/lib/project-management-dpr-breakdown";
import { formatPct, formatQtyAt } from "@/components/project-management/dpr/dpr-shell";
import { isLumpUnit } from "@/components/project-management/dpr/boq-register-add-several";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface BreakdownTreeRow {
  node: DprBreakdownNode;
  /** Submitted work, rolled up to this node, in its own unit. */
  done: number;
  /** Quantity less done, in its own unit. Negative when work has run past the quantity. */
  balance: number;
  /** Still planned from today on, rolled up to this node, in its own unit. */
  openPlan: number;
  /** Why a sub-item cannot be added under this node; empty when it can. */
  addBlockedBy: string[];
  /** Whether this node itself has projections or sheet lines booked against it. */
  hasRecords: boolean;
}

export function BreakdownTree({
  rows,
  collapsed,
  onToggle,
  decimalsFor,
  canEdit,
  canDelete,
  onAdd,
  onAddSeveral,
  onEdit,
  onDelete,
}: {
  rows: readonly BreakdownTreeRow[];
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  decimalsFor: (unit: string) => number;
  canEdit: boolean;
  canDelete: boolean;
  onAdd: (node: DprBreakdownNode) => void;
  onAddSeveral?: (node: DprBreakdownNode) => void;
  onEdit: (node: DprBreakdownNode) => void;
  onDelete: (node: DprBreakdownNode) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <TooltipProvider delayDuration={150}>
        <Table stickyHeader containerClassName="max-h-[65vh]" className="min-w-[1200px] table-fixed">
          <colgroup>
            <col className="w-[132px]" />
            <col />
            <col className="w-[84px]" />
            <col className="w-[72px]" />
            <col className="w-[88px]" />
            <col className="w-[80px]" />
            <col className="w-[72px]" />
            <col className="w-[100px]" />
            <col className="w-[100px]" />
            <col className="w-[96px]" />
            <col className="w-[104px]" />
            <col className="w-[84px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className="truncate">SL No</TableHead>
              <TableHead className="truncate">Description</TableHead>
              <TableHead className="truncate">Type</TableHead>
              <TableHead className="truncate">Unit</TableHead>
              <TableHead className="truncate text-right">Qty</TableHead>
              <TableHead className="truncate text-right" title="Share of the line directly above">
                Share
              </TableHead>
              <TableHead className="truncate text-right" title="Share of the BOQ line at the top of the branch">
                Of line
              </TableHead>
              <TableHead className="truncate text-right" title="Submitted work, rolled up to this line">
                Done
              </TableHead>
              <TableHead className="truncate text-right" title="Quantity less done">
                Balance
              </TableHead>
              <TableHead className="truncate text-right" title="Still planned from today on, from Projections">
                Planned
              </TableHead>
              <TableHead className="truncate" title="Done ÷ quantity">
                Progress
              </TableHead>
              <TableHead className="truncate text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ node, done, balance, openPlan, addBlockedBy, hasRecords }) => {
              const isGroup = !node.isLeaf;
              const lump = isLumpUnit(node.unit);
              // A group's rolled-up figure is a weighted fraction, so it keeps three places even
              // in a whole-number unit; a leaf shows its unit's own precision.
              const decimals = isGroup ? Math.max(decimalsFor(node.unit), 3) : decimalsFor(node.unit);
              /** A figure in this row's unit — "0.4 LOT" for a lump, the bare number otherwise. */
              const figure = (value: number) =>
                `${formatQtyAt(value, decimals)}${lump && node.unit ? ` ${node.unit}` : ""}`;
              const isOpen = !collapsed.has(node.id);
              const progress = node.qty > 0 ? (done / node.qty) * 100 : null;
              const path = node.ancestors
                .map((ancestor) => `${ancestor.slNo} ${ancestor.description}`.trim())
                .join(" › ");
              const blocked = addBlockedBy.length > 0;
              const showMenu = canEdit || (canDelete && node.kind === "sub");
              return (
                <TableRow key={node.id} className={cn(node.kind === "boq" && "bg-muted/20")}>
                  {/* SL No, indented by level, with the group's open/close toggle. */}
                  <TableCell className="py-1.5">
                    <div
                      className="flex min-w-0 items-center gap-1"
                      style={{ paddingLeft: `${node.depth * 12}px` }}
                    >
                      {isGroup ? (
                        <button
                          type="button"
                          onClick={() => onToggle(node.id)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.slNo || "this line"}`}
                          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      ) : node.depth > 0 ? (
                        <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <span className="w-5 shrink-0" aria-hidden="true" />
                      )}
                      <span
                        className={cn(
                          "truncate tabular-nums",
                          node.kind === "boq" ? "font-semibold" : "font-medium",
                        )}
                        title={node.slNo}
                      >
                        {node.slNo || "—"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell
                    className={cn("truncate text-sm", node.kind === "boq" && "font-medium")}
                    title={path ? `${path} › ${node.description}` : node.description}
                  >
                    {node.description || "BOQ line"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-1.5">
                    {isGroup ? (
                      <StatusBadge status="Group" tone="info">
                        Group
                      </StatusBadge>
                    ) : (
                      <span
                        className="text-xs text-muted-foreground"
                        title="Progress is planned and recorded on this line"
                      >
                        Records
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="truncate text-sm" title={node.unit}>
                    {node.unit || "—"}
                  </TableCell>
                  <TableCell className="truncate text-right text-sm tabular-nums" title={node.qty > 0 ? figure(node.qty) : undefined}>
                    {node.qty > 0 ? formatQtyAt(node.qty, decimalsFor(node.unit)) : "—"}
                  </TableCell>
                  <TableCell className="truncate text-right text-sm tabular-nums">
                    {node.kind === "boq" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : node.weightPct !== null ? (
                      formatPct(node.weightPct)
                    ) : (
                      <span
                        className="text-muted-foreground"
                        title="Auto: shares out what the set ones leave — by quantity when every sub-item uses the parent's unit, otherwise equally"
                      >
                        ≈{formatPct(node.weight * 100)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="truncate text-right text-sm tabular-nums text-muted-foreground">
                    {formatPct(node.shareOfLine * 100)}
                  </TableCell>
                  <TableCell
                    className="truncate text-right text-sm tabular-nums"
                    title={isGroup ? `${figure(done)} — rolled up from the sub-items below` : figure(done)}
                  >
                    {figure(done)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "truncate text-right text-sm tabular-nums",
                      balance < -1e-9 && "text-destructive",
                    )}
                    title={balance < -1e-9 ? `${figure(balance)} — work has run past the quantity` : figure(balance)}
                  >
                    {node.qty > 0 ? figure(balance) : "—"}
                  </TableCell>
                  <TableCell
                    className="truncate text-right text-sm tabular-nums text-muted-foreground"
                    title={openPlan > 0 ? `${figure(openPlan)} still planned from today on` : "Nothing planned from today on"}
                  >
                    {openPlan > 0 ? figure(openPlan) : "—"}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-11 shrink-0 text-right text-xs tabular-nums">{formatPct(progress)}</span>
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.min(100, Math.max(0, progress ?? 0))}%` }}
                        />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      {canEdit ? (
                        blocked ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {/* A disabled button fires no pointer events, so the tip sits on a wrapper. */}
                              <span tabIndex={0} className="inline-flex">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  disabled
                                  aria-label={`Add a sub-item under ${node.slNo || "this line"} (not available)`}
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">
                              {addBlockedBy.map((reason) => (
                                <p key={reason}>{reason}</p>
                              ))}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Add a sub-item"
                            aria-label={`Add a sub-item under ${node.slNo || "this line"}`}
                            onClick={() => onAdd(node)}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        )
                      ) : null}
                      {showMenu ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              aria-label={`More for ${node.slNo || "this line"}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-60">
                            <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                              {node.slNo ? `${node.slNo} · ` : ""}
                              {node.description}
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {canEdit && onAddSeveral ? (
                              <DropdownMenuItem disabled={blocked} onSelect={() => onAddSeveral(node)}>
                                <ListPlus className="mr-2 h-4 w-4" /> Add several sub-items
                              </DropdownMenuItem>
                            ) : null}
                            {canEdit ? (
                              <DropdownMenuItem disabled={blocked} onSelect={() => onAdd(node)}>
                                <Plus className="mr-2 h-4 w-4" /> Add one sub-item
                              </DropdownMenuItem>
                            ) : null}
                            {canEdit && blocked ? (
                              <p className="px-2 pb-1.5 text-xs text-muted-foreground">{addBlockedBy[0]}</p>
                            ) : null}
                            {canEdit && node.kind === "sub" ? (
                              <DropdownMenuItem onSelect={() => onEdit(node)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                {hasRecords ? "Edit (unit fixed: records exist)" : "Edit"}
                              </DropdownMenuItem>
                            ) : null}
                            {canDelete && node.kind === "sub" ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => onDelete(node)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TooltipProvider>
    </div>
  );
}
