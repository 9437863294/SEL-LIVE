"use client";

/**
 * Plan several lines — pick the period once, then fill a quantity against each BOQ line of a
 * scope. Every row is checked as it is typed (rules P1–P6), so a save only ever writes rows that
 * pass; rows that do not stay on screen with their messages.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CircleAlert,
  ClipboardPaste,
  Copy,
  ListPlus,
  Loader2,
  Pencil,
  Save,
  Search,
  Sigma,
  Target,
  TriangleAlert,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  DPR_BASE_PATH,
  DPR_SCOPES,
  daysInRange,
  type DprDistribution,
  type DprProjectionPeriod,
  type DprScope,
} from "@/lib/project-management-dpr";
import type { DprBreakdownNode } from "@/lib/project-management-dpr-breakdown";
import {
  DPR_DISTRIBUTIONS,
  DPR_DISTRIBUTION_LABELS,
  checkDprProjection,
  dprCalendar,
  isValidRange,
  parsePastedQuantities,
  previousPeriodRange,
  roundToDecimals,
  unplannedBalance,
  type DprCheckResult,
  type DprOverlapPolicy,
} from "@/lib/project-management-dpr-plan";
import type { DprBoqItem } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprMessages,
  DprPeriodPicker,
  defaultPeriodSelection,
  dprHref,
  formatDisplayDate,
  formatQtyAt,
  resolvePeriodRange,
  type DprPeriodSelection,
} from "@/components/project-management/dpr/dpr-shell";
import { DprIndentedText, breakdownTitle } from "@/components/project-management/dpr/dpr-indent";
import {
  SubItemDialog,
  addBlockersFor,
  type SubItemDialogRequest,
} from "@/components/project-management/dpr/breakdown-dialogs";
import { PasteQuantitiesDialog } from "@/components/project-management/dpr/projections-dialogs";
import {
  candidateFor,
  createProjections,
  readQtyText,
  worksOutAt,
  type NewProjection,
  type ProjectionsContext,
} from "@/components/project-management/dpr/projections-shared";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { InfoTip } from "@/components/shared/info-tip";
import { SectionHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PlanRow {
  qty: string;
  remarks: string;
}

const EMPTY_ROW: PlanRow = { qty: "", remarks: "" };

/** A row of the planner: a leaf, which takes a quantity, or a group heading over its sub-items. */
interface PlanDisplayRow {
  node: DprBreakdownNode;
  /** The leaf's plannable item; null for a group. */
  item: DprBoqItem | null;
}

/** A group's tooltip: the lines above it, then its own description. */
const nodeTitle = (node: DprBreakdownNode): string =>
  [
    ...node.ancestors.map((ancestor) => `${ancestor.slNo} ${ancestor.description}`.trim()),
    node.description,
  ].join(" › ");

/** Rounds down to a unit's precision, so a filled balance never overshoots it. */
const floorToDecimals = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.floor(value * scale + 1e-9) / scale;
};

export function ProjectionPlanner({ context }: { context: ProjectionsContext }) {
  const { toast } = useToast();
  const { data, actuals, today, canEdit } = context;

  const [scope, setScope] = useState<DprScope>("Civil");
  const [period, setPeriod] = useState<DprPeriodSelection>(() => defaultPeriodSelection("Week"));
  const [distribution, setDistribution] = useState<DprDistribution>("even");
  const [policy, setPolicy] = useState<DprOverlapPolicy>("block");
  const [rows, setRows] = useState<Record<string, PlanRow>>({});
  const [filter, setFilter] = useState("");
  const [isPasteOpen, setIsPasteOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  /** The add / edit sub-item dialog, opened from a row's actions. */
  const [subItemRequest, setSubItemRequest] = useState<SubItemDialogRequest | null>(null);

  const range = useMemo(() => resolvePeriodRange(period), [period]);
  const rangeOk = isValidRange(range);
  const periodType: DprProjectionPeriod = period.choice;
  const workingDays = useMemo(
    () => (rangeOk ? dprCalendar(data.settings).workingDays(range.startDate, range.endDate).length : 0),
    [data.settings, range, rangeOk],
  );

  const scopeItems = useMemo(
    () => data.boqItems.filter((item) => item.scope === scope),
    [data.boqItems, scope],
  );
  /**
   * The rows in breakdown order: a BOQ line with sub-items is a read-only heading over them, and
   * only leaves take a quantity. A filter match keeps the lines above it (so it reads in context)
   * and everything under it.
   */
  const displayRows = useMemo<PlanDisplayRow[]>(() => {
    const { breakdown } = data;
    const itemById = new Map(scopeItems.map((item) => [item.id, item]));
    const inScope = breakdown.ordered.filter((node) => node.scope === scope);
    const needle = filter.trim().toLowerCase();
    let visible: Set<string> | null = null;
    if (needle) {
      visible = new Set<string>();
      for (const node of inScope) {
        if (!`${node.slNo} ${node.erpSlNo ?? ""} ${node.description}`.toLowerCase().includes(needle)) continue;
        visible.add(node.id);
        for (let parentId = node.parentId; parentId; parentId = breakdown.nodes.get(parentId)?.parentId ?? null) {
          visible.add(parentId);
        }
        for (const id of breakdown.descendantIds(node.id)) visible.add(id);
      }
    }
    return inScope
      .filter((node) => !visible || visible.has(node.id))
      .map((node) => ({ node, item: node.isLeaf ? (itemById.get(node.id) ?? null) : null }))
      .filter((row) => !row.node.isLeaf || row.item !== null);
  }, [data, scopeItems, scope, filter]);

  /** Done and planned rolled up to every group, in the group's own unit. */
  const rolledDone = useMemo(
    () => data.breakdown.rollUp((id) => actuals.total(id)),
    [data.breakdown, actuals],
  );
  const rolledPlanned = useMemo(
    () =>
      rangeOk
        ? data.breakdown.rollUp((id) => data.plan.qtyInRange(id, range))
        : new Map<string, number>(),
    [data.breakdown, data.plan, range, rangeOk],
  );

  /** Why a sub-item cannot be added under a row (depth limit, records already booked), if it can't. */
  const addBlockers = useMemo(() => {
    const blockers = new Map<string, string[]>();
    for (const row of displayRows) blockers.set(row.node.id, addBlockersFor(row.node, data));
    return blockers;
  }, [displayRows, data]);

  const rowOf = (id: string): PlanRow => rows[id] ?? EMPTY_ROW;
  const setRow = (id: string, patch: Partial<PlanRow>) =>
    setRows((previous) => ({ ...previous, [id]: { ...(previous[id] ?? EMPTY_ROW), ...patch } }));

  const candidateOf = (item: DprBoqItem, qty: number) =>
    candidateFor({
      item,
      periodType,
      startDate: range.startDate,
      endDate: range.endDate,
      qty,
      distribution,
    });

  /** Live checks for every row with something typed in it. */
  const checks = useMemo(() => {
    const results = new Map<string, DprCheckResult>();
    for (const item of scopeItems) {
      const text = rows[item.id]?.qty ?? "";
      if (!text.trim()) continue;
      const qty = readQtyText(text);
      results.set(
        item.id,
        checkDprProjection({
          candidate: candidateFor({
            item,
            periodType,
            startDate: range.startDate,
            endDate: range.endDate,
            qty: qty !== null && Number.isFinite(qty) ? qty : 0,
            distribution,
          }),
          item: { unit: item.unit, boqQty: item.boqQty },
          targets: data.targets,
          actuals,
          settings: data.settings,
          projectDates: data.projectDates,
          today,
          overlapPolicy: policy,
        }),
      );
    }
    return results;
  }, [scopeItems, rows, periodType, range, distribution, data, actuals, today, policy]);

  const filledCount = scopeItems.filter((item) => (rows[item.id]?.qty ?? "").trim()).length;
  const blockedCount = [...checks.values()].filter((check) => check.errors.length > 0).length;

  /** Each row's problems, named by its BOQ number, for the list above the table. */
  const problemRows = useMemo(() => {
    const slOf = new Map(scopeItems.map((item) => [item.id, item.boqSlNo || item.erpSlNo || "A line"]));
    return [...checks]
      .filter(([, check]) => check.errors.length > 0 || check.warnings.length > 0)
      .map(([id, check]) => ({
        errors: check.errors.map((message) => `${slOf.get(id)}: ${message}`),
        warnings: check.warnings.map((message) => `${slOf.get(id)}: ${message}`),
      }));
  }, [checks, scopeItems]);

  const copyPrevious = () => {
    if (!rangeOk) {
      toast({ title: "Pick a valid period first", variant: "destructive" });
      return;
    }
    const previous = previousPeriodRange(periodType, range);
    let copied = 0;
    const next = { ...rows };
    for (const item of scopeItems) {
      const qty = roundToDecimals(data.plan.qtyInRange(item.id, previous), data.decimalsFor(item.unit));
      if (qty <= 0) continue;
      next[item.id] = { ...(next[item.id] ?? EMPTY_ROW), qty: String(qty) };
      copied += 1;
    }
    setRows(next);
    toast({
      title: copied
        ? `Copied ${copied} line${copied === 1 ? "" : "s"}`
        : "Nothing was planned in the previous period",
      description: `${formatDisplayDate(previous.startDate)} – ${formatDisplayDate(previous.endDate)}`,
    });
  };

  const spreadBalance = () => {
    let filled = 0;
    let noQuantity = 0;
    const next = { ...rows };
    for (const item of scopeItems) {
      const balance = unplannedBalance({ item, plan: data.plan, actuals, settings: data.settings, today });
      if (balance === null) {
        noQuantity += 1;
        continue;
      }
      const qty = floorToDecimals(balance, data.decimalsFor(item.unit));
      if (qty <= 0) continue;
      next[item.id] = { ...(next[item.id] ?? EMPTY_ROW), qty: String(qty) };
      filled += 1;
    }
    setRows(next);
    toast({
      title: filled
        ? `Filled the unplanned balance on ${filled} line${filled === 1 ? "" : "s"}`
        : "Nothing is left to plan",
      description:
        noQuantity > 0
          ? `${noQuantity} line${noQuantity === 1 ? " has" : "s have"} no BOQ quantity, so no balance.`
          : undefined,
    });
  };

  const applyPaste = (text: string) => {
    const pasted = parsePastedQuantities(text);
    const next = { ...rows };
    const notFound: string[] = [];
    let matched = 0;
    for (const { key, qty } of pasted) {
      const wanted = key.trim().toLowerCase();
      const item =
        scopeItems.find((candidate) => candidate.boqSlNo.trim().toLowerCase() === wanted) ??
        scopeItems.find((candidate) => (candidate.erpSlNo ?? "").trim().toLowerCase() === wanted);
      if (!item) {
        notFound.push(key);
        continue;
      }
      next[item.id] = { ...(next[item.id] ?? EMPTY_ROW), qty: String(qty) };
      matched += 1;
    }
    setRows(next);
    toast({
      title: `${matched} matched${pasted.length === 0 ? " — no rows with a number were found" : ""}`,
      description: notFound.length
        ? `Not found in ${scope}: ${notFound.slice(0, 12).join(", ")}${notFound.length > 12 ? "…" : ""}`
        : undefined,
      variant: matched === 0 ? "destructive" : undefined,
    });
  };

  const handleSave = async () => {
    if (!canEdit) return;
    const toSave: NewProjection[] = [];
    let needAttention = 0;
    for (const item of scopeItems) {
      const row = rows[item.id];
      if (!row?.qty.trim()) continue;
      const check = checks.get(item.id);
      const qty = readQtyText(row.qty);
      if (!check || check.errors.length > 0 || qty === null || !Number.isFinite(qty)) {
        needAttention += 1;
        continue;
      }
      toSave.push({ candidate: candidateOf(item, qty), item, remarks: row.remarks });
    }
    if (toSave.length === 0) {
      toast({
        title: needAttention ? "Fix the highlighted rows first" : "Enter a quantity against at least one line",
        variant: needAttention ? "destructive" : undefined,
      });
      return;
    }
    setIsSaving(true);
    try {
      await createProjections(context, toSave);
      setRows((previous) => {
        const next = { ...previous };
        for (const { item } of toSave) delete next[item.id];
        return next;
      });
      toast({
        title: `${toSave.length} projection${toSave.length === 1 ? "" : "s"} saved`,
        description: needAttention ? `${needAttention} need attention.` : undefined,
      });
      await data.reload();
    } catch (error) {
      console.error("Failed to save the projections:", error);
      toast({
        title: "Save failed",
        description: "The projections could not be saved.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const missingQuantities = scopeItems.filter((item) => !(item.boqQty > 0)).length;

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardContent className="space-y-3 p-4">
          <SectionHeader
            title="Plan several BOQ lines for one period"
            icon={Target}
            descriptionAs="info"
            description="Pick the period once, then fill a quantity against each line. Reports spread it over working days only, in the spread you choose."
            className="mb-0"
            actions={
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={copyPrevious} disabled={!canEdit}>
                  <Copy className="mr-1.5 h-4 w-4" /> Copy previous period
                </Button>
                <Button variant="outline" size="sm" onClick={spreadBalance} disabled={!canEdit}>
                  <Sigma className="mr-1.5 h-4 w-4" /> Spread remaining balance
                </Button>
                <Button variant="outline" size="sm" onClick={() => setIsPasteOpen(true)} disabled={!canEdit}>
                  <ClipboardPaste className="mr-1.5 h-4 w-4" /> Paste from Excel
                </Button>
              </div>
            }
          />
          {/* Every control on one line at its own height; it wraps only on a narrow screen. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[6.5rem] flex-[0.8] space-y-1.5">
              <Label htmlFor="plan-scope">Scope</Label>
              <Select value={scope} onValueChange={(next) => setScope(next as DprScope)}>
                <SelectTrigger id="plan-scope" className="text-left">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DPR_SCOPES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[7.5rem] flex-[0.9] space-y-1.5">
              <Label htmlFor="plan-spread">Spread</Label>
              <Select value={distribution} onValueChange={(next) => setDistribution(next as DprDistribution)}>
                <SelectTrigger id="plan-spread" className="text-left">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DPR_DISTRIBUTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {DPR_DISTRIBUTION_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[11rem] flex-[1.3] space-y-1.5">
              {/* h-6: the height a bare Label takes in its line box, so this label lines up with the rest. */}
              <div className="flex h-6 items-center gap-1.5">
                <Label htmlFor="plan-policy">Overlap rule</Label>
                <InfoTip label="About the overlap rule">
                  What happens when a line already has a projection in these dates. Overlapping
                  projections are never added together: block the entry, or let the shorter period
                  own the shared days — a catch-up week inside a month replaces the month&apos;s
                  share of that week.
                </InfoTip>
              </div>
              <Select value={policy} onValueChange={(next) => setPolicy(next as DprOverlapPolicy)}>
                <SelectTrigger id="plan-policy" className="text-left">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="block">Block the entry</SelectItem>
                  <SelectItem value="finer">Shorter period takes those days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DprPeriodPicker value={period} onChange={setPeriod} settings={data.settings} inline />
          </div>
        </CardContent>
      </Card>

      {!canEdit ? (
        <Card className="border-amber-500/40">
          <CardContent className="p-4 text-sm text-muted-foreground">
            You can read projections but not set them. Ask for the Edit action on Daily Progress.
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-border/60">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-sm text-muted-foreground">
                {rangeOk
                  ? `${formatDisplayDate(range.startDate)} – ${formatDisplayDate(range.endDate)} · ${daysInRange(
                      range.startDate,
                      range.endDate,
                    )}d, ${workingDays} working · ${filledCount} line${filledCount === 1 ? "" : "s"} filled`
                  : "Pick a valid from and to date"}
                {blockedCount > 0 ? ` · ${blockedCount} need attention` : ""}
              </p>
              <span className="flex items-center gap-1.5">
                <InfoTip label="About sub-items">
                  A BOQ line can be split into sub-items (and those into their own) with + — once
                  split, it is planned on its sub-items, and its figures roll up. Manage the whole
                  breakdown in BOQ register.
                </InfoTip>
                <Link
                  href={dprHref(`${DPR_BASE_PATH}/boq`, data.mappingId)}
                  className="text-sm text-primary underline-offset-2 hover:underline"
                >
                  Open BOQ register
                </Link>
              </span>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Filter BOQ lines"
                placeholder="Filter BOQ lines…"
                className="pl-9"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
          </div>

          {data.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded bg-muted/50" />
              ))}
            </div>
          ) : scopeItems.length === 0 ? (
            <PmEmptyState
              icon={Target}
              title={`No ${scope} BOQ lines on this project`}
              description={`BOQ items are read as ${scope} when their Scope 2 column says so.`}
            />
          ) : displayRows.length === 0 ? (
            <PmEmptyState icon={Search} title="No BOQ line matches the filter" />
          ) : (
            // One line per BOQ line, every cell single-line, and all of it inside the table: a
            // bounded height that scrolls under a pinned header, and a narrow screen scrolls the
            // table sideways in its own box. The description is cut to one line (full text on
            // hover). A row's problems are a marker beside its box, listed in full above the table.
            <div className="space-y-2">
              <DprMessages
                errors={problemRows.flatMap((row) => row.errors)}
                warnings={problemRows.flatMap((row) => row.warnings)}
                errorTitle="Fix these before saving"
                warningTitle="Check these"
              />
              <div className="overflow-hidden rounded-lg border border-border/60">
                <TooltipProvider delayDuration={150}>
                  <Table
                    stickyHeader
                    containerClassName="max-h-[65vh]"
                    className="min-w-[1336px] table-fixed"
                  >
                    <colgroup>
                      <col className="w-[72px]" />
                      <col />
                      <col className="w-[76px]" />
                      <col className="w-[88px]" />
                      <col className="w-[72px]" />
                      <col className="w-[88px]" />
                      <col className="w-[92px]" />
                      <col className="w-[160px]" />
                      <col className="w-[150px]" />
                      <col className="w-[150px]" />
                      <col className="w-[84px]" />
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="truncate">SL No</TableHead>
                        <TableHead className="truncate">BOQ line</TableHead>
                        <TableHead className="truncate">Unit</TableHead>
                        <TableHead className="truncate text-right">BOQ qty</TableHead>
                        <TableHead className="truncate text-right">Done</TableHead>
                        <TableHead className="truncate text-right">Balance</TableHead>
                        <TableHead className="truncate text-right" title="Already planned in this period">
                          Planned
                        </TableHead>
                        <TableHead className="truncate text-right">Plan for this period</TableHead>
                        <TableHead className="truncate">Works out at</TableHead>
                        <TableHead className="truncate">Remarks</TableHead>
                        <TableHead className="text-right">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayRows.map(({ node, item }) => {
                        const blockers = addBlockers.get(node.id) ?? [];
                        const sl = node.slNo || "this line";
                        // Add a sub-item under any row; edit one that already is a sub-item.
                        const actions = (
                          <TableCell className="py-1.5">
                            {canEdit ? (
                              <div className="flex items-center justify-end gap-1">
                                {/* A disabled button takes no pointer events, so its reason sits on a wrapper. */}
                                <span
                                  className="inline-flex"
                                  title={blockers.length > 0 ? blockers.join(" ") : `Add a sub-item under ${sl}`}
                                >
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    aria-label={`Add a sub-item under ${sl}`}
                                    disabled={blockers.length > 0}
                                    onClick={() => setSubItemRequest({ mode: "add", parentId: node.id })}
                                  >
                                    <ListPlus className="h-4 w-4" />
                                  </Button>
                                </span>
                                {node.kind === "sub" ? (
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    aria-label={`Edit sub-item ${sl}`}
                                    title={`Edit sub-item ${sl}`}
                                    onClick={() => setSubItemRequest({ mode: "edit", id: node.id })}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </TableCell>
                        );

                        if (!item) {
                          // A group: read-only, its figures rolled up from the sub-items under it.
                          const done = rolledDone.get(node.id) ?? 0;
                          const leafCount = data.breakdown.leavesUnder(node.id).length;
                          return (
                            <TableRow key={node.id} className="bg-muted/40 hover:bg-muted/40">
                              <TableCell
                                className="truncate text-sm font-semibold tabular-nums"
                                title={node.slNo}
                              >
                                {node.slNo || "—"}
                              </TableCell>
                              <TableCell className="text-sm" title={nodeTitle(node)}>
                                <DprIndentedText text={node.description} depth={node.depth} strong />
                              </TableCell>
                              <TableCell className="truncate text-sm" title={node.unit}>
                                {node.unit || "—"}
                              </TableCell>
                              <TableCell className="truncate text-right text-sm tabular-nums">
                                {node.qty > 0 ? formatQtyAt(node.qty, data.decimalsFor(node.unit)) : "—"}
                              </TableCell>
                              <TableCell className="truncate text-right text-sm tabular-nums">
                                {formatQtyAt(done, 3)}
                              </TableCell>
                              <TableCell className="truncate text-right text-sm font-medium tabular-nums">
                                {node.qty > 0 ? formatQtyAt(node.qty - done, 3) : "—"}
                              </TableCell>
                              <TableCell className="truncate text-right text-sm tabular-nums">
                                {rangeOk ? formatQtyAt(rolledPlanned.get(node.id) ?? 0, 3) : "—"}
                              </TableCell>
                              <TableCell
                                colSpan={3}
                                className="truncate text-xs text-muted-foreground"
                                title="A line with sub-items is planned on them; its figures roll up from theirs."
                              >
                                Plan on its sub-items · {leafCount} below
                              </TableCell>
                              {actions}
                            </TableRow>
                          );
                        }

                        const decimals = data.decimalsFor(item.unit);
                        const executed = actuals.total(item.id);
                        const row = rowOf(item.id);
                        const check = checks.get(item.id);
                        const hasQuantity = item.boqQty > 0;
                        const worksOut = worksOutAt(
                          readQtyText(row.qty),
                          item.unit,
                          decimals,
                          rangeOk ? workingDays : 0,
                        );
                        const hasErrors = Boolean(check && check.errors.length > 0);
                        const hasWarnings = Boolean(check && check.warnings.length > 0);
                        return (
                          <TableRow key={item.id}>
                            <TableCell
                              className="truncate text-sm font-semibold tabular-nums"
                              title={item.boqSlNo}
                            >
                              {item.boqSlNo || "—"}
                            </TableCell>
                            <TableCell className="text-sm" title={breakdownTitle(item)}>
                              <DprIndentedText text={item.description} depth={item.depth ?? 0} />
                            </TableCell>
                            <TableCell className="truncate text-sm" title={item.unit}>
                              {item.unit || "—"}
                            </TableCell>
                            <TableCell className="truncate text-right text-sm tabular-nums">
                              {hasQuantity ? formatQtyAt(item.boqQty, decimals) : "—"}
                            </TableCell>
                            <TableCell className="truncate text-right text-sm tabular-nums">
                              {formatQtyAt(executed, decimals)}
                            </TableCell>
                            <TableCell className="truncate text-right text-sm font-medium tabular-nums">
                              {hasQuantity ? formatQtyAt(item.boqQty - executed, decimals) : "—"}
                            </TableCell>
                            <TableCell className="truncate text-right text-sm tabular-nums">
                              {rangeOk ? formatQtyAt(data.plan.qtyInRange(item.id, range), decimals) : "—"}
                            </TableCell>
                            <TableCell className="py-1.5">
                              <div className="flex items-center justify-end gap-1.5">
                                {hasErrors || hasWarnings ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        aria-label={`Problems with ${item.boqSlNo || "this line"}`}
                                        className={cn(
                                          "shrink-0 rounded-full",
                                          hasErrors ? "text-destructive" : "text-amber-600 dark:text-amber-400",
                                        )}
                                      >
                                        {hasErrors ? (
                                          <CircleAlert className="h-4 w-4" />
                                        ) : (
                                          <TriangleAlert className="h-4 w-4" />
                                        )}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs text-xs">
                                      {[...(check?.errors ?? []), ...(check?.warnings ?? [])].map((message) => (
                                        <p key={message}>{message}</p>
                                      ))}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : null}
                                <Input
                                  type="number"
                                  min={0}
                                  step={decimals === 0 ? 1 : "any"}
                                  inputMode="decimal"
                                  aria-label={`Plan quantity for ${item.boqSlNo || "this line"}`}
                                  aria-invalid={hasErrors ? true : undefined}
                                  disabled={!canEdit}
                                  className={cn(
                                    "h-8 w-full min-w-0 text-right tabular-nums",
                                    hasErrors && "border-destructive",
                                  )}
                                  value={row.qty}
                                  onChange={(event) => setRow(item.id, { qty: event.target.value })}
                                />
                              </div>
                            </TableCell>
                            <TableCell
                              className="truncate text-xs tabular-nums text-muted-foreground"
                              title={worksOut === "—" ? undefined : worksOut}
                            >
                              {worksOut}
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                aria-label={`Remarks for ${item.boqSlNo || "this line"}`}
                                disabled={!canEdit}
                                className="h-8 w-full min-w-0"
                                value={row.remarks}
                                onChange={(event) => setRow(item.id, { remarks: event.target.value })}
                              />
                            </TableCell>
                            {actions}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TooltipProvider>
              </div>
            </div>
          )}

          {missingQuantities > 0 && scopeItems.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {missingQuantities} {scope} line{missingQuantities === 1 ? " has" : "s have"} no BOQ quantity, so
              the balance check is off for {missingQuantities === 1 ? "it" : "them"}.
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="outline" onClick={() => setRows({})} disabled={isSaving || filledCount === 0}>
              Clear
            </Button>
            <Button onClick={() => void handleSave()} disabled={!canEdit || isSaving || filledCount === 0}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save projections
            </Button>
          </div>
        </CardContent>
      </Card>

      <PasteQuantitiesDialog open={isPasteOpen} onOpenChange={setIsPasteOpen} onApply={applyPaste} />
      {/* The BOQ register's own add / edit dialog, so a sub-item made here is the same record. */}
      <SubItemDialog
        request={subItemRequest}
        data={data}
        user={context.user}
        onClose={() => setSubItemRequest(null)}
      />
    </div>
  );
}
