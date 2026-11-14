"use client";

/**
 * The DPR BOQ register as a tree table, after the user's mock-up (`sel-dpr-register-log-settings`):
 * the rows grouped into sections by the first segment of the BOQ SL No ("Section 2 · 6 lines"),
 * each section foldable; under a section every BOQ line, its sub-items under it, theirs under
 * those. One line per row, SL No in its own column, indented by level.
 *
 * Figures on a group are rolled up from the leaves under it (`breakdown.rollUp`), in the group's
 * own unit — a 1 LOT line whose sub-items are 40% done reads "0.4 LOT". Lump units (LOT, LS, job,
 * set) carry their unit beside the figure, so a fraction of a lot never reads as a bare decimal.
 *
 * A section's colour is decorative and follows its key (a hash), never its position.
 */

import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  CornerDownRight,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Target,
  Trash2,
} from "lucide-react";
import type { DprBreakdownNode } from "@/lib/project-management-dpr-breakdown";
import { dprSectionOf, groupDprRegisterSections } from "@/lib/project-management-dpr-register";
import { formatPct, formatQtyAt } from "@/components/project-management/dpr/dpr-shell";
import { isLumpUnit } from "@/components/project-management/dpr/boq-register-add-several";
import { dprSlGradient } from "@/components/project-management/dpr/reports-parts";
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

/** The section a row belongs to: its BOQ line's, for a sub-item. */
export const breakdownSectionOf = (node: DprBreakdownNode): string =>
  dprSectionOf(node.ancestors[0]?.slNo ?? node.slNo);

/** "#7c3aed" → "124, 58, 237", for a tint without color-mix (Chrome 109). */
const rgbOf = (hex: string): string => {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

const COLUMNS = 12;
/** The small square icon buttons of the Actions column. */
const ACTION_BUTTON =
  "h-[30px] w-[30px] rounded-[9px] border border-border/70 bg-background text-violet-700 hover:bg-violet-50 hover:text-violet-800";

export function BreakdownTree({
  rows,
  collapsed,
  onToggle,
  collapsedSections,
  onToggleSection,
  forceOpen = false,
  decimalsFor,
  canEdit,
  canDelete,
  canRecord = false,
  planHref,
  recordHref,
  onAdd,
  onAddSeveral,
  onEdit,
  onDelete,
}: {
  rows: readonly BreakdownTreeRow[];
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Sections folded shut, by key ("2"). */
  collapsedSections: ReadonlySet<string>;
  onToggleSection: (key: string) => void;
  /** A search is on: every section shows its matches, whatever was folded. */
  forceOpen?: boolean;
  decimalsFor: (unit: string) => number;
  canEdit: boolean;
  canDelete: boolean;
  /** May record progress — offers "Record progress" on a leaf. */
  canRecord?: boolean;
  /** Projections › Plan several lines, for "Plan this line". */
  planHref?: string;
  /** Record progress for a leaf's scope. */
  recordHref?: (node: DprBreakdownNode) => string;
  onAdd: (node: DprBreakdownNode) => void;
  onAddSeveral?: (node: DprBreakdownNode) => void;
  onEdit: (node: DprBreakdownNode) => void;
  onDelete: (node: DprBreakdownNode) => void;
}) {
  const sections = groupDprRegisterSections(rows, (row) => breakdownSectionOf(row.node));
  return (
    <TooltipProvider delayDuration={150}>
      <Table stickyHeader containerClassName="max-h-[65vh]" className="min-w-[1264px] table-fixed">
        <colgroup>
          <col className="w-[132px]" />
          <col />
          <col className="w-[92px]" />
          <col className="w-[92px]" />
          <col className="w-[88px]" />
          <col className="w-[92px]" />
          <col className="w-[92px]" />
          <col className="w-[96px]" />
          <col className="w-[100px]" />
          <col className="w-[100px]" />
          <col className="w-[120px]" />
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
            <TableHead className="truncate text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sections.map((section) => {
            const [from, to] = dprSlGradient(`section-${section.key}`);
            const open = forceOpen || !collapsedSections.has(section.key);
            const lines = section.rows.filter((row) => row.node.kind === "boq").length;
            return [
              <TableRow
                key={`section-${section.key}`}
                className="hover:bg-transparent"
                style={{ backgroundImage: `linear-gradient(90deg, rgba(${rgbOf(to)}, 0.1), transparent 60%)` }}
              >
                <TableCell colSpan={COLUMNS} className="p-0">
                  <button
                    type="button"
                    onClick={() => onToggleSection(section.key)}
                    disabled={forceOpen}
                    aria-expanded={open}
                    aria-label={`${open ? "Fold" : "Open"} section ${section.key}`}
                    className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default"
                  >
                    <span
                      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border border-border/70 bg-background"
                      aria-hidden="true"
                    >
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} />
                    </span>
                    <span
                      className="keep-light shrink-0 rounded-lg px-2 py-0.5 text-xs tabular-nums text-white"
                      style={{ backgroundImage: `linear-gradient(140deg, ${from}, ${to})` }}
                    >
                      {section.key}
                    </span>
                    <span className="truncate">Section {section.key}</span>
                    <small className="shrink-0 font-bold text-muted-foreground">
                      · {lines} line{lines === 1 ? "" : "s"}
                    </small>
                  </button>
                </TableCell>
              </TableRow>,
              ...(open
                ? section.rows.map((row) => (
                    <TreeRow
                      key={row.node.id}
                      row={row}
                      edge={to}
                      collapsed={collapsed}
                      onToggle={onToggle}
                      decimalsFor={decimalsFor}
                      canEdit={canEdit}
                      canDelete={canDelete}
                      canRecord={canRecord}
                      planHref={planHref}
                      recordHref={recordHref}
                      onAdd={onAdd}
                      onAddSeveral={onAddSeveral}
                      onEdit={onEdit}
                      onDelete={onDelete}
                    />
                  ))
                : []),
            ];
          })}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}

function TreeRow({
  row,
  edge,
  collapsed,
  onToggle,
  decimalsFor,
  canEdit,
  canDelete,
  canRecord,
  planHref,
  recordHref,
  onAdd,
  onAddSeveral,
  onEdit,
  onDelete,
}: {
  row: BreakdownTreeRow;
  /** The section's colour, for the row's left edge. */
  edge: string;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  decimalsFor: (unit: string) => number;
  canEdit: boolean;
  canDelete: boolean;
  canRecord: boolean;
  planHref?: string;
  recordHref?: (node: DprBreakdownNode) => string;
  onAdd: (node: DprBreakdownNode) => void;
  onAddSeveral?: (node: DprBreakdownNode) => void;
  onEdit: (node: DprBreakdownNode) => void;
  onDelete: (node: DprBreakdownNode) => void;
}) {
  const { node, done, balance, openPlan, addBlockedBy, hasRecords } = row;
  const isGroup = !node.isLeaf;
  const lump = isLumpUnit(node.unit);
  // A group's rolled-up figure is a weighted fraction, so it keeps three places even in a
  // whole-number unit; a leaf shows its unit's own precision.
  const decimals = isGroup ? Math.max(decimalsFor(node.unit), 3) : decimalsFor(node.unit);
  /** A figure in this row's unit — "0.4 LOT" for a lump, the bare number otherwise. */
  const figure = (value: number) => `${formatQtyAt(value, decimals)}${lump && node.unit ? ` ${node.unit}` : ""}`;
  const isOpen = !collapsed.has(node.id);
  const progress = node.qty > 0 ? (done / node.qty) * 100 : null;
  const path = node.ancestors.map((ancestor) => `${ancestor.slNo} ${ancestor.description}`.trim()).join(" › ");
  const blocked = addBlockedBy.length > 0;
  const record = canRecord && node.isLeaf && recordHref ? recordHref(node) : null;
  const showMenu = canEdit || (canDelete && node.kind === "sub") || Boolean(planHref) || Boolean(record);

  return (
    <TableRow className={cn(node.kind === "boq" && "bg-muted/20")}>
      {/* SL No, indented by level, with the group's open/close toggle and the section's edge. */}
      <TableCell className="py-1.5" style={{ boxShadow: `inset 3px 0 0 ${edge}` }}>
        <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: `${node.depth * 12}px` }}>
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
            className={cn("truncate tabular-nums", node.kind === "boq" ? "font-extrabold" : "font-bold")}
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
          <span
            className="rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-extrabold text-violet-700"
            title="Its figures roll up from the sub-items below; it takes no records of its own"
          >
            Group
          </span>
        ) : (
          <span
            className="rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-extrabold text-sky-700"
            title="Progress is planned and recorded on this line"
          >
            Records
          </span>
        )}
      </TableCell>
      <TableCell className="truncate text-sm" title={node.unit}>
        {node.unit || "—"}
      </TableCell>
      <TableCell
        className="truncate text-right text-sm font-bold tabular-nums"
        title={node.qty > 0 ? figure(node.qty) : undefined}
      >
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
      <TableCell className="truncate text-right text-sm font-extrabold tabular-nums text-cyan-700">
        {formatPct(node.shareOfLine * 100)}
      </TableCell>
      <TableCell
        className={cn(
          "truncate text-right text-sm tabular-nums",
          done > 1e-9 ? "font-extrabold text-emerald-600" : "text-muted-foreground",
        )}
        title={isGroup ? `${figure(done)} — rolled up from the sub-items below` : figure(done)}
      >
        {figure(done)}
      </TableCell>
      <TableCell
        className={cn("truncate text-right text-sm tabular-nums", balance < -1e-9 && "text-destructive")}
        title={balance < -1e-9 ? `${figure(balance)} — work has run past the quantity` : figure(balance)}
      >
        {node.qty > 0 ? figure(balance) : "—"}
      </TableCell>
      <TableCell
        className="truncate text-right text-sm tabular-nums"
        title={openPlan > 0 ? `${figure(openPlan)} still planned from today on` : "Nothing planned from today on"}
      >
        {openPlan > 0 ? (
          <span className="rounded-full bg-violet-50 px-2 py-0.5 font-extrabold text-violet-700">{figure(openPlan)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="py-1.5">
        {progress === null ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <b className="w-12 shrink-0 text-right text-xs font-extrabold tabular-nums">{formatPct(progress)}</b>
            <span className="h-[7px] w-[46px] shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.min(100, Math.max(progress > 0 ? 3 : 0, progress))}%`,
                  backgroundImage: "linear-gradient(90deg, #34d399, #059669)",
                }}
              />
            </span>
          </span>
        )}
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
                      className={ACTION_BUTTON}
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
                className={ACTION_BUTTON}
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
                  className={ACTION_BUTTON}
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
                {planHref || record ? <DropdownMenuSeparator /> : null}
                {planHref ? (
                  <DropdownMenuItem asChild>
                    <Link href={planHref}>
                      <Target className="mr-2 h-4 w-4" /> Plan this line
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {record ? (
                  <DropdownMenuItem asChild>
                    <Link href={record}>
                      <ClipboardList className="mr-2 h-4 w-4" /> Record progress
                    </Link>
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
}
