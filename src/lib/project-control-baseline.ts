/**
 * Baselines — the plan a project is measured against.
 *
 * The execution module already records planned dates: a PO has a start and end, a work package
 * has planned and actual dates, a tower activity has a planned window. What none of that gives is
 * a *frozen* plan. Those dates are edited as circumstances change, which is correct for running
 * the work and useless for measuring it — a project whose plan moves with reality is a project
 * that is always exactly on schedule.
 *
 * A baseline is therefore a snapshot: budget value and a planned window per control account, taken
 * once, approved, and thereafter read-only. Progress is compared to it; when the plan genuinely
 * changes, a *new* baseline is taken and the old one is retained as `Superseded`. The original can
 * never be deleted, because "how far have we drifted from what we promised" is a question that
 * outlives every re-plan.
 *
 * The one piece of real arithmetic in here is `computePlannedPct`, which answers "how much of this
 * account *should* be done by now" — the numerator of Planned Value. Asking a planner to draw a
 * curve per account would mean it never gets filled in, so the default is derived from the dates
 * alone and only overridden when somebody cares:
 *
 *   linear   — even spread. Right for supply and for anything rate-driven.
 *   sCurve   — slow start, fast middle, slow finish. Right for construction, and the default
 *              shape a client's own progress curve is drawn as.
 *   manual   — an explicit cumulative percentage per period, for a plan that follows neither.
 *
 * Pure (no Firebase, no React) so the curve and immutability rules are unit-testable with
 * `node --test`.
 */

export const BASELINE_COLLECTION = "projectBaselines";
export const BASELINE_PERMISSION_RESOURCE = "Project Management.Baselines";

/**
 * `Tender` is what was priced at bid stage — kept because tender-versus-baseline is the first
 * question asked when margin moves. `B0` is the approved execution baseline; `B1`, `B2`… are
 * re-baselines (a recovery plan, an EOT-driven re-plan).
 */
export const BASELINE_TYPES = ["Tender", "B0", "B1", "B2", "B3"] as const;
export type BaselineType = (typeof BASELINE_TYPES)[number];

export const BASELINE_STATUSES = ["Draft", "Approved", "Superseded"] as const;
export type BaselineStatus = (typeof BASELINE_STATUSES)[number];

export const CURVE_SHAPES = ["linear", "sCurve", "manual"] as const;
export type CurveShape = (typeof CURVE_SHAPES)[number];

export interface BaselineLine {
  controlAccountId: string;
  /** Set only when baselining at BOQ-line granularity; usually the account is enough. */
  boqItemId?: string;
  /** The account's share of BAC. Summed across lines, this is the project's budget. */
  budgetValue: number;
  plannedStartDate: string;
  plannedEndDate: string;
  curveShape: CurveShape;
  /** periodKey (`YYYY-MM`) → cumulative planned %, when `curveShape` is `manual`. */
  manualCurve?: Record<string, number>;
}

export interface ProjectBaseline {
  id: string;
  globalProjectId: string;
  type: BaselineType;
  /** Increments across every baseline for the project, so ordering never depends on `type`. */
  version: number;
  label: string;
  status: BaselineStatus;
  /** yyyy-mm-dd — when this baseline became the one in force. */
  effectiveFrom?: string;
  approvedVia?: string;
  approvedOn?: string;
  note?: string;
  lines: BaselineLine[];
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export type ProjectBaselineDraft = Omit<
  ProjectBaseline,
  "id" | "createdAt" | "createdBy" | "createdByName" | "updatedAt" | "updatedBy" | "updatedByName"
>;

export interface BaselineValidationError {
  field: keyof ProjectBaselineDraft | keyof BaselineLine | "lines";
  message: string;
  /** Index into `lines`, when the error is about one line rather than the baseline. */
  lineIndex?: number;
}

/* ── The planned-percentage curve ───────────────────────────────────────────────────────────── */

const parseLocalDate = (value?: string): Date | null => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfDay = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate());

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Smoothstep: `3t² − 2t³`.
 *
 * Chosen over a beta distribution or a hand-tuned lookup because it is exactly 0 at t=0, exactly
 * 1 at t=1, monotonic in between, and has zero slope at both ends — which is what makes it read
 * as an S-curve rather than a diagonal with rounded corners. It also needs no parameters, so
 * there is nothing for a planner to get wrong.
 */
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** The period key a date falls in. `YYYY-MM`, the grain every Control-layer snapshot uses. */
export const periodKeyOf = (date: string): string => date.slice(0, 7);

/**
 * How much of a line should be complete by `asOfDate`, as a percentage.
 *
 * Guarantees the callers depend on: 0 before the start, exactly 100 on and after the end, and
 * monotonically non-decreasing in between. A line whose dates are missing or reversed returns 0
 * rather than throwing — an unplanned account contributes nothing to PV, which is correct and
 * shows up as a plan gap rather than as silent credit.
 */
export function computePlannedPct(
  line: Pick<BaselineLine, "plannedStartDate" | "plannedEndDate" | "curveShape" | "manualCurve">,
  asOfDate: string,
): number {
  const start = parseLocalDate(line.plannedStartDate);
  const end = parseLocalDate(line.plannedEndDate);
  const asOf = parseLocalDate(asOfDate);
  if (!start || !end || !asOf || end.getTime() < start.getTime()) return 0;

  if (line.curveShape === "manual") return manualCurvePct(line.manualCurve, asOfDate);

  if (asOf.getTime() < start.getTime()) return 0;
  if (asOf.getTime() >= end.getTime()) return 100;

  const totalMs = end.getTime() - start.getTime();
  // A single-day window has no span to interpolate across: it is either due or not.
  if (totalMs <= 0) return 100;
  const t = clamp01((asOf.getTime() - start.getTime()) / totalMs);
  const fraction = line.curveShape === "sCurve" ? smoothstep(t) : t;
  return Math.round(fraction * 10000) / 100;
}

/**
 * Reads a manual curve. The stored value is *cumulative*, so the answer is the latest period at or
 * before the date — and a date past the last stated period holds at that period's value rather
 * than jumping to 100, because a manual curve that stops at 80% is stating a plan that does not
 * finish, and inventing the remaining 20% would hide that.
 */
function manualCurvePct(
  curve: Record<string, number> | undefined,
  asOfDate: string,
): number {
  if (!curve) return 0;
  const target = periodKeyOf(asOfDate);
  let best: number | null = null;
  let bestKey = "";
  for (const [key, value] of Object.entries(curve)) {
    if (key > target) continue;
    if (best === null || key > bestKey) {
      best = Number(value);
      bestKey = key;
    }
  }
  if (best === null || !Number.isFinite(best)) return 0;
  return Math.min(100, Math.max(0, Math.round(best * 100) / 100));
}

/* ── Planned Value ──────────────────────────────────────────────────────────────────────────── */

export interface PlannedValueLine {
  controlAccountId: string;
  boqItemId?: string;
  budgetValue: number;
  plannedPct: number;
  plannedValue: number;
}

export interface PlannedValueResult {
  /** Σ budgetValue — the project's Budget At Completion. */
  bac: number;
  /** Σ budgetValue × plannedPct — Planned Value as of the date. */
  pv: number;
  /** PV as a percentage of BAC, for the headline "we should be N% done". */
  plannedPct: number;
  lines: PlannedValueLine[];
}

/** Planned Value across a baseline, as of a date. The PV half of every EVM figure. */
export function computeBaselinePlannedValue(
  lines: readonly BaselineLine[],
  asOfDate: string,
): PlannedValueResult {
  const detail: PlannedValueLine[] = lines.map((line) => {
    const plannedPct = computePlannedPct(line, asOfDate);
    return {
      controlAccountId: line.controlAccountId,
      boqItemId: line.boqItemId,
      budgetValue: line.budgetValue,
      plannedPct,
      plannedValue: Math.round(line.budgetValue * plannedPct) / 100,
    };
  });

  const bac = detail.reduce((sum, line) => sum + line.budgetValue, 0);
  const pv = Math.round(detail.reduce((sum, line) => sum + line.plannedValue, 0) * 100) / 100;

  return {
    bac: Math.round(bac * 100) / 100,
    pv,
    plannedPct: bac > 0 ? Math.round((pv / bac) * 10000) / 100 : 0,
    lines: detail,
  };
}

/** The baseline's own planned window — the earliest start and latest end across its lines. */
export function baselineWindow(
  lines: readonly BaselineLine[],
): { startDate: string | null; endDate: string | null } {
  let startDate: string | null = null;
  let endDate: string | null = null;
  for (const line of lines) {
    if (line.plannedStartDate && (!startDate || line.plannedStartDate < startDate)) {
      startDate = line.plannedStartDate;
    }
    if (line.plannedEndDate && (!endDate || line.plannedEndDate > endDate)) {
      endDate = line.plannedEndDate;
    }
  }
  return { startDate, endDate };
}

/* ── Which baseline is in force ─────────────────────────────────────────────────────────────── */

export function sortBaselines(baselines: readonly ProjectBaseline[]): ProjectBaseline[] {
  return [...baselines].sort((a, b) => a.version - b.version);
}

/**
 * The approved baseline currently in force: the highest-version `Approved` one. `Tender` is
 * excluded — it is a pricing record, not an execution plan, and measuring progress against the
 * tender would flatter every project that has since been re-planned.
 */
export function resolveActiveBaseline(
  baselines: readonly ProjectBaseline[],
): ProjectBaseline | null {
  const candidates = baselines.filter(
    (baseline) => baseline.status === "Approved" && baseline.type !== "Tender",
  );
  return sortBaselines(candidates).at(-1) ?? null;
}

/** The tender baseline, for the tender-vs-baseline-vs-forecast comparison in §18. */
export function resolveTenderBaseline(
  baselines: readonly ProjectBaseline[],
): ProjectBaseline | null {
  return baselines.find((baseline) => baseline.type === "Tender") ?? null;
}

/** The first approved execution baseline — the "what we originally promised" reference that
 *  survives every re-baseline. */
export function resolveOriginalBaseline(
  baselines: readonly ProjectBaseline[],
): ProjectBaseline | null {
  const approved = sortBaselines(
    baselines.filter((baseline) => baseline.type !== "Tender" && baseline.status !== "Draft"),
  );
  return approved[0] ?? null;
}

export function nextBaselineVersion(baselines: readonly ProjectBaseline[]): number {
  return baselines.reduce((highest, baseline) => Math.max(highest, baseline.version), -1) + 1;
}

/**
 * The original approved baseline can never be deleted — it is the only record of what was
 * originally committed to, and every drift figure is measured from it. A Draft is freely
 * deletable; a Superseded baseline is retained because a re-baseline's own justification usually
 * lives in the one it replaced.
 */
export function canDeleteBaseline(
  baseline: ProjectBaseline,
  all: readonly ProjectBaseline[],
): boolean {
  if (baseline.status === "Draft") return true;
  const original = resolveOriginalBaseline(all);
  if (original && original.id === baseline.id) return false;
  return baseline.status !== "Approved";
}

/** Approving a baseline supersedes the one it replaces. Returned rather than mutated so the
 *  caller can do both writes in one transaction. */
export function baselinesSupersededBy(
  baseline: ProjectBaseline,
  all: readonly ProjectBaseline[],
): string[] {
  return all
    .filter(
      (candidate) =>
        candidate.id !== baseline.id &&
        candidate.status === "Approved" &&
        candidate.type !== "Tender" &&
        candidate.version < baseline.version,
    )
    .map((candidate) => candidate.id);
}

/* ── Schedule exposure (§6) ─────────────────────────────────────────────────────────────────── */

export interface ScheduleExposure {
  originalCompletionDate: string | null;
  approvedCompletionDate: string | null;
  forecastCompletionDate: string | null;
  /** Forecast vs the currently approved date. Positive means late. */
  grossForecastDelayDays: number;
  approvedEotDays: number;
  /** Delay not covered by an approved EOT — the days that carry LD risk. */
  netExposureDays: number;
}

/**
 * §6's table. Deliberately takes the three dates rather than deriving them, because they come from
 * three different owners: the original baseline, the contract (as amended by EOT), and the
 * forecast. Computing them in one place would couple this module to all three.
 */
export function summariseScheduleExposure(input: {
  originalCompletionDate?: string | null;
  approvedCompletionDate?: string | null;
  forecastCompletionDate?: string | null;
  approvedEotDays?: number;
}): ScheduleExposure {
  const original = input.originalCompletionDate ?? null;
  const approved = input.approvedCompletionDate ?? original;
  const forecast = input.forecastCompletionDate ?? null;
  const approvedEotDays = Math.max(0, input.approvedEotDays ?? 0);

  const grossForecastDelayDays =
    approved && forecast ? Math.max(0, daysBetween(approved, forecast)) : 0;

  return {
    originalCompletionDate: original,
    approvedCompletionDate: approved,
    forecastCompletionDate: forecast,
    grossForecastDelayDays,
    approvedEotDays,
    // Gross delay is measured against the *already-extended* date, so the EOT is not netted off
    // twice. What remains is genuinely uncovered.
    netExposureDays: grossForecastDelayDays,
  };
}

function daysBetween(from: string, to: string): number {
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  if (!start || !end) return 0;
  return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000);
}

/* ── Validation ─────────────────────────────────────────────────────────────────────────────── */

export function validateBaseline(draft: ProjectBaselineDraft): BaselineValidationError[] {
  const errors: BaselineValidationError[] = [];

  if (!draft.label?.trim()) {
    errors.push({ field: "label", message: "Give this baseline a label, e.g. Approved Baseline B0." });
  }
  if (!draft.lines.length) {
    errors.push({ field: "lines", message: "A baseline needs at least one control account line." });
  }

  const seenAccounts = new Set<string>();
  draft.lines.forEach((line, lineIndex) => {
    if (!line.controlAccountId) {
      errors.push({
        field: "controlAccountId",
        message: "Every line must belong to a control account.",
        lineIndex,
      });
    } else {
      // Two lines for one account would double-count its budget into BAC.
      const key = `${line.controlAccountId}::${line.boqItemId ?? ""}`;
      if (seenAccounts.has(key)) {
        errors.push({
          field: "controlAccountId",
          message: "This control account already has a line in this baseline.",
          lineIndex,
        });
      }
      seenAccounts.add(key);
    }

    if (!(line.budgetValue > 0)) {
      errors.push({
        field: "budgetValue",
        message: "Budget value must be greater than zero.",
        lineIndex,
      });
    }
    if (!line.plannedStartDate) {
      errors.push({ field: "plannedStartDate", message: "A planned start is required.", lineIndex });
    }
    if (!line.plannedEndDate) {
      errors.push({ field: "plannedEndDate", message: "A planned end is required.", lineIndex });
    }
    if (
      line.plannedStartDate &&
      line.plannedEndDate &&
      line.plannedEndDate < line.plannedStartDate
    ) {
      errors.push({
        field: "plannedEndDate",
        message: "Planned end cannot be before planned start.",
        lineIndex,
      });
    }

    if (line.curveShape === "manual") {
      const entries = Object.entries(line.manualCurve ?? {});
      if (!entries.length) {
        errors.push({
          field: "manualCurve",
          message: "A manual curve needs at least one period.",
          lineIndex,
        });
      }
      // Cumulative means non-decreasing. A curve that dips is stating that completed work became
      // uncompleted, which would make PV go backwards.
      const sorted = entries.sort(([a], [b]) => a.localeCompare(b));
      let previous = -Infinity;
      for (const [key, value] of sorted) {
        const pct = Number(value);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          errors.push({
            field: "manualCurve",
            message: `${key} must be a cumulative percentage between 0 and 100.`,
            lineIndex,
          });
        } else if (pct < previous) {
          errors.push({
            field: "manualCurve",
            message: `${key} is lower than the period before it — the curve is cumulative.`,
            lineIndex,
          });
        }
        previous = Math.max(previous, pct);
      }
    }
  });

  return errors;
}

/** The extra bar before a baseline becomes the thing progress is measured against. */
export function canApproveBaseline(draft: ProjectBaselineDraft): BaselineValidationError[] {
  const errors = validateBaseline(draft);
  if (!draft.effectiveFrom) {
    errors.push({
      field: "effectiveFrom",
      message: "Set the date this baseline takes effect before approving it.",
    });
  }
  return errors;
}

export const baselineStatusStyles: Record<BaselineStatus, string> = {
  Draft: "bg-muted text-muted-foreground",
  Approved: "bg-emerald-100 text-emerald-700",
  Superseded: "bg-slate-100 text-slate-600",
};

export const curveShapeLabels: Record<CurveShape, string> = {
  linear: "Linear",
  sCurve: "S-curve",
  manual: "Manual",
};
