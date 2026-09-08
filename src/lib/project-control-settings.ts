/**
 * Per-project configuration for the Control layer.
 *
 * Everything tunable in Parts 3–7 lands here, in one document per project at
 * `projects/{globalProjectId}/projectControlSettings/config` — the same shape Tower Progress
 * already uses for its own settings, and for the same reason: a dashboard that reads one document
 * to know how to interpret a hundred others is cheap, and a project's rules should travel with the
 * project rather than being an organisation-wide compromise.
 *
 * Two things in here are load-bearing rather than cosmetic:
 *
 *  1. **The supply earning rule.** An issued purchase order is not 5% of a delivered transformer
 *     and it is not 100% of one. §8 fixes weights per stage, and `resolveSupplyEarningRule`
 *     cascades project → scope → BOQ category so a transformer and a box of bolts do not have to
 *     share one. This is what stops earned value being a proxy for procurement activity.
 *
 *  2. **The exception thresholds.** SPI < 0.95 is a red flag on a 765kV line and noise on a
 *     three-month rate contract, so the numbers that raise an exception are configured, not
 *     hardcoded — exactly as `stallDays` and `variationTolerancePct` already are in the execution
 *     module's own general settings.
 *
 * Read tolerantly (`resolveProjectControlSettings`) so a project configured before a field existed,
 * or one with a hand-edited document, still resolves to a complete and usable configuration rather
 * than throwing on a dashboard.
 *
 * Pure (no Firebase, no React) so the cascade and validation rules are unit-testable with
 * `node --test`.
 */

export const CONTROL_SETTINGS_COLLECTION = "projectControlSettings";
export const CONTROL_SETTINGS_DOC_ID = "config";

/* ── Supply earning ─────────────────────────────────────────────────────────────────────────── */

/**
 * The stages a supply BOQ line earns value at, in execution order.
 *
 * These map onto the gate registers that already exist (`supply-gates.ts`) plus MDL for
 * `drawing` — with one exception. `manufacturing` is the interval between Manufacturing Clearance
 * and the inspection call, which no register records, so it earns from an optional
 * `manufacturingProgressPct` on the MC document and contributes 0 until somebody enters one. It is
 * included because §8 allocates it a quarter of the weight, and dropping it would silently
 * redistribute that quarter onto stages that have not happened yet.
 */
export const SUPPLY_EARNING_STAGES = [
  "po",
  "drawing",
  "mc",
  "manufacturing",
  "inspection",
  "mdcc",
  "di",
  "grn",
  "mvac",
] as const;
export type SupplyEarningStage = (typeof SUPPLY_EARNING_STAGES)[number];

export const SUPPLY_EARNING_STAGE_LABELS: Record<SupplyEarningStage, string> = {
  po: "Purchase order placed",
  drawing: "Drawing approved",
  mc: "Manufacturing clearance",
  manufacturing: "Manufacturing",
  inspection: "Inspection passed",
  mdcc: "Client clearance (MDCC)",
  di: "Dispatched (DI)",
  grn: "Received at site (GRN)",
  mvac: "Client accepted (MVAC)",
};

export type SupplyEarningRule = Record<SupplyEarningStage, number>;

/** §8's table verbatim. Totals 100. */
export const DEFAULT_SUPPLY_EARNING_RULE: SupplyEarningRule = {
  po: 5,
  drawing: 5,
  mc: 5,
  manufacturing: 25,
  inspection: 10,
  mdcc: 5,
  di: 15,
  grn: 20,
  mvac: 10,
};

/**
 * A narrower rule for part of the BOQ. Matched on the dimensions the BOQ already carries, the
 * same way a control account is (see `project-control-wbs.ts`), so an override is expressible in
 * terms somebody has already filled in.
 *
 * More specific wins: a rule naming both `scope2` and `category1` beats one naming only `scope2`.
 * That is the same most-specific-wins convention `resolveEApprovalRouting` uses for the approval
 * matrix, rather than a new precedence scheme to learn.
 */
export interface SupplyEarningOverride {
  scope2?: string;
  category1?: string;
  rule: SupplyEarningRule;
}

/* ── Risk ───────────────────────────────────────────────────────────────────────────────────── */

export type RiskProbabilityBand = 1 | 2 | 3 | 4 | 5;

/** Turns a 1–5 probability score into the percentage `computeEmv` multiplies by. Configurable
 *  because "likely" is a house convention, not a fact. */
export const DEFAULT_PROBABILITY_BANDS: Record<RiskProbabilityBand, number> = {
  1: 10,
  2: 30,
  3: 50,
  4: 70,
  5: 90,
};

/* ── The settings document ──────────────────────────────────────────────────────────────────── */

export interface ProjectControlSettings {
  /** Rule applied to any supply line no override matches. */
  supplyEarningRule: SupplyEarningRule;
  supplyEarningOverrides: SupplyEarningOverride[];

  /* Exception thresholds (§34). */
  spiRedBelow: number;
  cpiRedBelow: number;
  /** Forecast margin falling by more than this many points raises a margin warning. */
  marginDropWarnPct: number;
  /** Gap between bottom-up and statistical EAC, as a % of BAC, that raises a credibility flag. */
  forecastCredibilityGapPct: number;

  /* Cash-flow scenarios (§20). */
  bestCaseCollectionDays: number;
  worstCaseCollectionDays: number;
  worstCaseCostEscalationPct: number;
  /** Funding the project can draw on, for the §21 gap. */
  fundingAvailable: number;

  /* Risk (§29). */
  probabilityBands: Record<RiskProbabilityBand, number>;
  /** Residual score at or above which a risk is reported as critical. */
  riskCriticalScore: number;

  /** Whether month close requires the verified earned figure rather than the live one (§3.4a). */
  closeOnVerifiedProgress: boolean;

  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export const DEFAULT_PROJECT_CONTROL_SETTINGS: ProjectControlSettings = {
  supplyEarningRule: { ...DEFAULT_SUPPLY_EARNING_RULE },
  supplyEarningOverrides: [],
  spiRedBelow: 0.95,
  cpiRedBelow: 0.97,
  marginDropWarnPct: 2,
  forecastCredibilityGapPct: 5,
  bestCaseCollectionDays: 30,
  worstCaseCollectionDays: 120,
  worstCaseCostEscalationPct: 5,
  fundingAvailable: 0,
  probabilityBands: { ...DEFAULT_PROBABILITY_BANDS },
  riskCriticalScore: 15,
  closeOnVerifiedProgress: true,
};

/* ── Tolerant reading ───────────────────────────────────────────────────────────────────────── */

const finiteNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
};

const optionalText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

function readEarningRule(raw: unknown, fallback: SupplyEarningRule): SupplyEarningRule {
  const stored = (raw ?? {}) as Record<string, unknown>;
  const rule = { ...fallback };
  for (const stage of SUPPLY_EARNING_STAGES) {
    const value = finiteNumber(stored[stage]);
    if (value !== undefined && value >= 0) rule[stage] = value;
  }
  return rule;
}

/** Reads a stored settings document into a complete configuration. Anything unrecognised or
 *  malformed degrades to the default for that field rather than throwing — one bad document must
 *  not take down a project's whole dashboard. */
export function resolveProjectControlSettings(raw: unknown): ProjectControlSettings {
  const stored = (raw ?? {}) as Partial<ProjectControlSettings> & Record<string, unknown>;
  const defaults = DEFAULT_PROJECT_CONTROL_SETTINGS;

  // Typed as unknown[] on purpose: the stored value is whatever Firestore holds, and the point of
  // this function is to not trust its declared shape.
  const overridesRaw: unknown[] = Array.isArray(stored.supplyEarningOverrides)
    ? (stored.supplyEarningOverrides as unknown[])
    : [];
  const supplyEarningRule = readEarningRule(stored.supplyEarningRule, defaults.supplyEarningRule);

  const bands = { ...defaults.probabilityBands };
  const storedBands = (stored.probabilityBands ?? {}) as Record<string, unknown>;
  for (const key of [1, 2, 3, 4, 5] as RiskProbabilityBand[]) {
    const value = finiteNumber(storedBands[String(key)]);
    if (value !== undefined && value >= 0 && value <= 100) bands[key] = value;
  }

  const positive = (value: unknown, fallback: number) => {
    const parsed = finiteNumber(value);
    return parsed !== undefined && parsed >= 0 ? parsed : fallback;
  };

  return {
    supplyEarningRule,
    supplyEarningOverrides: overridesRaw
      .map((entry) => {
        const item = (entry ?? {}) as Record<string, unknown>;
        return {
          scope2: optionalText(item.scope2),
          category1: optionalText(item.category1),
          rule: readEarningRule(item.rule, supplyEarningRule),
        };
      })
      // An override matching nothing would never fire and only confuse the settings screen.
      .filter((override) => override.scope2 || override.category1),
    spiRedBelow: positive(stored.spiRedBelow, defaults.spiRedBelow),
    cpiRedBelow: positive(stored.cpiRedBelow, defaults.cpiRedBelow),
    marginDropWarnPct: positive(stored.marginDropWarnPct, defaults.marginDropWarnPct),
    forecastCredibilityGapPct: positive(
      stored.forecastCredibilityGapPct,
      defaults.forecastCredibilityGapPct,
    ),
    bestCaseCollectionDays: positive(
      stored.bestCaseCollectionDays,
      defaults.bestCaseCollectionDays,
    ),
    worstCaseCollectionDays: positive(
      stored.worstCaseCollectionDays,
      defaults.worstCaseCollectionDays,
    ),
    worstCaseCostEscalationPct: positive(
      stored.worstCaseCostEscalationPct,
      defaults.worstCaseCostEscalationPct,
    ),
    fundingAvailable: positive(stored.fundingAvailable, defaults.fundingAvailable),
    probabilityBands: bands,
    riskCriticalScore: positive(stored.riskCriticalScore, defaults.riskCriticalScore),
    closeOnVerifiedProgress:
      typeof stored.closeOnVerifiedProgress === "boolean"
        ? stored.closeOnVerifiedProgress
        : defaults.closeOnVerifiedProgress,
  };
}

/* ── The earning-rule cascade ───────────────────────────────────────────────────────────────── */

const normalise = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/** How many dimensions an override names. Higher wins. */
function overrideSpecificity(override: SupplyEarningOverride): number {
  return (override.scope2 ? 1 : 0) + (override.category1 ? 1 : 0);
}

/**
 * The rule that applies to one BOQ line: the most specific matching override, or the project
 * default. Dimensions are compared trimmed and case-insensitively, matching `project-control-wbs`.
 *
 * Ties on specificity resolve to the first override in the list, so the settings screen's own
 * ordering is the tie-break a user can see and change.
 */
export function resolveSupplyEarningRule(
  settings: Pick<ProjectControlSettings, "supplyEarningRule" | "supplyEarningOverrides">,
  dimensions: { scope2?: string; category1?: string },
): SupplyEarningRule {
  let winner: SupplyEarningOverride | null = null;
  for (const override of settings.supplyEarningOverrides) {
    if (override.scope2 && normalise(override.scope2) !== normalise(dimensions.scope2)) continue;
    if (override.category1 && normalise(override.category1) !== normalise(dimensions.category1)) {
      continue;
    }
    if (!winner || overrideSpecificity(override) > overrideSpecificity(winner)) winner = override;
  }
  return winner ? winner.rule : settings.supplyEarningRule;
}

export const earningRuleTotal = (rule: SupplyEarningRule): number =>
  Math.round(SUPPLY_EARNING_STAGES.reduce((sum, stage) => sum + (rule[stage] || 0), 0) * 100) / 100;

/* ── Validation ─────────────────────────────────────────────────────────────────────────────── */

export interface ControlSettingsValidationError {
  field: keyof ProjectControlSettings | SupplyEarningStage | "supplyEarningOverride";
  message: string;
}

export function validateProjectControlSettings(
  draft: ProjectControlSettings,
): ControlSettingsValidationError[] {
  const errors: ControlSettingsValidationError[] = [];

  // Weights must total 100. A rule totalling 90 makes every line permanently 10% short of
  // complete; one totalling 110 lets a line finish before it is delivered.
  const total = earningRuleTotal(draft.supplyEarningRule);
  if (total !== 100) {
    errors.push({
      field: "supplyEarningRule",
      message: `Stage weights must total 100% — they currently total ${total}%.`,
    });
  }
  for (const stage of SUPPLY_EARNING_STAGES) {
    const weight = draft.supplyEarningRule[stage];
    if (!Number.isFinite(weight) || weight < 0) {
      errors.push({
        field: stage,
        message: `${SUPPLY_EARNING_STAGE_LABELS[stage]} weight must be zero or more.`,
      });
    }
  }

  draft.supplyEarningOverrides.forEach((override, index) => {
    const label = override.category1
      ? `${override.scope2 ?? "any scope"} / ${override.category1}`
      : (override.scope2 ?? `override ${index + 1}`);
    const overrideTotal = earningRuleTotal(override.rule);
    if (overrideTotal !== 100) {
      errors.push({
        field: "supplyEarningOverride",
        message: `Override for ${label} totals ${overrideTotal}%, not 100%.`,
      });
    }
    if (!override.scope2 && !override.category1) {
      errors.push({
        field: "supplyEarningOverride",
        message: `Override ${index + 1} names no scope or category, so it would never apply.`,
      });
    }
  });

  if (draft.spiRedBelow <= 0 || draft.spiRedBelow > 2) {
    errors.push({ field: "spiRedBelow", message: "SPI threshold should be between 0 and 2." });
  }
  if (draft.cpiRedBelow <= 0 || draft.cpiRedBelow > 2) {
    errors.push({ field: "cpiRedBelow", message: "CPI threshold should be between 0 and 2." });
  }
  if (draft.worstCaseCollectionDays < draft.bestCaseCollectionDays) {
    errors.push({
      field: "worstCaseCollectionDays",
      message: "Worst-case collection days cannot be shorter than best-case.",
    });
  }
  if (draft.riskCriticalScore < 1 || draft.riskCriticalScore > 25) {
    errors.push({
      field: "riskCriticalScore",
      message: "Risk score is probability × impact on a 1–5 scale, so it ranges from 1 to 25.",
    });
  }

  return errors;
}
