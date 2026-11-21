"use client";

/**
 * The BOQ progress report, from the user's mock-up (`sel-dpr-reports-colour`): four figures, the
 * same period in money (planned value, value done, value to date, balance value), the value scope by
 * scope when every scope is shown, a card per line with its plan, actual and share of BOQ as bars and
 * its value, the findings worth checking, and the full table (the same rows as Export CSV) underneath.
 *
 * Value = quantity × the BOQ line's rate (`project-management-dpr-values.ts`), so lines in Cum and
 * Nos add up. A line with no rate is never given a value: it is left out of the money figures and
 * counted ("1 line has no rate").
 *
 * A line's colour is decorative — one of three gradients, picked by a stable hash of its id, so it
 * never changes with the order or filter. Figures stay in text colours; status (behind, ahead,
 * achieved) is always written out beside its colour.
 */

import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Banknote,
  Check,
  IndianRupee,
  Layers,
  List,
  Scale,
  Table as TableIcon,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { DprPeriodRow, DprScope } from "@/lib/project-management-dpr";
import { dprShortDate } from "@/lib/project-management-dpr-plan";
import { buildDprProgressChecks, summariseDprProgress } from "@/lib/project-management-dpr-progress-checks";
import {
  dprPeriodRowValue,
  dprPeriodValuesByScope,
  dprUnpricedText,
  formatDprRate,
  formatDprValue,
  formatDprValueCompact,
  summariseDprPeriodValues,
  type DprPeriodRowValue,
  type DprPeriodValueSummary,
  type DprRateLookup,
} from "@/lib/project-management-dpr-values";
import { dprScopeTone, formatPct, formatQtyAt } from "@/components/project-management/dpr/dpr-shell";
import {
  DprFigureRow,
  DprFigureTile,
  DprReportCallout,
  DprReportCard,
  DprReportPill,
  DprReportZero,
  type DprGradient,
} from "@/components/project-management/dpr/reports-parts";
import { InfoTip } from "@/components/shared/info-tip";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const LINE_GRADIENTS: readonly DprGradient[] = [
  ["#c4b5fd", "#7c3aed"],
  ["#93c5fd", "#2563eb"],
  ["#6ee7b7", "#059669"],
];

/** The same line always takes the same gradient. */
const gradientFor = (id: string): DprGradient => {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return LINE_GRADIENTS[Math.abs(hash) % LINE_GRADIENTS.length];
};

/** "Items 5 · 2.2 · 7.4 +2", or `none` when the list is empty. */
const itemList = (rows: readonly DprPeriodRow[], none: string): string => {
  if (rows.length === 0) return none;
  const named = rows.slice(0, 3).map((row) => row.boqSlNo || row.erpSlNo || "—");
  const more = rows.length - named.length;
  return `${rows.length === 1 ? "Item" : "Items"} ${named.join(" · ")}${more > 0 ? ` +${more}` : ""}`;
};

const CHIP = "max-w-full truncate rounded-lg px-2 py-0.5 text-[11px] font-bold";

export function DprBoqProgressView({
  rows,
  pathOf,
  decimalsFor,
  scopeLabel,
  periodLabel,
  periodChoiceLabel,
  periodNoun,
  workingDays,
  workingDaysToDate,
  dayNoun = "working day",
  progressDays,
  fullDetail,
  rates,
  scopeOf,
  showScopes,
}: {
  /** Leaf lines, in the report's order. */
  rows: readonly DprPeriodRow[];
  /** A line's ancestors ("7.4 Superstructure"), "" for a BOQ line of its own. */
  pathOf: (id: string) => string;
  decimalsFor: (unit: string) => number;
  scopeLabel: string;
  periodLabel: string;
  periodChoiceLabel: string;
  periodNoun: string;
  /** Days a sheet was expected on in the period (recording days by the schedule), and up to today. */
  workingDays: number;
  workingDaysToDate: number;
  /** "recording day" when a weekly or specific-days schedule sets the expected days. */
  dayNoun?: string;
  /** Dates in the period, up to today, with any work recorded. */
  progressDays: number;
  /** The full table, as exported. */
  fullDetail: ReactNode;
  /** BOQ rates by line id (`buildDprRateLookup(boqItems)`), for the value figures. */
  rates: DprRateLookup;
  /** A line's scope, for the value-by-scope table. */
  scopeOf: (boqItemId: string) => DprScope | undefined;
  /** "All scopes" is chosen: show the value-by-scope table. */
  showScopes: boolean;
}) {
  if (rows.length === 0) {
    return (
      <DprReportCard
        icon={Activity}
        colours={["#6ee7b7", "#059669"]}
        title="BOQ progress by line"
        subtitle={`${scopeLabel} · ${periodChoiceLabel} · ${periodLabel}`}
      >
        <DprReportZero
          icon={Activity}
          colours={["#6ee7b7", "#059669"]}
          glow={["rgba(110, 231, 183, 0.6)", "rgba(147, 197, 253, 0.6)"]}
          title="Nothing recorded or projected for this period"
          text="Change the period or scope, or record a day's progress."
        />
      </DprReportCard>
    );
  }

  const summary = summariseDprProgress(rows);
  const checks = buildDprProgressChecks(rows, {
    workingDays,
    workingDaysToDate,
    progressDays,
    periodNoun,
    decimalsFor,
    dayNoun,
  });
  const values = summariseDprPeriodValues(rows, rates);
  const unpriced = dprUnpricedText(values.unpriced);
  const byScope = showScopes ? dprPeriodValuesByScope(rows, rates, scopeOf) : [];
  /** A compact amount, with the exact one on hover. "—" when no line in the figure has a rate. */
  const money = (value: number) =>
    values.priced === 0 ? (
      "—"
    ) : (
      <span title={formatDprValue(value)} className="tabular-nums">
        {formatDprValueCompact(value)}
      </span>
    );
  const noRates = values.priced === 0 ? "No line here has a rate" : "";

  return (
    <div className="space-y-4">
      <DprFigureRow>
        <DprFigureTile
          icon={List}
          colours={["#c4b5fd", "#7c3aed"]}
          label="BOQ lines with progress"
          value={summary.withProgress.length}
          detail={
            summary.withProgress.length === rows.length
              ? periodLabel
              : `of ${rows.length} planned or worked · ${periodLabel}`
          }
        />
        <DprFigureTile
          icon={Check}
          colours={["#6ee7b7", "#059669"]}
          label="Completed (100% BOQ)"
          value={
            <>
              {summary.completed.length}{" "}
              <span className="text-sm font-bold text-muted-foreground">/ {rows.length}</span>
            </>
          }
          detail={itemList(summary.completed, "None yet")}
        />
        <DprFigureTile
          icon={TrendingDown}
          colours={["#fda4af", "#e11d48"]}
          label="Behind plan"
          value={summary.behind.length}
          alert={summary.behind.length > 0 ? "danger" : undefined}
          detail={itemList(summary.behind, "None")}
        />
        <DprFigureTile
          icon={TrendingUp}
          colours={["#5eead4", "#0d9488"]}
          label="Ahead of plan"
          value={summary.ahead.length}
          valueClassName={summary.ahead.length > 0 ? "text-emerald-600" : undefined}
          detail={itemList(summary.ahead, "None")}
        />
      </DprFigureRow>

      {/* The same period in money: quantity × the BOQ rate, so lines in different units add up. */}
      <DprFigureRow>
        <DprFigureTile
          icon={IndianRupee}
          colours={["#93c5fd", "#2563eb"]}
          label="Planned value"
          value={money(values.planned)}
          detail={noRates || periodLabel}
        />
        <DprFigureTile
          icon={Banknote}
          colours={["#6ee7b7", "#059669"]}
          label="Value done"
          value={money(values.actual)}
          detail={
            noRates ||
            [
              values.achievementPct === null ? "nothing priced was planned" : `${formatPct(values.achievementPct)} of planned`,
              unpriced,
            ]
              .filter(Boolean)
              .join(" · ")
          }
        />
        <DprFigureTile
          icon={Layers}
          colours={["#c4b5fd", "#7c3aed"]}
          label="Value to date"
          value={money(values.toDate)}
          detail={
            noRates ||
            (values.progressPct === null ? "No BOQ value to measure against" : `${formatPct(values.progressPct)} of BOQ value`)
          }
        />
        <DprFigureTile
          icon={Scale}
          colours={["#fcd34d", "#d97706"]}
          label="Balance value"
          value={money(values.balance)}
          detail={noRates || `of ${formatDprValueCompact(values.boq)} BOQ value`}
        />
      </DprFigureRow>

      {byScope.length > 1 ? <ValueByScope rows={byScope} total={values} /> : null}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <DprReportCard
          icon={Activity}
          colours={["#6ee7b7", "#059669"]}
          title="BOQ progress by line"
          subtitle={`${scopeLabel} · ${periodChoiceLabel} · ${periodLabel}`}
          aside={
            <DprReportPill tone="neutral">
              {rows.length} line{rows.length === 1 ? "" : "s"}
            </DprReportPill>
          }
        >
          <div className="grid max-h-[70vh] gap-3 overflow-y-auto p-4 sm:p-5">
            {rows.map((row) => (
              <LineCard
                key={row.id}
                row={row}
                path={pathOf(row.id)}
                decimals={decimalsFor(row.unit)}
                value={dprPeriodRowValue(row, rates)}
              />
            ))}
          </div>
        </DprReportCard>

        <DprReportCard
          icon={AlertTriangle}
          colours={["#fcd34d", "#d97706"]}
          title="Worth checking"
          subtitle="From the figures above"
        >
          <div className="grid gap-2.5 p-4 sm:p-5">
            {checks.length === 0 ? (
              <DprReportCallout tone="success" title="Nothing stands out">
                No line is planned above its BOQ, none was worked without a plan, and progress is
                recorded on every {dayNoun} so far this {periodNoun}.
              </DprReportCallout>
            ) : (
              checks.map((check) => (
                <DprReportCallout key={check.key} tone={check.tone} title={check.title}>
                  {check.detail}
                </DprReportCallout>
              ))
            )}
          </div>
        </DprReportCard>
      </div>

      <DprReportCard icon={TableIcon} colours={["#93c5fd", "#2563eb"]} title="Full detail" subtitle="Same as Export CSV">
        {fullDetail}
      </DprReportCard>
    </div>
  );
}

/** "3", or "3 (1 no rate)" when some of the scope's lines carry no rate. */
const linesText = (lines: number, unpriced: number) => (unpriced > 0 ? `${lines} (${unpriced} no rate)` : String(lines));

/**
 * The period's value scope by scope — shown with "All scopes", when more than one scope has lines.
 * One line per scope, every figure in whole rupees, and a total row over every line in the report.
 */
function ValueByScope({ rows, total }: { rows: ReturnType<typeof dprPeriodValuesByScope>; total: DprPeriodValueSummary }) {
  const totalLines = total.priced + total.unpriced;
  const head = "whitespace-nowrap text-right";
  const cell = "whitespace-nowrap text-right text-sm tabular-nums";
  return (
    <DprReportCard
      icon={IndianRupee}
      colours={["#93c5fd", "#2563eb"]}
      title="Value by scope"
      subtitle="This period, quantity × BOQ rate"
      aside={
        <InfoTip label="About “Value by scope”">
          Each line&apos;s quantity times its BOQ rate, added up per scope. Planned value is what the
          projections put in this period; value done is what submitted sheets recorded in it; value to
          date is everything recorded up to the period&apos;s end, against the BOQ value. A line with no
          rate is left out of every figure and counted beside its scope&apos;s lines.
        </InfoTip>
      }
    >
      <Table className="min-w-full">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[72px] whitespace-nowrap">SL No</TableHead>
            <TableHead className="whitespace-nowrap">Scope</TableHead>
            <TableHead className={head}>Lines</TableHead>
            <TableHead className={head}>Planned value</TableHead>
            <TableHead className={head}>Value done</TableHead>
            <TableHead className={head} title="Value done ÷ planned value">
              Achieved
            </TableHead>
            <TableHead className={head}>Value to date</TableHead>
            <TableHead className={head}>BOQ value</TableHead>
            <TableHead className={head} title="Value to date ÷ BOQ value">
              % of BOQ
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const priced = row.priced > 0;
            return (
              <TableRow key={row.scope}>
                <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">{index + 1}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <StatusBadge status={row.scope} tone={dprScopeTone(row.scope)} />
                </TableCell>
                <TableCell className={cell}>{linesText(row.lines, row.unpriced)}</TableCell>
                <TableCell className={cell}>{priced ? formatDprValue(row.planned) : "—"}</TableCell>
                <TableCell className={`${cell} font-semibold`}>{priced ? formatDprValue(row.actual) : "—"}</TableCell>
                <TableCell className={cell}>{formatPct(row.achievementPct)}</TableCell>
                <TableCell className={cell}>{priced ? formatDprValue(row.toDate) : "—"}</TableCell>
                <TableCell className={cell}>{priced ? formatDprValue(row.boq) : "—"}</TableCell>
                <TableCell className={cell}>{formatPct(row.progressPct)}</TableCell>
              </TableRow>
            );
          })}
          <TableRow className="bg-muted/40 font-semibold">
            <TableCell className="whitespace-nowrap text-sm" />
            <TableCell className="whitespace-nowrap text-sm font-bold">Total</TableCell>
            <TableCell className={cell}>{linesText(totalLines, total.unpriced)}</TableCell>
            <TableCell className={cell}>{total.priced > 0 ? formatDprValue(total.planned) : "—"}</TableCell>
            <TableCell className={`${cell} font-bold`}>{total.priced > 0 ? formatDprValue(total.actual) : "—"}</TableCell>
            <TableCell className={cell}>{formatPct(total.achievementPct)}</TableCell>
            <TableCell className={cell}>{total.priced > 0 ? formatDprValue(total.toDate) : "—"}</TableCell>
            <TableCell className={cell}>{total.priced > 0 ? formatDprValue(total.boq) : "—"}</TableCell>
            <TableCell className={cell}>{formatPct(total.progressPct)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </DprReportCard>
  );
}

/** One line: its SL No tile, description and facts, its value, and plan / actual / share-of-BOQ bars. */
function LineCard({
  row,
  path,
  decimals,
  value,
}: {
  row: DprPeriodRow;
  path: string;
  decimals: number;
  value: DprPeriodRowValue;
}) {
  const gradient = gradientFor(row.id);
  const qty = (value: number) => formatQtyAt(value, decimals);
  const scale = Math.max(row.plannedQty, row.actualQty, 0);
  const widthOf = (value: number) => (scale > 0 ? `${Math.min(100, (Math.max(value, 0) / scale) * 100)}%` : "0%");
  const progress = row.progressPct;
  const complete = progress !== null && progress >= 100;
  const variance = row.varianceQty;
  const varianceText = `${variance > 0 ? "+" : variance < 0 ? "−" : ""}${qty(Math.abs(variance))}`;
  const achieved = row.achievementPct;
  const label = row.boqSlNo || row.erpSlNo || "—";

  return (
    <div className="relative grid min-w-0 grid-cols-[56px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 overflow-hidden rounded-[18px] border border-border/60 bg-card py-3.5 pl-5 pr-4 md:grid-cols-[64px_minmax(0,1fr)_300px]">
      <span
        className="absolute inset-y-0 left-0 w-[5px]"
        style={{ backgroundImage: `linear-gradient(180deg, ${gradient[0]}, ${gradient[1]})` }}
        aria-hidden="true"
      />
      <span
        className="keep-light flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl px-1 text-[13px] font-extrabold text-white shadow-md"
        style={{ backgroundImage: `linear-gradient(140deg, ${gradient[0]}, ${gradient[1]})` }}
        title={label}
      >
        <span className="truncate">{label}</span>
      </span>

      <div className="min-w-0">
        <div
          className="line-clamp-2 break-words text-[13.5px] font-bold leading-snug"
          title={path ? `${path} › ${row.description}` : row.description}
        >
          {row.description || "BOQ line"}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {path ? (
            <span className={cn(CHIP, "max-w-[16rem] bg-muted text-muted-foreground")} title={path}>
              in {path}
            </span>
          ) : null}
          <span className={cn(CHIP, "bg-muted text-muted-foreground")}>{row.unit || "—"}</span>
          <span className={cn(CHIP, "bg-muted text-muted-foreground")}>BOQ qty {qty(row.boqQty)}</span>
          <span className={cn(CHIP, "bg-muted text-muted-foreground")}>Balance {qty(row.balanceQty)}</span>
          <span className={cn(CHIP, "bg-muted text-muted-foreground")}>
            {row.workedDays > 0
              ? `${row.workedDays} day${row.workedDays === 1 ? "" : "s"}${row.lastWorkedDate ? ` · last ${dprShortDate(row.lastWorkedDate)}` : ""}`
              : "Not worked"}
          </span>
          <span
            className={cn(
              CHIP,
              variance < 0
                ? "bg-rose-50 text-rose-700"
                : variance > 0
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-muted text-muted-foreground",
            )}
          >
            Variance {varianceText}
          </span>
          {achieved !== null ? (
            <span
              className={cn(
                CHIP,
                achieved >= 100
                  ? "bg-emerald-50 text-emerald-700"
                  : achieved >= 50
                    ? "bg-amber-50 text-amber-700"
                    : "bg-rose-50 text-rose-700",
              )}
            >
              Achieved {formatPct(achieved)}
            </span>
          ) : null}
          {value.rate === null ? (
            <span className={cn(CHIP, "bg-muted text-muted-foreground")} title="This BOQ line carries no rate, so it has no value">
              No rate
            </span>
          ) : (
            <>
              <span className={cn(CHIP, "bg-blue-50 text-blue-700")} title={`Rate ${formatDprRate(value.rate)} per ${row.unit || "unit"}`}>
                Rate {formatDprRate(value.rate)}
              </span>
              <span
                className={cn(CHIP, "bg-blue-50 text-blue-700")}
                title={`Value done ${formatDprValue(value.actual)} · planned ${formatDprValue(value.planned)} · to date ${formatDprValue(value.toDate)} of ${formatDprValue(value.boq)}`}
              >
                Value {formatDprValue(value.actual)}
                {(value.planned ?? 0) > 0 ? ` of ${formatDprValue(value.planned)} planned` : ""}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="col-span-2 grid gap-[7px] md:col-span-1">
        <Bar label="Planned" value={qty(row.plannedQty)} width={widthOf(row.plannedQty)} fill="#cbd5e1" />
        <Bar
          label="Actual"
          value={qty(row.actualQty)}
          width={widthOf(row.actualQty)}
          fill={`linear-gradient(90deg, ${gradient[0]}, ${gradient[1]})`}
        />
        <Bar
          label="% of BOQ"
          value={formatPct(progress)}
          width={progress === null ? "0%" : `${Math.min(100, Math.max(progress, 0))}%`}
          fill={complete ? "#059669" : "#f59e0b"}
        />
      </div>
    </div>
  );
}

function Bar({ label, value, width, fill }: { label: string; value: string; width: string; fill: string }) {
  return (
    <div className="grid grid-cols-[62px_minmax(0,1fr)_58px] items-center gap-2 text-[11.5px] font-bold text-muted-foreground">
      <span className="truncate">{label}</span>
      <span className="h-[9px] overflow-hidden rounded-[5px] bg-muted" aria-hidden="true">
        <i className="block h-full rounded-[5px]" style={{ width, background: fill }} />
      </span>
      <b className="truncate text-right font-extrabold tabular-nums text-foreground" title={`${label} ${value}`}>
        {value}
      </b>
    </div>
  );
}
