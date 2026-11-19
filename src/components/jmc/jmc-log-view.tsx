"use client";

/**
 * The JMC log, from the user's `sel-jmc-log` mock-up.
 *
 * The log was a wide table with one column per workflow stage holding a date. It was accurate and
 * almost unreadable: the thing a reader wants from this screen — where is this certificate, and how
 * much of it has been certified — had to be reconstructed by scanning a row of dates for the last
 * one filled in. So each certificate is now one card carrying its own tracker, the stage dates sit
 * under the step they belong to, and the money is a pair of figures with a bar.
 *
 * Above the list: what the register comes to, and a row of stage buttons that both report how many
 * are sitting at each step and filter the list to them.
 *
 * Props only — no data, no permissions, no Firestore. Row actions are passed in, so deleting and
 * opening stay the page's business.
 *
 * Colours are plain hex and theme tokens, never `color-mix()`: Chrome 109 on the Windows 7 PCs
 * drops it silently, which would leave these tiles and tracker dots blank.
 */

import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  Calendar,
  Check,
  CircleDollarSign,
  Clock,
  Download,
  FileText,
  History,
  Search,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HeroBand,
  HERO_PRIMARY_BUTTON,
  HERO_SECONDARY_BUTTON,
} from "@/components/project-management/hero-band";
import { JMC_MAIN_CLASS } from "@/components/jmc/jmc-page-shell";
import { formatJmcAmount } from "@/lib/project-management-jmc-dashboard";
import { cn } from "@/lib/utils";

/** The stage tints, continuing past the mock-up's four so a longer workflow keeps its sequence. */
const STAGE_COLOURS: ReadonlyArray<readonly [string, string]> = [
  ["#6ee7b7", "#059669"],
  ["#67e8f9", "#0891b2"],
  ["#93c5fd", "#2563eb"],
  ["#c4b5fd", "#7c3aed"],
  ["#fcd34d", "#d97706"],
  ["#f9a8d4", "#db2777"],
];

export interface JmcLogRow {
  id: string;
  jmcNo: string;
  /** The JMC date as it should read, already formatted. */
  dateLabel: string;
  /**
   * Which step it is waiting at, counting the configured workflow only — `steps.length` once it
   * has cleared them all.
   */
  stageIndex: number;
  stageName: string;
  status: string;
  value: number;
  certified: number;
  /** Stage name → the date that step completed, blank where it has not. */
  stageDates: Record<string, string>;
}

export interface JmcLogViewProps {
  back: { href: string; label: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void };
  crumbs?: readonly { label: string; href?: string }[];
  projectName: string;
  description: ReactNode;
  /** The configured workflow step names, in order. */
  steps: readonly string[];
  rows: readonly JmcLogRow[];
  create?: { href: string };
  onExport?: () => void;
  onOpen: (row: JmcLogRow) => void;
  /** The page's own buttons for a row — view document, delete. */
  renderActions?: (row: JmcLogRow) => ReactNode;
  isLoading?: boolean;
}

/* ── Parts ──────────────────────────────────────────────────────────────────────────────────── */

function Kpi({
  icon: Icon,
  label,
  value,
  note,
  tone,
  valueClassName,
}: {
  icon: typeof Check;
  label: string;
  value: string;
  note: string;
  tone: readonly [string, string];
  valueClassName?: string;
}) {
  return (
    <Card className="overflow-hidden border-border/60">
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white shadow-md"
          style={{ backgroundImage: `linear-gradient(140deg, ${tone[0]}, ${tone[1]})` }}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <span className="block text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span className={cn("block truncate text-xl font-extrabold leading-tight", valueClassName)}>
            {value}
          </span>
          <span className="block truncate text-xs font-semibold text-muted-foreground">{note}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/** One step of a certificate's run: done, the one it is waiting at, or still ahead. */
function TrackerStep({
  label,
  detail,
  index,
  state,
}: {
  label: string;
  detail: string;
  index: number;
  state: "done" | "now" | "ahead";
}) {
  return (
    <div className="relative min-w-0 text-center">
      <span
        className={cn(
          "relative z-10 mx-auto mb-1.5 grid h-7 w-7 place-items-center rounded-full border-2 text-[11px] font-extrabold",
          state === "done" && "border-emerald-600 bg-emerald-600 text-white",
          state === "now" && "border-amber-500 bg-amber-50 text-amber-700 ring-4 ring-amber-100",
          state === "ahead" && "border-border bg-background text-muted-foreground",
        )}
      >
        {state === "done" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
      </span>
      <span
        className={cn(
          "block truncate text-[11.5px] font-bold",
          state === "now" ? "text-amber-700" : "text-muted-foreground",
        )}
        title={label}
      >
        {label}
      </span>
      <span className="block truncate text-[10.5px] text-muted-foreground" title={detail}>
        {detail}
      </span>
    </div>
  );
}

function LogRow({
  row,
  trackerLabels,
  onOpen,
  renderActions,
}: {
  row: JmcLogRow;
  trackerLabels: readonly string[];
  onOpen: (row: JmcLogRow) => void;
  renderActions?: (row: JmcLogRow) => ReactNode;
}) {
  // Creating the certificate is always behind it, so its position on the tracker is one past the
  // workflow index.
  const at = row.stageIndex + 1;
  const pct = row.value > 0 ? Math.min(100, (row.certified / row.value) * 100) : 0;
  const done = at >= trackerLabels.length;

  return (
    <div className="grid gap-4 border-b p-4 last:border-b-0 hover:bg-muted/30 lg:grid-cols-[minmax(240px,1.3fr)_minmax(280px,2fr)_minmax(190px,1fr)_auto] lg:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white shadow-md"
          style={{ backgroundImage: "linear-gradient(140deg, #6ee7b7, #059669)" }}
          aria-hidden="true"
        >
          <FileText className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onOpen(row)}
            className="block max-w-full truncate text-left text-[13px] font-extrabold hover:underline"
            title={row.jmcNo}
          >
            {row.jmcNo || "—"}
          </button>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
            JMC date {row.dateLabel}
          </span>
        </div>
      </div>

      {/* The tracker. The rule behind the dots is drawn from the first to the last, so it never
          sticks out past either end however many steps this workflow has. */}
      <div className="relative min-w-0">
        <span
          className="absolute top-[13px] h-[3px] rounded-full bg-border"
          style={{
            left: `${50 / trackerLabels.length}%`,
            right: `${50 / trackerLabels.length}%`,
          }}
          aria-hidden="true"
        />
        <span
          className="absolute top-[13px] h-[3px] rounded-full"
          style={{
            left: `${50 / trackerLabels.length}%`,
            width: `${(Math.min(at, trackerLabels.length - 1) / (trackerLabels.length - 1 || 1)) * (100 - 100 / trackerLabels.length)}%`,
            backgroundImage: "linear-gradient(90deg, #34d399, #0891b2)",
          }}
          aria-hidden="true"
        />
        <div
          className="relative grid"
          style={{ gridTemplateColumns: `repeat(${trackerLabels.length}, minmax(0, 1fr))` }}
        >
          {trackerLabels.map((label, index) => {
            const state = index < at ? "done" : index === at ? "now" : "ahead";
            const detail =
              index === 0
                ? row.dateLabel
                : row.stageDates[label] || (index === at ? row.status || "Pending" : "—");
            return (
              <TrackerStep
                key={`${label}-${index}`}
                label={label}
                detail={state === "done" || index === 0 ? detail : state === "now" ? detail : "—"}
                index={index}
                state={state}
              />
            );
          })}
        </div>
      </div>

      <div className="grid gap-1.5">
        <div className="flex justify-between gap-2 text-xs font-bold text-muted-foreground">
          <span>JMC value</span>
          <span className="font-extrabold tabular-nums text-foreground">
            {formatJmcAmount(row.value)}
          </span>
        </div>
        <div className="flex justify-between gap-2 text-xs font-bold text-muted-foreground">
          <span>Certified</span>
          <span className="font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatJmcAmount(row.certified)}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full"
            style={{
              width: `${pct}%`,
              backgroundImage: "linear-gradient(90deg, #34d399, #059669)",
            }}
          />
        </div>
        <span className="text-[11px] font-bold text-muted-foreground">
          {pct.toFixed(1)}% certified
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-extrabold",
            done
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {done ? "Certified" : row.status || "Pending"}
        </span>
        <Button size="sm" className="h-8" onClick={() => onOpen(row)}>
          Open
        </Button>
        {renderActions?.(row)}
      </div>
    </div>
  );
}

/* ── The screen ─────────────────────────────────────────────────────────────────────────────── */

export function JmcLogView({
  back,
  crumbs,
  projectName,
  description,
  steps,
  rows,
  create,
  onExport,
  onOpen,
  renderActions,
  isLoading,
}: JmcLogViewProps) {
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<number | null>(null);

  const trackerLabels = useMemo(() => ["Create", ...steps], [steps]);

  const totals = useMemo(() => {
    const value = rows.reduce((sum, row) => sum + row.value, 0);
    const certified = rows.reduce((sum, row) => sum + row.certified, 0);
    const pending = rows.filter((row) => row.stageIndex < steps.length).length;
    return { value, certified, pending };
  }, [rows, steps.length]);

  /** How many are sitting at each configured step, plus those that have cleared them all. */
  const funnel = useMemo(() => {
    const buckets = steps.map((name, index) => ({
      key: String(index),
      index,
      name,
      count: rows.filter((row) => row.stageIndex === index).length,
    }));
    const completed = rows.filter((row) => row.stageIndex >= steps.length).length;
    return completed > 0
      ? [
          ...buckets,
          { key: "done", index: steps.length, name: "Through every stage", count: completed },
        ]
      : buckets;
  }, [rows, steps]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const stageMatch =
        stageFilter === null ||
        (stageFilter >= steps.length ? row.stageIndex >= steps.length : row.stageIndex === stageFilter);
      const textMatch =
        needle === "" ||
        `${row.jmcNo} ${row.stageName}`.toLowerCase().includes(needle);
      return stageMatch && textMatch;
    });
  }, [rows, query, stageFilter, steps.length]);

  const listTitle =
    stageFilter === null
      ? "All JMCs"
      : stageFilter >= steps.length
        ? "Through every stage"
        : steps[stageFilter] ?? "All JMCs";

  const pct = totals.value > 0 ? (totals.certified / totals.value) * 100 : 0;

  return (
    <main className={JMC_MAIN_CLASS}>
      <HeroBand
        band="emerald"
        icon={History}
        back={back}
        crumbs={crumbs}
        title="JMC Log"
        description={description}
        actions={
          <>
            {onExport ? (
              <Button
                variant="outline"
                onClick={onExport}
                disabled={rows.length === 0}
                className={HERO_SECONDARY_BUTTON}
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                <span className="sm:hidden">Export</span>
                <span className="hidden sm:inline">Export All as Excel</span>
              </Button>
            ) : null}
            {create ? (
              <Button asChild className={cn(HERO_PRIMARY_BUTTON, "text-emerald-900")}>
                <Link href={create.href}>Create JMC</Link>
              </Button>
            ) : null}
          </>
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((tile) => (
              <Skeleton key={tile} className="h-[86px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              icon={FileText}
              label="JMCs raised"
              value={String(rows.length)}
              note={projectName ? `on ${projectName}` : "on this project"}
              tone={["#6ee7b7", "#059669"]}
            />
            <Kpi
              icon={CircleDollarSign}
              label="JMC value"
              value={formatJmcAmount(totals.value)}
              note="total raised"
              tone={["#93c5fd", "#2563eb"]}
            />
            <Kpi
              icon={Trophy}
              label="Certified value"
              value={formatJmcAmount(totals.certified)}
              note={`${pct.toFixed(1)}% of JMC value`}
              tone={["#c4b5fd", "#7c3aed"]}
            />
            <Kpi
              icon={Clock}
              label="Awaiting certification"
              value={formatJmcAmount(totals.value - totals.certified)}
              note={`${totals.pending} JMC${totals.pending === 1 ? "" : "s"} still in the workflow`}
              tone={["#fcd34d", "#d97706"]}
              valueClassName="text-amber-700 dark:text-amber-400"
            />
          </div>

          {funnel.length > 0 ? (
            <div className="grid grid-cols-1 overflow-hidden rounded-xl border bg-card sm:grid-cols-2 lg:grid-cols-4">
              {funnel.map((bucket) => {
                const [light, strong] = STAGE_COLOURS[bucket.index % STAGE_COLOURS.length]!;
                const active = stageFilter === bucket.index;
                return (
                  <button
                    key={bucket.key}
                    type="button"
                    onClick={() => setStageFilter(active ? null : bucket.index)}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-3 border-b p-3.5 text-left transition-colors last:border-b-0 sm:border-r sm:[&:nth-child(2n)]:border-r-0 lg:border-b-0 lg:border-r lg:last:border-r-0 lg:[&:nth-child(2n)]:border-r",
                      active ? "bg-muted" : "hover:bg-muted/50",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base font-extrabold tabular-nums",
                        bucket.count > 0 ? "text-white shadow-md" : "bg-muted text-muted-foreground",
                      )}
                      style={
                        bucket.count > 0
                          ? { backgroundImage: `linear-gradient(140deg, ${light}, ${strong})` }
                          : undefined
                      }
                    >
                      {bucket.count}
                    </span>
                    <span className="min-w-0">
                      <span
                        className="block truncate text-[13px] font-extrabold"
                        style={active ? { color: strong } : undefined}
                      >
                        {bucket.name}
                      </span>
                      <span className="block text-[11.5px] font-bold text-muted-foreground">
                        {bucket.count > 0 ? `${bucket.count} here` : "none here"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <Card className="overflow-hidden border-border/60">
            <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 p-3.5">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
                style={{ backgroundImage: "linear-gradient(140deg, #6ee7b7, #059669)" }}
                aria-hidden="true"
              >
                <History className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <span className="block text-sm font-extrabold">{listTitle}</span>
                <span className="block text-[11.5px] font-semibold text-muted-foreground">
                  Newest first · stage dates fill in as each stage completes
                </span>
              </div>
              <div className="relative ml-auto w-full sm:w-[280px]">
                <Search
                  className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search JMC No..."
                  aria-label="Search the JMC log"
                  className="h-9 pl-9"
                />
              </div>
            </div>

            <CardContent className="p-0">
              {shown.length === 0 ? (
                <p className="p-10 text-center text-sm font-semibold text-muted-foreground">
                  {rows.length === 0
                    ? "No JMC has been raised on this project yet."
                    : `No JMC ${stageFilter === null ? "" : `at ${listTitle} `}matches${query ? ` "${query}"` : ""}.`}
                </p>
              ) : (
                shown.map((row) => (
                  <LogRow
                    key={row.id}
                    row={row}
                    trackerLabels={trackerLabels}
                    onOpen={onOpen}
                    renderActions={renderActions}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
