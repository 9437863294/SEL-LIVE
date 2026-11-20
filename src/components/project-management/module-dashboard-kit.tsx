"use client";

/**
 * The parts a Project Management module's dashboard is built from.
 *
 * Every module that owns a configured workflow opens on the same three things: a row of figures, a
 * run of stage cards saying what is sitting on each desk, and headings between the sections. They
 * were written for JMC from the user's `sel-jmc-hub` mock-up; MVAC then wanted the same grammar
 * with quantities in place of money, which is a reason to share the parts rather than to copy
 * them — a fix to the stage card's joining arrows should land on both.
 *
 * What stays with each module is the *wording*: a stage's note ("₹4.2 L held at this step",
 * "1,240 Mtr awaiting acceptance") is passed in already written, because only the module knows
 * what its quantity means.
 *
 * Colours are plain hex, never `color-mix()`: Chrome 109 on the Windows 7 PCs drops it silently
 * and these bands would come out blank.
 */

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The band colours a stage card takes, by its position in the run — the mock-up's emerald → cyan →
 * blue → violet, continuing into amber and rose so a workflow with more stages than the mock-up
 * drew still reads as one sequence rather than running out of colours.
 */
export const MODULE_STAGE_COLOURS: ReadonlyArray<readonly [string, string]> = [
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

export interface ModuleStageCard {
  id: string;
  name: string;
  /** Records sitting here, waiting for this step to be actioned. */
  waiting: number;
  /** Records that have cleared this step. */
  cleared: number;
  /** One line about what is held here, already worded by the module. */
  note: string;
  href: string;
  icon: LucideIcon;
}

export function ModuleSectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-2.5 mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 px-0.5">
      <span className="text-[15px] font-extrabold">{title}</span>
      <span className="text-xs font-semibold text-muted-foreground">{hint}</span>
      <span className="h-px min-w-8 flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

export function ModuleStatTile({
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
  stage: ModuleStageCard;
  index: number;
  total: number;
  /** False when the run is too long to sit on one row, where a joining arrow would mislead. */
  joined: boolean;
}) {
  const [light, strong] = MODULE_STAGE_COLOURS[index % MODULE_STAGE_COLOURS.length]!;
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
            <p className="text-[12.5px] text-muted-foreground">{stage.note}</p>
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
          className="pointer-events-none absolute -right-[30px] top-[73px] hidden h-[26px] w-[26px] place-items-center rounded-full border bg-background shadow-sm lg:grid"
          style={{ color: strong, borderColor: light }}
          aria-hidden="true"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </div>
  );
}

/**
 * The run of stages, with the joining arrows and the progress track beneath it.
 *
 * Beyond six the run no longer fits one row at `lg`: the cards fall into a four-column grid, and
 * the joining arrows and the track — both of which describe a single left-to-right sequence —
 * would then point at nothing. They are dropped rather than drawn wrongly.
 */
export function ModuleStageFlow({ stages }: { stages: readonly ModuleStageCard[] }) {
  const singleRow = stages.length > 0 && stages.length <= 6;
  const columns = FLOW_COLUMNS[stages.length] ?? "lg:grid-cols-4";

  return (
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
              const [light, strong] = MODULE_STAGE_COLOURS[index % MODULE_STAGE_COLOURS.length]!;
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
                style={{ color: MODULE_STAGE_COLOURS[index % MODULE_STAGE_COLOURS.length]![1] }}
              >
                {stage.name}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
