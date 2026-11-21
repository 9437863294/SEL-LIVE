"use client";

/**
 * One progress record — a Daily Progress sheet, read: the BOQ lines recorded on it, its manpower and
 * plant, and the site diary.
 *
 * The user asked (2026-11-21) to see, for every record on Record progress, the BOQ lines given in
 * it, and to change the record: edit its lines, add new ones and take lines off. A record is a
 * sheet (`dprEntries`, one per scope per day), and the sheet editor already holds every rule about
 * changing one, so this screen only reads: Edit hands the sheet to the page (`onEdit`), which opens
 * the editor — after reopening a submitted sheet, which only a DPR approver may do.
 *
 * Planned on each line is the plan snapshot written when the sheet was saved, not the plan as it
 * stands now (a projection may have been revised since), so "vs plan" says what the sheet said.
 *
 * Props only: the page does the writes (`onEdit`, `onDelete`), so the screen can be rendered with
 * made-up data.
 */

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  History,
  IndianRupee,
  ListChecks,
  Lock,
  NotebookPen,
  Pencil,
  Trash2,
  Truck,
  Unlock,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { daysInRange, dprNumber, type DprEntry } from "@/lib/project-management-dpr";
import { dprLogSheetStats } from "@/lib/project-management-dpr-log";
import {
  dprProgressRecordState,
  dprRecordDeleteAction,
  dprRecordEditAction,
  dprRecordLineFigures,
  type DprProgressRecordState,
  type DprRecordAccess,
} from "@/lib/project-management-dpr-progress-records";
import {
  buildDprRateLookup,
  dprRateOf,
  dprSheetValue,
  dprUnpricedText,
  dprValuePct,
  formatDprRate,
  formatDprValue,
  formatDprValueCompact,
} from "@/lib/project-management-dpr-values";
import type { DprDataState } from "@/components/project-management/dpr/use-dpr-data";
import { dprScopeTone, formatDisplayDate, formatQty, formatQtyAt, todayIso } from "@/components/project-management/dpr/dpr-shell";
import { DprIndentedText, breakdownTitle } from "@/components/project-management/dpr/dpr-indent";
import {
  DprFigureRow,
  DprFigureTile,
  DprReportCard,
  DprReportZero,
  DprSlNoPill,
  type DprGradient,
} from "@/components/project-management/dpr/reports-parts";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { InfoTip } from "@/components/shared/info-tip";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const RECORD_COLOURS: DprGradient = ["#c4b5fd", "#7c3aed"];

const NO_RATE = "This BOQ line has no rate, so it has no value.";
const MANPOWER_COLOURS: DprGradient = ["#93c5fd", "#2563eb"];
const PLANT_COLOURS: DprGradient = ["#fcd34d", "#d97706"];
const DIARY_COLOURS: DprGradient = ["#7dd3fc", "#0284c7"];

/** A white-text gradient button, as the planner draws its actions. */
const GRADIENT_BUTTON =
  "keep-light h-9 rounded-[11px] border-0 px-3.5 text-[12.5px] font-extrabold text-white hover:brightness-105 disabled:opacity-50";
const gradient = (from: string, to: string) => ({
  backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
  boxShadow: `0 8px 16px -10px ${to}`,
});

const STATE_TEXT: Record<DprProgressRecordState, string> = {
  draft: "Draft",
  reopened: "Reopened",
  submitted: "Submitted · locked",
};
const STATE_PILL: Record<DprProgressRecordState, string> = {
  draft: "border-amber-200 bg-amber-50 text-amber-800",
  reopened: "border-amber-200 bg-amber-50 text-amber-800",
  submitted: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "Sat 21 Nov 2026", as the records list writes it — the day of the week matters on a site sheet. */
const longDate = (isoDate: string): string => {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate || "—";
  return `${date.toLocaleDateString("en-IN", { weekday: "short" })} ${formatDisplayDate(isoDate)}`;
};


/** "today", "yesterday", "5 days ago" — or "" for a date not yet reached or unreadable. */
const agoText = (isoDate: string, today: string): string => {
  if (!isoDate || isoDate > today) return "";
  const days = daysInRange(isoDate, today) - 1;
  if (!Number.isFinite(days) || days < 0) return "";
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

export interface ProgressRecordViewProps {
  /** The register as `useDprData` gives it; only these parts are read. */
  data: Pick<DprDataState, "boqItems" | "decimalsFor" | "isLoading">;
  /** Null when the address names a sheet that is no longer there (or not read yet). */
  entry: DprEntry | null;
  access: DprRecordAccess;
  onBack: () => void;
  /** The back button's text: the list it returns to. */
  backLabel?: string;
  /** Edit pressed; the page handles reopening a submitted sheet first (it confirms). */
  onEdit: (entry: DprEntry) => void;
  /** Resolve true once deleted (the page then returns to the list). */
  onDelete: (entry: DprEntry) => Promise<boolean>;
  /** Defaults to the real today; fixed for a test. */
  today?: string;
}

export function ProgressRecordView({
  data,
  entry,
  access,
  onBack,
  backLabel = "All progress records",
  onEdit,
  onDelete,
  today,
}: ProgressRecordViewProps) {
  if (!entry && data.isLoading) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} label={backLabel} />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-12 animate-pulse rounded bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} label={backLabel} />
        <DprReportCard icon={ListChecks} colours={RECORD_COLOURS} title="Progress record">
          <DprReportZero
            icon={ListChecks}
            colours={RECORD_COLOURS}
            glow={["rgba(196, 181, 253, 0.6)", "rgba(147, 197, 253, 0.5)"]}
            title="This record is no longer there"
            text="The sheet was deleted, or the link is out of date. Pick a record from the list."
          />
        </DprReportCard>
      </div>
    );
  }
  return (
    <RecordBody
      data={data}
      entry={entry}
      access={access}
      onBack={onBack}
      backLabel={backLabel}
      onEdit={onEdit}
      onDelete={onDelete}
      today={today ?? todayIso()}
    />
  );
}

function BackButton({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" className="h-8 rounded-[10px] px-2.5 font-bold" onClick={onBack}>
      <ArrowLeft className="mr-1.5 h-4 w-4" /> {label}
    </Button>
  );
}

/**
 * "Reopen this sheet to edit it?" — asked before a submitted sheet is opened for editing, because
 * reopening makes it a draft, and a draft stays out of the progress figures until resubmitted.
 * `onConfirm` throws to keep the dialog open (the failure is reported by the caller).
 */
export function ReopenSheetDialog({
  entry,
  onClose,
  onConfirm,
}: {
  entry: DprEntry | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Reopen this sheet to edit it?"
      description={
        entry
          ? `The ${entry.scope} sheet of ${longDate(entry.date)} becomes a draft. A draft does not count in progress, so it stays out of the figures until it is submitted again.`
          : undefined
      }
      confirmLabel="Reopen and edit"
      onConfirm={onConfirm}
    />
  );
}

function RecordBody({
  data,
  entry,
  access,
  onBack,
  backLabel,
  onEdit,
  onDelete,
  today,
}: Omit<ProgressRecordViewProps, "entry" | "today" | "backLabel"> & {
  entry: DprEntry;
  today: string;
  backLabel: string;
}) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const itemById = useMemo(() => new Map(data.boqItems.map((item) => [item.id, item])), [data.boqItems]);
  /** Quantity × the BOQ line's current rate; a line with no rate is counted, never priced. */
  const rates = useMemo(() => buildDprRateLookup(data.boqItems), [data.boqItems]);
  const value = useMemo(() => dprSheetValue(entry.lines, rates), [entry.lines, rates]);
  const valuePct = dprValuePct(value.actual, value.planned);
  const stats = dprLogSheetStats(entry);
  const state = dprProgressRecordState(entry);
  const locked = state === "submitted";
  const editAction = dprRecordEditAction(entry, access);
  const deleteAction = dprRecordDeleteAction(entry, access);

  const lines = (entry.lines ?? []).filter(Boolean);
  const manpower = (entry.manpower ?? []).filter(Boolean);
  const equipment = (entry.equipment ?? []).filter(Boolean);
  const trades = new Set(manpower.map((row) => (row.trade ?? "").trim().toLowerCase()).filter(Boolean)).size;

  const preparedBy = entry.preparedByName || entry.createdByName || "";
  const stateBy =
    state === "submitted"
      ? entry.submittedByName || entry.updatedByName || ""
      : state === "reopened"
        ? entry.reopenedByName || ""
        : preparedBy;
  const stateDetail = stateBy
    ? `${state === "submitted" ? "Submitted" : state === "reopened" ? "Reopened" : "Prepared"} by ${stateBy}`
    : state === "submitted"
      ? "Submitted"
      : "Not submitted yet";
  const ago = agoText(entry.date, today);
  const lostHours = dprNumber(entry.lostTimeHours);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      if (await onDelete(entry)) setIsConfirmingDelete(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Back to the list, and which record this is. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <BackButton onBack={onBack} label={backLabel} />
        <span className="flex min-w-0 items-center gap-2">
          <StatusBadge status={entry.scope} tone={dprScopeTone(entry.scope)} />
          <span className="truncate text-sm font-extrabold tabular-nums">
            {longDate(entry.date)}
            {ago ? <span className="ml-1.5 text-xs font-semibold text-muted-foreground">{ago}</span> : null}
          </span>
          <span
            className={cn("whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold", STATE_PILL[state])}
          >
            {locked ? <Lock className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" /> : null}
            {STATE_TEXT[state]}
          </span>
        </span>
      </div>

      <DprFigureRow>
        <DprFigureTile
          icon={IndianRupee}
          colours={["#6ee7b7", "#059669"]}
          label="Value done"
          value={
            value.priced > 0 ? (
              <span title={`${formatDprValue(value.actual)} done of ${formatDprValue(value.planned)} planned`}>
                {formatDprValueCompact(value.actual)}
              </span>
            ) : (
              "—"
            )
          }
          valueClassName="text-xl"
          detail={
            value.priced === 0
              ? lines.length === 0
                ? "No lines"
                : dprUnpricedText(value.unpriced)
              : `of ${formatDprValueCompact(value.planned)} planned${
                  valuePct !== null ? ` · ${Math.round(valuePct)}%` : ""
                }${value.unpriced > 0 ? ` · ${dprUnpricedText(value.unpriced)}` : ""}`
          }
        />
        <DprFigureTile
          icon={ListChecks}
          colours={RECORD_COLOURS}
          label="BOQ lines"
          value={String(stats.lines)}
          detail={`${stats.worked} worked · ${stats.behind} behind plan`}
        />
        <DprFigureTile
          icon={Users}
          colours={MANPOWER_COLOURS}
          label="Manpower"
          value={formatQty(stats.manpower)}
          detail={manpower.length === 0 ? "None recorded" : `${plural(trades, "trade")} on site`}
        />
        <DprFigureTile
          icon={locked ? Lock : state === "reopened" ? History : CheckCircle2}
          colours={locked ? ["#6ee7b7", "#059669"] : ["#fcd34d", "#d97706"]}
          label="Status"
          value={STATE_TEXT[state].split(" · ")[0]}
          valueClassName="text-xl"
          detail={stateDetail}
        />
      </DprFigureRow>

      <DprReportCard
        icon={ListChecks}
        colours={RECORD_COLOURS}
        title="BOQ lines on this record"
        subtitle={`${entry.scope} · ${longDate(entry.date)}${preparedBy ? ` · prepared by ${preparedBy}` : ""}`}
        aside={
          <>
            <InfoTip label="About this record's lines">
              Planned is the plan snapshot saved with the sheet, not today&apos;s plan — a projection
              revised since does not change it. vs plan compares the actual with that snapshot. A
              line with nothing planned still takes an actual: it shows as Unplanned. Value is the
              quantity × the BOQ line&apos;s rate; a line with no rate has no value and is left out of
              the totals. Editing opens the sheet editor, which can change a line, add new BOQ lines
              and take lines off.
            </InfoTip>
            <span className="inline-flex" title={editAction.reason ?? undefined}>
              <Button
                size="sm"
                className={GRADIENT_BUTTON}
                style={gradient("#a78bfa", "#7c3aed")}
                disabled={!editAction.allowed}
                onClick={() => onEdit(entry)}
              >
                {editAction.reopenFirst && editAction.allowed ? (
                  <>
                    <Unlock className="mr-1.5 h-4 w-4" /> Reopen &amp; edit
                  </>
                ) : (
                  <>
                    <Pencil className="mr-1.5 h-4 w-4" /> Edit record
                  </>
                )}
              </Button>
            </span>
            <span className="inline-flex" title={deleteAction.reason ?? undefined}>
              <Button
                size="sm"
                variant="outline"
                className="h-9 rounded-[11px] px-3 text-[12.5px] font-extrabold text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={!deleteAction.allowed}
                onClick={() => setIsConfirmingDelete(true)}
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Delete record
              </Button>
            </span>
          </>
        }
      >
        {lines.length === 0 ? (
          <DprReportZero
            icon={ListChecks}
            colours={RECORD_COLOURS}
            glow={["rgba(196, 181, 253, 0.6)", "rgba(147, 197, 253, 0.5)"]}
            title="No BOQ lines on this sheet"
            text="It was saved without any work recorded."
          />
        ) : (
          // One line per BOQ line, every cell single-line, all of it inside the table: fixed
          // columns (980px) beside an auto description column that keeps at least 300px of the
          // minimum width, sideways scroll on a phone. No Location or Agency: the sheet stopped
          // asking for them (user, 2026-11-21).
          <Table stickyHeader containerClassName="max-h-[65vh]" className="min-w-[1280px] table-fixed">
            <colgroup>
              <col className="w-[72px]" />
              <col />
              <col className="w-[60px]" />
              <col className="w-[96px]" />
              <col className="w-[96px]" />
              <col className="w-[120px]" />
              <col className="w-[88px]" />
              <col className="w-[124px]" />
              <col className="w-[124px]" />
              <col className="w-[200px]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="truncate">SL No</TableHead>
                <TableHead className="truncate">BOQ line</TableHead>
                <TableHead className="truncate">Unit</TableHead>
                <TableHead className="truncate text-right" title="The plan for this day, as saved with the sheet">
                  Planned
                </TableHead>
                <TableHead className="truncate text-right">Actual</TableHead>
                <TableHead className="truncate text-right" title="Actual against the planned snapshot">
                  vs plan
                </TableHead>
                <TableHead className="truncate text-right" title="The BOQ line's rate, per unit">
                  Rate
                </TableHead>
                <TableHead className="truncate text-right" title="Planned × rate">
                  Planned value
                </TableHead>
                <TableHead className="truncate text-right" title="Actual × rate">
                  Actual value
                </TableHead>
                <TableHead className="truncate">Remarks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => {
                const item = itemById.get(line.boqItemId);
                const unit = line.unit || item?.unit || "";
                const decimals = data.decimalsFor(unit);
                const figures = dprRecordLineFigures(line);
                const slNo = line.boqSlNo || line.erpSlNo || item?.boqSlNo || "";
                const description = line.description || item?.description || "";
                const rate = dprRateOf(rates, line.boqItemId);
                return (
                  <TableRow key={line.id || `${line.boqItemId}-${index}`}>
                    <TableCell className="py-1.5">
                      {slNo ? (
                        <DprSlNoPill slNo={slNo} seed={line.boqItemId || slNo} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm" title={breakdownTitle({ description, path: item?.path })}>
                      <DprIndentedText text={description} depth={item?.depth ?? 0} />
                    </TableCell>
                    <TableCell className="truncate text-sm" title={unit || undefined}>
                      {unit || "—"}
                    </TableCell>
                    <TableCell className="truncate text-right text-sm tabular-nums">
                      {figures.planned > 0 ? (
                        formatQtyAt(figures.planned, decimals)
                      ) : (
                        <span className="font-extrabold text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="truncate text-right text-sm tabular-nums">
                      {figures.entered ? (
                        <span className="font-extrabold">{formatQtyAt(figures.actual, decimals)}</span>
                      ) : (
                        <span className="text-xs font-semibold text-muted-foreground">Not entered</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="truncate text-right text-xs"
                      title={
                        figures.entered && figures.planned > 0
                          ? `Actual ${formatQtyAt(figures.actual, decimals)} against ${formatQtyAt(figures.planned, decimals)} planned`
                          : undefined
                      }
                    >
                      <VsPlan figures={figures} decimals={decimals} />
                    </TableCell>
                    <TableCell className="truncate text-right text-sm tabular-nums text-muted-foreground">
                      {formatDprRate(rate)}
                    </TableCell>
                    <TableCell
                      className="truncate text-right text-sm tabular-nums text-muted-foreground"
                      title={rate === null ? NO_RATE : undefined}
                    >
                      {rate === null ? <span className="font-extrabold text-muted-foreground/50">—</span> : formatDprValue(figures.planned * rate)}
                    </TableCell>
                    <TableCell
                      className="truncate text-right text-sm font-bold tabular-nums"
                      title={rate === null ? NO_RATE : undefined}
                    >
                      {rate === null || !figures.entered ? (
                        <span className="font-extrabold text-muted-foreground/50">—</span>
                      ) : (
                        formatDprValue(figures.actual * rate)
                      )}
                    </TableCell>
                    <TableCell className="truncate text-sm" title={line.remarks || undefined}>
                      {line.remarks || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {/* The sheet's value: planned against done, over the lines that have a rate. */}
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableCell colSpan={7} className="py-2 text-right text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
                  Value
                  {value.unpriced > 0 ? (
                    <span className="ml-2 font-semibold normal-case tracking-normal">
                      ({dprUnpricedText(value.unpriced)} — left out)
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="py-2 text-right text-sm font-bold tabular-nums text-muted-foreground">
                  {value.priced > 0 ? formatDprValue(value.planned) : "—"}
                </TableCell>
                <TableCell className="py-2 text-right text-sm font-extrabold tabular-nums">
                  {value.priced > 0 ? formatDprValue(value.actual) : "—"}
                </TableCell>
                <TableCell className="truncate py-2 text-xs font-semibold tabular-nums text-muted-foreground">
                  {valuePct !== null ? `${Math.round(valuePct)}% of the planned value` : ""}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </DprReportCard>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <DprReportCard
          icon={Users}
          colours={MANPOWER_COLOURS}
          title="Manpower"
          subtitle={manpower.length === 0 ? "None recorded" : `${formatQty(stats.manpower)} on site · ${plural(trades, "trade")}`}
        >
          {manpower.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">No manpower was recorded on this sheet.</p>
          ) : (
            <Table className="min-w-[320px] table-fixed">
              <colgroup>
                <col className="w-[72px]" />
                <col />
                <col className="w-[110px]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="truncate">SL No</TableHead>
                  <TableHead className="truncate">Trade</TableHead>
                  <TableHead className="truncate text-right">Headcount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {manpower.map((row, index) => (
                  <TableRow key={row.id || `${row.trade}-${index}`}>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="truncate text-sm font-semibold" title={row.trade || undefined}>
                      {row.trade || "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm font-extrabold tabular-nums">
                      {formatQty(dprNumber(row.count))}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell />
                  <TableCell className="text-sm font-extrabold">Total</TableCell>
                  <TableCell className="text-right text-sm font-extrabold tabular-nums">
                    {formatQty(stats.manpower)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </DprReportCard>

        <DprReportCard
          icon={Truck}
          colours={PLANT_COLOURS}
          title="Plant"
          subtitle={equipment.length === 0 ? "None recorded" : plural(equipment.length, "item")}
        >
          {equipment.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">No plant was recorded on this sheet.</p>
          ) : (
            <Table className="min-w-[500px] table-fixed">
              <colgroup>
                <col className="w-[72px]" />
                <col />
                <col className="w-[104px]" />
                <col className="w-[96px]" />
                <col className="w-[80px]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="truncate">SL No</TableHead>
                  <TableHead className="truncate">Plant</TableHead>
                  <TableHead className="truncate text-right">Deployed</TableHead>
                  <TableHead className="truncate text-right">Running h</TableHead>
                  <TableHead className="truncate text-right">Idle h</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {equipment.map((row, index) => (
                  <TableRow key={row.id || `${row.name}-${index}`}>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="truncate text-sm font-semibold" title={row.name || undefined}>
                      {row.name || "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm font-extrabold tabular-nums">
                      {formatQty(dprNumber(row.deployed))}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatQty(dprNumber(row.runningHours))}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatQty(dprNumber(row.idleHours))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DprReportCard>
      </div>

      <DprReportCard icon={NotebookPen} colours={DIARY_COLOURS} title="Site diary">
        <Table className="table-fixed">
          <colgroup>
            <col className="w-[132px] sm:w-[160px]" />
            <col />
          </colgroup>
          <TableBody>
            <DiaryRow label="Weather" value={entry.weather?.trim() || ""} empty="Not recorded" />
            <DiaryRow
              label="Lost time"
              value={
                lostHours > 0
                  ? `${formatQty(lostHours)} h${entry.lostTimeReason?.trim() ? ` · ${entry.lostTimeReason.trim()}` : ""}`
                  : ""
              }
              empty="None"
            />
            <DiaryRow label="Hindrances" value={entry.hindrances?.trim() || ""} empty="None" />
            <DiaryRow label="Remarks" value={entry.remarks?.trim() || ""} empty="None" />
          </TableBody>
        </Table>
      </DprReportCard>

      <ConfirmDialog
        open={isConfirmingDelete}
        onOpenChange={(open) => (!open ? setIsConfirmingDelete(false) : undefined)}
        destructive
        loading={isDeleting}
        title="Delete this progress record?"
        description={`${entry.scope} · ${longDate(entry.date)} · ${plural(
          stats.lines,
          "BOQ line",
        )}, its manpower, plant and diary. This cannot be undone.`}
        confirmLabel="Delete record"
        onConfirm={handleDelete}
      />
    </div>
  );
}

/** Actual against the plan snapshot: met, ahead or behind by how much, or unplanned work. */
function VsPlan({ figures, decimals }: { figures: ReturnType<typeof dprRecordLineFigures>; decimals: number }) {
  switch (figures.standing) {
    case "met":
      return <span className="font-extrabold text-emerald-700">Met</span>;
    case "ahead":
      return (
        <span className="font-extrabold tabular-nums text-emerald-700">
          +{formatQtyAt(figures.variance ?? 0, decimals)} <span className="font-semibold">ahead</span>
        </span>
      );
    case "behind":
      return (
        <span className="font-extrabold tabular-nums text-rose-600">
          −{formatQtyAt(Math.abs(figures.variance ?? 0), decimals)} <span className="font-semibold">behind</span>
        </span>
      );
    case "unplanned":
      return (
        <span className="whitespace-nowrap rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-extrabold text-blue-700">
          Unplanned
        </span>
      );
    default:
      return <span className="font-extrabold text-muted-foreground/50">—</span>;
  }
}

/** One diary line: label, then the value — prose, so it wraps rather than hiding behind a tooltip. */
function DiaryRow({ label, value, empty }: { label: string; value: string; empty: string }) {
  return (
    <TableRow>
      <TableCell className="align-top text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</TableCell>
      <TableCell className={cn("whitespace-pre-line break-words text-sm", !value && "text-muted-foreground")}>
        {value || empty}
      </TableCell>
    </TableRow>
  );
}
