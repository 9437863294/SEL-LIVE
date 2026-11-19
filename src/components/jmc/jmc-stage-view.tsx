"use client";

/**
 * A JMC workflow stage — the desk a certificate is sitting on — from the user's
 * `sel-jmc-verification-v2` mock-up.
 *
 * The screen used to be a page header over two tabs and a table, which answered "what is in front
 * of me" and nothing else. Three things the mock-up adds, all of which this screen could answer
 * and did not:
 *   - where this stage sits in the run, so the person acting on a certificate can see what has
 *     already been cleared and whose desk it goes to next;
 *   - the size of their own queue, pending against completed, without counting rows;
 *   - an empty state that says *why* it is empty and offers somewhere to go, rather than one grey
 *     line of text.
 *
 * The stage run is built from the configured workflow, so an installation with three or seven
 * steps sees its own; the mock-up's four are not written in anywhere.
 *
 * Props only — no data, no permissions, no Firestore. The actions a task offers are passed in,
 * because which action may be taken is the page's question and answering it needs the workflow,
 * the user and the transaction that follows.
 *
 * Colours are plain hex and theme tokens, never `color-mix()`: Chrome 109 on the Windows 7 PCs
 * drops it silently, which would leave these tiles blank. The illustrations are drawn in
 * `currentColor` so they read on both the light and the dark surface.
 */

import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  Check,
  CircleAlert,
  Clock,
  FilePlus,
  GitMerge,
  History,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { HeroBand } from "@/components/project-management/hero-band";
import { JMC_MAIN_CLASS } from "@/components/jmc/jmc-page-shell";
import { formatJmcAmount } from "@/lib/project-management-jmc-dashboard";
import { cn } from "@/lib/utils";

export type JmcStageTab = "pending" | "completed";

export interface JmcStageTask {
  id: string;
  jmcNo: string;
  /** The JMC date as it should read, already formatted. */
  dateLabel: string;
  amount: number;
  status: string;
  /**
   * What the deadline says, already worded — "due in 3 days", "2 days overdue". Omitted where the
   * certificate carries no deadline, which is most of the completed ones.
   */
  due?: { label: string; overdue: boolean } | null;
}

export interface JmcStageViewProps {
  back: { href: string; label: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void };
  crumbs?: readonly { label: string; href?: string }[];
  stageName: string;
  /** This stage's place in the configured run, 0-based; -1 if it is not one of the steps. */
  stageIndex: number;
  /** The configured workflow step names, in order. */
  steps: readonly string[];
  projectName: string;
  description: ReactNode;
  pending: readonly JmcStageTask[];
  completed: readonly JmcStageTask[];
  logHref: string;
  createHref?: string;
  onOpen: (task: JmcStageTask) => void;
  /** The page's own buttons for a task — the workflow actions, details. */
  renderActions?: (task: JmcStageTask, tab: JmcStageTab) => ReactNode;
  isLoading?: boolean;
}

/** The two queues' accents: amber for what is waiting, emerald for what has been done. */
const TONES = {
  pending: {
    gradient: ["#fbbf24", "#d97706"] as const,
    text: "text-amber-700 dark:text-amber-400",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    bar: "linear-gradient(90deg, #fbbf24, #d97706)",
  },
  completed: {
    gradient: ["#34d399", "#059669"] as const,
    text: "text-emerald-700 dark:text-emerald-400",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    bar: "linear-gradient(90deg, #34d399, #059669)",
  },
} as const;

/* ── Parts ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * The empty-state drawing.
 *
 * Everything neutral is `currentColor` at low opacity, so the picture takes the surface it is on
 * and reads in the dark theme as well as the light one; only the two accents are fixed colours.
 */
function StageIllustration({ tab }: { tab: JmcStageTab }) {
  const tone = TONES[tab];

  return (
    <svg
      viewBox="0 0 340 220"
      className="h-auto w-full max-w-[300px] text-muted-foreground"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`jmc-stage-accent-${tab}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={tone.gradient[0]} />
          <stop offset="1" stopColor={tone.gradient[1]} />
        </linearGradient>
      </defs>

      <ellipse cx="170" cy="198" rx="118" ry="10" fill="currentColor" opacity=".10" />

      {tab === "pending" ? (
        <>
          {/* A tray of paperwork, with the clock that says it is waiting. */}
          <g transform="rotate(-5 170 96)">
            <rect x="100" y="44" width="140" height="96" rx="14" fill="currentColor" opacity=".08" />
            <rect x="118" y="66" width="76" height="9" rx="4.5" fill="currentColor" opacity=".26" />
            <rect x="118" y="88" width="104" height="9" rx="4.5" fill="currentColor" opacity=".14" />
            <rect x="118" y="110" width="58" height="9" rx="4.5" fill="currentColor" opacity=".14" />
          </g>
          <path
            d="M72 128h54l12 23h64l12-23h54v45a14 14 0 0 1-14 14H86a14 14 0 0 1-14-14z"
            fill={`url(#jmc-stage-accent-${tab})`}
          />
          <circle cx="262" cy="48" r="25" fill="currentColor" opacity=".14" />
          <circle cx="262" cy="48" r="19" fill={`url(#jmc-stage-accent-${tab})`} />
          <path
            d="M262 38v11l7 4"
            stroke="#fff"
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
          />
        </>
      ) : (
        <>
          {/* A checked-off sheet, with the tick that closed it. */}
          <rect x="106" y="34" width="128" height="156" rx="16" fill="currentColor" opacity=".08" />
          <rect x="144" y="24" width="52" height="20" rx="8" fill="currentColor" opacity=".2" />
          <g fill="currentColor">
            <rect x="126" y="70" width="16" height="16" rx="5" opacity=".24" />
            <rect x="152" y="74" width="64" height="8" rx="4" opacity=".14" />
            <rect x="126" y="100" width="16" height="16" rx="5" opacity=".24" />
            <rect x="152" y="104" width="52" height="8" rx="4" opacity=".14" />
            <rect x="126" y="130" width="16" height="16" rx="5" opacity=".24" />
            <rect x="152" y="134" width="58" height="8" rx="4" opacity=".14" />
          </g>
          <circle cx="236" cy="166" r="30" fill="currentColor" opacity=".12" />
          <circle cx="236" cy="166" r="25" fill={`url(#jmc-stage-accent-${tab})`} />
          <path
            d="M224 166l9 9 16-18"
            stroke="#fff"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </>
      )}
    </svg>
  );
}

/** One of the two queue tabs: its name, and how many are in it. */
function StageTab({
  tab,
  active,
  count,
  onSelect,
}: {
  tab: JmcStageTab;
  active: boolean;
  count: number;
  onSelect: () => void;
}) {
  const tone = TONES[tab];
  const Icon = tab === "pending" ? Clock : Check;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "relative flex items-center gap-2 px-3 py-3.5 text-sm font-extrabold transition-colors sm:px-4",
        active ? tone.text : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {tab === "pending" ? "Pending" : "Completed"}
      <span
        className={cn(
          "grid h-[22px] min-w-[24px] place-items-center rounded-full px-1.5 text-[11.5px] font-extrabold",
          active ? tone.chip : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
      {active ? (
        <span
          className="absolute inset-x-2 -bottom-px h-[3px] rounded-t-full"
          style={{ backgroundImage: tone.bar }}
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}

/** A certificate in the queue: what it is, what it is worth, and what may be done to it. */
function TaskRow({
  task,
  tab,
  onOpen,
  renderActions,
}: {
  task: JmcStageTask;
  tab: JmcStageTab;
  onOpen: (task: JmcStageTask) => void;
  renderActions?: (task: JmcStageTask, tab: JmcStageTab) => ReactNode;
}) {
  const tone = TONES[tab];

  return (
    <div className="grid gap-3 border-b p-4 last:border-b-0 hover:bg-muted/30 lg:grid-cols-[minmax(220px,1.4fr)_minmax(150px,1fr)_minmax(150px,1fr)_auto] lg:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white shadow-md"
          style={{ backgroundImage: `linear-gradient(140deg, ${tone.gradient[0]}, ${tone.gradient[1]})` }}
          aria-hidden="true"
        >
          {tab === "pending" ? <Clock className="h-5 w-5" /> : <Check className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onOpen(task)}
            className="block max-w-full truncate text-left text-[13px] font-extrabold hover:underline"
            title={task.jmcNo}
          >
            {task.jmcNo || "—"}
          </button>
          <span className="block truncate text-xs font-semibold text-muted-foreground">
            JMC date {task.dateLabel}
          </span>
        </div>
      </div>

      <div className="min-w-0">
        <span className="block text-[10.5px] font-extrabold uppercase tracking-wider text-muted-foreground">
          Total amount
        </span>
        <span className="block truncate text-sm font-extrabold tabular-nums">
          {formatJmcAmount(task.amount)}
        </span>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-extrabold",
            tone.chip,
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {task.status || (tab === "pending" ? "Pending" : "Done")}
        </span>
        {task.due ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-extrabold",
              task.due.overdue ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
            )}
          >
            {task.due.overdue ? (
              <CircleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : null}
            {task.due.label}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {renderActions?.(task, tab)}
      </div>
    </div>
  );
}

/** One figure in the right-hand queue panel. */
function QueueFigure({ tab, count }: { tab: JmcStageTab; count: number }) {
  const tone = TONES[tab];
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/30 p-3 text-center">
      <span className={cn("block text-3xl font-extrabold leading-tight tabular-nums", tone.text)}>
        {count}
      </span>
      <span className="block text-[11.5px] font-extrabold text-muted-foreground">
        {tab === "pending" ? "Pending" : "Completed"}
      </span>
    </div>
  );
}

/** A right-hand panel: a gradient icon chip, a title, and whatever it holds. */
function RailCard({
  icon: Icon,
  title,
  tone,
  children,
}: {
  icon: typeof Check;
  title: string;
  tone: readonly [string, string];
  children: ReactNode;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-[13.5px] font-extrabold">
          <span
            className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-white"
            style={{ backgroundImage: `linear-gradient(135deg, ${tone[0]}, ${tone[1]})` }}
            aria-hidden="true"
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          {title}
        </h3>
        {children}
      </CardContent>
    </Card>
  );
}

/** One step of the run, in the right-hand relay. */
function RelayStep({
  label,
  detail,
  index,
  state,
  last,
}: {
  label: string;
  detail: string;
  index: number;
  state: "done" | "now" | "ahead";
  last: boolean;
}) {
  return (
    <li className="relative flex items-start gap-3 pb-4 last:pb-0">
      {!last ? (
        <span className="absolute left-[14px] top-[30px] bottom-0 w-[2px] bg-border" aria-hidden="true" />
      ) : null}
      <span
        className={cn(
          "relative z-10 grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full border-2 text-xs font-extrabold",
          state === "done" && "border-emerald-600 bg-emerald-600 text-white",
          state === "now" && "border-cyan-600 bg-cyan-600 text-white ring-4 ring-cyan-100 dark:ring-cyan-950",
          state === "ahead" && "border-border bg-background text-muted-foreground",
        )}
      >
        {state === "done" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
      </span>
      <div className="min-w-0 pt-1">
        <span
          className={cn(
            "block truncate text-[13px] font-extrabold",
            state === "now" ? "text-cyan-700 dark:text-cyan-400" : undefined,
          )}
          title={label}
        >
          {label}
        </span>
        <span className="block text-[11.5px] font-semibold text-muted-foreground">{detail}</span>
      </div>
    </li>
  );
}

/* ── The screen ─────────────────────────────────────────────────────────────────────────────── */

export function JmcStageView({
  back,
  crumbs,
  stageName,
  stageIndex,
  steps,
  projectName,
  description,
  pending,
  completed,
  logHref,
  createHref,
  onOpen,
  renderActions,
  isLoading,
}: JmcStageViewProps) {
  const [tab, setTab] = useState<JmcStageTab>("pending");
  const [query, setQuery] = useState("");

  const rows = tab === "pending" ? pending : completed;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return rows;
    return rows.filter((task) =>
      `${task.jmcNo} ${task.status} ${task.dateLabel}`.toLowerCase().includes(needle),
    );
  }, [rows, query]);

  /**
   * The run as the relay draws it. Raising the certificate is not a configured step — it is what
   * happens before the first one — so "Create JMC" is prepended and this stage sits one further
   * along than its index in the workflow.
   */
  const relay = useMemo(() => {
    const labels = ["Create JMC", ...steps];
    const at = stageIndex >= 0 ? stageIndex + 1 : -1;
    return labels.map((label, index) => {
      const state: "done" | "now" | "ahead" =
        index === at ? "now" : at >= 0 && index < at ? "done" : "ahead";
      const detail =
        index === at
          ? "You are here"
          : index === 0
            ? "JMC raised on the project"
            : state === "done"
              ? "Already cleared"
              : index === labels.length - 1
                ? "Final stage"
                : index === at + 1
                  ? "Next, after this stage"
                  : "Later in the run";
      return { label, detail, state };
    });
  }, [steps, stageIndex]);

  const emptyCopy =
    tab === "pending"
      ? {
          badge: `PENDING · ${pending.length}`,
          title: "No pending tasks found.",
          body: projectName
            ? `Nothing is waiting for you at ${stageName} on ${projectName}. When a JMC reaches this stage and is assigned to you, it appears here.`
            : `Nothing is waiting for you at ${stageName}. When a JMC reaches this stage and is assigned to you, it appears here.`,
        }
      : {
          badge: `COMPLETED · ${completed.length}`,
          title: "No completed tasks yet.",
          body: `JMCs you action at ${stageName} are listed here once they move on.`,
        };

  const tone = TONES[tab];

  return (
    <main className={JMC_MAIN_CLASS}>
      <HeroBand
        band="cyan"
        icon={GitMerge}
        back={back}
        crumbs={crumbs}
        title={stageName}
        description={description}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <Card className="overflow-hidden border-border/60">
            <div className="flex flex-wrap items-center gap-1 border-b px-2 sm:px-3">
              <StageTab
                tab="pending"
                active={tab === "pending"}
                count={pending.length}
                onSelect={() => {
                  setTab("pending");
                  setQuery("");
                }}
              />
              <StageTab
                tab="completed"
                active={tab === "completed"}
                count={completed.length}
                onSelect={() => {
                  setTab("completed");
                  setQuery("");
                }}
              />
              <div className="relative ml-auto w-full py-2 sm:w-[230px]">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search tasks..."
                  aria-label="Search tasks"
                  disabled={rows.length === 0}
                  title={rows.length === 0 ? "Nothing to search yet" : undefined}
                  className="h-9 rounded-xl pl-9 font-semibold"
                />
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2].map((row) => (
                  <Skeleton key={row} className="h-14 rounded-xl" />
                ))}
              </div>
            ) : shown.length > 0 ? (
              <div>
                {shown.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    tab={tab}
                    onOpen={onOpen}
                    renderActions={renderActions}
                  />
                ))}
              </div>
            ) : rows.length > 0 ? (
              /* The queue is not empty — the search is. Said separately, so nobody reads a
                 filtered list as an empty desk. */
              <div className="flex flex-col items-center gap-3 p-10 text-center">
                <Search className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-extrabold">No task matches &ldquo;{query.trim()}&rdquo;.</p>
                <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                  <X className="mr-2 h-4 w-4" aria-hidden="true" />
                  Clear search
                </Button>
              </div>
            ) : (
              <div className="grid items-center gap-6 p-6 sm:p-8 lg:grid-cols-2">
                <div className="flex justify-center">
                  <StageIllustration tab={tab} />
                </div>
                <div className="text-center lg:text-left">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold tracking-[0.08em]",
                      tone.chip,
                    )}
                  >
                    {emptyCopy.badge}
                  </span>
                  <h2 className="mt-2.5 text-xl font-extrabold tracking-tight sm:text-2xl">
                    {emptyCopy.title}
                  </h2>
                  <p className="mt-1.5 max-w-[42ch] text-[13.5px] text-muted-foreground max-lg:mx-auto">
                    {emptyCopy.body}
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2 lg:justify-start">
                    <Button variant="outline" asChild>
                      <Link href={logHref}>
                        <History className="mr-2 h-4 w-4" aria-hidden="true" />
                        Open JMC Log
                      </Link>
                    </Button>
                    {createHref ? (
                      <Button asChild>
                        <Link href={createHref}>
                          <FilePlus className="mr-2 h-4 w-4" aria-hidden="true" />
                          Create JMC
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <RailCard icon={Clock} title="Your queue" tone={["#67e8f9", "#0891b2"]}>
            <div className="grid grid-cols-2 gap-2.5">
              <QueueFigure tab="pending" count={pending.length} />
              <QueueFigure tab="completed" count={completed.length} />
            </div>
          </RailCard>

          {relay.length > 1 ? (
            <RailCard icon={GitMerge} title="Where this stage sits" tone={["#6ee7b7", "#059669"]}>
              <ol>
                {relay.map((step, index) => (
                  <RelayStep
                    key={`${step.label}-${index}`}
                    label={step.label}
                    detail={step.detail}
                    index={index}
                    state={step.state}
                    last={index === relay.length - 1}
                  />
                ))}
              </ol>
            </RailCard>
          ) : null}

          <RailCard icon={CircleAlert} title="Good to know" tone={["#fcd34d", "#d97706"]}>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Only tasks <span className="font-extrabold text-foreground">assigned to you</span>
              {projectName ? (
                <>
                  {" "}
                  on <span className="font-extrabold text-foreground">{projectName}</span>
                </>
              ) : null}{" "}
              show here. JMCs on other projects appear in that project&rsquo;s queue, and every
              certificate — whoever it is with — is in the{" "}
              <Link href={logHref} className="font-extrabold text-foreground underline">
                JMC Log
              </Link>
              .
            </p>
          </RailCard>
        </aside>
      </div>
    </main>
  );
}
