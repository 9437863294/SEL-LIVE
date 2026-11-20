"use client";

/**
 * The JMC dashboard — the module's landing screen, from the user's `sel-jmc-hub` mock-up.
 *
 * The mock-up's numbered run of stage cards is kept, because it says how a certificate actually
 * moves; what it carries has changed. The cards were links into the stages, which the module's
 * sidebar now does; here each one reports how many certificates are sitting on that desk and what
 * they are worth. A module with a sidebar opens on figures, not on a page of links.
 *
 * Props only: it holds no data and reads no permissions, so the page above it keeps owning those
 * and this can be rendered from fabricated props to check a design. The stage list comes from the
 * configured workflow, so the run is however many stages this installation has, not the four the
 * mock-up happened to draw.
 *
 * Colours are plain hex and theme tokens — no `color-mix()`, which Chrome 109 on the Windows 7 PCs
 * drops silently, leaving blank backgrounds.
 */

import { type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  ClipboardList,
  FileCheck2,
  Hourglass,
  IndianRupee,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HeroBand, HERO_PRIMARY_BUTTON } from "@/components/project-management/hero-band";
import {
  MODULE_STAGE_COLOURS,
  ModuleSectionHeading,
  ModuleStageFlow,
  ModuleStatTile,
  type ModuleStageCard,
} from "@/components/project-management/module-dashboard-kit";
import { JMC_MAIN_CLASS } from "@/components/jmc/jmc-page-shell";
import { JmcDashboardCharts } from "@/components/jmc/jmc-dashboard-charts";
import {
  formatJmcAmount,
  type JmcDashboardReading,
} from "@/lib/project-management-jmc-dashboard";
import { cn } from "@/lib/utils";

/**
 * The stage band colours, now shared with the other module dashboards.
 *
 * Kept exported under this name because the JMC screens have always read it here.
 */
export const JMC_STAGE_COLOURS = MODULE_STAGE_COLOURS;

export interface JmcDashboardStage {
  id: string;
  name: string;
  /** Certificates sitting here, waiting for this step to be actioned. */
  waiting: number;
  /** Certificates that have cleared this step. */
  cleared: number;
  waitingValue: number;
  href: string;
  icon: LucideIcon;
}

export interface JmcRecentEntry {
  id: string;
  jmcNo: string;
  date: string;
  value: number;
  stage: string;
}

export interface JmcDashboardViewProps {
  back: { href: string; label: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void };
  crumbs?: readonly { label: string; href?: string }[];
  projectName: string;
  description: ReactNode;
  reading: JmcDashboardReading;
  stages: readonly JmcDashboardStage[];
  recent: readonly JmcRecentEntry[];
  logHref: string;
  create?: { href: string };
  isLoading?: boolean;
  /** Shown in place of the figures when the register could not be read. */
  loadError?: string;
}

/* ── Parts ──────────────────────────────────────────────────────────────────────────────────── */

function RecentList({ recent, logHref }: { recent: readonly JmcRecentEntry[]; logHref: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-0">
        {recent.length === 0 ? (
          <p className="p-6 text-center text-sm font-semibold text-muted-foreground">
            No certificates raised yet.
          </p>
        ) : (
          <ul className="divide-y">
            {recent.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
              >
                <span className="font-extrabold">{entry.jmcNo || "—"}</span>
                <span className="text-muted-foreground">{entry.date}</span>
                <span className="ml-auto font-semibold">{formatJmcAmount(entry.value)}</span>
                <span className="w-full text-xs text-muted-foreground sm:w-auto sm:basis-full">
                  {entry.stage}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-4 py-2.5 text-right">
          <Link href={logHref} className="text-xs font-bold text-primary hover:underline">
            Open the JMC log
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── The screen ─────────────────────────────────────────────────────────────────────────────── */

export function JmcDashboardView({
  back,
  crumbs,
  projectName,
  description,
  reading,
  stages,
  recent,
  logHref,
  create,
  isLoading,
  loadError,
}: JmcDashboardViewProps) {
  /** The stage cards, with each stage's note worded in JMC's own terms. */
  const stageCards: ModuleStageCard[] = stages.map((stage) => ({
    ...stage,
    note:
      stage.waiting === 0
        ? "Nothing waiting here."
        : `${formatJmcAmount(stage.waitingValue)} held at this step.`,
  }));

  return (
    <main className={JMC_MAIN_CLASS}>
      <HeroBand
        band="emerald"
        icon={ClipboardList}
        back={back}
        crumbs={crumbs}
        title="JMC Management"
        description={description}
        actions={
          <>
            {projectName ? (
              <span className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-3.5 py-2 font-extrabold">
                <span
                  className="h-2 w-2 rounded-full bg-yellow-300 ring-4 ring-yellow-300/25"
                  aria-hidden="true"
                />
                <span className="max-w-[12rem] truncate">{projectName}</span>
              </span>
            ) : null}
            {create ? (
              <Button asChild className={cn(HERO_PRIMARY_BUTTON, "text-emerald-900")}>
                <Link href={create.href}>Create JMC</Link>
              </Button>
            ) : null}
          </>
        }
      />

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-sm font-semibold text-muted-foreground">
            {loadError} The pages in the sidebar still work; reload to try the figures again.
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <Skeleton key={tile} className="h-[86px] rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <ModuleStatTile
              icon={Layers}
              label="Certificates raised"
              value={String(reading.count)}
              note={`${reading.inProgress} still in the workflow`}
              tone={["#6ee7b7", "#059669"]}
            />
            <ModuleStatTile
              icon={FileCheck2}
              label="Through every stage"
              value={String(reading.completed)}
              note={
                reading.count > 0
                  ? `${Math.round((reading.completed / reading.count) * 100)}% of the register`
                  : "Nothing raised yet"
              }
              tone={["#93c5fd", "#2563eb"]}
            />
            <ModuleStatTile
              icon={IndianRupee}
              label="Certified value"
              value={formatJmcAmount(reading.certifiedValue)}
              note={`of ${formatJmcAmount(reading.totalValue)} measured`}
              tone={["#c4b5fd", "#7c3aed"]}
            />
            <ModuleStatTile
              icon={Hourglass}
              label="Longest wait"
              value={
                reading.oldestWaitingDays === null ? "—" : `${reading.oldestWaitingDays} days`
              }
              note={
                reading.oldestWaitingDays === null
                  ? "Nothing outstanding"
                  : "Since the oldest open certificate was raised"
              }
              tone={["#fcd34d", "#d97706"]}
            />
          </div>

          <ModuleSectionHeading
            title="Where certificates are"
            hint={
              stages.length === 0
                ? "No workflow stages configured"
                : `Waiting at each of the ${stages.length} stages`
            }
          />
          {stages.length === 0 ? (
            <Card className="border-border/60">
              <CardContent className="p-6 text-sm font-semibold text-muted-foreground">
                This installation has no JMC workflow stages configured, so there is no run to show.
              </CardContent>
            </Card>
          ) : (
            <ModuleStageFlow stages={stageCards} />
          )}

          <ModuleSectionHeading title="Over time" hint="The last six months" />
          <JmcDashboardCharts months={reading.months} />

          <ModuleSectionHeading title="Latest certificates" hint="The five most recently raised" />
          <RecentList recent={recent} logHref={logHref} />
        </>
      )}
    </main>
  );
}
