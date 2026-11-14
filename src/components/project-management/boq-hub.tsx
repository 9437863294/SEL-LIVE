"use client";

/**
 * The BOQ landing screen (`/project-management/boq`): the project's header, then the BOQ's life as
 * a left-to-right flow — enter it, price it, execute it, change it — and a strip saying what each
 * step is for. The page loads the project and checks permissions; this file only draws.
 */

import Link from "next/link";
import {
  ArrowRight,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  GitPullRequestArrow,
  ListPlus,
  ListTree,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";

export type BoqHubProject = {
  id: string;
  projectName: string;
  globalProjectName: string;
};

/** Live counts for the stage headings; `undefined` while loading, `null` when it could not be read. */
export type BoqHubFigures = {
  boqItems?: number | null;
  pendingVariations?: number | null;
};

export type BoqHubPermissions = {
  canImport: boolean;
  canAddManual: boolean;
  canBreakDown: boolean;
  canViewVariations: boolean;
};

/**
 * Each card's colour, spelled out as whole class names so Tailwind finds them. Plain hex `--c`
 * tokens mixed with `color-mix()` would be shorter, but Chrome 109 (the Windows 7 PCs) drops every
 * property that uses one, so the tiles and hover borders would vanish there.
 */
const ACCENTS = {
  orange: {
    bar: "bg-orange-600",
    tile: "bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
    cta: "text-orange-600 dark:text-orange-300",
    hover: "hover:border-orange-300 dark:hover:border-orange-500/50",
  },
  blue: {
    bar: "bg-blue-600",
    tile: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
    cta: "text-blue-600 dark:text-blue-300",
    hover: "hover:border-blue-300 dark:hover:border-blue-500/50",
  },
  emerald: {
    bar: "bg-emerald-600",
    tile: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
    cta: "text-emerald-600 dark:text-emerald-300",
    hover: "hover:border-emerald-300 dark:hover:border-emerald-500/50",
  },
  violet: {
    bar: "bg-violet-600",
    tile: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
    cta: "text-violet-600 dark:text-violet-300",
    hover: "hover:border-violet-300 dark:hover:border-violet-500/50",
  },
  amber: {
    bar: "bg-amber-600",
    tile: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
    cta: "text-amber-600 dark:text-amber-300",
    hover: "hover:border-amber-300 dark:hover:border-amber-500/50",
  },
} as const;

export type BoqCard = {
  title: string;
  description: string;
  cta: string;
  href: string;
  icon: LucideIcon;
  accent: keyof typeof ACCENTS;
};

export type BoqStage = {
  key: string;
  label: string;
  cards: BoqCard[];
  /** The strip under the flow: a short name and one line on what happens at this stage. */
  help: { title: string; text: string };
  /** This stage's part of the sentence beside the "BOQ workflow" heading. */
  phrase: string;
  /** A live figure beside the stage's name; `flag` when it wants somebody to act. */
  status?: { text: string; tone: "default" | "flag" };
};

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * The BOQ's life, left to right. A card the viewer may not use is left out rather than shown and
 * refused, and a stage with no cards left drops out with it — the rest renumber, so the flow never
 * shows a gap.
 */
export function buildBoqStages(
  project: BoqHubProject,
  permissions: BoqHubPermissions,
  figures: BoqHubFigures = {},
): BoqStage[] {
  const projectQuery = `project=${encodeURIComponent(project.id)}`;
  const globalProjectSlug = slugify(project.globalProjectName);
  const { canImport, canAddManual, canBreakDown, canViewVariations } = permissions;
  const { boqItems, pendingVariations } = figures;
  const count = (n: number) => n.toLocaleString("en-IN");
  // With nothing entered yet, costing and execution have nothing to work on — say so where the
  // viewer would otherwise click through to an empty screen.
  const waitingOnBoq = boqItems === 0 ? { text: "Waiting on the BOQ", tone: "default" as const } : undefined;

  const entryCards: BoqCard[] = [];
  if (canImport) {
    entryCards.push({
      title: "Import BOQ",
      description: "Upload and process a BOQ Excel file.",
      cta: "Upload Excel",
      href: `/project-management/boq/import?${projectQuery}`,
      icon: UploadCloud,
      accent: "orange",
    });
  }
  if (canAddManual) {
    entryCards.push({
      title: "Add BOQ Items",
      description: "Manually add one or more BOQ items at once.",
      cta: "Add items",
      href: `/project-management/boq/add?${projectQuery}`,
      icon: ListPlus,
      accent: "blue",
    });
  }

  const entryHelp =
    canImport && canAddManual
      ? { title: "Import or add", text: "Bring the BOQ in from Excel, or key items in by hand." }
      : canImport
        ? { title: "Import", text: "Bring the BOQ in from Excel." }
        : { title: "Add items", text: "Key the BOQ items in by hand." };

  const stages: BoqStage[] = [
    {
      key: "enter",
      label: "Enter the BOQ",
      cards: entryCards,
      help: entryHelp,
      phrase: "enter the BOQ",
      status:
        typeof boqItems !== "number"
          ? undefined
          : boqItems === 0
            ? { text: "No items yet — start here", tone: "flag" }
            : { text: `${count(boqItems)} item${boqItems === 1 ? "" : "s"}`, tone: "default" },
    },
    {
      key: "breakdown",
      label: "Break it down",
      // A client's line is what you are paid for; a sub-item is what you actually buy and build.
      // Its own right, because subdividing a line changes what every register downstream can book
      // against — and it can only be done before work starts on the line.
      cards: canBreakDown
        ? [
            {
              title: "Work Breakdown",
              description: "Split a BOQ line into the parts you buy and sub-contract.",
              cta: "Open breakdown",
              href: `/project-management/boq/breakdown?${projectQuery}`,
              icon: ListTree,
              accent: "amber",
            },
          ]
        : [],
      help: {
        title: "Work Breakdown",
        text: "Break a coarse line — “Earthing system, 1 LOT” — into pits, strip and testing, so procurement can order the parts. The client still bills the line.",
      },
      phrase: "break it into parts",
      status: waitingOnBoq,
    },
    {
      key: "price",
      label: "Price it",
      cards: [
        {
          title: "BOQ Costing",
          description: "Prepare and manage project BOQ costing.",
          cta: "Open costing",
          href: `/project-management/boq/costing?${projectQuery}`,
          icon: Calculator,
          accent: "emerald",
        },
      ],
      help: { title: "Costing", text: "Prepare the project costing against the BOQ." },
      phrase: "cost it",
      status: waitingOnBoq,
    },
    {
      key: "execute",
      label: "Execute",
      cards: [
        {
          title: "Operational BOQ",
          description: "Manage operational quantities and project execution BOQ.",
          cta: "Open operational BOQ",
          href: `/project-management/boq/operational/${globalProjectSlug}?${projectQuery}`,
          icon: ClipboardCheck,
          accent: "violet",
        },
      ],
      help: { title: "Operational BOQ", text: "Track the quantities used for execution." },
      phrase: "run it on site",
      status: waitingOnBoq,
    },
    {
      key: "change",
      label: "Change",
      // Its own permission, not BOQ's: approving a variation rewrites a BOQ quantity, so somebody
      // who may only read the BOQ should not be shown a card that refuses them.
      cards: canViewVariations
        ? [
            {
              title: "Variation Orders",
              description: "Approve BOQ quantities asked to go beyond the surveyed quantity.",
              cta: "Review variations",
              href: `/project-management/boq/variation-orders?${projectQuery}`,
              icon: GitPullRequestArrow,
              accent: "amber",
            },
          ]
        : [],
      help: { title: "Variation orders", text: "Approve quantities beyond the surveyed figure." },
      phrase: "handle variations",
      status:
        typeof pendingVariations !== "number"
          ? undefined
          : pendingVariations > 0
            ? { text: `${count(pendingVariations)} awaiting approval`, tone: "flag" }
            : { text: "None pending", tone: "default" },
    },
  ];

  return stages.filter((stage) => stage.cards.length > 0);
}

/** Whole class names per stage count, so Tailwind generates each one. */
const HELP_COLUMNS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

function StageCard({ card, className }: { card: BoqCard; className?: string }) {
  const accent = ACCENTS[card.accent];
  const Icon = card.icon;

  return (
    <Link
      href={card.href}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card p-4 no-underline transition-[border-color,box-shadow] duration-150 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        accent.hover,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-[3px]", accent.bar)} />
      <span
        aria-hidden="true"
        className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px]", accent.tile)}
      >
        <Icon className="h-[19px] w-[19px]" />
      </span>
      <h3 className="mt-3 text-[15px] font-semibold leading-snug text-foreground">{card.title}</h3>
      <p className="mt-1 flex-1 text-[12.5px] leading-relaxed text-muted-foreground">
        {card.description}
      </p>
      <span
        className={cn(
          "mt-3.5 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-[12.5px] font-semibold",
          accent.cta,
        )}
      >
        {card.cta}
        <ArrowRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 transition-transform duration-150 group-hover:translate-x-[3px] motion-reduce:transition-none"
        />
      </span>
    </Link>
  );
}

function ProjectChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border px-3 py-1.5 sm:max-w-[18rem]">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {label}
      </p>
      <p className="truncate text-[13px] font-semibold text-foreground" title={value}>
        {value}
      </p>
    </div>
  );
}

export function BoqHub({ project, stages }: { project: BoqHubProject; stages: BoqStage[] }) {
  const projectHref = `/project-management?project=${encodeURIComponent(project.id)}`;
  const phrases = stages.map((stage) => stage.phrase);
  const workflowLine =
    phrases.length > 1
      ? `Step by step — ${phrases.slice(0, -1).join(", ")}, then ${phrases[phrases.length - 1]}.`
      : null;

  return (
    <div className="w-full">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      {/* `space-y-0` drops the header's own bottom margin (globals.css), so the card pads evenly. */}
      <div className="space-y-0 rounded-xl border border-border bg-card px-4 py-4 sm:px-5">
        <PageHeader
          title="BOQ"
          icon={ClipboardList}
          breadcrumbs={[
            { label: "Project Management", href: projectHref },
            { label: project.projectName },
          ]}
          backHref={projectHref}
          backLabel="Back to Project Management"
          actions={
            <>
              <ProjectChip label="Project" value={project.projectName} />
              <ProjectChip label="Mapped to" value={project.globalProjectName} />
            </>
          }
        />
      </div>

      {/* ── Workflow ────────────────────────────────────────────────────── */}
      <div className="mx-0.5 mb-2.5 mt-6 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <h2 className="text-[15px] font-semibold leading-snug tracking-tight text-foreground">
          BOQ workflow
        </h2>
        {workflowLine && <p className="text-xs text-muted-foreground">{workflowLine}</p>}
      </div>

      {/* A grid while the stages wrap; one row with arrows between them from `lg` up. The arrow
          hangs in the gap to the left of each stage, so the list stays one item per stage. */}
      <ol className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:flex lg:items-stretch lg:gap-8">
        {stages.map((stage, index) => {
          const isPair = stage.cards.length > 1;
          return (
            <li
              key={stage.key}
              className={cn(
                "relative flex min-w-0 flex-col gap-2.5 lg:basis-0",
                // A pair stacks while the row is narrow and sits side by side from `xl`, where it
                // needs about twice a single stage's width.
                isPair ? "lg:flex-[1.15] xl:flex-[2.15]" : "lg:flex-1",
              )}
            >
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 -left-8 hidden w-8 items-center justify-center text-muted-foreground/50 lg:flex"
                >
                  <ArrowRight className="h-[22px] w-[22px]" />
                </span>
              )}
              <div className="flex min-h-5 items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background">
                  {index + 1}
                </span>
                <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                  {stage.label}
                </span>
                {stage.status && (
                  <span
                    className={cn(
                      "ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                      stage.status.tone === "flag"
                        ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {stage.status.text}
                  </span>
                )}
              </div>
              {isPair ? (
                <div className="flex flex-1 flex-col gap-2.5 xl:flex-row xl:items-stretch">
                  {stage.cards.map((card, cardIndex) => (
                    <div key={card.href} className="contents">
                      {cardIndex > 0 && (
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground xl:flex-col xl:gap-1.5">
                          <span aria-hidden="true" className="h-px flex-1 bg-border xl:h-auto xl:w-px" />
                          or
                          <span aria-hidden="true" className="h-px flex-1 bg-border xl:h-auto xl:w-px" />
                        </div>
                      )}
                      <StageCard card={card} className="xl:min-w-0 xl:flex-1 xl:basis-0" />
                    </div>
                  ))}
                </div>
              ) : (
                <StageCard card={stage.cards[0]!} className="flex-1" />
              )}
            </li>
          );
        })}
      </ol>

      {/* ── What each step is for ───────────────────────────────────────── */}
      {/* The 1px gap over a border-coloured fill draws the dividers, whichever way the cells wrap.
          Hidden on a phone, where each card already sits directly above its own explanation. */}
      <div
        className={cn(
          "mt-6 hidden grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid sm:grid-cols-2",
          HELP_COLUMNS[stages.length],
        )}
      >
        {stages.map((stage, index) => (
          <div
            key={stage.key}
            className={cn(
              "bg-card px-4 py-3.5 sm:px-[18px]",
              // An odd last cell on the two-column grid takes the whole row instead of leaving an
              // empty, border-filled slot beside it.
              stages.length % 2 === 1 && index === stages.length - 1 && "sm:col-span-2 lg:col-span-1",
            )}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Step {index + 1}
            </p>
            <p className="mb-0.5 mt-[3px] text-[13px] font-semibold text-foreground">{stage.help.title}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{stage.help.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The skeleton while the project and permissions load — the same shape as `BoqHub`. */
export function BoqHubSkeleton() {
  return (
    <div className="w-full space-y-5">
      <div className="h-[84px] w-full animate-pulse rounded-xl bg-muted" />
      <div className="h-5 w-64 animate-pulse rounded-md bg-muted" />
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-56 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-20 w-full animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
