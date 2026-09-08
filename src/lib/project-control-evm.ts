/**
 * Earned Value Management.
 *
 * Small, because by the time it runs the hard work is done: `project-control-baseline.ts` has
 * produced PV, `project-control-progress.ts` has produced EV, and cost has produced AC. This
 * module is the arithmetic that turns three numbers into the seven a manager actually reads.
 *
 * Two things in here are decisions rather than formulae, and both are the reason this is its own
 * module rather than a few lines in a component.
 *
 * ## 1. Undefined, not zero
 *
 * `SPI = EV / PV` and `CPI = EV / AC` are undefined before a project has any plan or any cost, and
 * every one of them returns `undefined` in that case — never `0`, never `Infinity`, never `NaN`.
 *
 * This matters more than it looks. A project in its first week has AC = 0, so a CPI of `0` would
 * render as "0.00 🔴 — critical cost overrun" on a project that has not spent anything, and an
 * `Infinity` would render as "∞". Either one trains people to ignore the indicator, which is worse
 * than not showing it. `undefined` renders as "—", which is the truth.
 *
 * ## 2. Two forecasts, deliberately kept apart
 *
 * `eacBottomUp` is what the discipline owners say it will cost: actual to date plus their own
 * estimate to complete. `eacStatistical` is `BAC / CPI` — what it will cost if the project keeps
 * performing exactly as it has so far.
 *
 * They disagree, and the disagreement is the point. A manager forecasting on budget while running
 * a CPI of 0.85 is either about to recover, or is not reforecasting honestly, and nothing else in
 * a report surfaces that. So both are computed, and the gap between them raises its own
 * exception rather than being averaged away into a single comfortable number.
 *
 * Pure (no Firebase, no React) so every guard is unit-testable with `node --test`.
 */

export const EVM_PERMISSION_RESOURCE = "Project Management.EVM";

export interface EvmInput {
  /** Budget At Completion — Σ baseline budget value. */
  bac: number;
  /** Planned Value as of the reporting date. */
  pv: number;
  /** Earned Value as of the reporting date. */
  ev: number;
  /** Actual Cost booked to the reporting date. */
  ac: number;
  /** Estimate To Complete from the discipline owners, when a forecast has been submitted. */
  etcBottomUp?: number;
  /** Gap between the two EACs, as a % of BAC, past which credibility is flagged. */
  forecastCredibilityGapPct?: number;
  /** For the forecast completion date. */
  plannedStartDate?: string;
  plannedEndDate?: string;
  asOfDate?: string;
}

export interface EvmResult {
  bac: number;
  pv: number;
  ev: number;
  ac: number;

  /** EV − PV. Negative means behind schedule, in money. */
  sv: number;
  /** EV − AC. Negative means over cost, in money. */
  cv: number;

  /** EV / PV. Undefined until there is a plan to be measured against. */
  spi?: number;
  /** EV / AC. Undefined until something has been spent. */
  cpi?: number;

  /** Owner-supplied ETC, echoed for the dashboard. */
  etcBottomUp?: number;
  /** AC + owner ETC. Undefined when no forecast has been submitted. */
  eacBottomUp?: number;
  /** BAC / CPI. Undefined until CPI exists. */
  eacStatistical?: number;
  /** The EAC used for variance — bottom-up when submitted, else statistical. */
  eac?: number;
  /** BAC − EAC. Negative means a forecast overrun. */
  vac?: number;
  /** (BAC − EV) / (BAC − AC) — the efficiency the remaining work must be done at. */
  tcpi?: number;

  /** |eacBottomUp − eacStatistical| ÷ BAC, as a percentage. Undefined unless both exist. */
  forecastGapPct?: number;
  /** True when that gap exceeds the configured threshold. */
  forecastCredibilityFlag: boolean;

  /** Planned end slipped by SPI. Undefined without a planned window or an SPI. */
  forecastCompletionDate?: string;
  /** Days between planned and forecast completion. Positive means late. */
  forecastSlipDays?: number;

  overBudget: boolean;
  behindSchedule: boolean;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** A ratio, or undefined when the denominator cannot support one. Never 0, Infinity or NaN. */
function safeRatio(numerator: number, denominator: number): number | undefined {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return undefined;
  if (denominator === 0) return undefined;
  const value = numerator / denominator;
  return Number.isFinite(value) ? round3(value) : undefined;
}

const parseLocalDate = (value?: string): Date | null => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

export function computeEvm(input: EvmInput): EvmResult {
  const bac = Number.isFinite(input.bac) ? input.bac : 0;
  const pv = Number.isFinite(input.pv) ? input.pv : 0;
  const ev = Number.isFinite(input.ev) ? input.ev : 0;
  const ac = Number.isFinite(input.ac) ? input.ac : 0;

  const spi = safeRatio(ev, pv);
  const cpi = safeRatio(ev, ac);

  const etcBottomUp =
    input.etcBottomUp != null && Number.isFinite(input.etcBottomUp)
      ? round2(input.etcBottomUp)
      : undefined;
  const eacBottomUp = etcBottomUp != null ? round2(ac + etcBottomUp) : undefined;
  const eacStatistical = cpi != null && cpi > 0 ? round2(bac / cpi) : undefined;

  // The owner's forecast is the accountable one, so it wins when it exists; the statistical figure
  // is the challenge to it, not a replacement for it.
  const eac = eacBottomUp ?? eacStatistical;
  const vac = eac != null ? round2(bac - eac) : undefined;

  // TCPI: the cost efficiency the remaining work has to achieve to still land on budget.
  // Undefined once AC has reached BAC — at that point no efficiency saves it, and a huge or
  // negative number would imply a target rather than an impossibility.
  const remainingBudget = bac - ac;
  const tcpi = remainingBudget > 0 ? safeRatio(bac - ev, remainingBudget) : undefined;

  const gapThreshold = input.forecastCredibilityGapPct ?? 5;
  const forecastGapPct =
    eacBottomUp != null && eacStatistical != null && bac > 0
      ? round2((Math.abs(eacBottomUp - eacStatistical) / bac) * 100)
      : undefined;

  const { forecastCompletionDate, forecastSlipDays } = forecastCompletion(input, spi);

  return {
    bac: round2(bac),
    pv: round2(pv),
    ev: round2(ev),
    ac: round2(ac),
    sv: round2(ev - pv),
    cv: round2(ev - ac),
    spi,
    cpi,
    etcBottomUp,
    eacBottomUp,
    eacStatistical,
    eac,
    vac,
    tcpi,
    forecastGapPct,
    forecastCredibilityFlag: forecastGapPct != null && forecastGapPct > gapThreshold,
    forecastCompletionDate,
    forecastSlipDays,
    overBudget: vac != null && vac < 0,
    behindSchedule: spi != null && spi < 1,
  };
}

/**
 * Forecast completion by stretching the planned duration by 1/SPI.
 *
 * Crude, and deliberately so: a real forecast date comes from a re-planned schedule, which this
 * application does not hold. What this gives is the arithmetic consequence of the current rate —
 * "at this pace, this is when it lands" — which is the right input to a conversation about
 * whether to re-plan. It is skipped entirely when SPI is undefined or the project is not yet
 * under way, rather than guessing.
 */
function forecastCompletion(
  input: EvmInput,
  spi: number | undefined,
): { forecastCompletionDate?: string; forecastSlipDays?: number } {
  const start = parseLocalDate(input.plannedStartDate);
  const end = parseLocalDate(input.plannedEndDate);
  if (!start || !end || spi == null || spi <= 0) return {};

  const plannedDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (plannedDays <= 0) return {};

  const forecastDays = Math.round(plannedDays / spi);
  const forecast = new Date(start.getTime());
  forecast.setDate(forecast.getDate() + forecastDays);

  return {
    forecastCompletionDate: toDateKey(forecast),
    forecastSlipDays: forecastDays - plannedDays,
  };
}

/* ── Presentation helpers ───────────────────────────────────────────────────────────────────── */

export type EvmHealth = "good" | "warn" | "bad" | "unknown";

/**
 * Traffic-lighting an index. `unknown` — not `bad` — when the index is undefined, so a project
 * that has not started reads as "no data" rather than "critical".
 */
export function evmIndexHealth(
  index: number | undefined,
  redBelow: number,
  warnBelow = 1,
): EvmHealth {
  if (index == null) return "unknown";
  if (index < redBelow) return "bad";
  if (index < warnBelow) return "warn";
  return "good";
}

export const evmHealthStyles: Record<EvmHealth, string> = {
  good: "bg-emerald-100 text-emerald-700",
  warn: "bg-amber-100 text-amber-700",
  bad: "bg-red-100 text-red-700",
  unknown: "bg-muted text-muted-foreground",
};

/** Indices render to two decimals; an absent one renders as an em dash, never as 0.00. */
export const formatEvmIndex = (index: number | undefined): string =>
  index == null ? "—" : index.toFixed(2);
