"use client";

import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableScrollArea } from "./module-table-card";

/**
 * Shared chrome for the Recurring Payments "Reports" section. Every report hand-rolled its own
 * hero banner (six different gradients across seven screens, none reliably matching the module's
 * actual emerald/teal brand), metric tile, loading/permission-denied block, and name/count/amount
 * summary table. Centralizing them here means the whole section now looks and behaves like one
 * product, a palette change only has to happen once, and print styling is baked in everywhere
 * instead of only on the overview dashboard.
 */

/**
 * Visualization tokens.
 *
 * `#059669` is the module's emerald, validated against both card surfaces (white in light mode,
 * `#1f1f21` in dark): inside the lightness band, above the chroma floor, and ≥3:1 contrast in each
 * mode. The dark step is selected rather than flipped — `#0e9f6e` reads brighter against the dark
 * card while still sitting inside the dark band.
 *
 * There is deliberately **one** bar colour, not a ramp. The things these tables rank — vendors,
 * payment modes, bank accounts, categories — are nominal, with no inherent order, so shading each
 * bar darker-where-longer would double-encode the length as hue and spend the only free channel
 * restating what the bar already says.
 */
const BAR_FILL = "bg-[#059669] dark:bg-[#0e9f6e]";
const BAR_TRACK = "bg-emerald-100/70 dark:bg-emerald-950";

const inr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);

export function ReportHeader({
  title,
  description,
  hero,
  actions,
}: {
  title: string;
  description: string;
  /** The one number this report leads with. At most one per page — the KPI tiles carry the rest. */
  hero?: { label: string; value: string; hint?: string };
  actions?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {/* A hairline emerald rule instead of the old full-bleed gradient: a large saturated
              block reads loud at page scale and forced every value on top of it to fight the
              background. The accent now marks the page without competing with the data. */}
          <div className="mb-2 h-0.5 w-10 rounded-full bg-[#059669] dark:bg-[#0e9f6e]" />
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
          {hero && (
            <div className="sm:text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{hero.label}</p>
              {/* Proportional figures, not tabular: at display size, equal-width digits make a
                  number like 121 look gapped. tabular-nums belongs in the columns below. */}
              <p className="text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
                {hero.value}
              </p>
              {hero.hint && <p className="text-xs text-muted-foreground">{hero.hint}</p>}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function ReportLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
    </div>
  );
}

export function ReportAccessDenied() {
  return (
    <Card>
      <CardContent className="py-16 text-center">
        <AlertTriangle className="mx-auto mb-3 h-9 w-9 text-amber-500" />
        <p className="font-semibold text-muted-foreground">
          You don&apos;t have permission to view this report.
        </p>
      </CardContent>
    </Card>
  );
}

/** Every report's Firestore listener used to swallow errors into an indistinguishable empty
 * "no records" table. Render this alongside (not instead of) the table when a listener errors, so
 * a permission-denied/offline error reads as an error, not as "there's just no data." */
export function ReportErrorBanner({
  message = "Couldn't load live data for this report. Check your connection, or that you still have access, and try refreshing the page.",
}: {
  message?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

/**
 * Status tones. Measured against this module's own emerald/amber/rose, the amber↔emerald pair sits
 * at CVD ΔE 7.9 — inside the band that is only legal alongside a second, non-colour channel. So a
 * non-neutral tone always renders its own shape-distinct icon (tick / triangle / octagon), even
 * when the caller passes none: the tone may never be the only thing carrying the meaning.
 */
const METRIC_TONES = {
  neutral: {
    chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    value: "",
    icon: undefined,
  },
  good: {
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    value: "",
    icon: CheckCircle2,
  },
  warning: {
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    value: "text-amber-700 dark:text-amber-400",
    icon: AlertTriangle,
  },
  critical: {
    chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400",
    value: "text-rose-700 dark:text-rose-400",
    icon: AlertOctagon,
  },
} as const;

export function ReportMetricTile({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  icon?: React.ElementType;
  tone?: keyof typeof METRIC_TONES;
  /** Short qualifier under the value — the period or basis it covers. */
  hint?: string;
}) {
  const palette = METRIC_TONES[tone];
  const Glyph = Icon || palette.icon;
  return (
    <Card className="min-w-0">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <p className={`mt-1.5 text-2xl font-semibold leading-none tracking-tight ${palette.value}`}>
            {value}
          </p>
          {hint && <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">{hint}</p>}
        </div>
        {Glyph && (
          <div className={`shrink-0 rounded-lg p-2 ${palette.chip}`}>
            <Glyph className="h-4 w-4" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Name / count / amount ranking, with the amount also drawn as a bar.
 *
 * The bar is the point of this component: a column of currency strings makes the reader compare
 * digit counts, while length is read at a glance. Every bar is the same colour — see `BAR_FILL`
 * for why a ramp would be wrong here.
 *
 * Bar length is the share of the **total**, matching the percentage printed beside it. Scaling to
 * the largest row instead would read better as a magnitude comparison, but under a column headed
 * "Share of total" it would put a full-width bar next to a label saying 55% — the mark contradicting
 * its own number. The bar and its label have to state the same fact.
 *
 * The bar is `aria-hidden`: it restates the amount already in the adjacent column, so announcing
 * it again would just make the row twice as long to hear. Nothing is available only as a bar.
 */
export function ReportSummaryTable({
  title,
  description,
  icon: Icon,
  rows,
  nameHeader = "Name",
  countHeader = "Records",
  emptyLabel = "No data yet.",
}: {
  title: string;
  description?: string;
  icon?: React.ElementType;
  rows: Array<{ name: string; count: number; amount: number }>;
  nameHeader?: string;
  countHeader?: string;
  emptyLabel?: string;
}) {
  const ranked = [...rows].sort((a, b) => b.amount - a.amount);
  const total = ranked.reduce((sum, row) => sum + (row.amount || 0), 0);
  const magnitude = ranked.reduce((sum, row) => sum + Math.abs(row.amount || 0), 0);
  const totalCount = ranked.reduce((sum, row) => sum + (row.count || 0), 0);
  return (
    <Card className="min-w-0">
      <CardHeader className="py-4">
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon && <Icon className="h-5 w-5 text-emerald-600" />}
          {title}
        </CardTitle>
        <CardDescription>
          {[
            `${ranked.length.toLocaleString("en-IN")} row${ranked.length === 1 ? "" : "s"}`,
            description,
          ]
            .filter(Boolean)
            .join(" · ")}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <TableScrollArea>
          <Table className="[&_td]:py-2 [&_th]:h-9">
            <TableHeader>
              <TableRow>
                <TableHead>{nameHeader}</TableHead>
                <TableHead className="text-right">{countHeader}</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-[34%] min-w-40">Share of total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.map((row) => {
                const amount = row.amount || 0;
                const sharePct = magnitude ? (Math.abs(amount) / magnitude) * 100 : 0;
                // A row worth a fraction of a percent still isn't nothing, and "0.0%" claims it is.
                const shareLabel = !magnitude
                  ? "—"
                  : amount && sharePct < 0.05
                    ? "<0.1%"
                    : `${sharePct.toFixed(1)}%`;
                return (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.count.toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {inr(amount)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className={`h-2 flex-1 overflow-hidden rounded-[4px] ${BAR_TRACK}`} aria-hidden="true">
                          {/* Square at the baseline, 4px rounded at the data end. `min-w` keeps a
                              small-but-nonzero value from rendering as nothing at all. */}
                          <div
                            className={`h-full rounded-r-[4px] ${BAR_FILL} ${amount ? "min-w-[2px]" : ""}`}
                            style={{ width: `${Math.max(0, Math.min(100, sharePct))}%` }}
                          />
                        </div>
                        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {shareLabel}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!ranked.length && (
                <TableRow>
                  <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                    {emptyLabel}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {ranked.length > 1 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {totalCount.toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{inr(total)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </TableScrollArea>
      </CardContent>
    </Card>
  );
}
