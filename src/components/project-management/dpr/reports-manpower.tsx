"use client";

/**
 * The Manpower report, from the user's mock-up (`sel-dpr-reports-manpower-colour`): four figures,
 * a coloured card per trade, a sortable table with a total, the share of man-days as a donut with
 * its legend, and a warning when working days have no manpower recorded.
 *
 * Colour follows the trade, never its rank: `tradeOrder` (every trade in the register, in the
 * configured list's order) gives each trade its slot in the dataviz reference palette — validated
 * for colour blindness in both modes — so a trade keeps its colour whatever the period or scope.
 * A ninth trade and on share the grey "Other". Light slots below 3:1 against the card are relieved
 * by the legend's figures and the table, as the palette requires. Figures stay in text colours;
 * the colour is carried by a swatch, a dot, an edge or the card itself.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Anchor,
  ArrowDown,
  ArrowUp,
  BrickWall,
  CalendarDays,
  Construction,
  Flame,
  Hammer,
  HardHat,
  PaintRoller,
  PieChart,
  Star,
  Tractor,
  User,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { DPR_BASE_PATH, type DprScope } from "@/lib/project-management-dpr";
import { dprShortDate } from "@/lib/project-management-dpr-plan";
import type { DprManpowerReport, DprManpowerTradeRow } from "@/lib/project-management-dpr-reports";
import { dprHref, formatQty } from "@/components/project-management/dpr/dpr-shell";
import {
  DprFigureRow,
  DprFigureTile,
  DprReportCallout,
  DprReportCard,
  DprReportZero,
} from "@/components/project-management/dpr/reports-parts";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/* ── Colour ─────────────────────────────────────────────────────────────────────────────────── */

interface TradeColour {
  /** The palette slot, stepped for each mode. */
  light: string;
  dark: string;
  /** The trade card: darker steps of the same hue, so its white text stays readable. */
  card: readonly [string, string];
}

/** The dataviz reference categorical palette, in its validated order. */
const SLOTS: readonly TradeColour[] = [
  { light: "#2a78d6", dark: "#3987e5", card: ["#2a78d6", "#1c5cab"] },
  { light: "#eb6834", dark: "#d95926", card: ["#d9572a", "#a8401b"] },
  { light: "#1baf7a", dark: "#199e70", card: ["#15936a", "#0d6b4c"] },
  { light: "#eda100", dark: "#c98500", card: ["#b97d00", "#8a5c00"] },
  { light: "#e87ba4", dark: "#d55181", card: ["#c95a85", "#9c3a62"] },
  { light: "#008300", dark: "#0ca30c", card: ["#0a8a0a", "#006100"] },
  { light: "#6250d6", dark: "#9085e9", card: ["#6250d6", "#4535a8"] },
  { light: "#e34948", dark: "#e66767", card: ["#d63c3b", "#a82a29"] },
];
const OTHER: TradeColour = { light: "#94a3b8", dark: "#71717a", card: ["#64748b", "#475569"] };

/** A trade's icon, by what it is called. */
const TRADE_ICONS: Array<[RegExp, LucideIcon]> = [
  [/mason|brick/i, BrickWall],
  [/helper|labou?r|khalasi/i, User],
  [/carpent|shutter/i, Hammer],
  [/bar ?bend|steel|rebar/i, Construction],
  [/fitter|plumb|mechanic/i, Wrench],
  [/rigger/i, Anchor],
  [/weld/i, Flame],
  [/electric/i, Zap],
  [/paint/i, PaintRoller],
  [/operator|driver/i, Tractor],
  [/supervis|foreman|engineer/i, HardHat],
];
const tradeIcon = (trade: string): LucideIcon =>
  TRADE_ICONS.find(([pattern]) => pattern.test(trade))?.[1] ?? Users;

const fmt = (value: number) => formatQty(value);
/** An average headcount: one decimal is as fine as a crew is counted. */
const avg = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value);
const pct = (value: number) => `${Math.round(value)}%`;

/* ── The report ─────────────────────────────────────────────────────────────────────────────── */

export function DprManpowerView({
  report,
  tradeOrder,
  mappingId,
  scope,
  scopeLabel,
  periodLabel,
  periodChoiceLabel,
  periodNoun,
}: {
  report: DprManpowerReport;
  /** Every trade in the register, in colour order (`dprTradeOrder`). */
  tradeOrder: readonly string[];
  mappingId: string;
  scope: DprScope | "All";
  scopeLabel: string;
  /** "09–15 Nov 2026" */
  periodLabel: string;
  /** "weekly" */
  periodChoiceLabel: string;
  /** "week" — for "This week". */
  periodNoun: string;
}) {
  const { resolvedMode } = useTheme();
  const dark = resolvedMode === "dark";
  const colourOf = useMemo(() => {
    const slot = new Map(tradeOrder.map((trade, index) => [trade.toLowerCase(), index]));
    return (trade: string): TradeColour => SLOTS[slot.get(trade.toLowerCase()) ?? SLOTS.length] ?? OTHER;
  }, [tradeOrder]);

  const { rows, totalManDays, largest, workingDaysToDate, missingDates } = report;
  const recordedWorking = workingDaysToDate - missingDates.length;

  return (
    <div className="space-y-4">
      <DprFigureRow>
        <DprFigureTile
          icon={Users}
          colours={["#c4b5fd", "#7c3aed"]}
          label="Total man-days"
          value={fmt(totalManDays)}
          detail={periodLabel}
        />
        <DprFigureTile
          icon={Wrench}
          colours={["#5eead4", "#0d9488"]}
          label="Trades deployed"
          value={String(rows.length)}
          detail={rows.length > 0 ? rows.map((row) => row.trade).join(" · ") : "None recorded"}
        />
        <DprFigureTile
          icon={Star}
          colours={["#93c5fd", "#2563eb"]}
          label="Largest trade"
          value={largest ? largest.trade : "—"}
          detail={largest ? `${fmt(largest.manDays)} man-days · ${pct(largest.sharePct)}` : "No manpower recorded"}
        />
        <DprFigureTile
          icon={CalendarDays}
          colours={["#fcd34d", "#d97706"]}
          label="Days recorded"
          alert={missingDates.length > 0 ? "warning" : undefined}
          value={
            workingDaysToDate > 0 ? (
              <>
                {recordedWorking}{" "}
                <span className="text-sm font-bold text-muted-foreground">/ {workingDaysToDate}</span>
              </>
            ) : (
              "—"
            )
          }
          detail={
            workingDaysToDate === 0
              ? "This period has not started"
              : report.workingDays > workingDaysToDate
                ? "working days so far"
                : "working days"
          }
        />
      </DprFigureRow>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <DprReportCard
          icon={Users}
          colours={["#c4b5fd", "#7c3aed"]}
          title="Manpower by trade"
          subtitle={`${scopeLabel} · ${periodChoiceLabel} · ${periodLabel}`}
        >
          {rows.length === 0 ? (
            <DprReportZero
              icon={Users}
              colours={["#c4b5fd", "#7c3aed"]}
              glow={["rgba(196, 181, 253, 0.6)", "rgba(147, 197, 253, 0.5)"]}
              title="No manpower recorded"
              text="Trades and headcount entered on submitted daily sheets for this period roll up here."
            />
          ) : (
            <>
              <TradeCards rows={rows} colourOf={colourOf} />
              <TradeTable rows={rows} total={totalManDays} colourOf={colourOf} dark={dark} />
            </>
          )}
        </DprReportCard>

        <DprReportCard
          icon={PieChart}
          colours={["#f9a8d4", "#db2777"]}
          title="Share of man-days"
          subtitle={`This ${periodNoun}`}
        >
          <div className="space-y-3 p-4 sm:p-5">
            {rows.length > 0 ? <ShareDonut rows={rows} total={totalManDays} colourOf={colourOf} dark={dark} /> : null}
            <Coverage
              report={report}
              recordedWorking={recordedWorking}
              periodNoun={periodNoun}
              entryHref={(date) =>
                dprHref(`${DPR_BASE_PATH}/entry`, mappingId, scope === "All" ? { date } : { date, scope })
              }
            />
          </div>
        </DprReportCard>
      </div>
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────────────────────────── */

/** One coloured card per trade, largest first; past six, the table carries the rest. */
const CARD_LIMIT = 6;

function TradeCards({ rows, colourOf }: { rows: readonly DprManpowerTradeRow[]; colourOf: (trade: string) => TradeColour }) {
  const shown = rows.slice(0, CARD_LIMIT);
  return (
    <div className="px-4 pb-1 pt-4 sm:px-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {shown.map((row) => {
          const colour = colourOf(row.trade);
          const Icon = tradeIcon(row.trade);
          return (
            <div
              key={row.trade}
              className="keep-light relative min-w-0 overflow-hidden rounded-[18px] p-4 text-white"
              style={{
                backgroundImage: `radial-gradient(240px 120px at 100% 0%, rgba(255, 255, 255, 0.2), transparent 70%), linear-gradient(140deg, ${colour.card[0]}, ${colour.card[1]})`,
                boxShadow: `0 16px 30px -20px ${colour.card[1]}`,
              }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border border-white/35 bg-white/20"
                  aria-hidden="true"
                >
                  <Icon className="h-[19px] w-[19px]" />
                </span>
                <div className="min-w-0">
                  <b className="block truncate text-base font-extrabold" title={row.trade}>
                    {row.trade}
                  </b>
                  <small className="block text-[11.5px] font-semibold text-white/90">Trade</small>
                </div>
                <span className="ml-auto shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-[13px] font-extrabold tabular-nums">
                  {pct(row.sharePct)}
                </span>
              </div>
              <div className="mb-0.5 mt-3 text-[38px] font-extrabold leading-none tracking-tight">
                {fmt(row.manDays)}
                <small className="ml-1.5 text-[13px] font-bold text-white/90">man-days</small>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {[
                  ["Days", String(row.days)],
                  ["Peak", fmt(row.peak)],
                  ["Avg / day", avg(row.avgPerDay)],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 rounded-[11px] border border-white/25 bg-white/15 px-2 py-1.5">
                    <small className="block truncate text-[10.5px] font-bold text-white/90">{label}</small>
                    <b className="block truncate text-base font-extrabold tabular-nums">{value}</b>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {rows.length > CARD_LIMIT ? (
        <p className="pt-3 text-xs text-muted-foreground">
          The {CARD_LIMIT} largest of {rows.length} trades — every trade is in the table below.
        </p>
      ) : null}
    </div>
  );
}

type SortKey = "trade" | "manDays" | "days" | "peak" | "avgPerDay";
const COLUMNS: Array<{ key: SortKey; label: string; title: string }> = [
  { key: "trade", label: "Trade", title: "Trade" },
  { key: "manDays", label: "Man-days", title: "Headcount summed over the days on site" },
  { key: "days", label: "Days", title: "Dates the trade was on site" },
  { key: "peak", label: "Peak", title: "The largest headcount on any one date" },
  { key: "avgPerDay", label: "Avg / day", title: "Average headcount per day on site" },
];

function TradeTable({
  rows,
  total,
  colourOf,
  dark,
}: {
  rows: readonly DprManpowerTradeRow[];
  total: number;
  colourOf: (trade: string) => TradeColour;
  dark: boolean;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: "manDays", direction: -1 });
  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const compared =
        sort.key === "trade" ? a.trade.localeCompare(b.trade) : (a[sort.key] as number) - (b[sort.key] as number);
      return compared * sort.direction || a.trade.localeCompare(b.trade);
    });
    return list;
  }, [rows, sort]);

  return (
    <div className="mt-3 border-t border-border/60">
      <Table stickyHeader containerClassName="max-h-[50vh]" className="min-w-[520px] table-fixed">
        <colgroup>
          <col />
          <col className="w-[112px]" />
          <col className="w-[88px]" />
          <col className="w-[88px]" />
          <col className="w-[104px]" />
        </colgroup>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((column) => {
              const active = sort.key === column.key;
              return (
                <TableHead
                  key={column.key}
                  className={cn(column.key !== "trade" && "text-right")}
                  aria-sort={active ? (sort.direction > 0 ? "ascending" : "descending") : "none"}
                >
                  <button
                    type="button"
                    title={`${column.title} — sort`}
                    className={cn(
                      "inline-flex max-w-full items-center gap-1 truncate font-bold uppercase tracking-wide hover:text-foreground",
                      active ? "text-violet-700" : "",
                    )}
                    onClick={() =>
                      setSort((current) =>
                        current.key === column.key
                          ? { key: column.key, direction: current.direction === 1 ? -1 : 1 }
                          : { key: column.key, direction: column.key === "trade" ? 1 : -1 },
                      )
                    }
                  >
                    {column.label}
                    {active ? (
                      sort.direction > 0 ? (
                        <ArrowUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                      ) : (
                        <ArrowDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                      )
                    ) : null}
                  </button>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => {
            const colour = dark ? colourOf(row.trade).dark : colourOf(row.trade).light;
            return (
              <TableRow key={row.trade}>
                <TableCell className="truncate text-sm" style={{ boxShadow: `inset 3px 0 0 ${colour}` }} title={row.trade}>
                  <span className="inline-flex max-w-full items-center gap-2 font-extrabold">
                    <i className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ backgroundColor: colour }} aria-hidden="true" />
                    <span className="truncate">{row.trade}</span>
                  </span>
                </TableCell>
                <TableCell className="truncate text-right text-sm font-extrabold tabular-nums">{fmt(row.manDays)}</TableCell>
                <TableCell className="truncate text-right text-sm font-semibold tabular-nums">{row.days}</TableCell>
                <TableCell className="truncate text-right text-sm font-semibold tabular-nums">{fmt(row.peak)}</TableCell>
                <TableCell className="truncate text-right text-sm font-semibold tabular-nums">{avg(row.avgPerDay)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow className="bg-violet-50 font-extrabold text-violet-900 hover:bg-violet-50">
            <TableCell className="text-sm" style={{ boxShadow: "inset 3px 0 0 #7c3aed" }}>
              Total
            </TableCell>
            <TableCell className="text-right text-sm tabular-nums">{fmt(total)}</TableCell>
            <TableCell />
            <TableCell />
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

/** A segment per trade (a ninth and on folded into "Other"), 2px surface gaps, hover for figures. */
function ShareDonut({
  rows,
  total,
  colourOf,
  dark,
}: {
  rows: readonly DprManpowerTradeRow[];
  total: number;
  colourOf: (trade: string) => TradeColour;
  dark: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const parts = useMemo(() => {
    const named: Array<{ key: string; label: string; manDays: number; colour: string }> = [];
    let other = 0;
    let otherCount = 0;
    for (const row of rows) {
      const colour = colourOf(row.trade);
      if (colour === OTHER) {
        other += row.manDays;
        otherCount += 1;
      } else {
        named.push({ key: row.trade, label: row.trade, manDays: row.manDays, colour: dark ? colour.dark : colour.light });
      }
    }
    if (other > 0) {
      named.push({
        key: "__other__",
        label: `Other (${otherCount} trade${otherCount === 1 ? "" : "s"})`,
        manDays: other,
        colour: dark ? OTHER.dark : OTHER.light,
      });
    }
    return named;
  }, [rows, colourOf, dark]);

  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  const gap = parts.length > 1 ? 3 : 0;
  let offset = 0;
  const focus = parts.find((part) => part.key === hovered) ?? null;

  return (
    <div>
      <div className="relative mx-auto mb-3 h-[200px] w-[200px]">
        <svg
          viewBox="0 0 200 200"
          className="h-full w-full"
          role="img"
          aria-label={`Share of ${fmt(total)} man-days: ${parts.map((part) => `${part.label} ${pct((part.manDays / total) * 100)}`).join(", ")}`}
        >
          <circle r={radius} cx={100} cy={100} fill="none" className="stroke-muted" strokeWidth={22} />
          {parts.map((part) => {
            const length = (part.manDays / total) * circumference;
            const dash = Math.max(length - gap, 0.5);
            const segment = (
              <circle
                key={part.key}
                r={radius}
                cx={100}
                cy={100}
                fill="none"
                stroke={part.colour}
                strokeWidth={22}
                strokeDasharray={`${dash} ${circumference}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 100 100)"
                opacity={hovered && hovered !== part.key ? 0.35 : 1}
                className="cursor-default transition-opacity"
                onMouseEnter={() => setHovered(part.key)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{`${part.label}: ${fmt(part.manDays)} man-days · ${pct((part.manDays / total) * 100)}`}</title>
              </circle>
            );
            offset += length;
            return segment;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <b className="block text-[44px] font-extrabold leading-none tracking-tight tabular-nums">
              {fmt(focus ? focus.manDays : total)}
            </b>
            <small className="block max-w-[7.5rem] truncate font-bold text-muted-foreground">
              {focus ? focus.label : "man-days"}
            </small>
          </div>
        </div>
      </div>
      <ul className="space-y-1.5">
        {parts.map((part) => (
          <li
            key={part.key}
            className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-3 py-2"
            onMouseEnter={() => setHovered(part.key)}
            onMouseLeave={() => setHovered(null)}
          >
            <i className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: part.colour }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-bold" title={part.label}>
              {part.label}
            </span>
            <b className="font-extrabold tabular-nums">{fmt(part.manDays)}</b>
            <em className="w-11 text-right font-extrabold not-italic tabular-nums text-muted-foreground">
              {pct((part.manDays / total) * 100)}
            </em>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Whether every working day so far has manpower on it — and if not, which ones are missing. */
function Coverage({
  report,
  recordedWorking,
  periodNoun,
  entryHref,
}: {
  report: DprManpowerReport;
  recordedWorking: number;
  periodNoun: string;
  entryHref: (date: string) => string;
}) {
  const { workingDaysToDate, missingDates } = report;
  if (workingDaysToDate === 0) return null;
  const days = `working day${workingDaysToDate === 1 ? "" : "s"}`;
  if (missingDates.length === 0) {
    return (
      <DprReportCallout tone="success" title="Every working day so far has manpower recorded">
        {recordedWorking} of {workingDaysToDate} {days} this {periodNoun}.
      </DprReportCallout>
    );
  }
  const shown = missingDates.slice(0, 4).map((date) => dprShortDate(date));
  const more = missingDates.length - shown.length;
  return (
    <DprReportCallout
      tone="warning"
      title={`Only ${recordedWorking} of ${workingDaysToDate} ${days} recorded`}
      action={
        <Button asChild size="sm" variant="outline" className="h-7 rounded-lg bg-background px-2.5 text-xs">
          <Link href={entryHref(missingDates[0])}>Record {dprShortDate(missingDates[0])}</Link>
        </Button>
      }
    >
      No manpower on {shown.join(", ")}
      {more > 0 ? ` and ${more} more` : ""} — check the daily sheets.
    </DprReportCallout>
  );
}
