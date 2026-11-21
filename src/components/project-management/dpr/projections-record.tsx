"use client";

/**
 * One projection record: every BOQ line planned for a scope over one period, read and edited.
 *
 * The user asked (2026-11-21) to see the BOQ lines given in each projection record and to change
 * the record: edit its lines, add new ones and take lines off. The record itself is derived, not
 * stored (`project-management-dpr-records.ts`). Editing keeps every projection rule:
 *  - a changed quantity is saved as a revision (rule P7). One reason covers every change, the
 *    baseline is kept and the history is appended;
 *  - an added line is a new projection over the record's period and spread, checked like any
 *    other (P1–P6), and follows the overlap rule chosen here;
 *  - a line taken off is deleted;
 *  - an ended record is locked.
 *
 * Props only: the page does the writes (`onSave`, `onDelete`), so the screen can be rendered with
 * made-up data.
 */

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CircleAlert,
  History,
  IndianRupee,
  ListChecks,
  ListEnd,
  ListPlus,
  Loader2,
  Lock,
  Pencil,
  Save,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { daysInRange, dprNumber, type DprTarget } from "@/lib/project-management-dpr";
import {
  DPR_DISTRIBUTION_LABELS,
  DPR_PERIOD_LABELS,
  dprCalendar,
  unplannedBalance,
  type DprOverlapPolicy,
} from "@/lib/project-management-dpr-plan";
import {
  checkDprRecordRows,
  dprAddedRowKey,
  planDprRecordEdit,
  readDprQtyText,
  type DprProjectionRecord,
  type DprRecordAddedDraft,
  type DprRecordEditPlan,
  type DprRecordRowDraft,
} from "@/lib/project-management-dpr-records";
import {
  buildDprRateLookup,
  dprPlannedValue,
  dprRateOf,
  dprUnpricedText,
  formatDprRate,
  formatDprValue,
  formatDprValueCompact,
} from "@/lib/project-management-dpr-values";
import type { DprBoqItem } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprMessages,
  formatDisplayDate,
  formatQtyAt,
  formatRangeCompact,
} from "@/components/project-management/dpr/dpr-shell";
import { DprIndentedText, breakdownTitle } from "@/components/project-management/dpr/dpr-indent";
import {
  DprFigureRow,
  DprFigureTile,
  DprGradientChip,
  DprReportCard,
  DprReportPill,
  DprReportZero,
  DprSlNoPill,
  dprSlNoColumnWidth,
} from "@/components/project-management/dpr/reports-parts";
import { ScopeBadge, type ProjectionsContext } from "@/components/project-management/dpr/projections-shared";
import { DprBoqLinePickerDialog } from "@/components/project-management/dpr/boq-line-picker-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { InfoTip } from "@/components/shared/info-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type ProjectionRecordMode = "view" | "edit";

const RECORD_COLOURS = ["#c4b5fd", "#7c3aed"] as const;

/** A white-text gradient button, as the planner draws its actions. */
const GRADIENT_BUTTON =
  "keep-light h-9 rounded-[11px] border-0 px-3.5 text-[12.5px] font-extrabold text-white hover:brightness-105 disabled:opacity-50";
const gradient = (from: string, to: string) => ({
  backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
  boxShadow: `0 8px 16px -10px ${to}`,
});

const STATUS_TEXT: Record<DprProjectionRecord["status"], string> = {
  upcoming: "Upcoming",
  running: "Running",
  ended: "Ended · locked",
};
const STATUS_PILL: Record<DprProjectionRecord["status"], string> = {
  upcoming: "border-blue-200 bg-blue-50 text-blue-700",
  running: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ended: "border-border bg-muted text-muted-foreground",
};

/** Rounds down to a unit's precision, so a filled balance never overshoots it. */
const floorToDecimals = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.floor(value * scale + 1e-9) / scale;
};

/** The per-day figure on its own — "0.467", or "1 to 2" for a whole-number unit. */
const perDayFigure = (qty: number, decimals: number, workingDays: number): string => {
  const perDay = qty / workingDays;
  return decimals === 0 && perDay % 1 !== 0
    ? `${Math.floor(perDay)} to ${Math.ceil(perDay)}`
    : formatQtyAt(perDay, 3);
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * A line's Rate and Value cells: quantity × the BOQ line's rate. No rate, no value — never a
 * guessed one. While editing, `wasQty` is the stored quantity, so the value says what it was.
 */
function ValueCells({
  rate,
  qty,
  struck = false,
  wasQty = null,
}: {
  rate: number | null;
  /** null while an added line has no quantity yet. */
  qty: number | null;
  struck?: boolean;
  wasQty?: number | null;
}) {
  const value = rate !== null && qty !== null ? qty * rate : null;
  const title =
    rate === null
      ? "This BOQ line has no rate, so it has no value."
      : value === null
        ? undefined
        : `${formatQtyAt(qty ?? 0, 3)} × ${formatDprRate(rate)} = ${formatDprValue(value)}${
            wasQty !== null ? `; was ${formatDprValue(wasQty * rate)}` : ""
          }`;
  return (
    <>
      <TableCell className={cn("truncate text-right text-sm tabular-nums text-muted-foreground", struck && "line-through")}>
        {formatDprRate(rate)}
      </TableCell>
      <TableCell
        className={cn("truncate text-right text-sm font-bold tabular-nums", struck && "line-through text-muted-foreground")}
        title={title}
      >
        {value === null ? <span className="font-extrabold text-muted-foreground/60">—</span> : formatDprValue(value)}
      </TableCell>
    </>
  );
}

/** "2 quantities changed · 1 line added · 1 taken off". */
export function changeSummary(plan: DprRecordEditPlan): string {
  const parts: string[] = [];
  if (plan.revise.length) parts.push(`${plural(plan.revise.length, "quantity", "quantities")} changed`);
  if (plan.remarksOnly.length) parts.push(`${plural(plan.remarksOnly.length, "note")} changed`);
  if (plan.add.length) parts.push(`${plural(plan.add.length, "line")} added`);
  if (plan.remove.length) parts.push(`${plural(plan.remove.length, "line")} taken off`);
  return parts.join(" · ");
}

export function ProjectionRecordView({
  context,
  record,
  mode,
  onModeChange,
  onBack,
  onSave,
  onDelete,
  isLoading = false,
}: {
  context: ProjectionsContext;
  /** Null when the address names a record that is no longer there. */
  record: DprProjectionRecord | null;
  mode: ProjectionRecordMode;
  onModeChange: (mode: ProjectionRecordMode) => void;
  onBack: () => void;
  /** Writes the edit; resolves true when it was saved. The page shows the toast and reloads. */
  onSave: (record: DprProjectionRecord, plan: DprRecordEditPlan, reason: string) => Promise<boolean>;
  /** Deletes the whole record; resolves true when it was deleted. */
  onDelete: (record: DprProjectionRecord) => Promise<boolean>;
  /** The register is still loading, so a missing record may just not be read yet. */
  isLoading?: boolean;
}) {
  if (!record && isLoading) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-12 animate-pulse rounded bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }
  if (!record) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <DprReportCard icon={ListChecks} colours={RECORD_COLOURS} title="Projection record">
          <DprReportZero
            icon={ListChecks}
            colours={RECORD_COLOURS}
            glow={["rgba(196, 181, 253, 0.6)", "rgba(147, 197, 253, 0.5)"]}
            title="This record is no longer there"
            text="Its lines were taken off, or the link is out of date. Pick a record from the list."
          />
        </DprReportCard>
      </div>
    );
  }
  return (
    <RecordBody
      context={context}
      record={record}
      mode={mode}
      onModeChange={onModeChange}
      onBack={onBack}
      onSave={onSave}
      onDelete={onDelete}
    />
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="h-8 rounded-[10px] px-2.5 font-bold" onClick={onBack}>
      <ArrowLeft className="mr-1.5 h-4 w-4" /> All projection records
    </Button>
  );
}

function RecordBody({
  context,
  record,
  mode,
  onModeChange,
  onBack,
  onSave,
  onDelete,
}: {
  context: ProjectionsContext;
  record: DprProjectionRecord;
  mode: ProjectionRecordMode;
  onModeChange: (mode: ProjectionRecordMode) => void;
  onBack: () => void;
  onSave: (record: DprProjectionRecord, plan: DprRecordEditPlan, reason: string) => Promise<boolean>;
  onDelete: (record: DprProjectionRecord) => Promise<boolean>;
}) {
  const { data, actuals, today, canEdit, canDelete } = context;
  const locked = record.status === "ended";
  const editing = mode === "edit" && canEdit && !locked;

  /** Lines touched in the editor; an untouched line reads as its stored values. */
  const [rows, setRows] = useState<ReadonlyMap<string, DprRecordRowDraft>>(new Map());
  const [added, setAdded] = useState<DprRecordAddedDraft[]>([]);
  const [reason, setReason] = useState("");
  const [policy, setPolicy] = useState<DprOverlapPolicy>("block");
  const [attempted, setAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const range = useMemo(() => ({ startDate: record.startDate, endDate: record.endDate }), [record]);
  const calendar = useMemo(() => dprCalendar(data.settings), [data.settings]);
  const workingDays = calendar.workingDays(record.startDate, record.endDate).length;
  const itemById = useMemo(() => new Map(data.boqItems.map((item) => [item.id, item])), [data.boqItems]);
  const itemInfo = useMemo(
    () => new Map(data.boqItems.map((item) => [item.id, { unit: item.unit, boqQty: item.boqQty }])),
    [data.boqItems],
  );
  /** Planned quantity × the BOQ line's rate; a line with no rate is counted, never priced. */
  const rates = useMemo(() => buildDprRateLookup(data.boqItems), [data.boqItems]);
  const storedValue = useMemo(() => dprPlannedValue(record.targets, rates), [record, rates]);

  const rowOf = (target: DprTarget): DprRecordRowDraft =>
    rows.get(target.id) ?? {
      qty: String(dprNumber(target.plannedQty)),
      remarks: target.remarks ?? "",
      removed: false,
    };
  const setRow = (target: DprTarget, patch: Partial<DprRecordRowDraft>) =>
    setRows((previous) => new Map(previous).set(target.id, { ...rowOf(target), ...patch }));
  const setAddedRow = (boqItemId: string, patch: Partial<DprRecordAddedDraft>) =>
    setAdded((previous) => previous.map((line) => (line.boqItemId === boqItemId ? { ...line, ...patch } : line)));

  const plan = useMemo(() => planDprRecordEdit(record, rows, added), [record, rows, added]);
  const checks = useMemo(
    () =>
      checkDprRecordRows({
        record,
        rows,
        added,
        items: itemInfo,
        targets: data.targets,
        actuals,
        settings: data.settings,
        projectDates: data.projectDates,
        today,
        overlapPolicy: policy,
      }),
    [record, rows, added, itemInfo, data.targets, data.settings, data.projectDates, actuals, today, policy],
  );

  /** The line's open balance at its unit's precision — what an added line's fill button types. */
  const openBalanceOf = (item: DprBoqItem): number | null => {
    const balance = unplannedBalance({ item, plan: data.plan, actuals, settings: data.settings, today });
    if (balance === null) return null;
    const qty = floorToDecimals(balance, data.decimalsFor(item.unit));
    return qty > 0 ? qty : null;
  };

  /** BOQ lines of the record's scope that are not in it yet, in work-breakdown order. */
  const candidates = useMemo(() => {
    const taken = new Set([...record.targets.map((target) => target.boqItemId), ...added.map((line) => line.boqItemId)]);
    const order = new Map(data.breakdown.ordered.map((node, index) => [node.id, index]));
    return data.boqItems
      .filter((item) => item.scope === record.scope && !taken.has(item.id))
      .sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  }, [data.boqItems, data.breakdown, record, added]);

  const slOf = (rowKey: string): string => {
    if (rowKey.startsWith("add:")) {
      const item = itemById.get(rowKey.slice(4));
      return item?.boqSlNo || item?.description || "A new line";
    }
    const target = record.targets.find((candidate) => candidate.id === rowKey);
    return itemById.get(target?.boqItemId ?? "")?.boqSlNo || target?.boqSlNo || "A line";
  };

  const rowErrors = [...checks].flatMap(([key, check]) => check.errors.map((message) => `${slOf(key)}: ${message}`));
  const rowWarnings = [...checks].flatMap(([key, check]) =>
    check.warnings.map((message) => `${slOf(key)}: ${message}`),
  );
  const reasonMissing = plan.needsReason && !reason.trim();
  const errors = [
    ...rowErrors,
    ...(attempted && reasonMissing
      ? ["Give a reason for the change. The baseline is kept and the change is logged."]
      : []),
  ];
  const warnings = [
    ...rowWarnings,
    ...(plan.removesAll ? ["Every line is taken off, so the record goes once you save."] : []),
    ...(plan.remove.length > 0 && record.status === "running"
      ? [
          `${plural(plan.remove.length, "line")} taken off: ${
            plan.remove.length === 1 ? "its" : "their"
          } planned quantity leaves every report, including the days already past.`,
        ]
      : []),
  ];
  const blocked = rowErrors.length > 0 || reasonMissing;

  const handleSave = async () => {
    setAttempted(true);
    if (blocked || plan.changeCount === 0) return;
    setIsSaving(true);
    try {
      await onSave(record, plan, reason);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      if (await onDelete(record)) setIsConfirmingDelete(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const periodLabel = DPR_PERIOD_LABELS[record.periodType] ?? "Custom";
  const spreadLabel =
    record.distribution === "mixed" ? "Mixed" : (DPR_DISTRIBUTION_LABELS[record.distribution] ?? "Even");
  const elapsedWorking =
    record.status === "running" ? calendar.workingDays(record.startDate, today).length : 0;
  const daysToStart = record.status === "upcoming" ? daysInRange(today, record.startDate) - 1 : 0;
  const lineCount = record.targets.length;

  /**
   * The record's value as it would save: an edited quantity counts as typed, a line taken off
   * drops out, an added line counts once it has a quantity. Outside the editor it is the stored value.
   */
  const liveValue = (() => {
    if (!editing) return storedValue;
    const lines: Array<{ boqItemId: string; plannedQty: number }> = [];
    for (const target of record.targets) {
      const row = rowOf(target);
      if (row.removed) continue;
      const typed = readDprQtyText(row.qty);
      const qty = typed !== null && Number.isFinite(typed) && typed >= 0 ? typed : dprNumber(target.plannedQty);
      lines.push({ boqItemId: target.boqItemId, plannedQty: qty });
    }
    for (const line of added) {
      const typed = readDprQtyText(line.qty);
      lines.push({ boqItemId: line.boqItemId, plannedQty: typed !== null && Number.isFinite(typed) && typed > 0 ? typed : 0 });
    }
    return dprPlannedValue(lines, rates);
  })();
  const valueChanged = editing && Math.abs(liveValue.value - storedValue.value) > 0.005;
  const editTitle = locked
    ? "This period has ended. Past periods are locked."
    : !canEdit
      ? "Needs the Edit action on Daily Progress."
      : undefined;

  return (
    <div className={cn("space-y-4", editing && "pb-2")}>
      {/* Back to the list, and which record this is. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <BackButton onBack={onBack} />
        <span className="flex min-w-0 items-center gap-2">
          <ScopeBadge scope={record.scope} />
          <span className="truncate text-sm font-extrabold tabular-nums">
            {periodLabel} · {formatRangeCompact(record.startDate, record.endDate)}
          </span>
          <span
            className={cn(
              "whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold",
              STATUS_PILL[record.status],
            )}
          >
            {locked ? <Lock className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" /> : null}
            {STATUS_TEXT[record.status]}
          </span>
        </span>
      </div>

      <DprFigureRow>
        <DprFigureTile
          icon={CalendarDays}
          colours={["#93c5fd", "#2563eb"]}
          label="Period"
          value={formatRangeCompact(record.startDate, record.endDate)}
          valueClassName="text-xl"
          detail={
            <span
              title={
                record.distribution === "mixed"
                  ? `Mixed spread — new lines take ${DPR_DISTRIBUTION_LABELS[record.spreadForNew]}`
                  : `${spreadLabel} spread across working days`
              }
            >
              {periodLabel} · {daysInRange(record.startDate, record.endDate)} days, {workingDays} working ·{" "}
              {spreadLabel} spread
            </span>
          }
        />
        <DprFigureTile
          icon={ListChecks}
          colours={RECORD_COLOURS}
          label="BOQ lines"
          value={String(lineCount)}
          detail={`${record.revisedCount} revised · ${lineCount - record.revisedCount} on baseline`}
        />
        <DprFigureTile
          icon={IndianRupee}
          colours={["#6ee7b7", "#059669"]}
          label="Planned value"
          value={
            <span title={`${formatDprValue(storedValue.value)} planned`}>
              {storedValue.priced > 0 ? formatDprValueCompact(storedValue.value) : "—"}
            </span>
          }
          valueClassName="text-xl"
          detail={dprUnpricedText(storedValue.unpriced) || "planned quantity × BOQ rate"}
        />
        <DprFigureTile
          icon={locked ? Lock : History}
          colours={locked ? ["#cbd5e1", "#64748b"] : ["#fcd34d", "#d97706"]}
          label="Status"
          value={STATUS_TEXT[record.status].split(" · ")[0]}
          valueClassName="text-xl"
          detail={
            record.status === "upcoming"
              ? daysToStart <= 1
                ? "starts tomorrow"
                : `starts in ${daysToStart} days`
              : record.status === "running"
                ? `working day ${elapsedWorking} of ${workingDays}`
                : "past periods cannot change"
          }
        />
      </DprFigureRow>

      <DprReportCard
        icon={ListChecks}
        colours={RECORD_COLOURS}
        title={editing ? "Edit the BOQ lines in this record" : "BOQ lines in this record"}
        subtitle={`${record.scope} · ${periodLabel} ${formatDisplayDate(record.startDate)} – ${formatDisplayDate(
          record.endDate,
        )}${record.madeBy.length ? ` · set by ${record.madeBy.join(", ")}` : ""}`}
        aside={
          editing ? (
            <>
              <InfoTip label="About editing a record">
                A changed quantity is saved as a revision: one reason covers every change, and each
                line keeps its baseline and history. An added line is a new projection over this
                period, spread the record&apos;s way. A line taken off is deleted. The overlap rule
                only matters for added lines that already have a projection in these dates.
              </InfoTip>
              <Select value={policy} onValueChange={(next) => setPolicy(next as DprOverlapPolicy)}>
                <SelectTrigger
                  aria-label="Overlap rule for added lines"
                  className="h-9 w-[15.5rem] rounded-[11px] text-left text-[12.5px] font-bold"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="block">Overlap: block the line</SelectItem>
                  <SelectItem value="finer">Overlap: shorter period takes the days</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className={GRADIENT_BUTTON}
                style={gradient("#34d399", "#059669")}
                onClick={() => setIsPickerOpen(true)}
                disabled={candidates.length === 0}
                title={candidates.length === 0 ? `Every ${record.scope} BOQ line is already in this record.` : undefined}
              >
                <ListPlus className="mr-1.5 h-4 w-4" /> Add BOQ lines
              </Button>
            </>
          ) : (
            <>
              <span className="inline-flex" title={editTitle}>
                <Button
                  size="sm"
                  className={GRADIENT_BUTTON}
                  style={gradient("#a78bfa", "#7c3aed")}
                  disabled={Boolean(editTitle)}
                  onClick={() => onModeChange("edit")}
                >
                  <Pencil className="mr-1.5 h-4 w-4" /> Edit record
                </Button>
              </span>
              <span className="inline-flex" title={canDelete ? undefined : "Needs the Delete action on Daily Progress."}>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 rounded-[11px] px-3 text-[12.5px] font-extrabold text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={!canDelete}
                  onClick={() => setIsConfirmingDelete(true)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" /> Delete record
                </Button>
              </span>
            </>
          )
        }
      >
        {editing && (errors.length > 0 || warnings.length > 0) ? (
          <div className="px-4 pt-3 sm:px-5">
            <DprMessages errors={errors} warnings={warnings} errorTitle="Fix these before saving" />
          </div>
        ) : null}
        <div className={cn(editing && (errors.length > 0 || warnings.length > 0) && "mt-3 border-t border-border/60")}>
          <TooltipProvider delayDuration={150}>
            {/* One line per BOQ line, every cell single-line, all of it inside the table: fixed
                columns, a bounded height under a pinned header, sideways scroll on a phone. */}
            <Table
              stickyHeader
              containerClassName="max-h-[65vh]"
              // The fixed columns sum to 1118px (1206px editing); the rest is the BOQ line's.
              className={cn("table-fixed", editing ? "min-w-[1442px]" : "min-w-[1372px]")}
            >
              <colgroup>
                {/* Wide enough for the longest SL No (added lines too), so none is cut short. */}
                <col
                  style={{
                    width: dprSlNoColumnWidth([
                      ...record.targets.map((target) => itemById.get(target.boqItemId)?.boqSlNo || target.boqSlNo),
                      ...added.map((line) => itemById.get(line.boqItemId)?.boqSlNo),
                    ]),
                  }}
                />
                <col />
                <col className="w-[64px]" />
                <col className="w-[84px]" />
                <col className="w-[80px]" />
                <col className="w-[92px]" />
                <col className="w-[140px]" />
                <col className="w-[80px]" />
                <col className="w-[112px]" />
                <col className="w-[160px]" />
                <col className="w-[104px]" />
                <col className="w-[130px]" />
                {editing ? <col className="w-[88px]" /> : null}
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="truncate">SL No</TableHead>
                  <TableHead className="truncate">BOQ line</TableHead>
                  <TableHead className="truncate">Unit</TableHead>
                  <TableHead className="truncate text-right">BOQ qty</TableHead>
                  <TableHead className="truncate text-right" title="Done to date, all sheets">
                    Done
                  </TableHead>
                  <TableHead className="truncate text-right" title="Done within this record's period">
                    In period
                  </TableHead>
                  <TableHead className="truncate text-right">{editing ? "Quantity" : "Planned"}</TableHead>
                  <TableHead className="truncate text-right" title="The BOQ line's rate, per unit">
                    Rate
                  </TableHead>
                  <TableHead className="truncate text-right" title="Planned quantity × rate">
                    Value
                  </TableHead>
                  <TableHead className="truncate">{editing ? "Works out at" : "Per working day"}</TableHead>
                  <TableHead className="truncate">Revision</TableHead>
                  <TableHead className="truncate">Remarks</TableHead>
                  {editing ? (
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {record.targets.map((target) => {
                  const item = itemById.get(target.boqItemId);
                  const unit = item?.unit || target.unit;
                  const decimals = data.decimalsFor(unit);
                  const currentQty = dprNumber(target.plannedQty);
                  const row = rowOf(target);
                  const check = checks.get(target.id);
                  const hasErrors = Boolean(check && check.errors.length > 0);
                  const hasWarnings = Boolean(check && check.warnings.length > 0);
                  const typed = readDprQtyText(row.qty);
                  const changed =
                    editing && !row.removed && typed !== null && Number.isFinite(typed) && Math.abs(typed - currentQty) > 1e-9;
                  const shownQty = changed && typed !== null ? typed : currentQty;
                  const slNo = item?.boqSlNo || target.boqSlNo;
                  const revisionNo = target.revisionNo ?? 0;
                  return (
                    <TableRow key={target.id} className={cn(row.removed && "bg-muted/40 text-muted-foreground")}>
                      <TableCell className="py-1.5">
                        <DprSlNoPill slNo={slNo} seed={target.boqItemId} />
                      </TableCell>
                      <TableCell
                        className={cn("text-sm", row.removed && "line-through")}
                        title={breakdownTitle({ description: item?.description || target.description, path: item?.path })}
                      >
                        <DprIndentedText text={item?.description || target.description} depth={item?.depth ?? 0} />
                      </TableCell>
                      <TableCell className="truncate text-sm" title={unit}>
                        {unit || "—"}
                      </TableCell>
                      <BoqFigures item={item} decimals={decimals} done={actuals.total(target.boqItemId)} doneInPeriod={actuals.total(target.boqItemId, range)} />
                      <TableCell className="py-1.5 text-right">
                        {editing && !row.removed ? (
                          <QtyInput
                            label={`New quantity for ${slNo || "this line"}`}
                            value={row.qty}
                            decimals={decimals}
                            hasErrors={hasErrors}
                            hasWarnings={hasWarnings}
                            passed={Boolean(check) && changed}
                            problems={check ? [...check.errors, ...check.warnings] : []}
                            onChange={(value) => setRow(target, { qty: value })}
                          />
                        ) : (
                          <span className={cn("text-sm font-extrabold tabular-nums", row.removed && "line-through")}>
                            {formatQtyAt(currentQty, decimals)}
                          </span>
                        )}
                      </TableCell>
                      <ValueCells
                        rate={dprRateOf(rates, target.boqItemId)}
                        qty={shownQty}
                        struck={row.removed}
                        wasQty={changed ? currentQty : null}
                      />
                      <TableCell
                        className="truncate text-xs tabular-nums text-muted-foreground"
                        title={hasErrors ? check?.errors.join(" ") : undefined}
                      >
                        {row.removed ? (
                          <span className="font-bold text-rose-600">Taken off on save</span>
                        ) : hasErrors ? (
                          <span className="font-bold text-rose-600">{check?.errors[0]}</span>
                        ) : workingDays > 0 && shownQty > 0 ? (
                          <>
                            <span className="rounded-lg bg-cyan-50 px-2 py-0.5 font-extrabold text-cyan-800">
                              {perDayFigure(shownQty, decimals, workingDays)}
                            </span>{" "}
                            /day
                            {changed ? ` · was ${formatQtyAt(currentQty, decimals)}` : ""}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <RevisionPill target={target} slNo={slNo} decimals={decimals} pending={changed} />
                      </TableCell>
                      <TableCell className="truncate py-1.5 text-sm" title={editing ? undefined : target.remarks || undefined}>
                        {editing && !row.removed ? (
                          <Input
                            aria-label={`Remarks for ${slNo || "this line"}`}
                            placeholder="Add a note"
                            className="h-8 w-full min-w-0 rounded-[10px] bg-muted/40"
                            value={row.remarks}
                            onChange={(event) => setRow(target, { remarks: event.target.value })}
                          />
                        ) : (
                          <span className="text-muted-foreground">{target.remarks || "—"}</span>
                        )}
                      </TableCell>
                      {editing ? (
                        <TableCell className="py-1.5">
                          <div className="flex items-center justify-end gap-1">
                            {row.removed ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-[10px] px-2 text-xs font-bold"
                                aria-label={`Keep ${slNo || "this line"} in the record`}
                                onClick={() => setRow(target, { removed: false })}
                              >
                                <Undo2 className="mr-1 h-3.5 w-3.5" /> Keep
                              </Button>
                            ) : (
                              <span
                                className="inline-flex"
                                title={canDelete ? `Take ${slNo || "this line"} off the record` : "Needs the Delete action on Daily Progress."}
                              >
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  className="h-8 w-8 rounded-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  aria-label={`Take ${slNo || "this line"} off the record`}
                                  disabled={!canDelete}
                                  onClick={() => setRow(target, { removed: true })}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </span>
                            )}
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}

                {editing
                  ? added.map((line) => {
                      const item = itemById.get(line.boqItemId);
                      if (!item) return null;
                      const key = dprAddedRowKey(line.boqItemId);
                      const decimals = data.decimalsFor(item.unit);
                      const check = checks.get(key);
                      const hasErrors = Boolean(check && check.errors.length > 0);
                      const hasWarnings = Boolean(check && check.warnings.length > 0);
                      const typed = readDprQtyText(line.qty);
                      const typedOk = typed !== null && Number.isFinite(typed) && typed > 0;
                      const fillQty = openBalanceOf(item);
                      const slNo = item.boqSlNo || item.erpSlNo || "";
                      return (
                        <TableRow key={key}>
                          <TableCell className="py-1.5">
                            <DprSlNoPill slNo={slNo} seed={item.id} />
                          </TableCell>
                          <TableCell className="text-sm" title={breakdownTitle(item)}>
                            <DprIndentedText text={item.description} depth={item.depth ?? 0} />
                          </TableCell>
                          <TableCell className="truncate text-sm" title={item.unit}>
                            {item.unit || "—"}
                          </TableCell>
                          <BoqFigures item={item} decimals={decimals} done={actuals.total(item.id)} doneInPeriod={actuals.total(item.id, range)} />
                          <TableCell className="py-1.5 text-right">
                            <QtyInput
                              label={`Quantity for ${slNo || "the new line"}`}
                              value={line.qty}
                              decimals={decimals}
                              hasErrors={hasErrors}
                              hasWarnings={hasWarnings}
                              passed={Boolean(check) && typedOk}
                              problems={check ? [...check.errors, ...check.warnings] : []}
                              onChange={(value) => setAddedRow(line.boqItemId, { qty: value })}
                            />
                          </TableCell>
                          <ValueCells rate={dprRateOf(rates, item.id)} qty={typedOk ? (typed ?? 0) : null} />
                          <TableCell
                            className="truncate text-xs tabular-nums text-muted-foreground"
                            title={hasErrors ? check?.errors.join(" ") : undefined}
                          >
                            {hasErrors && line.qty.trim() ? (
                              <span className="font-bold text-rose-600">{check?.errors[0]}</span>
                            ) : typedOk && workingDays > 0 ? (
                              <>
                                <span className="rounded-lg bg-cyan-50 px-2 py-0.5 font-extrabold text-cyan-800">
                                  {perDayFigure(typed ?? 0, decimals, workingDays)}
                                </span>{" "}
                                /day
                              </>
                            ) : (
                              "Type a quantity"
                            )}
                          </TableCell>
                          <TableCell className="py-1.5">
                            <DprReportPill tone="success">New</DprReportPill>
                          </TableCell>
                          <TableCell className="py-1.5">
                            <Input
                              aria-label={`Remarks for ${slNo || "the new line"}`}
                              placeholder="Add a note"
                              className="h-8 w-full min-w-0 rounded-[10px] bg-muted/40"
                              value={line.remarks}
                              onChange={(event) => setAddedRow(line.boqItemId, { remarks: event.target.value })}
                            />
                          </TableCell>
                          <TableCell className="py-1.5">
                            <div className="flex items-center justify-end gap-1">
                              <span
                                className="inline-flex"
                                title={
                                  fillQty === null
                                    ? "Nothing left to plan on this line"
                                    : `Plan the whole balance (${formatQtyAt(fillQty, decimals)} ${item.unit})`
                                }
                              >
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  className="h-8 w-8 rounded-[10px] text-blue-600 hover:bg-blue-50"
                                  aria-label={`Plan the whole balance of ${slNo || "the new line"}`}
                                  disabled={fillQty === null}
                                  onClick={() => fillQty !== null && setAddedRow(line.boqItemId, { qty: String(fillQty) })}
                                >
                                  <ListEnd className="h-4 w-4" />
                                </Button>
                              </span>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 rounded-[10px]"
                                aria-label={`Don't add ${slNo || "this line"}`}
                                title="Don't add this line"
                                onClick={() =>
                                  setAdded((previous) => previous.filter((other) => other.boqItemId !== line.boqItemId))
                                }
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  : null}

                {/* The record's value: what it is, and — while editing — what it will be. */}
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={8} className="py-2 text-right text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
                    {editing ? "Planned value on save" : "Planned value"}
                    {liveValue.unpriced > 0 ? (
                      <span className="ml-2 font-semibold normal-case tracking-normal">
                        ({dprUnpricedText(liveValue.unpriced)} — left out)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className="py-2 text-right text-sm font-extrabold tabular-nums"
                    title={`${formatDprValue(liveValue.value)}${valueChanged ? `, was ${formatDprValue(storedValue.value)}` : ""}`}
                  >
                    {liveValue.priced > 0 ? formatDprValue(liveValue.value) : "—"}
                  </TableCell>
                  <TableCell colSpan={editing ? 4 : 3} className="truncate py-2 text-xs tabular-nums text-muted-foreground">
                    {valueChanged ? `was ${formatDprValue(storedValue.value)}` : ""}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TooltipProvider>
        </div>
      </DprReportCard>

      {/* The edit's actions, pinned to the bottom: what changes, the reason, Cancel and Save. The
          tint sits on an opaque card, so the table scrolling underneath never shows through. */}
      {editing ? (
        <div data-floating-nav="hide" className="sticky bottom-3 z-10 rounded-2xl bg-card shadow-lg">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
            <DprGradientChip
              icon={Pencil}
              colours={["#a78bfa", "#7c3aed"]}
              className="h-[34px] w-[34px] rounded-[11px]"
              iconClassName="h-4 w-4"
            />
            <span className="min-w-0 text-sm font-bold text-violet-950 sm:whitespace-nowrap">
              {plan.changeCount > 0 ? changeSummary(plan) : "No changes yet."}
            </span>
            <Input
              aria-label="Reason for the change"
              aria-invalid={attempted && reasonMissing ? true : undefined}
              placeholder={plan.needsReason ? "Reason for the change (needed)" : "Reason for the change"}
              className={cn(
                "h-[var(--control-h,2.5rem)] min-w-[14rem] flex-1 rounded-[11px] bg-card",
                attempted && reasonMissing && "border-rose-300",
              )}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="rounded-[11px] font-extrabold"
                disabled={isSaving}
                onClick={() => onModeChange("view")}
              >
                Cancel
              </Button>
              <Button
                className="keep-light rounded-[11px] font-extrabold text-white shadow-md hover:brightness-105"
                style={{ backgroundImage: "linear-gradient(135deg, #818cf8, #4f46e5)" }}
                disabled={isSaving || plan.changeCount === 0}
                onClick={() => void handleSave()}
              >
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save changes
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <DprBoqLinePickerDialog
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        title="Add BOQ lines to this record"
        description={`${record.scope} lines not in the record yet. Each joins with a blank quantity for you to fill.`}
        emptyText={`Every ${record.scope} BOQ line is already in this record.`}
        candidates={candidates}
        decimalsFor={data.decimalsFor}
        balanceOf={(item) => {
          if (!(item.boqQty > 0)) return null;
          return item.boqQty - actuals.total(item.id);
        }}
        onAdd={(ids) =>
          setAdded((previous) => [...previous, ...ids.map((boqItemId) => ({ boqItemId, qty: "", remarks: "" }))])
        }
      />

      <ConfirmDialog
        open={isConfirmingDelete}
        onOpenChange={(open) => (!open ? setIsConfirmingDelete(false) : undefined)}
        destructive
        loading={isDeleting}
        title="Delete this projection record?"
        description={`${record.scope} · ${periodLabel} ${formatDisplayDate(record.startDate)} – ${formatDisplayDate(
          record.endDate,
        )} · ${plural(lineCount, "BOQ line")}. Their planned quantities leave every report, including past periods.`}
        confirmLabel="Delete record"
        onConfirm={handleDelete}
      />
    </div>
  );
}

/** BOQ qty, done to date and done in the record's period — the same three cells on every row. */
function BoqFigures({
  item,
  decimals,
  done,
  doneInPeriod,
}: {
  item: DprBoqItem | undefined;
  decimals: number;
  done: number;
  doneInPeriod: number;
}) {
  const boqQty = item?.boqQty ?? 0;
  return (
    <>
      <TableCell className="truncate text-right text-sm tabular-nums">
        {boqQty > 0 ? formatQtyAt(boqQty, decimals) : "—"}
      </TableCell>
      <TableCell className={cn("truncate text-right text-sm tabular-nums", done > 0 && "font-bold text-emerald-600")}>
        {formatQtyAt(done, decimals)}
      </TableCell>
      <TableCell className={cn("truncate text-right text-sm tabular-nums", doneInPeriod > 0 && "font-bold text-emerald-600")}>
        {formatQtyAt(doneInPeriod, decimals)}
      </TableCell>
    </>
  );
}

/** A quantity box, green once it passes every check, amber with warnings, rose with an error. */
function QtyInput({
  label,
  value,
  decimals,
  hasErrors,
  hasWarnings,
  passed,
  problems,
  onChange,
}: {
  label: string;
  value: string;
  decimals: number;
  hasErrors: boolean;
  hasWarnings: boolean;
  passed: boolean;
  problems: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      {hasErrors || hasWarnings ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Problems: ${label}`}
              className={cn("shrink-0 rounded-full", hasErrors ? "text-destructive" : "text-amber-600 dark:text-amber-400")}
            >
              {hasErrors ? <CircleAlert className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            {problems.map((message) => (
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
        aria-label={label}
        aria-invalid={hasErrors ? true : undefined}
        // Dark text is set explicitly: the dark-compat layer leaves text alone beside a -300 border.
        className={cn(
          "h-8 w-full min-w-0 rounded-[10px] bg-muted/40 text-right font-extrabold tabular-nums",
          hasErrors
            ? "border-rose-300 bg-rose-50 text-rose-700 dark:text-rose-300"
            : hasWarnings
              ? "border-amber-300 bg-amber-50 text-amber-700 dark:text-amber-300"
              : passed
                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:text-emerald-300"
                : "",
        )}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** "Baseline", or R2 with the history on hover; "R3 on save" while a change is pending. */
function RevisionPill({
  target,
  slNo,
  decimals,
  pending,
}: {
  target: DprTarget;
  slNo: string;
  decimals: number;
  pending: boolean;
}) {
  const revisionNo = target.revisionNo ?? 0;
  if (pending) return <DprReportPill tone="warning">R{revisionNo + 1} on save</DprReportPill>;
  if (revisionNo === 0) return <DprReportPill tone="neutral">Baseline</DprReportPill>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Revision history for ${slNo || "this line"}`}
        >
          <DprReportPill tone="warning">
            <History className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />R{revisionNo}
          </DprReportPill>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1 text-xs">
        <span className="block">
          Baseline {formatQtyAt(dprNumber(target.baselineQty ?? target.plannedQty), decimals)}
        </span>
        {(target.revisions ?? []).map((entry) => (
          <span key={entry.revisionNo} className="block">
            <span className="font-medium">R{entry.revisionNo}</span>: {formatQtyAt(dprNumber(entry.fromQty), decimals)} →{" "}
            {formatQtyAt(dprNumber(entry.toQty), decimals)} · {entry.reason}
            {entry.changedByName ? ` · ${entry.changedByName}` : ""}
            {entry.changedAt ? ` · ${formatDisplayDate(String(entry.changedAt).slice(0, 10))}` : ""}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
