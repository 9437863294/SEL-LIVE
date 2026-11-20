"use client";

/**
 * The MVAC dashboard — the module's landing screen.
 *
 * MVAC's figures are quantities, not money: a joint acceptance certificate says how much of what
 * was received at site both sides agreed on. What it is worth is billing's question, downstream of
 * here, so nothing on this screen is in rupees.
 *
 * The furniture is the shared module-dashboard kit, the same parts JMC's dashboard is built from,
 * so the two modules read as one application. The stage run is built from the configured workflow,
 * so an installation with three or seven steps sees its own.
 *
 * Props only: it holds no data and reads no permissions, so the page above it keeps owning those
 * and this can be rendered from fabricated props to check a design.
 */

import { type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  ClipboardCheck,
  FileCheck2,
  Hourglass,
  Layers,
  PackageCheck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HeroBand, HERO_PRIMARY_BUTTON } from "@/components/project-management/hero-band";
import {
  ModuleSectionHeading,
  ModuleStageFlow,
  ModuleStatTile,
  type ModuleStageCard,
} from "@/components/project-management/module-dashboard-kit";
import {
  ModuleTrendCharts,
  type ModuleTrendMonth,
} from "@/components/project-management/module-dashboard-charts";
import {
  formatMvacQty,
  type MvacDashboardReading,
} from "@/lib/project-management-mvac-dashboard";
import { MVAC_MAIN_CLASS } from "@/components/mvac/mvac-page-shell";
import { cn } from "@/lib/utils";

export interface MvacDashboardStage {
  id: string;
  name: string;
  waiting: number;
  cleared: number;
  waitingQty: number;
  href: string;
  icon: LucideIcon;
}

export interface MvacRecentCertificate {
  id: string;
  docNumber: string;
  date: string;
  presented: number;
  accepted: number;
  vendorName: string;
  stage: string;
}

export interface MvacDashboardViewProps {
  back: { href: string; label: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void };
  crumbs?: readonly { label: string; href?: string }[];
  projectName: string;
  description: ReactNode;
  reading: MvacDashboardReading;
  stages: readonly MvacDashboardStage[];
  recent: readonly MvacRecentCertificate[];
  registerHref: string;
  create?: { href: string };
  isLoading?: boolean;
  /** Shown in place of the figures when the register could not be read. */
  loadError?: string;
}

function RecentList({
  recent,
  registerHref,
}: {
  recent: readonly MvacRecentCertificate[];
  registerHref: string;
}) {
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
                <span className="font-extrabold">{entry.docNumber || "—"}</span>
                <span className="text-muted-foreground">{entry.date}</span>
                <span className="ml-auto font-semibold tabular-nums">
                  {formatMvacQty(entry.accepted)} / {formatMvacQty(entry.presented)}
                </span>
                <span className="w-full text-xs text-muted-foreground sm:w-auto sm:basis-full">
                  {entry.vendorName} · {entry.stage}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-4 py-2.5 text-right">
          <Link href={registerHref} className="text-xs font-bold text-primary hover:underline">
            Open the MVAC register
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function MvacDashboardView({
  back,
  crumbs,
  projectName,
  description,
  reading,
  stages,
  recent,
  registerHref,
  create,
  isLoading,
  loadError,
}: MvacDashboardViewProps) {
  /** The stage cards, with each stage's note worded in MVAC's own terms. */
  const stageCards: ModuleStageCard[] = stages.map((stage) => ({
    ...stage,
    note:
      stage.waiting === 0
        ? "Nothing waiting here."
        : `${formatMvacQty(stage.waitingQty)} awaiting this step.`,
  }));

  const months: ModuleTrendMonth[] = reading.months.map((month) => ({
    key: month.key,
    label: month.label,
    count: month.raised,
    value: month.acceptedQty,
  }));

  const acceptedShare =
    reading.presentedQty > 0 ? (reading.acceptedQty / reading.presentedQty) * 100 : 0;

  return (
    <main className={MVAC_MAIN_CLASS}>
      <HeroBand
        band="rose"
        icon={ClipboardCheck}
        back={back}
        crumbs={crumbs}
        title="MVAC Management"
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
              <Button asChild className={cn(HERO_PRIMARY_BUTTON, "text-rose-900")}>
                <Link href={create.href}>Create MVAC</Link>
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
              note={
                reading.drafts > 0
                  ? `${reading.inWorkflow} in the workflow · ${reading.drafts} draft${reading.drafts === 1 ? "" : "s"}`
                  : `${reading.inWorkflow} still in the workflow`
              }
              tone={["#f9a8d4", "#db2777"]}
            />
            <ModuleStatTile
              icon={PackageCheck}
              label="Quantity accepted"
              value={formatMvacQty(reading.acceptedQty)}
              note={`of ${formatMvacQty(reading.presentedQty)} presented · ${acceptedShare.toFixed(0)}%`}
              tone={["#6ee7b7", "#059669"]}
            />
            <ModuleStatTile
              icon={FileCheck2}
              label="Signed off"
              value={String(reading.completed)}
              note={
                reading.count > 0
                  ? `${Math.round((reading.completed / reading.count) * 100)}% of the register`
                  : "Nothing raised yet"
              }
              tone={["#93c5fd", "#2563eb"]}
            />
            <ModuleStatTile
              icon={Hourglass}
              label="Longest wait"
              value={reading.oldestWaitingDays === null ? "—" : `${reading.oldestWaitingDays} days`}
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
              <CardContent className="space-y-1 p-6 text-sm text-muted-foreground">
                <p className="font-semibold">
                  This installation has no MVAC workflow configured, so there is no run to show.
                </p>
                <p>
                  Certificates are raised and signed off on the register as before. Settings ›
                  Workflow Configuration adds the stages.
                </p>
              </CardContent>
            </Card>
          ) : (
            <ModuleStageFlow stages={stageCards} />
          )}

          <ModuleSectionHeading title="Over time" hint="The last six months" />
          <ModuleTrendCharts
            months={months}
            countTitle="Certificates raised"
            countLabel="Raised"
            countEmpty="No certificates raised in the last six months."
            valueTitle="Quantity accepted"
            valueLabel="Accepted"
            valueEmpty="Nothing accepted in the last six months."
            formatValue={(value) => formatMvacQty(value)}
          />

          <ModuleSectionHeading title="Latest certificates" hint="The five most recently raised" />
          <RecentList recent={recent} registerHref={registerHref} />
        </>
      )}
    </main>
  );
}
