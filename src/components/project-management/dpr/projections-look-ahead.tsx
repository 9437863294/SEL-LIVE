"use client";

/**
 * Six-week look-ahead — planned quantity per BOQ line per week, from last week to five weeks out,
 * with work done for weeks that have started. A week that has not ended can be planned straight
 * from its cell: an existing weekly projection is revised, otherwise a weekly one is added and
 * takes that week's days from any longer projection around it.
 *
 * Laid out after the user's mock-up (`sel-projections-colour`): three figures (the window, the
 * lines shown, how the current week stands), the week grid with each planned figure on a violet
 * chip that deepens with the quantity and a done chip under it, and the current week's findings.
 * Every figure is one line's own, in its own unit — lines are never added together.
 */

import { useMemo, useState, type CSSProperties } from "react";
import { AlertTriangle, CalendarDays, CalendarRange, CheckCircle2, Plus, Target, TrendingDown } from "lucide-react";
import type { DprScope, DprTarget } from "@/lib/project-management-dpr";
import { buildDprLookAhead, dprShortDate, type DprLookAheadWeek } from "@/lib/project-management-dpr-plan";
import {
  buildDprLookAheadChecks,
  dprLookAheadShortfall,
  dprLookAheadWindow,
} from "@/lib/project-management-dpr-lookahead-checks";
import type { DprBoqItem } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprBoqPicker,
  DprScopeTabs,
  formatQtyAt,
  formatRangeCompact,
} from "@/components/project-management/dpr/dpr-shell";
import { DprIndentedText, breakdownTitle } from "@/components/project-management/dpr/dpr-indent";
import type { ProjectionsContext } from "@/components/project-management/dpr/projections-shared";
import {
  DprFigureTile,
  DprReportCallout,
  DprReportCard,
  DprReportZero,
  DprSlNoPill,
} from "@/components/project-management/dpr/reports-parts";
import { InfoTip } from "@/components/shared/info-tip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const CARD = ["#6ee7b7", "#059669"] as const;
const CHECKS = ["#fda4af", "#e11d48"] as const;

/** A planned figure's chip: violet, deeper the more of the line's busiest week it is. */
const plannedChip = (planned: number, rowMax: number) => ({
  backgroundColor: `rgba(124, 58, 237, ${(0.08 + 0.37 * Math.min(1, planned / (rowMax || 1))).toFixed(3)})`,
});

export function ProjectionLookAhead({
  context,
  onRevise,
  onPlanWeek,
}: {
  context: ProjectionsContext;
  onRevise: (target: DprTarget) => void;
  onPlanWeek: (item: DprBoqItem, week: DprLookAheadWeek) => void;
}) {
  const { data, today, canEdit } = context;
  const [scope, setScope] = useState<DprScope | "All">("All");
  /** Lines added by hand, so a line with nothing planned yet can be planned from here too. */
  const [extraIds, setExtraIds] = useState<string[]>([]);

  const lookAhead = useMemo(
    () =>
      buildDprLookAhead({
        items: data.boqItems,
        entries: data.entries,
        plan: data.plan,
        today,
        scope: scope === "All" ? undefined : scope,
      }),
    [data.boqItems, data.entries, data.plan, today, scope],
  );

  const rows = useMemo(() => {
    const shown = new Set(lookAhead.rows.map((row) => row.item.id));
    const extras = extraIds
      .filter((id) => !shown.has(id))
      .map((id) => data.boqItems.find((item) => item.id === id))
      .filter((item): item is DprBoqItem => Boolean(item) && (scope === "All" || item!.scope === scope))
      .map((item) => ({
        item,
        cells: lookAhead.weeks.map((week) => ({ planned: 0, done: week.started ? 0 : null })),
      }));
    return [...lookAhead.rows, ...extras];
  }, [lookAhead, extraIds, data.boqItems, scope]);

  const pickable = useMemo(() => {
    const shown = new Set(rows.map((row) => row.item.id));
    return data.boqItems.filter(
      (item) => !shown.has(item.id) && (scope === "All" || item.scope === scope),
    );
  }, [data.boqItems, rows, scope]);

  /** The six weeks' span and the week holding today. */
  const frame = dprLookAheadWindow(lookAhead.weeks);
  const shortfall = useMemo(() => dprLookAheadShortfall(rows, lookAhead.weeks), [rows, lookAhead.weeks]);
  const checks = useMemo(
    () => buildDprLookAheadChecks(rows, lookAhead.weeks, data.decimalsFor),
    [rows, lookAhead.weeks, data.decimalsFor],
  );
  const plannedThisWeek = useMemo(() => {
    const index = lookAhead.weeks.findIndex((week) => week.isCurrent);
    return index >= 0 && rows.some((row) => (row.cells[index]?.planned ?? 0) > 0);
  }, [rows, lookAhead.weeks]);

  const openCell = (item: DprBoqItem, week: DprLookAheadWeek) => {
    const weekly = data.targets.find(
      (target) =>
        target.boqItemId === item.id &&
        target.periodType === "Week" &&
        target.startDate === week.startDate &&
        target.endDate === week.endDate,
    );
    if (weekly) onRevise(weekly);
    else onPlanWeek(item, week);
  };

  const currentLabel = frame.current ? dprShortDate(frame.current.startDate) : "";
  const shortDecimals = data.decimalsFor(shortfall?.unit ?? "");

  return (
    <div className="space-y-4">
      {/* Three figures, three across on a wide screen. */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <DprFigureTile
          icon={CalendarDays}
          colours={CARD}
          label="Window"
          value={frame.startDate ? `${dprShortDate(frame.startDate)} – ${dprShortDate(frame.endDate)}` : "—"}
          valueClassName="text-xl"
          detail={`six weeks${currentLabel ? ` · current week ${currentLabel}` : ""}`}
        />
        <DprFigureTile
          icon={Target}
          colours={["#c4b5fd", "#7c3aed"]}
          label="Lines in look-ahead"
          value={String(rows.length)}
          detail={canEdit && pickable.length > 0 ? "add more below" : "planned or worked in these weeks"}
        />
        {shortfall ? (
          <DprFigureTile
            icon={TrendingDown}
            colours={CHECKS}
            label={`Week ${currentLabel}`}
            alert="danger"
            value={`${formatQtyAt(shortfall.done, shortDecimals)}${shortfall.unit ? ` ${shortfall.unit}` : ""}`}
            detail={`done on ${shortfall.slNo ? `item ${shortfall.slNo}` : "this line"} vs ${formatQtyAt(shortfall.planned, shortDecimals)} planned`}
          />
        ) : (
          <DprFigureTile
            icon={CheckCircle2}
            colours={["#6ee7b7", "#059669"]}
            label={currentLabel ? `Week ${currentLabel}` : "This week"}
            value={plannedThisWeek ? "On plan" : "—"}
            valueClassName={plannedThisWeek ? "text-emerald-600" : undefined}
            detail={plannedThisWeek ? "every line at or above this week’s plan" : "nothing planned this week"}
          />
        )}
      </section>

      <DprReportCard
        icon={CalendarRange}
        colours={CARD}
        title="Six-week look-ahead"
        subtitle="Planned quantity per week · deeper colour = more planned"
        aside={
          <>
            <span className="flex flex-wrap items-center gap-3 text-[11.5px] font-bold text-muted-foreground">
              <Swatch style={{ backgroundColor: "rgba(124, 58, 237, 0.3)" }} label="Planned" />
              <Swatch className="bg-emerald-100" label="Done ≥ plan" />
              <Swatch className="bg-rose-100" label="Done < plan" />
              <InfoTip label="About the look-ahead">
                Planned quantity per week, whatever period each projection was set at, with work
                done shown for weeks that have started. Click a week that has not ended to plan it:
                a weekly projection takes those days from a longer one instead of adding to it.
              </InfoTip>
            </span>
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
          <DprReportZero
            icon={CalendarRange}
            colours={CARD}
            glow={["rgba(110, 231, 183, 0.55)", "rgba(196, 181, 253, 0.5)"]}
            title="Nothing planned or done in these six weeks"
            text={
              canEdit
                ? "Add a BOQ line below to plan a week, or use “Plan several lines”."
                : "Projections set for these weeks will show here."
            }
          />
        ) : (
          // One line per BOQ line, all of it inside the table: fixed columns, a bounded height
          // under a pinned header, and a narrow screen scrolls it sideways. A started week's cell
          // carries its planned chip with the done chip under it, so every row has one height.
          <Table stickyHeader containerClassName="max-h-[65vh]" className="min-w-[1252px] table-fixed">
            <colgroup>
              <col className="w-[84px]" />
              <col />
              <col className="w-[80px]" />
              {lookAhead.weeks.map((week) => (
                <col key={week.startDate} className="w-[120px]" />
              ))}
              <col className="w-[108px]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="truncate">SL No</TableHead>
                <TableHead className="truncate">BOQ line</TableHead>
                <TableHead className="truncate">Unit</TableHead>
                {lookAhead.weeks.map((week) => (
                  <TableHead
                    key={week.startDate}
                    className={cn("whitespace-nowrap text-right", week.isCurrent && "bg-violet-50 text-violet-700")}
                    title={`${formatRangeCompact(week.startDate, week.endDate)}${week.isCurrent ? " (this week)" : ""}`}
                  >
                    {/* The current week is marked by its tinted column, not by a longer heading. */}
                    {week.label}
                  </TableHead>
                ))}
                <TableHead className="whitespace-nowrap bg-violet-50 text-right text-violet-700" title="Planned over the six weeks">
                  6-wk total
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ item, cells }) => {
                const decimals = data.decimalsFor(item.unit);
                const rowMax = Math.max(0, ...cells.map((cell) => cell.planned));
                const total = cells.reduce((sum, cell) => sum + cell.planned, 0);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="py-1.5">
                      <DprSlNoPill slNo={item.boqSlNo} seed={item.id} />
                    </TableCell>
                    <TableCell className="text-sm" title={breakdownTitle(item)}>
                      <DprIndentedText text={item.description} depth={item.depth ?? 0} />
                    </TableCell>
                    <TableCell className="truncate text-sm" title={item.unit}>
                      {item.unit || "—"}
                    </TableCell>
                    {cells.map((cell, index) => {
                      const week = lookAhead.weeks[index]!;
                      const editable = canEdit && !week.ended;
                      const planned = cell.planned > 0 ? formatQtyAt(cell.planned, decimals) : null;
                      const done = cell.done !== null ? formatQtyAt(cell.done, decimals) : null;
                      const doneTone =
                        cell.done === null
                          ? null
                          : cell.done <= 0
                            ? "bg-muted text-muted-foreground"
                            : cell.planned <= 0 || cell.done >= cell.planned
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-rose-100 text-rose-700";
                      const title = `Planned ${planned ?? "—"}${done !== null ? ` · done ${done}` : ""}${
                        editable ? " · click to plan this week" : ""
                      }`;
                      const content = (
                        <span className="flex flex-col items-end gap-0.5">
                          {planned ? (
                            <b
                              className="max-w-full truncate rounded-lg px-2 py-px text-sm font-extrabold tabular-nums text-foreground"
                              style={plannedChip(cell.planned, rowMax)}
                            >
                              {planned}
                            </b>
                          ) : (
                            <span className="px-2 text-sm font-bold text-muted-foreground/60">—</span>
                          )}
                          {done !== null && doneTone ? (
                            <span
                              className={cn(
                                "max-w-full truncate whitespace-nowrap rounded-full px-1.5 text-[10.5px] font-extrabold tabular-nums",
                                doneTone,
                              )}
                            >
                              {done} done
                            </span>
                          ) : null}
                        </span>
                      );
                      return (
                        <TableCell
                          key={week.startDate}
                          className={cn("p-1 text-right", week.isCurrent && "bg-violet-50")}
                        >
                          {editable ? (
                            <button
                              type="button"
                              title={title}
                              onClick={() => openCell(item, week)}
                              aria-label={`Plan ${item.boqSlNo || "this line"} for ${week.label}`}
                              className="flex min-h-[2.75rem] w-full items-center justify-end rounded-md px-1.5 py-1 text-right transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {content}
                            </button>
                          ) : (
                            <div className="flex min-h-[2.75rem] items-center justify-end px-1.5 py-1" title={title}>
                              {content}
                            </div>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="truncate bg-violet-50 text-right text-sm font-extrabold tabular-nums text-violet-900">
                      {total > 0 ? formatQtyAt(total, decimals) : <span className="font-bold text-muted-foreground/60">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {canEdit && pickable.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-border/60 bg-muted/30 px-4 py-3 sm:px-5">
            <span className="flex shrink-0 items-center gap-1.5 text-sm font-extrabold text-emerald-700">
              <Plus className="h-4 w-4" aria-hidden="true" /> Plan a line not shown
            </span>
            <DprBoqPicker
              compact
              items={pickable}
              value=""
              onChange={(id) => setExtraIds((previous) => [...previous, id])}
              placeholder="Choose a BOQ line to add to the look-ahead"
              ariaLabel="Add a BOQ line to the look-ahead"
              className="min-w-[16rem] flex-1 sm:max-w-xl"
            />
          </div>
        ) : null}
      </DprReportCard>

      {!data.isLoading && rows.length > 0 ? (
        <DprReportCard icon={AlertTriangle} colours={CHECKS} title="Worth checking" subtitle="From the figures above">
          <div className="grid grid-cols-1 gap-3 p-4 sm:p-5 md:grid-cols-3">
            {checks.length > 0 ? (
              checks.map((check) => (
                <DprReportCallout key={check.key} tone={check.tone} title={check.title} mark={check.mark}>
                  {check.detail}
                </DprReportCallout>
              ))
            ) : (
              <DprReportCallout tone="success" title="Nothing stands out">
                {frame.current
                  ? `No line is behind or ahead of its plan for week ${currentLabel}, and nothing was done without a plan.`
                  : "None of these weeks is the current one."}
              </DprReportCallout>
            )}
          </div>
        </DprReportCard>
      ) : null}
    </div>
  );
}

function Swatch({ label, className, style }: { label: string; className?: string; style?: CSSProperties }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className={cn("h-2.5 w-2.5 rounded-[3px]", className)} style={style} aria-hidden="true" />
      {label}
    </span>
  );
}
