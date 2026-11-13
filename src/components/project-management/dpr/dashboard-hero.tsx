"use client";

/**
 * The dashboard's headline band: where the period stands (achievement to date, planned against done
 * by today), how many lines are behind, how many working days are reported, and whether today's
 * sheets are in. It is the house dark band (`.wd-hero`, tinted by the user's accent) and carries
 * `keep-light`, so the dark-compat layer leaves its white text alone.
 */

import Link from "next/link";
import { CalendarCheck, HardHat } from "lucide-react";
import { DPR_BASE_PATH, type DprScope, type DprStatus } from "@/lib/project-management-dpr";
import type { DprAchievementBasis } from "@/lib/project-management-dpr-plan";
import type { DprProgressReading } from "@/lib/project-management-dpr-dashboard";
import { dprHref, formatPct } from "@/components/project-management/dpr/dpr-shell";
import { DPR_STATUS_COLOURS } from "@/components/project-management/dpr/dashboard-charts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DprTodaySheet {
  scope: DprScope;
  status: DprStatus | "none";
  /** Whether today is a working day in the project calendar. */
  working: boolean;
}

const RING = { size: 112, stroke: 10 };

function AchievementRing({ value }: { value: number | null }) {
  const radius = (RING.size - RING.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(100, Math.max(0, value ?? 0)) / 100;
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg
        viewBox={`0 0 ${RING.size} ${RING.size}`}
        className="h-full w-full -rotate-90"
        role="img"
        aria-label={`Achievement to date ${formatPct(value)}`}
      >
        <circle
          cx={RING.size / 2}
          cy={RING.size / 2}
          r={radius}
          fill="none"
          stroke="rgb(255 255 255 / 0.18)"
          strokeWidth={RING.stroke}
        />
        {value !== null ? (
          <circle
            cx={RING.size / 2}
            cy={RING.size / 2}
            r={radius}
            fill="none"
            stroke="#ffffff"
            strokeWidth={RING.stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * filled} ${circumference}`}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums leading-none">{formatPct(value)}</span>
        <span className="mt-1 text-[10px] uppercase tracking-wide text-white/70">to date</span>
      </div>
    </div>
  );
}

function HeroBar({ label, value, solid }: { label: string; value: number; solid: boolean }) {
  const width = Math.min(100, Math.max(0, value));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-white/75">{label}</span>
        <span className="text-sm font-semibold tabular-nums">{formatPct(value)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
        <div
          className={cn("h-full rounded-full", solid ? "bg-white" : "bg-white/45")}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

const SHEET_STATE: Record<DprTodaySheet["status"], { label: string; colour: string }> = {
  Submitted: { label: "Submitted", colour: DPR_STATUS_COLOURS.good },
  Draft: { label: "Draft saved", colour: DPR_STATUS_COLOURS.warning },
  none: { label: "Not recorded", colour: DPR_STATUS_COLOURS.critical },
};

export function DprDashboardHero({
  achievementPct,
  basis,
  reading,
  linesBehind,
  linesDue,
  daysReported,
  workingDaysElapsed,
  workingDaysInPeriod,
  periodLabel,
  periodNote,
  today,
  todaySheets,
  mappingId,
}: {
  achievementPct: number | null;
  basis: DprAchievementBasis;
  reading: DprProgressReading | null;
  linesBehind: number;
  linesDue: number;
  daysReported: number;
  workingDaysElapsed: number;
  workingDaysInPeriod: number;
  periodLabel: string;
  /** Shown instead of the planned/done bars when there is no reading (not started, nothing planned). */
  periodNote: string;
  today: string;
  todaySheets: DprTodaySheet[];
  mappingId: string;
}) {
  return (
    <section
      className="wd-hero keep-light overflow-hidden rounded-2xl p-4 text-white shadow-sm sm:p-5"
      aria-label="Period summary"
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-center">
        <div className="flex items-center gap-4 lg:col-span-4">
          <AchievementRing value={achievementPct} />
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-semibold">Achievement to date</div>
            <div className="text-xs text-white/75">
              {basis === "value" ? "Weighted by BOQ value" : "Average of line percentages"}
            </div>
            <div className="text-xs text-white/75">
              {linesDue === 0 ? (
                "No line is due yet"
              ) : linesBehind === 0 ? (
                <>All {linesDue} lines due are on plan</>
              ) : (
                <>
                  Behind on <span className="font-semibold text-white">{linesBehind}</span> of {linesDue}{" "}
                  line{linesDue === 1 ? "" : "s"} due
                </>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3 lg:col-span-4">
          <div className="flex items-center gap-2 text-xs text-white/75">
            <CalendarCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate" title={periodLabel}>
              {periodLabel}
            </span>
          </div>
          {reading ? (
            <>
              <HeroBar label="Planned by today, of the period plan" value={reading.plannedPct} solid={false} />
              <HeroBar label="Done by today, of the period plan" value={reading.actualPct} solid />
            </>
          ) : (
            <div className="rounded-lg bg-white/10 px-3 py-2 text-xs text-white/80">{periodNote}</div>
          )}
          <div className="text-xs text-white/75 tabular-nums">
            {daysReported} of {workingDaysElapsed} working day{workingDaysElapsed === 1 ? "" : "s"} so far
            reported · {workingDaysInPeriod} in the period
          </div>
        </div>

        <div className="space-y-2 lg:col-span-4">
          <div className="text-xs font-medium uppercase tracking-wide text-white/70">Today</div>
          {todaySheets.map((sheet) => {
            const state = SHEET_STATE[sheet.status];
            const quiet = sheet.status === "none" && !sheet.working;
            return (
              <div
                key={sheet.scope}
                className="flex items-center justify-between gap-3 rounded-xl bg-white/10 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <HardHat className="h-4 w-4 shrink-0 text-white/80" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{sheet.scope}</div>
                    <div className="flex items-center gap-1.5 text-xs text-white/80">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: quiet ? "rgb(255 255 255 / 0.5)" : state.colour }}
                        aria-hidden="true"
                      />
                      {quiet ? "Not a working day" : state.label}
                    </div>
                  </div>
                </div>
                <Button
                  asChild
                  size="sm"
                  className="shrink-0 bg-white text-slate-900 hover:bg-white/90"
                >
                  <Link href={dprHref(`${DPR_BASE_PATH}/entry`, mappingId, { scope: sheet.scope, date: today })}>
                    {sheet.status === "Submitted" ? "Open" : sheet.status === "Draft" ? "Continue" : "Record"}
                  </Link>
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
