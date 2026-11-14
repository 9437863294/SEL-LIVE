"use client";

/**
 * Projection list — every projection on the project, newest period first, with its spread and
 * revision history. A projection is never edited in place: Revise changes the quantity with a
 * reason and keeps the baseline (rule P7).
 *
 * Laid out after the user's mock-up (`sel-projections-colour`): four figures over what is shown,
 * the list in a card with the scope switch in its header, and a "Worth checking" grid of real
 * findings (`buildDprProjectionChecks`) under it.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  AlignJustify,
  CalendarDays,
  History,
  ListChecks,
  Pencil,
  RotateCcw,
  Target,
  Trash2,
} from "lucide-react";
import { deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import {
  DPR_TARGET_COLLECTION,
  daysInRange,
  dprNumber,
  type DprScope,
  type DprTarget,
} from "@/lib/project-management-dpr";
import {
  DPR_DISTRIBUTION_LABELS,
  DPR_PERIOD_LABELS,
  dprCalendar,
} from "@/lib/project-management-dpr-plan";
import {
  buildDprProjectionChecks,
  type DprProjectionCheckLine,
} from "@/lib/project-management-dpr-projection-checks";
import {
  DprScopeTabs,
  formatDisplayDate,
  formatQtyAt,
  formatRangeCompact,
} from "@/components/project-management/dpr/dpr-shell";
import { DprIndentedText, breakdownTitle } from "@/components/project-management/dpr/dpr-indent";
import { ScopeBadge, type ProjectionsContext } from "@/components/project-management/dpr/projections-shared";
import {
  DprFigureRow,
  DprFigureTile,
  DprReportCallout,
  DprReportCard,
  DprReportPill,
  DprReportZero,
  DprSlNoPill,
} from "@/components/project-management/dpr/reports-parts";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { InfoTip } from "@/components/shared/info-tip";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const LIST_COLOURS = ["#c4b5fd", "#7c3aed"] as const;

export function ProjectionList({
  context,
  onRevise,
  onPlan,
}: {
  context: ProjectionsContext;
  onRevise: (target: DprTarget) => void;
  /** Switches to "Plan several lines" — the empty state's next step. */
  onPlan: () => void;
}) {
  const { toast } = useToast();
  const { data, today, canEdit, canDelete, user } = context;
  const [scope, setScope] = useState<DprScope | "All">("All");
  const [deleting, setDeleting] = useState<DprTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const calendar = useMemo(() => dprCalendar(data.settings), [data.settings]);
  const unitById = useMemo(
    () => new Map(data.boqItems.map((item) => [item.id, item.unit])),
    [data.boqItems],
  );
  /** Where each projection's line sits in the work breakdown (depth, and the lines above it). */
  const itemById = useMemo(
    () => new Map(data.boqItems.map((item) => [item.id, item])),
    [data.boqItems],
  );

  const rows = useMemo(() => {
    const visible =
      scope === "All" ? data.targets : data.targets.filter((target) => target.scope === scope);
    return [...visible].sort(
      (a, b) =>
        b.startDate.localeCompare(a.startDate) ||
        a.boqSlNo.localeCompare(b.boqSlNo, undefined, { numeric: true }),
    );
  }, [data.targets, scope]);

  /** The four figures, over the projections shown. */
  const figures = useMemo(() => {
    const lines = new Set(rows.map((target) => target.boqItemId)).size;
    const periods = new Map(rows.map((target) => [`${target.startDate}|${target.endDate}`, target]));
    const revised = rows.filter((target) => (target.revisionNo ?? 0) > 0).length;
    const spreads = new Set(rows.map((target) => target.distribution ?? "even"));
    const starts = rows.map((target) => target.startDate).sort();
    const ends = rows.map((target) => target.endDate).sort();
    const only = periods.size === 1 ? [...periods.values()][0] : null;
    return {
      lines,
      revised,
      period: only
        ? {
            value: formatRangeCompact(only.startDate, only.endDate),
            detail: `${DPR_PERIOD_LABELS[only.periodType] ?? "Custom"} · ${daysInRange(only.startDate, only.endDate)} days`,
          }
        : rows.length > 0
          ? {
              value: `${periods.size} periods`,
              detail: formatRangeCompact(starts[0], ends[ends.length - 1]),
            }
          : { value: "—", detail: "No projections" },
      spread:
        spreads.size === 1
          ? { value: DPR_DISTRIBUTION_LABELS[[...spreads][0]] ?? "Even", detail: "across the period" }
          : spreads.size > 1
            ? {
                value: "Mixed",
                detail: [...spreads].map((spread) => DPR_DISTRIBUTION_LABELS[spread] ?? spread).join(" · "),
              }
            : { value: "—", detail: "No projections" },
    };
  }, [rows]);

  const checks = useMemo(() => {
    const items = new Map<string, DprProjectionCheckLine>(
      data.boqItems.map((item) => [
        item.id,
        { boqSlNo: item.boqSlNo, unit: item.unit, boqQty: item.boqQty, scope: item.scope },
      ]),
    );
    return buildDprProjectionChecks(rows, {
      items,
      scope,
      decimalsFor: data.decimalsFor,
      workingDays: (target) => calendar.workingDays(target.startDate, target.endDate).length,
    });
  }, [rows, scope, data.boqItems, data.decimalsFor, calendar]);

  const handleDelete = async () => {
    const target = deleting;
    if (!target || !data.globalProjectId || !user) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, "projects", data.globalProjectId, DPR_TARGET_COLLECTION, target.id));
      void logUserActivity({
        userId: user.id ?? "",
        userName: user.name ?? "",
        userEmail: user.email ?? "",
        module: "Project Management",
        action: "Delete DPR Projection",
        details: {
          project: data.projectName,
          scope: target.scope,
          boqSlNo: target.boqSlNo,
          startDate: target.startDate,
          endDate: target.endDate,
          plannedQty: dprNumber(target.plannedQty),
        },
      });
      toast({ title: "Projection removed" });
      setDeleting(null);
      await data.reload();
    } catch (error) {
      console.error("Failed to delete the projection:", error);
      toast({
        title: "Delete failed",
        description: "The projection could not be removed.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {!data.isLoading ? (
        <DprFigureRow>
          <DprFigureTile
            icon={ListChecks}
            colours={LIST_COLOURS}
            label="Projections"
            value={String(rows.length)}
            detail={`${figures.lines} BOQ line${figures.lines === 1 ? "" : "s"} planned`}
          />
          <DprFigureTile
            icon={CalendarDays}
            colours={["#93c5fd", "#2563eb"]}
            label="Period"
            value={figures.period.value}
            valueClassName="text-xl"
            detail={figures.period.detail}
          />
          <DprFigureTile
            icon={RotateCcw}
            colours={["#fcd34d", "#d97706"]}
            label="Revised"
            value={String(figures.revised)}
            detail={`${rows.length - figures.revised} still on baseline`}
          />
          <DprFigureTile
            icon={AlignJustify}
            colours={["#6ee7b7", "#059669"]}
            label="Spread"
            value={figures.spread.value}
            valueClassName="text-xl"
            detail={figures.spread.detail}
          />
        </DprFigureRow>
      ) : null}

      <DprReportCard
        icon={ListChecks}
        colours={LIST_COLOURS}
        title="Projection list"
        subtitle="Every projection made for a BOQ line, with its revision"
        aside={
          <>
            <InfoTip label="About the projection list">
              Quantity, unit and spread stay visible however long the BOQ description is. Average per
              day counts working days only. A revision changes the quantity with a reason; the
              baseline is kept.
            </InfoTip>
            <DprScopeTabs value={scope} onChange={setScope} includeAll asField />
          </>
        }
      >
        {data.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded bg-muted/50" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div>
            <DprReportZero
              icon={Target}
              colours={LIST_COLOURS}
              glow={["rgba(196, 181, 253, 0.6)", "rgba(147, 197, 253, 0.5)"]}
              title={`No ${scope === "All" ? "" : `${scope} `}projections yet`}
              text="Plan what each BOQ line should achieve over a day, a week, a month or any range."
            />
            {canEdit ? (
              <div className="flex justify-center pb-8">
                <Button onClick={onPlan}>
                  <Target className="mr-2 h-4 w-4" /> Plan several lines
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <TooltipProvider delayDuration={150}>
            {/* One line per projection, all of it inside the table: fixed columns, a bounded
                height under a pinned header, and a narrow screen scrolls it sideways. */}
            <Table stickyHeader containerClassName="max-h-[65vh]" className="min-w-[1290px] table-fixed">
              <colgroup>
                <col className="w-[210px]" />
                <col className="w-[64px]" />
                <col className="w-[84px]" />
                <col className="w-[84px]" />
                <col />
                <col className="w-[80px]" />
                <col className="w-[84px]" />
                <col className="w-[88px]" />
                <col className="w-[92px]" />
                <col className="w-[116px]" />
                <col className="w-[96px]" />
                <col className="w-[120px]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="truncate">Period</TableHead>
                  <TableHead className="truncate text-right" title="Working days in the period">
                    Days
                  </TableHead>
                  <TableHead className="truncate">Scope</TableHead>
                  <TableHead className="truncate">SL No</TableHead>
                  <TableHead className="truncate">BOQ line</TableHead>
                  <TableHead className="truncate">Unit</TableHead>
                  <TableHead className="truncate text-right" title="Quantity">
                    Qty
                  </TableHead>
                  <TableHead className="truncate text-right" title="The quantity as first saved">
                    Baseline
                  </TableHead>
                  <TableHead className="truncate text-right" title="Average per working day">
                    Per day
                  </TableHead>
                  <TableHead className="truncate">Spread</TableHead>
                  <TableHead className="truncate">Revision</TableHead>
                  <TableHead className="truncate text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((target) => {
                  const unit = unitById.get(target.boqItemId) || target.unit;
                  const decimals = data.decimalsFor(unit);
                  const qty = dprNumber(target.plannedQty);
                  const working = calendar.workingDays(target.startDate, target.endDate).length;
                  const revisionNo = target.revisionNo ?? 0;
                  const ended = target.endDate < today;
                  const range = formatRangeCompact(target.startDate, target.endDate);
                  const spread = DPR_DISTRIBUTION_LABELS[target.distribution ?? "even"] ?? "Even";
                  const periodLabel = DPR_PERIOD_LABELS[target.periodType] ?? "Custom";
                  const slNo = itemById.get(target.boqItemId)?.boqSlNo || target.boqSlNo;
                  return (
                    <TableRow key={target.id}>
                      <TableCell className="truncate text-sm tabular-nums" title={`${periodLabel} · ${range}`}>
                        <span className="font-bold">{periodLabel}</span>
                        <span className="text-muted-foreground"> · {range}</span>
                      </TableCell>
                      <TableCell
                        className="truncate text-right text-sm tabular-nums"
                        title={`${working} working day${working === 1 ? "" : "s"}`}
                      >
                        {working}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <ScopeBadge scope={target.scope} />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <DprSlNoPill slNo={slNo} seed={target.boqItemId} />
                      </TableCell>
                      <TableCell
                        className="text-sm"
                        title={breakdownTitle({
                          description: target.description,
                          path: itemById.get(target.boqItemId)?.path,
                        })}
                      >
                        <DprIndentedText
                          text={target.description}
                          depth={itemById.get(target.boqItemId)?.depth ?? 0}
                        />
                      </TableCell>
                      <TableCell className="truncate text-sm" title={unit}>
                        {unit || "—"}
                      </TableCell>
                      <TableCell className="truncate text-right text-sm font-extrabold tabular-nums">
                        {formatQtyAt(qty, decimals)}
                      </TableCell>
                      <TableCell className="truncate text-right text-sm tabular-nums text-muted-foreground">
                        {revisionNo > 0 ? (
                          <s title="The quantity as first saved">
                            {formatQtyAt(dprNumber(target.baselineQty ?? qty), decimals)}
                          </s>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="truncate text-right text-sm tabular-nums">
                        {working > 0 ? (
                          <span className="rounded-lg bg-cyan-50 px-2 py-0.5 font-extrabold text-cyan-800">
                            {formatQtyAt(qty / working, 3)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="truncate text-sm" title={spread}>
                        {spread}
                      </TableCell>
                      <TableCell className="py-1.5">
                        {revisionNo > 0 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={`Revision history for ${slNo || "this projection"}`}
                              >
                                <DprReportPill tone="warning">
                                  <History className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />
                                  R{revisionNo}
                                </DprReportPill>
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs space-y-1 text-xs">
                              {(target.revisions ?? []).length === 0 ? (
                                <span>Revised {revisionNo} time{revisionNo === 1 ? "" : "s"}.</span>
                              ) : (
                                (target.revisions ?? []).map((entry) => (
                                  <span key={entry.revisionNo} className="block">
                                    <span className="font-medium">R{entry.revisionNo}</span>:{" "}
                                    {formatQtyAt(dprNumber(entry.fromQty), decimals)} →{" "}
                                    {formatQtyAt(dprNumber(entry.toQty), decimals)} · {entry.reason}
                                    {entry.changedByName ? ` · ${entry.changedByName}` : ""}
                                    {entry.changedAt
                                      ? ` · ${formatDisplayDate(String(entry.changedAt).slice(0, 10))}`
                                      : ""}
                                  </span>
                                ))
                              )}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <DprReportPill tone="neutral">Baseline</DprReportPill>
                        )}
                      </TableCell>
                      <TableCell className="py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-[10px] px-2.5 text-xs font-bold"
                            disabled={!canEdit || ended}
                            title={
                              ended
                                ? "This period has ended. Past periods are locked."
                                : !canEdit
                                  ? "Needs the Edit action on Daily Progress."
                                  : undefined
                            }
                            onClick={() => onRevise(target)}
                          >
                            {revisionNo > 0 ? (
                              <History className="mr-1 h-3.5 w-3.5" />
                            ) : (
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                            )}
                            Revise
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8 rounded-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label="Delete projection"
                            title="Delete projection"
                            disabled={!canDelete}
                            onClick={() => setDeleting(target)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TooltipProvider>
        )}
      </DprReportCard>

      {!data.isLoading && rows.length > 0 ? (
        <DprReportCard
          icon={AlertTriangle}
          colours={["#fda4af", "#e11d48"]}
          title="Worth checking"
          subtitle="From the figures on this page"
        >
          <div className="grid grid-cols-1 gap-3 p-4 sm:p-5 md:grid-cols-3">
            {checks.length === 0 ? (
              <DprReportCallout tone="success" title="Nothing stands out">
                Every projection is within its BOQ quantity and on its first figure.
              </DprReportCallout>
            ) : (
              checks.map((check) => (
                <DprReportCallout key={check.key} tone={check.tone} title={check.title} mark={check.mark}>
                  {check.detail}
                </DprReportCallout>
              ))
            )}
          </div>
        </DprReportCard>
      ) : null}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => (!open ? setDeleting(null) : undefined)}
        destructive
        loading={isDeleting}
        title="Delete this projection?"
        description={
          deleting
            ? `${deleting.boqSlNo || "BOQ line"} · ${formatDisplayDate(deleting.startDate)} – ${formatDisplayDate(
                deleting.endDate,
              )}. Its planned quantity leaves every report, including past periods.`
            : undefined
        }
        confirmLabel="Delete projection"
        onConfirm={handleDelete}
      />
    </div>
  );
}
