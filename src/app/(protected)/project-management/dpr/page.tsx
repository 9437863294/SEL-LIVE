"use client";

/**
 * Daily Progress — the module's dashboard.
 *
 * Figures and charts for the chosen scope and period, read from the register through the planning
 * engine (`src/lib/project-management-dpr-plan.ts`) and the dashboard's own builders
 * (`src/lib/project-management-dpr-dashboard.ts`). Projections are spread over working days, the
 * shorter of two overlapping projections owns the shared days, and quantities in different units
 * are never added: anything read across lines is each line's share of its own plan —
 * value-weighted when every line has a BOQ rate, the average of line percentages otherwise.
 *
 * Only real register data is shown. Drafts are not counted anywhere; the filing calendar is the one
 * place a draft appears, as a draft.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  BarChart3,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  HardHat,
  LineChart as LineChartIcon,
  ListChecks,
  Target,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DPR_BASE_PATH,
  DPR_PERMISSION_RESOURCE,
  DPR_SCOPES,
  buildDprHindrances,
  daysInRange,
  type DprPeriodType,
  type DprScope,
} from "@/lib/project-management-dpr";
import {
  buildDprBoard,
  buildDprShareTrend,
  dprCalendar,
  dprShortDate,
  isValidRange,
} from "@/lib/project-management-dpr-plan";
import {
  buildDprComingUp,
  buildDprDiaryDays,
  buildDprFilingCalendar,
  buildDprScopeSplit,
  dprProgressAt,
  furthestBehind,
  lineAchievementBars,
} from "@/lib/project-management-dpr-dashboard";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprAccessDenied,
  DprHeader,
  DprLoadingState,
  DprPageShell,
  DprPeriodPicker,
  DprProjectNotFound,
  DprScopeTabs,
  DprStatTile,
  defaultPeriodSelection,
  dprHref,
  formatDisplayDate,
  formatPct,
  formatQtyAt,
  resolvePeriodRange,
  todayIso,
  type DprPeriodSelection,
} from "@/components/project-management/dpr/dpr-shell";
import {
  DprDashboardCard,
  DprDiaryCharts,
  DprLineAchievementChart,
  DprSCurveChart,
  DprShareBarsChart,
  type DprShareBar,
} from "@/components/project-management/dpr/dashboard-charts";
import { DprFilingCalendarView } from "@/components/project-management/dpr/dashboard-calendar";
import {
  DprComingUpTable,
  DprFurthestBehindList,
  DprHindranceList,
  DprScopeSplitPanel,
} from "@/components/project-management/dpr/dashboard-lists";
import { DprBoardTable } from "@/components/project-management/dpr/dashboard-board-table";
import { DprDashboardHero, type DprTodaySheet } from "@/components/project-management/dpr/dashboard-hero";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Bars by day for a month or less, by week up to half a year, by month beyond. */
const shareGranularity = (days: number): DprPeriodType =>
  days <= 31 ? "Day" : days <= 183 ? "Week" : "Month";

export default function DailyProgressDashboardPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);

  const {
    projectName,
    isResolving,
    notFound,
    boqItems,
    entries,
    settings,
    plan,
    projectDates,
    decimalsFor,
    isLoading,
    loadError,
  } = useDprData(mappingId, canView);

  // The Civil and Erection workspaces link in with their own scope, so arriving from one opens
  // already filtered to it rather than on a mixed view the user then has to narrow.
  const linkedScope = searchParams?.get("scope");
  const [scope, setScope] = useState<DprScope | "All">(
    linkedScope === "Civil" || linkedScope === "Erection" ? linkedScope : "All",
  );
  const [period, setPeriod] = useState<DprPeriodSelection>(() => defaultPeriodSelection("Week"));

  const today = todayIso();
  const range = useMemo(() => resolvePeriodRange(period), [period]);
  const rangeIsValid = isValidRange(range);
  const scopeFilter = scope === "All" ? undefined : scope;

  /** Scopes this project actually has BOQ lines in — both, if it has none yet. */
  const projectScopes = useMemo<DprScope[]>(() => {
    const present = DPR_SCOPES.filter((candidate) => boqItems.some((item) => item.scope === candidate));
    return present.length > 0 ? present : [...DPR_SCOPES];
  }, [boqItems]);
  const shownScopes = useMemo<DprScope[]>(
    () => (scopeFilter ? [scopeFilter] : projectScopes),
    [scopeFilter, projectScopes],
  );

  const board = useMemo(
    () => buildDprBoard({ items: boqItems, entries, plan, settings, range, scope: scopeFilter, today }),
    [boqItems, entries, plan, settings, range, scopeFilter, today],
  );
  const reading = useMemo(() => dprProgressAt(board, today), [board, today]);
  const bars = useMemo(() => lineAchievementBars(board, 10), [board]);
  const behind = useMemo(() => furthestBehind(board, 5), [board]);

  const shareBars = useMemo<DprShareBar[]>(() => {
    if (!rangeIsValid) return [];
    const granularity = shareGranularity(daysInRange(range.startDate, range.endDate));
    const { points } = buildDprShareTrend({
      items: boqItems,
      entries,
      plan,
      range,
      periodType: granularity,
      scope: scopeFilter,
    });
    return points.map((point) => ({
      label: granularity === "Day" ? dprShortDate(point.bucketStart) : point.label,
      plannedPct: point.plannedPct,
      // A bucket that has not started cannot have anything done in it yet.
      actualPct: point.bucketStart > today ? null : point.actualPct,
    }));
  }, [boqItems, entries, plan, range, rangeIsValid, scopeFilter, today]);

  const diary = useMemo(
    () => buildDprDiaryDays({ entries, range, scope: scopeFilter, today }),
    [entries, range, scopeFilter, today],
  );
  const filing = useMemo(
    () =>
      buildDprFilingCalendar({ entries, settings, range, scopes: shownScopes, today, projectDates }),
    [entries, settings, range, shownScopes, today, projectDates],
  );
  const split = useMemo(
    () =>
      scope === "All" && projectScopes.length > 1
        ? buildDprScopeSplit({ items: boqItems, entries, plan, settings, range, today })
        : [],
    [scope, projectScopes.length, boqItems, entries, plan, settings, range, today],
  );
  const comingUp = useMemo(
    () => buildDprComingUp({ items: boqItems, plan, settings, today, scope: scopeFilter }),
    [boqItems, plan, settings, today, scopeFilter],
  );
  const hindrances = useMemo(
    () => (rangeIsValid ? buildDprHindrances(entries, { scope: scopeFilter, range }) : []),
    [entries, scopeFilter, range, rangeIsValid],
  );

  /** Today's sheet per scope — the question a site office opens this screen to answer. */
  const todaySheets = useMemo<DprTodaySheet[]>(() => {
    const working = dprCalendar(settings).isWorkingDay(today);
    return shownScopes.map((candidate) => {
      const sheet = entries.find((item) => item.date === today && item.scope === candidate);
      return { scope: candidate, status: sheet?.status ?? "none", working };
    });
  }, [entries, settings, today, shownScopes]);

  if (isAuthLoading || isResolving) return <DprLoadingState blocks={2} />;
  if (!canView) {
    return <DprAccessDenied description="You do not have permission to view daily progress." />;
  }
  if (notFound) {
    return (
      <DprProjectNotFound
        description="Return to Project Management and choose a project before opening Daily Progress."
        href="/project-management"
      />
    );
  }

  const qty = (value: number, unit: string) => formatQtyAt(value, decimalsFor(unit));
  // A per-day rate is not a count, so even a whole-number unit shows it to two places.
  const rate = (value: number, unit: string) => formatQtyAt(value, Math.max(2, decimalsFor(unit)));
  const { stats } = board;
  const basisText = stats.basis === "value" ? "Weighted by BOQ value" : "Average of line percentages";
  const todayLabel =
    rangeIsValid && range.startDate <= today && today <= range.endDate ? dprShortDate(today) : null;
  const periodLabel = rangeIsValid
    ? range.startDate === range.endDate
      ? formatDisplayDate(range.startDate)
      : `${formatDisplayDate(range.startDate)} – ${formatDisplayDate(range.endDate)}`
    : "";
  const periodNote =
    rangeIsValid && range.startDate > today
      ? `This period starts on ${formatDisplayDate(range.startDate)}.`
      : "Nothing is planned in this period yet.";
  const projectionsLink = (
    <Button asChild variant="outline" size="sm">
      <Link href={dprHref(`${DPR_BASE_PATH}/targets`, mappingId)}>Open projections</Link>
    </Button>
  );

  return (
    <DprPageShell>
      <DprHeader active="dashboard" mappingId={mappingId} projectName={projectName} />

      <Card className="border-border/60">
        <CardContent className="space-y-4 p-4">
          <DprScopeTabs value={scope} onChange={setScope} includeAll />
          <DprPeriodPicker value={period} onChange={setPeriod} settings={settings} />
        </CardContent>
      </Card>

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{loadError}</CardContent>
        </Card>
      ) : null}

      {!rangeIsValid ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">Pick a valid from and to date.</CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-2xl" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Skeleton className="h-80 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        </div>
      ) : (
        <>
          <DprDashboardHero
            achievementPct={stats.achievementToDatePct}
            basis={stats.basis}
            reading={reading}
            linesBehind={stats.linesBehind}
            linesDue={stats.linesDue}
            daysReported={stats.daysReported}
            workingDaysElapsed={stats.workingDaysElapsed}
            workingDaysInPeriod={stats.workingDaysInPeriod}
            periodLabel={periodLabel}
            periodNote={periodNote}
            today={today}
            todaySheets={todaySheets}
            mappingId={mappingId}
          />

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <DprStatTile
              value={formatPct(stats.achievementFullPct)}
              label="Against the full period"
              detail={basisText}
              icon={Target}
              tone="bg-sky-500/10 text-sky-600"
            />
            <DprStatTile
              value={stats.linesBehind}
              label="Lines behind plan"
              detail={`${stats.linesDue} line${stats.linesDue === 1 ? "" : "s"} due so far`}
              icon={TriangleAlert}
              tone="bg-rose-500/10 text-rose-600"
            />
            <DprStatTile
              value={stats.linesWorked}
              label="Lines worked"
              detail={`${stats.linesInPeriod} in this period`}
              icon={ClipboardList}
              tone="bg-teal-500/10 text-teal-600"
            />
            <DprStatTile
              value={`${stats.daysReported} / ${stats.workingDaysElapsed}`}
              label="Working days reported"
              detail={`${stats.workingDaysInPeriod} working day${stats.workingDaysInPeriod === 1 ? "" : "s"} in period`}
              icon={CalendarDays}
              tone="bg-indigo-500/10 text-indigo-600"
            />
            <DprStatTile
              value={formatQtyAt(stats.manDays, 1)}
              label="Man-days"
              detail="From submitted sheets"
              icon={Users}
              tone="bg-amber-500/10 text-amber-600"
            />
            <DprStatTile
              value={formatQtyAt(stats.lostTimeHours, 1)}
              label="Lost time (hrs)"
              detail="From submitted sheets"
              icon={TriangleAlert}
              tone="bg-orange-500/10 text-orange-600"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <DprDashboardCard
              title="Cumulative progress"
              info={`Planned and actual as running shares of the period plan — each line counts as its own percentage (${
                stats.basis === "value" ? "weighted by BOQ value" : "averaged across lines"
              }), so Cum and Nos are never added together. The planned line is dashed; the actual line is stepped and stops at today.`}
              icon={LineChartIcon}
            >
              {board.curve.length > 0 ? (
                <DprSCurveChart curve={board.curve} todayLabel={todayLabel} />
              ) : (
                <PmEmptyState icon={LineChartIcon} title={periodNote} action={projectionsLink} />
              )}
            </DprDashboardCard>

            <DprDashboardCard
              title="Planned and done, bucket by bucket"
              info="Each bar is that day's (or week's) share of the period plan, so the bars across the period add up to 100% planned. Actual bars stop at today."
              icon={BarChart3}
            >
              {shareBars.some((bar) => bar.plannedPct > 0 || (bar.actualPct ?? 0) > 0) ? (
                <DprShareBarsChart data={shareBars} />
              ) : (
                <PmEmptyState icon={BarChart3} title={periodNote} action={projectionsLink} />
              )}
            </DprDashboardCard>

            <DprDashboardCard
              title="Achievement by BOQ line"
              info="Lines already due in this period, worst first: actual against plan to date. Red is behind plan, green is on plan; the dashed line is 100%. Hover a bar for the quantities."
              icon={Activity}
            >
              <DprLineAchievementChart bars={bars} formatQty={qty} />
            </DprDashboardCard>

            <DprDashboardCard
              title="Furthest behind"
              info="Lines behind their plan to date, with what each remaining working day must deliver to meet the period plan. Today counts as remaining until its sheet is submitted."
              icon={TriangleAlert}
            >
              <DprFurthestBehindList rows={behind} qty={qty} rate={rate} />
            </DprDashboardCard>

            <DprDashboardCard
              title="Daily sheets filed"
              info="One mark per scope per day: submitted, a draft, not recorded on a working day, not expected (a non-working day or outside the project's dates), or not yet due. Select a mark to open that day's sheet."
              icon={CalendarRange}
            >
              <DprFilingCalendarView calendar={filing} mappingId={mappingId} />
            </DprDashboardCard>

            <DprDashboardCard
              title="Manpower and lost time"
              info="Headcount on site and hours lost, per day, from the submitted sheets. Two charts on one time axis, so neither scale distorts the other."
              icon={Users}
            >
              <DprDiaryCharts days={diary} />
            </DprDashboardCard>
          </div>

          <DprDashboardCard
            title="Next seven days"
            info="What the projections ask of each BOQ line from today, day by day, in its own unit. Greyed days are non-working days in the project calendar."
            icon={ListChecks}
          >
            <DprComingUpTable comingUp={comingUp} qty={qty} />
          </DprDashboardCard>

          <div className={split.length > 0 ? "grid grid-cols-1 gap-4 xl:grid-cols-2" : "space-y-4"}>
            {split.length > 0 ? (
              <DprDashboardCard
                title="Civil against Erection"
                info="Each scope read on its own: achievement to date and against the full period, and how many of its lines are behind."
                icon={HardHat}
              >
                <DprScopeSplitPanel rows={split} />
              </DprDashboardCard>
            ) : null}
            <DprDashboardCard
              title="Hindrances in this period"
              info="Hindrances written on submitted sheets, newest first."
              icon={TriangleAlert}
            >
              <DprHindranceList rows={hindrances} />
            </DprDashboardCard>
          </div>

          <DprDashboardCard
            title="Planned against actual, by BOQ line"
            info="Each line is measured in its own unit. “Plan to date” runs from the period start to today. “Needed per day” is what the remaining working days must deliver to meet the period plan; today counts until its sheet is submitted."
            icon={Activity}
          >
            {board.rows.length === 0 ? (
              <PmEmptyState
                icon={Target}
                title={
                  scope === "All"
                    ? "No projections or progress in this period"
                    : `No ${scope} projections or progress in this period`
                }
                description="Add projections, or record a day's progress, to see the lines here."
                action={projectionsLink}
              />
            ) : (
              <DprBoardTable rows={board.rows} qty={qty} rate={rate} />
            )}
          </DprDashboardCard>
        </>
      )}
    </DprPageShell>
  );
}
