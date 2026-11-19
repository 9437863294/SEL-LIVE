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
  ArrowRight,
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
import { JMC_MAIN_CLASS } from "@/components/jmc/jmc-page-shell";
import { JmcDashboardCharts } from "@/components/jmc/jmc-dashboard-charts";
import {
  formatJmcAmount,
  type JmcDashboardReading,
} from "@/lib/project-management-jmc-dashboard";
import { cn } from "@/lib/utils";

/**
 * The band colours a stage card takes, by its position in the run — the mock-up's emerald → cyan →
 * blue → violet, continuing into amber and rose so a workflow with more stages than the mock-up
 * drew still reads as one sequence rather than running out of colours.
 */
export const JMC_STAGE_COLOURS: ReadonlyArray<readonly [string, string]> = [
  ["#6ee7b7", "#059669"],
  ["#67e8f9", "#0891b2"],
  ["#93c5fd", "#2563eb"],
  ["#c4b5fd", "#7c3aed"],
  ["#fcd34d", "#d97706"],
  ["#f9a8d4", "#db2777"],
];

/**
 * Column counts as literal classes rather than a built string, because Tailwind only emits the
 * classes it can find written out in the source.
 */
const FLOW_COLUMNS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

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

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-2.5 mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 px-0.5">
      <span className="text-[15px] font-extrabold">{title}</span>
      <span className="text-xs font-semibold text-muted-foreground">{hint}</span>
      <span className="h-px min-w-8 flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  note,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note?: string;
  tone: readonly [string, string];
}) {
  return (
    <Card className="overflow-hidden border-border/60">
      <CardContent className="flex items-center gap-3.5 p-4">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white shadow-md"
          style={{ backgroundImage: `linear-gradient(140deg, ${tone[0]}, ${tone[1]})` }}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-muted-foreground">{label}</p>
          <p className="truncate text-xl font-extrabold leading-tight">{value}</p>
          {note ? <p className="truncate text-[11.5px] text-muted-foreground">{note}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function StageCard({
  stage,
  index,
  total,
  joined,
}: {
  stage: JmcDashboardStage;
  index: number;
  total: number;
  /** False when the run is too long to sit on one row, where a joining arrow would mislead. */
  joined: boolean;
}) {
  const [light, strong] = JMC_STAGE_COLOURS[index % JMC_STAGE_COLOURS.length]!;
  const Icon = stage.icon;

  return (
    <div className="relative">
      <Link href={stage.href} className="block h-full no-underline">
        <div className="group flex h-full flex-col overflow-hidden rounded-[22px] border bg-card text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
          <div
            className="relative h-[86px]"
            style={{
              backgroundImage: `radial-gradient(220px 120px at 100% 0%, rgba(255, 255, 255, 0.33), transparent 70%), linear-gradient(135deg, ${light}, ${strong})`,
            }}
          >
            <span className="absolute left-[18px] top-3.5 rounded-full border border-white/35 bg-white/20 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-white">
              Stage {index + 1}
            </span>
            <span className="absolute right-[18px] top-3 text-right text-white">
              <span className="block text-2xl font-extrabold leading-none">{stage.waiting}</span>
              <span className="block text-[10.5px] font-bold uppercase tracking-wide opacity-90">
                waiting
              </span>
            </span>
            <span
              className="absolute -bottom-6 left-[18px] grid h-[54px] w-[54px] place-items-center rounded-[17px] border bg-background shadow-lg"
              style={{ color: strong }}
              aria-hidden="true"
            >
              <Icon className="h-6 w-6" />
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-1.5 px-[18px] pb-4 pt-[34px]">
            <span className="text-base font-extrabold leading-snug">{stage.name}</span>
            <p className="text-[12.5px] text-muted-foreground">
              {stage.waiting === 0
                ? "Nothing waiting here."
                : `${formatJmcAmount(stage.waitingValue)} held at this step.`}
            </p>
            <div
              className="mt-auto flex items-center gap-2 pt-3 text-[12.5px] font-extrabold"
              style={{ color: strong }}
            >
              {stage.cleared} cleared
              <span className="grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-muted transition-transform duration-200 group-hover:translate-x-0.5">
                <ArrowRight className="h-[15px] w-[15px]" />
              </span>
            </div>
          </div>
        </div>
      </Link>
      {/* The joint between one stage and the next. It is centred in the 34px gap, so it holds for
          any number of stages — and it only exists at `lg`, where the run is a single row; once
          the cards wrap, an arrow pointing off the end of a row would be a lie. */}
      {joined && index < total - 1 ? (
        <span
          className="pointer-events-none absolute -right-[30px] top-[73px] hidden h-[26px] w-[26px] place-items-center rounded-full border border-emerald-200 bg-background text-emerald-600 shadow-sm lg:grid"
          aria-hidden="true"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </div>
  );
}

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
  // Beyond six the run no longer fits one row at `lg`: the cards fall into a four-column grid, and
  // the joining arrows and the progress track — both of which describe a single left-to-right
  // sequence — would then point at nothing. They are dropped rather than drawn wrongly.
  const singleRow = stages.length > 0 && stages.length <= 6;
  const columns = FLOW_COLUMNS[stages.length] ?? "lg:grid-cols-4";

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
            <StatTile
              icon={Layers}
              label="Certificates raised"
              value={String(reading.count)}
              note={`${reading.inProgress} still in the workflow`}
              tone={["#6ee7b7", "#059669"]}
            />
            <StatTile
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
            <StatTile
              icon={IndianRupee}
              label="Certified value"
              value={formatJmcAmount(reading.certifiedValue)}
              note={`of ${formatJmcAmount(reading.totalValue)} measured`}
              tone={["#c4b5fd", "#7c3aed"]}
            />
            <StatTile
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

          <SectionHeading
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
            <>
              <section className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-[34px]", columns)}>
                {stages.map((stage, index) => (
                  <StageCard
                    key={stage.id}
                    stage={stage}
                    index={index}
                    total={stages.length}
                    joined={singleRow}
                  />
                ))}
              </section>

              {singleRow && stages.length > 1 ? (
                <>
                  <div className="mt-3.5 hidden px-1.5 lg:flex" aria-hidden="true">
                    {stages.map((stage, index) => {
                      const [light, strong] =
                        JMC_STAGE_COLOURS[index % JMC_STAGE_COLOURS.length]!;
                      return (
                        <span
                          key={stage.id}
                          className={cn(
                            "h-1.5 flex-1",
                            index === 0 && "rounded-l-full",
                            index === stages.length - 1 && "rounded-r-full",
                          )}
                          style={{ backgroundImage: `linear-gradient(90deg, ${light}, ${strong})` }}
                        />
                      );
                    })}
                  </div>
                  <div
                    className={cn(
                      "mt-1.5 hidden grid-cols-1 px-1.5 text-[11px] font-extrabold lg:grid lg:gap-[34px]",
                      columns,
                    )}
                    aria-hidden="true"
                  >
                    {stages.map((stage, index) => (
                      <span
                        key={stage.id}
                        className="truncate"
                        style={{ color: JMC_STAGE_COLOURS[index % JMC_STAGE_COLOURS.length]![1] }}
                      >
                        {stage.name}
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}

          <SectionHeading title="Over time" hint="The last six months" />
          <JmcDashboardCharts months={reading.months} />

          <SectionHeading title="Latest certificates" hint="The five most recently raised" />
          <RecentList recent={recent} logHref={logHref} />
        </>
      )}
    </main>
  );
}
