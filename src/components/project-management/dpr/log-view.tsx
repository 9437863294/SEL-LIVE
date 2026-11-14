"use client";

/**
 * Daily Progress log — every sheet filed on this project, newest first — after the user's mock-up
 * (`sel-dpr-register-log-settings`): the headline band, four figures over the sheets shown, the
 * one-line filters, each sheet as a row with its calendar tile and counts, and what is worth a
 * second look.
 *
 * Quantities are never totalled across a sheet's lines — they are in different units — so a sheet
 * is summarised by counts (`project-management-dpr-log.ts`): lines on it, lines worked, and lines
 * that fell short of the plan snapshot taken when it was filed. Opening a row returns to the entry
 * screen for that day.
 *
 * Everything it needs comes in as props, so it renders the same from fabricated data as from the
 * register: `log/page.tsx` only resolves the project, the permissions and the loading states.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Plus,
  Users,
} from "lucide-react";
import {
  DPR_BASE_PATH,
  DPR_STATUSES,
  parseIsoDate,
  type DprEntry,
  type DprScope,
  type DprStatus,
} from "@/lib/project-management-dpr";
import { dprCalendar } from "@/lib/project-management-dpr-plan";
import {
  buildDprLogChecks,
  dprLogSheetStats,
  summariseDprLog,
  type DprLogSheetStats,
} from "@/lib/project-management-dpr-log";
import type { DprDataState } from "@/components/project-management/dpr/use-dpr-data";
import {
  DPR_TABS,
  DprPageShell,
  DprScopeTabs,
  dprHref,
  formatDisplayDate,
  formatQty,
  todayIso,
} from "@/components/project-management/dpr/dpr-shell";
import { DPR_HERO_PRIMARY, DprReportsHero } from "@/components/project-management/dpr/reports-hero";
import {
  DprFigureRow,
  DprFigureTile,
  DprReportCallout,
  DprReportCard,
  dprSlGradient,
} from "@/components/project-management/dpr/reports-parts";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const LOG_TAB = DPR_TABS.find((tab) => tab.key === "log")!;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export interface DprLogViewProps {
  /** The register as `useDprData` gives it; only these parts are read. */
  data: Pick<DprDataState, "entries" | "settings" | "isLoading" | "projectName">;
  mappingId: string;
  /** May record progress (the Add action): shows the Record progress buttons. */
  canRecord: boolean;
  /** Defaults to the real today; fixed for a test. */
  today?: string;
}

export function DprLogView({ data, mappingId, canRecord, today: todayProp }: DprLogViewProps) {
  const { entries, settings, isLoading, projectName } = data;
  const [today] = useState(() => todayProp ?? todayIso());
  const [scope, setScope] = useState<DprScope | "All">("All");
  const [status, setStatus] = useState<DprStatus | "All">("All");
  const [search, setSearch] = useState("");

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries
      .filter((entry) => (scope === "All" ? true : entry.scope === scope))
      .filter((entry) => (status === "All" ? true : entry.status === status))
      .filter((entry) => {
        if (!needle) return true;
        const haystack = [
          entry.date,
          entry.scope,
          entry.preparedByName ?? "",
          entry.remarks ?? "",
          entry.hindrances ?? "",
          ...(entry.lines ?? []).map((line) => `${line.boqSlNo} ${line.description}`),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      });
  }, [entries, scope, status, search]);

  const summary = useMemo(() => summariseDprLog(shown), [shown]);
  const checks = useMemo(
    () =>
      buildDprLogChecks(shown, {
        calendar: dprCalendar(settings),
        today,
        backdateDays: settings.backdateDays,
        scope,
      }),
    [shown, settings, today, scope],
  );

  const recordHref = dprHref(`${DPR_BASE_PATH}/entry`, mappingId);

  return (
    <DprPageShell>
      <DprReportsHero
        mappingId={mappingId}
        projectName={projectName}
        title={LOG_TAB.label}
        description={LOG_TAB.description}
        icon={LOG_TAB.icon}
        band="violet"
        actions={
          canRecord ? (
            <Button asChild className={DPR_HERO_PRIMARY}>
              <Link href={recordHref}>
                <Plus className="mr-2 h-4 w-4" /> Record progress
              </Link>
            </Button>
          ) : null
        }
      />

      {!isLoading ? (
        <DprFigureRow>
          <DprFigureTile
            icon={ClipboardList}
            colours={["#c4b5fd", "#7c3aed"]}
            label="Sheets filed"
            value={String(summary.sheets)}
            detail={
              summary.sheets === 0
                ? "none in this view"
                : summary.drafts === 0
                  ? "all submitted"
                  : `${plural(summary.drafts, "draft")} not submitted`
            }
          />
          <DprFigureTile
            icon={CheckCircle2}
            colours={["#6ee7b7", "#059669"]}
            label="Lines worked"
            value={String(summary.worked)}
            detail={`${summary.behind} behind plan`}
          />
          <DprFigureTile
            icon={Users}
            colours={["#93c5fd", "#2563eb"]}
            label="Manpower"
            value={formatQty(summary.manpower)}
            detail="across all sheets"
          />
          <DprFigureTile
            icon={Clock}
            colours={["#fda4af", "#e11d48"]}
            label="Lost hours"
            value={formatQty(summary.lostHours)}
            detail={summary.lostDays > 0 ? `on ${plural(summary.lostDays, "day")}` : "no time lost"}
          />
        </DprFigureRow>
      ) : null}

      <Card className="rounded-[20px] border-border/60 shadow-sm">
        <CardContent className="p-4">
          {/* Scope, status and search on one line at one height; it wraps only when narrow. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <DprScopeTabs value={scope} onChange={setScope} includeAll asField />
            </div>
            <div className="min-w-[11rem] space-y-1.5">
              <Label htmlFor="dpr-log-status">Status</Label>
              <Select value={status} onValueChange={(next) => setStatus(next as DprStatus | "All")}>
                <SelectTrigger id="dpr-log-status" className="text-left">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All statuses</SelectItem>
                  {DPR_STATUSES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[14rem] flex-1 space-y-1.5">
              <Label htmlFor="dpr-log-search">Find</Label>
              <Input
                id="dpr-log-search"
                placeholder="Search by date, BOQ line, recorder or remarks…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <DprReportCard
        icon={LOG_TAB.icon}
        colours={["#c4b5fd", "#7c3aed"]}
        title="Sheets"
        subtitle="Newest first"
      >
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-xl bg-muted/50" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <PmEmptyState
            icon={CalendarDays}
            title={entries.length === 0 ? "No daily progress recorded yet" : "Nothing matches these filters"}
            description={
              entries.length === 0
                ? "Record a day's work against this project's Civil or Erection BOQ lines."
                : "Clear the search or change the scope and status filters."
            }
            action={
              entries.length === 0 && canRecord ? (
                <Button asChild>
                  <Link href={recordHref}>
                    <Plus className="mr-2 h-4 w-4" /> Record progress
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="max-h-[70vh] overflow-y-auto">
            {shown.map((entry) => (
              <SheetRow key={entry.id} entry={entry} stats={dprLogSheetStats(entry)} mappingId={mappingId} />
            ))}
          </div>
        )}
      </DprReportCard>

      {!isLoading && shown.length > 0 ? (
        <DprReportCard
          icon={AlertTriangle}
          colours={["#fcd34d", "#d97706"]}
          title="Worth checking"
          subtitle="From the sheets above"
        >
          <div className="grid grid-cols-1 gap-3 p-4 sm:p-5 md:grid-cols-2">
            {checks.length === 0 ? (
              <DprReportCallout tone="success" title="Nothing stands out">
                Every sheet shown has its manpower, and no working day between them is missing a sheet.
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
    </DprPageShell>
  );
}

/* ── One sheet ──────────────────────────────────────────────────────────────────────────────── */

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** A small tinted tile: its label in the tint's own colour, the figure in text colour. */
const STAT_TINT = {
  violet: { box: "border-violet-200 bg-violet-50", label: "text-violet-700" },
  emerald: { box: "border-emerald-200 bg-emerald-50", label: "text-emerald-700" },
  slate: { box: "border-slate-200 bg-slate-50", label: "text-slate-600" },
  rose: { box: "border-rose-200 bg-rose-50", label: "text-rose-700" },
  blue: { box: "border-blue-200 bg-blue-50", label: "text-blue-700" },
  amber: { box: "border-amber-200 bg-amber-50", label: "text-amber-700" },
} as const;

function Stat({
  label,
  value,
  tint,
  note,
}: {
  label: string;
  value: string;
  tint: keyof typeof STAT_TINT;
  /** Why the tile is tinted, for a screen reader and on hover — colour is never the only signal. */
  note?: string;
}) {
  const style = STAT_TINT[tint];
  return (
    <div className={cn("min-w-0 rounded-xl border px-2.5 py-1.5", style.box)} title={note}>
      <small className={cn("block truncate text-[10.5px] font-extrabold uppercase tracking-wide", style.label)}>
        {label}
        {note ? <span className="sr-only"> — {note}</span> : null}
      </small>
      <b className="block truncate text-[17px] font-extrabold tabular-nums">{value}</b>
    </div>
  );
}

function SheetRow({ entry, stats, mappingId }: { entry: DprEntry; stats: DprLogSheetStats; mappingId: string }) {
  const date = parseIsoDate(entry.date);
  const month = date ? date.toLocaleDateString("en-IN", { month: "short" }).toUpperCase() : "";
  const weekday = date ? date.toLocaleDateString("en-IN", { weekday: "short" }).toUpperCase() : "";
  const [from, to] = dprSlGradient(entry.id || entry.date);
  const recorder = entry.preparedByName || entry.createdByName || "";
  const noCrew = stats.worked > 0 && stats.manpower === 0;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 border-b border-border/60 px-4 py-4 last:border-b-0 hover:bg-muted/30 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-5">
      <div
        className="w-[62px] overflow-hidden rounded-[14px] border border-border/70 text-center shadow-sm"
        aria-hidden="true"
      >
        <small
          className="keep-light block py-0.5 text-[10.5px] font-extrabold tracking-[0.08em] text-white"
          style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
        >
          {month}
        </small>
        <b className="block bg-card text-2xl font-extrabold leading-snug tabular-nums">{date ? date.getDate() : "—"}</b>
        <span className="block bg-card pb-0.5 text-[10.5px] font-bold text-muted-foreground">{weekday}</span>
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <b className="text-[14.5px]">{formatDisplayDate(entry.date)}</b>
          <StatusBadge status={entry.scope} tone={entry.scope === "Civil" ? "info" : "progress"} />
          <StatusBadge status={entry.status} dot />
          {recorder ? (
            <span className="ml-auto flex min-w-0 items-center gap-2 font-extrabold" title={recorder}>
              <span
                className="keep-light flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[10.5px] font-extrabold text-white"
                style={{ backgroundImage: "linear-gradient(135deg, #f472b6, #7c3aed)" }}
                aria-hidden="true"
              >
                {initialsOf(recorder)}
              </span>
              <span className="truncate">{recorder}</span>
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <Stat label="Lines" value={String(stats.lines)} tint="violet" />
          <Stat label="Worked" value={String(stats.worked)} tint="emerald" />
          <Stat
            label="Behind plan"
            value={String(stats.behind)}
            tint={stats.behind > 0 ? "rose" : "slate"}
            note={stats.behind > 0 ? "lines short of the plan" : undefined}
          />
          <Stat
            label="Manpower"
            value={formatQty(stats.manpower)}
            tint={noCrew ? "amber" : "blue"}
            note={noCrew ? "work recorded with no manpower" : undefined}
          />
          <Stat
            label="Lost hrs"
            value={formatQty(stats.lostHours)}
            tint={stats.lostHours > 0 ? "rose" : "slate"}
            note={stats.lostHours > 0 ? "time lost this day" : undefined}
          />
        </div>
      </div>

      <div className="col-span-2 justify-self-end sm:col-span-1">
        <Button
          asChild
          size="sm"
          className="keep-light h-9 rounded-[11px] border-0 font-extrabold text-white shadow-md hover:brightness-105"
          style={{ backgroundImage: "linear-gradient(135deg, #a78bfa, #7c3aed)" }}
        >
          <Link
            href={dprHref(`${DPR_BASE_PATH}/entry`, mappingId, { scope: entry.scope, date: entry.date })}
            aria-label={`Open the ${entry.scope} sheet of ${formatDisplayDate(entry.date)}`}
          >
            Open <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
