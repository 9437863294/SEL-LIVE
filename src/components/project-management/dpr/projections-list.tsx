"use client";

/**
 * Projection list — every projection on the project, newest period first, with its spread and
 * revision history. A projection is never edited in place: Revise changes the quantity with a
 * reason and keeps the baseline (rule P7).
 */

import { useMemo, useState } from "react";
import { History, Pencil, Target, Trash2 } from "lucide-react";
import { deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import {
  DPR_TARGET_COLLECTION,
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
  DprScopeTabs,
  formatDisplayDate,
  formatQtyAt,
  formatRangeCompact,
} from "@/components/project-management/dpr/dpr-shell";
import { ScopeBadge, type ProjectionsContext } from "@/components/project-management/dpr/projections-shared";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SectionHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

  const rows = useMemo(() => {
    const visible =
      scope === "All" ? data.targets : data.targets.filter((target) => target.scope === scope);
    return [...visible].sort(
      (a, b) =>
        b.startDate.localeCompare(a.startDate) ||
        a.boqSlNo.localeCompare(b.boqSlNo, undefined, { numeric: true }),
    );
  }, [data.targets, scope]);

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
    <Card className="border-border/60">
      <CardContent className="space-y-4 p-4">
        <SectionHeader
          title="Projection list"
          icon={Target}
          descriptionAs="info"
          description="Quantity, unit and spread stay visible however long the BOQ description is. Average per day counts working days only. A revision changes the quantity with a reason; the baseline is kept."
          className="mb-0"
          actions={<DprScopeTabs value={scope} onChange={setScope} includeAll />}
        />

        {data.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded bg-muted/50" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <PmEmptyState
            icon={Target}
            title={`No ${scope === "All" ? "" : `${scope} `}projections yet`}
            description="Plan what each BOQ line should achieve over a day, a week, a month or any range."
            action={
              canEdit ? (
                <Button onClick={onPlan}>
                  <Target className="mr-2 h-4 w-4" /> Plan several lines
                </Button>
              ) : undefined
            }
          />
        ) : (
          <TooltipProvider delayDuration={150}>
            {/* One line per projection, all of it inside the table: fixed columns, a bounded
                height under a pinned header, and a narrow screen scrolls it sideways. */}
            <div className="overflow-hidden rounded-lg border border-border/60">
              <Table
                stickyHeader
                containerClassName="max-h-[65vh]"
                className="min-w-[1282px] table-fixed"
              >
                <colgroup>
                  <col className="w-[210px]" />
                  <col className="w-[64px]" />
                  <col className="w-[76px]" />
                  <col className="w-[72px]" />
                  <col />
                  <col className="w-[80px]" />
                  <col className="w-[80px]" />
                  <col className="w-[84px]" />
                  <col className="w-[80px]" />
                  <col className="w-[126px]" />
                  <col className="w-[96px]" />
                  <col className="w-[108px]" />
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
                    return (
                      <TableRow key={target.id}>
                        <TableCell
                          className="truncate text-sm tabular-nums"
                          title={`${DPR_PERIOD_LABELS[target.periodType] ?? "Custom"} · ${range}`}
                        >
                          <span className="font-medium">{DPR_PERIOD_LABELS[target.periodType] ?? "Custom"}</span>
                          <span className="text-muted-foreground"> · </span>
                          {range}
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
                        <TableCell
                          className="truncate text-sm font-semibold tabular-nums"
                          title={target.boqSlNo}
                        >
                          {target.boqSlNo || "—"}
                        </TableCell>
                        <TableCell className="truncate text-sm" title={target.description}>
                          {target.description || "BOQ line"}
                        </TableCell>
                        <TableCell className="truncate text-sm" title={unit}>
                          {unit || "—"}
                        </TableCell>
                        <TableCell className="truncate text-right text-sm font-semibold tabular-nums">
                          {formatQtyAt(qty, decimals)}
                        </TableCell>
                        <TableCell className="truncate text-right text-sm tabular-nums text-muted-foreground">
                          {revisionNo > 0
                            ? formatQtyAt(dprNumber(target.baselineQty ?? qty), decimals)
                            : "—"}
                        </TableCell>
                        <TableCell className="truncate text-right text-sm tabular-nums text-muted-foreground">
                          {working > 0 ? formatQtyAt(qty / working, 3) : "—"}
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
                                  aria-label={`Revision history for ${target.boqSlNo || "this projection"}`}
                                >
                                  <StatusBadge status="Revised" tone="warning">
                                    R{revisionNo}
                                  </StatusBadge>
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
                            <StatusBadge status="Baseline" tone="neutral" />
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs"
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
                              variant="ghost"
                              className="h-8 w-8"
                              aria-label="Delete projection"
                              disabled={!canDelete}
                              onClick={() => setDeleting(target)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
        )}
      </CardContent>

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
    </Card>
  );
}
