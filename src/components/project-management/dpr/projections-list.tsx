"use client";

/**
 * Projection records — every projection on the project, read as records: the BOQ lines planned
 * for one scope over the same dates make one record (`buildDprProjectionRecords`). Newest period
 * first, one row per record, with the BOQ lines given in it at a glance. Open shows a record's
 * lines; Edit changes quantities (a revision with a reason, the baseline kept — rule P7), adds
 * lines or takes lines off. Ended records are locked.
 *
 * Laid out after the user's mock-up (`sel-projections-colour`): four figures over what is shown,
 * the records in a card with the scope switch in its header, and a "Worth checking" grid of real
 * findings (`buildDprProjectionChecks`, over the lines of the records shown) under it.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Eye,
  IndianRupee,
  ListChecks,
  Pencil,
  RotateCcw,
  Target,
  Trash2,
} from "lucide-react";
import {
  buildDprRateLookup,
  dprPlannedValue,
  dprUnpricedText,
  formatDprValue,
  formatDprValueCompact,
} from "@/lib/project-management-dpr-values";
import { daysInRange, type DprScope } from "@/lib/project-management-dpr";
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
  buildDprProjectionRecords,
  type DprProjectionRecord,
  type DprRecordStatus,
} from "@/lib/project-management-dpr-records";
import {
  DprScopeTabs,
  formatDisplayDate,
  formatRangeCompact,
} from "@/components/project-management/dpr/dpr-shell";
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

const LIST_COLOURS = ["#c4b5fd", "#7c3aed"] as const;

/** How many SL Nos the BOQ lines column shows before "+N". */
const PREVIEW_COUNT = 3;

const ACTION_BUTTON = "h-8 rounded-[10px] px-2.5 text-xs font-bold";

/** Upcoming has no tone of its own among the report pills, so it is drawn here in the same shape. */
function StatusPill({ status }: { status: DprRecordStatus }) {
  if (status === "running") return <DprReportPill tone="success">Running</DprReportPill>;
  if (status === "ended") return <DprReportPill tone="neutral">Ended · locked</DprReportPill>;
  return (
    <span className="whitespace-nowrap rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-extrabold text-blue-700">
      Upcoming
    </span>
  );
}

const periodLabelOf = (record: DprProjectionRecord): string =>
  DPR_PERIOD_LABELS[record.periodType] ?? "Custom";

export function ProjectionList({
  context,
  onOpen,
  onPlan,
  onDeleteRecord,
}: {
  context: ProjectionsContext;
  /** Opens a record's screen — to read it, or straight into editing. */
  onOpen: (record: DprProjectionRecord, mode: "view" | "edit") => void;
  /** Opens Plan several lines with its line picker — the empty state's next step. */
  onPlan: () => void;
  /** Deletes every projection in the record; resolves true when it was deleted. The page owns the write, toast and reload. */
  onDeleteRecord: (record: DprProjectionRecord) => Promise<boolean>;
}) {
  const { data, today, canEdit, canDelete } = context;
  const [scope, setScope] = useState<DprScope | "All">("All");
  const [deleting, setDeleting] = useState<DprProjectionRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const calendar = useMemo(() => dprCalendar(data.settings), [data.settings]);
  /** The current SL No of each line (a sub-item renumbered since keeps its record row current). */
  const slNoById = useMemo(
    () => new Map(data.boqItems.map((item) => [item.id, item.boqSlNo])),
    [data.boqItems],
  );

  const records = useMemo(() => {
    const all = buildDprProjectionRecords(data.targets, today);
    return scope === "All" ? all : all.filter((record) => record.scope === scope);
  }, [data.targets, today, scope]);

  /** Every projection line in the records shown — what the figures and the checks read. */
  const rows = useMemo(() => records.flatMap((record) => record.targets), [records]);

  /** Planned quantity × the BOQ line's rate; lines with no rate are counted, never priced. */
  const rates = useMemo(() => buildDprRateLookup(data.boqItems), [data.boqItems]);
  const valueOf = useMemo(() => {
    const byKey = new Map(records.map((record) => [record.key, dprPlannedValue(record.targets, rates)]));
    return (record: DprProjectionRecord) => byKey.get(record.key) ?? dprPlannedValue(record.targets, rates);
  }, [records, rates]);
  const shownValue = useMemo(() => dprPlannedValue(rows, rates), [rows, rates]);

  /** The four figures, over the records shown. */
  const figures = useMemo(() => {
    const lines = new Set(rows.map((target) => target.boqItemId)).size;
    const periods = new Map(rows.map((target) => [`${target.startDate}|${target.endDate}`, target]));
    const revised = rows.filter((target) => (target.revisionNo ?? 0) > 0).length;
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
    const record = deleting;
    if (!record) return;
    setIsDeleting(true);
    try {
      if (await onDeleteRecord(record)) setDeleting(null);
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
            label="Records"
            value={String(records.length)}
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
            icon={IndianRupee}
            colours={["#6ee7b7", "#059669"]}
            label="Planned value"
            value={
              rows.length > 0 ? (
                <span title={`${formatDprValue(shownValue.value)} planned`}>
                  {formatDprValueCompact(shownValue.value)}
                </span>
              ) : (
                "—"
              )
            }
            valueClassName="text-xl"
            detail={
              rows.length === 0
                ? "No projections"
                : dprUnpricedText(shownValue.unpriced) || "planned quantity × BOQ rate"
            }
          />
        </DprFigureRow>
      ) : null}

      <DprReportCard
        icon={ListChecks}
        colours={LIST_COLOURS}
        title="Projection records"
        subtitle="Each period's projections for a scope, with the BOQ lines given in it"
        aside={
          <>
            <InfoTip label="About projection records">
              A record is every BOQ line planned for one scope over the same dates. Open it to see
              its lines. Edit it to change a quantity (a revision with a reason; the baseline is
              kept), add lines or take lines off. Records whose period has ended are locked. Planned
              value is each line&apos;s planned quantity × its BOQ rate; a line with no rate is left out
              and marked *.
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
        ) : records.length === 0 ? (
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
                  <Target className="mr-2 h-4 w-4" /> Add projection
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          // One line per record, all of it inside the table: short values, so the columns size to
          // their content; a bounded height under a pinned header, and a narrow screen scrolls it
          // sideways.
          <Table stickyHeader containerClassName="max-h-[65vh]" className="min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">SL No</TableHead>
                <TableHead className="whitespace-nowrap">Period</TableHead>
                <TableHead className="whitespace-nowrap">Scope</TableHead>
                <TableHead className="whitespace-nowrap text-right" title="Working days in the period">
                  Days
                </TableHead>
                <TableHead className="whitespace-nowrap">BOQ lines</TableHead>
                <TableHead
                  className="whitespace-nowrap text-right"
                  title="Planned quantity × BOQ rate, over the record's lines"
                >
                  Planned value
                </TableHead>
                <TableHead className="whitespace-nowrap">Revised</TableHead>
                <TableHead className="whitespace-nowrap">Spread</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
                <TableHead className="whitespace-nowrap">Made by</TableHead>
                <TableHead className="whitespace-nowrap text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record, index) => {
                const range = formatRangeCompact(record.startDate, record.endDate);
                const periodLabel = periodLabelOf(record);
                const working = calendar.workingDays(record.startDate, record.endDate).length;
                const count = record.targets.length;
                const slNos = record.targets.map((target) => slNoById.get(target.boqItemId) || target.boqSlNo || "—");
                const preview = `${slNos.slice(0, PREVIEW_COUNT).join(" · ")}${
                  count > PREVIEW_COUNT ? ` +${count - PREVIEW_COUNT}` : ""
                }`;
                const fullList = record.targets
                  .map((target, lineIndex) => `${slNos[lineIndex]} ${target.description ?? ""}`.trim())
                  .join("\n");
                const spread =
                  record.distribution === "mixed"
                    ? "Mixed"
                    : (DPR_DISTRIBUTION_LABELS[record.distribution] ?? "Even");
                const ended = record.status === "ended";
                const editTitle = ended
                  ? "This period has ended. Past periods are locked."
                  : !canEdit
                    ? "Needs the Edit action on Daily Progress."
                    : `Edit the ${record.scope} record for ${range}`;
                const deleteTitle = canDelete
                  ? `Delete the ${record.scope} record for ${range}`
                  : "Needs the Delete action on Daily Progress.";
                const value = valueOf(record);
                const unpriced = dprUnpricedText(value.unpriced);
                const madeBy =
                  record.madeBy.length === 0
                    ? "—"
                    : `${record.madeBy[0]}${record.madeBy.length > 1 ? ` +${record.madeBy.length - 1}` : ""}`;
                return (
                  <TableRow
                    key={record.key}
                    className="cursor-pointer"
                    onClick={() => onOpen(record, "view")}
                  >
                    <TableCell className="whitespace-nowrap py-1.5">
                      <DprSlNoPill slNo={String(index + 1)} seed={record.key} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums" title={`${periodLabel} · ${range}`}>
                      <span className="font-bold">{periodLabel}</span>
                      <span className="text-muted-foreground"> · {range}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-1.5">
                      <ScopeBadge scope={record.scope} />
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap text-right text-sm tabular-nums"
                      title={`${working} working day${working === 1 ? "" : "s"}`}
                    >
                      {working}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm" title={fullList}>
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="shrink-0 font-extrabold tabular-nums">
                          {count} line{count === 1 ? "" : "s"}
                        </span>
                        <span className="block max-w-[220px] truncate text-xs tabular-nums text-muted-foreground">
                          {preview}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap text-right text-sm font-bold tabular-nums"
                      title={unpriced ? `${unpriced} — left out of the value` : undefined}
                    >
                      {value.priced > 0 ? formatDprValue(value.value) : "—"}
                      {unpriced ? (
                        <>
                          <span className="ml-1 text-xs font-semibold text-muted-foreground" aria-hidden="true">
                            *
                          </span>
                          <span className="sr-only"> ({unpriced})</span>
                        </>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-1.5">
                      {record.revisedCount > 0 ? (
                        <DprReportPill tone="warning">
                          {record.revisedCount} of {count}
                        </DprReportPill>
                      ) : (
                        <DprReportPill tone="neutral">Baseline</DprReportPill>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{spread}</TableCell>
                    <TableCell className="whitespace-nowrap py-1.5">
                      <StatusPill status={record.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm" title={record.madeBy.join(", ") || undefined}>
                      <span className="block max-w-[160px] truncate">{madeBy}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className={ACTION_BUTTON}
                          aria-label={`Open the ${record.scope} record for ${range}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(record, "view");
                          }}
                        >
                          <Eye className="mr-1 h-3.5 w-3.5" />
                          Open
                        </Button>
                        {/* A disabled button takes no pointer events, so its reason sits on a wrapper. */}
                        <span className="inline-flex" title={editTitle}>
                          <Button
                            size="sm"
                            variant="outline"
                            className={ACTION_BUTTON}
                            aria-label={`Edit the ${record.scope} record for ${range}`}
                            disabled={!canEdit || ended}
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpen(record, "edit");
                            }}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        </span>
                        <span className="inline-flex" title={deleteTitle}>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8 rounded-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Delete the ${record.scope} record for ${range}`}
                            disabled={!canDelete}
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleting(record);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
        title="Delete this projection record?"
        description={
          deleting
            ? `${deleting.scope} · ${periodLabelOf(deleting)} ${formatDisplayDate(deleting.startDate)} – ${formatDisplayDate(
                deleting.endDate,
              )} · ${deleting.targets.length} BOQ line${deleting.targets.length === 1 ? "" : "s"}. Their planned quantities leave every report, including past periods.`
            : undefined
        }
        confirmLabel="Delete record"
        onConfirm={handleDelete}
      />
    </div>
  );
}
