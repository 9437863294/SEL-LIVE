"use client";

/**
 * Six-week look-ahead — planned quantity per BOQ line per week, from last week to five weeks out,
 * with work done for weeks that have started. A week that has not ended can be planned straight
 * from its cell: an existing weekly projection is revised, otherwise a weekly one is added and
 * takes that week's days from any longer projection around it.
 */

import { useMemo, useState } from "react";
import { CalendarRange, Plus } from "lucide-react";
import type { DprScope, DprTarget } from "@/lib/project-management-dpr";
import { buildDprLookAhead, type DprLookAheadWeek } from "@/lib/project-management-dpr-plan";
import type { DprBoqItem } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprBoqPicker,
  DprScopeTabs,
  formatQtyAt,
  formatRangeCompact,
} from "@/components/project-management/dpr/dpr-shell";
import type { ProjectionsContext } from "@/components/project-management/dpr/projections-shared";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { SectionHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

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

  return (
    <Card className="border-border/60">
      <CardContent className="space-y-4 p-4">
        <SectionHeader
          title="Six-week look-ahead"
          icon={CalendarRange}
          descriptionAs="info"
          description="Planned quantity per week, whatever period each projection was set at, with work done shown for weeks that have started. Click a week that has not ended to plan it: a weekly projection takes those days from a longer one instead of adding to it."
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
            icon={CalendarRange}
            title="Nothing planned or done in these six weeks"
            description={
              canEdit
                ? "Add a BOQ line below to plan a week, or use “Plan several lines”."
                : "Projections set for these weeks will show here."
            }
          />
        ) : (
          // One line per BOQ line, all of it inside the table: fixed columns, a bounded height
          // under a pinned header, and a narrow screen scrolls it sideways. Each week cell is one
          // line — planned, then "done" for a week that has started — with both in its title.
          <div className="overflow-hidden rounded-lg border border-border/60">
            <Table
              stickyHeader
              containerClassName="max-h-[65vh]"
              className="min-w-[1060px] table-fixed"
            >
              <colgroup>
                <col />
                <col className="w-[88px]" />
                {lookAhead.weeks.map((week) => (
                  <col key={week.startDate} className="w-[128px]" />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="truncate">BOQ line</TableHead>
                  <TableHead className="truncate">Unit</TableHead>
                  {lookAhead.weeks.map((week) => (
                    <TableHead
                      key={week.startDate}
                      className={cn("truncate text-right", week.isCurrent && "text-primary")}
                      title={`${formatRangeCompact(week.startDate, week.endDate)}${week.isCurrent ? " (this week)" : ""}`}
                    >
                      {/* The current week is marked by its tinted column and coloured heading. */}
                      {week.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ item, cells }) => {
                  const decimals = data.decimalsFor(item.unit);
                  const boqLabel = `${item.boqSlNo ? `${item.boqSlNo} · ` : ""}${item.description || "BOQ line"}`;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="truncate text-sm" title={boqLabel}>
                        {item.boqSlNo ? <span className="font-semibold">{item.boqSlNo}</span> : null}
                        {item.boqSlNo ? " · " : null}
                        {item.description || "BOQ line"}
                      </TableCell>
                      <TableCell className="truncate text-sm" title={item.unit}>
                        {item.unit || "—"}
                      </TableCell>
                      {cells.map((cell, index) => {
                        const week = lookAhead.weeks[index]!;
                        const editable = canEdit && !week.ended;
                        const planned = cell.planned > 0 ? formatQtyAt(cell.planned, decimals) : "—";
                        const done = cell.done !== null ? formatQtyAt(cell.done, decimals) : null;
                        const title = `Planned ${planned}${done !== null ? ` · done ${done}` : ""}${
                          editable ? " · click to plan this week" : ""
                        }`;
                        const content = (
                          <span className="block truncate whitespace-nowrap">
                            <span className={cell.planned > 0 ? "font-medium" : "text-muted-foreground"}>
                              {planned}
                            </span>
                            {done !== null ? (
                              <span className="text-xs text-muted-foreground"> · {done} done</span>
                            ) : null}
                          </span>
                        );
                        return (
                          <TableCell
                            key={week.startDate}
                            className={cn("p-1 text-right text-sm tabular-nums", week.isCurrent && "bg-primary/5")}
                          >
                            {editable ? (
                              <button
                                type="button"
                                title={title}
                                onClick={() => openCell(item, week)}
                                aria-label={`Plan ${item.boqSlNo || "this line"} for ${week.label}`}
                                className="flex h-8 w-full items-center justify-end rounded-md px-2 text-right transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {content}
                              </button>
                            ) : (
                              <div className="flex h-8 items-center justify-end px-2" title={title}>
                                {content}
                              </div>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {canEdit && pickable.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
              <Plus className="h-4 w-4" /> Plan a line not shown
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
      </CardContent>
    </Card>
  );
}
