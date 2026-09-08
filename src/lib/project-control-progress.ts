/**
 * Progress recognition — turning execution records into earned value.
 *
 * This is the hinge of the whole Control layer. Everything downstream (EVM, P&L, cash, ROI) is
 * arithmetic on top of one number per BOQ line: **how much of this line's value has actually been
 * earned**. Get that number from a person and the rest is fiction; derive it from the registers
 * and the rest follows.
 *
 * So there is deliberately no function in here that accepts a progress percentage. Each lane
 * derives its own:
 *
 *   supply    weighted stage rule over the gate registers (PO → drawing → MC → manufacturing →
 *             inspection → MDCC → DI → GRN → MVAC), configured per project/scope/category
 *   civil     certified JMC quantity ÷ approved quantity — certified, never merely executed
 *   erection  the tower module's own weighted activity roll-up, aggregated over the towers
 *             pointing at the line
 *
 * ## The verified-progress decision (§3.4a)
 *
 * §7 of the requirement says only verified progress should enter EVM. The Tower module
 * deliberately does the opposite: `Completed`, `Under Verification` and `Approved` all earn full
 * credit, and the reason is written into that module — *"the tower is built whether or not a
 * signature has landed, and hiding that would make the dashboard lag reality by days."*
 *
 * Taken literally, §7 produces an EV that falls whenever a verification queue builds up, so CPI
 * and SPI would move because a checker went on leave. Taken the other way, EV can include a claim
 * later rejected. Both readings are defensible and both are wrong on their own, so this module
 * computes **both** and reports the gap:
 *
 *   earnedPct          live figure, on the existing credit rule — what the execution dashboards show
 *   verifiedEarnedPct  approved-only — what month close and client reports use
 *   unverifiedValue    the difference, in money, raised as its own exception
 *
 * A persistent gap is then a managed number and a useful signal in itself (verification is the
 * bottleneck), rather than either a hidden risk or a self-inflicted dip in the KPIs.
 *
 * Pure (no Firebase, no React) so every lane's rule is unit-testable with `node --test`.
 */

import { isBoqSectionHeader } from "./project-management-boq-columns.ts";
import { projectBoqValue, projectManagementNumber } from "./project-management-dashboard.ts";
import {
  SUPPLY_EARNING_STAGES,
  resolveSupplyEarningRule,
  type ProjectControlSettings,
  type SupplyEarningRule,
  type SupplyEarningStage,
} from "./project-control-settings.ts";
import { readBoqDimension } from "./project-control-wbs.ts";

export const PROGRESS_PERMISSION_RESOURCE = "Project Management.Progress Recognition";

export const EXECUTION_LANES = ["supply", "civil", "erection"] as const;
export type ExecutionLane = (typeof EXECUTION_LANES)[number];

/* ── Supply ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * The gate facts one BOQ line's supply progress is read from. Deliberately a flat record of
 * already-decided statuses rather than the gate documents themselves, so this module never
 * re-implements a gate rule — the caller passes what `supply-gates.ts` and `mdl.ts` already say.
 */
export interface SupplyGateFacts {
  /** True once the line sits on an issued or received PO. */
  ordered?: boolean;
  /** Undefined when the line is not MDL-tracked, in which case the drawing weight is redistributed. */
  drawingApproved?: boolean;
  drawingRequired?: boolean;
  mcCleared?: boolean;
  /** 0–100 from the MC record. Absent means nobody has reported manufacturing progress yet. */
  manufacturingProgressPct?: number;
  inspectionPassed?: boolean;
  mdccIssued?: boolean;
  dispatched?: boolean;
  receivedAtSite?: boolean;
  clientAccepted?: boolean;
}

/**
 * Whether each stage has earned, as a fraction of its own weight.
 *
 * All-or-nothing per stage, except `manufacturing`, which is the one stage with a genuine
 * in-between state and no register recording completion. A stage whose fact is absent earns 0 —
 * never a guess.
 */
function stageCredit(stage: SupplyEarningStage, facts: SupplyGateFacts): number {
  switch (stage) {
    case "po":
      return facts.ordered ? 1 : 0;
    case "drawing":
      return facts.drawingApproved ? 1 : 0;
    case "mc":
      return facts.mcCleared ? 1 : 0;
    case "manufacturing": {
      const pct = facts.manufacturingProgressPct;
      if (pct == null || !Number.isFinite(pct)) return 0;
      return Math.min(1, Math.max(0, pct / 100));
    }
    case "inspection":
      return facts.inspectionPassed ? 1 : 0;
    case "mdcc":
      return facts.mdccIssued ? 1 : 0;
    case "di":
      return facts.dispatched ? 1 : 0;
    case "grn":
      return facts.receivedAtSite ? 1 : 0;
    case "mvac":
      return facts.clientAccepted ? 1 : 0;
    default:
      return 0;
  }
}

/**
 * Earned percentage for one supply line.
 *
 * **Drawing weight is redistributed, not forfeited, when a line is not MDL-tracked.** A box of
 * bolts has no drawing to approve, and leaving its 5% permanently unearned would cap the line at
 * 95% forever — the line would never read as delivered no matter what arrived at site. So the
 * denominator is the weight of the stages that actually apply, which is also why
 * `computeTowerProgressPct` normalises by its own available weight rather than assuming 100.
 */
export function computeSupplyEarnedPct(
  facts: SupplyGateFacts,
  rule: SupplyEarningRule,
): number {
  const applies = (stage: SupplyEarningStage): boolean => {
    // Not MDL-tracked: the drawing stage does not exist for this line.
    if (stage === "drawing" && facts.drawingRequired === false) return false;
    return true;
  };

  let earned = 0;
  let available = 0;
  for (const stage of SUPPLY_EARNING_STAGES) {
    const weight = Number(rule[stage]) || 0;
    if (weight <= 0 || !applies(stage)) continue;
    available += weight;
    earned += weight * stageCredit(stage, facts);
  }
  if (available <= 0) return 0;
  return Math.round((earned / available) * 10000) / 100;
}

/* ── Civil ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * Earned percentage for one civil line: certified quantity over approved quantity.
 *
 * Certified, not executed. `aggregateMeasurementsByBoqItem` returns both, and executed quantity is
 * a claim while certified quantity has been jointly measured — using executed would let EV run
 * ahead of anything the client has agreed. Civil therefore needs no verified/live split: it is
 * verified by construction.
 *
 * Capped at 100. Certified quantity exceeding approved quantity is a real and important condition,
 * but it is a *scope* exception (the quantity ladder already raises it); letting it push a line to
 * 130% earned would quietly inflate project EV instead.
 */
export function computeCivilEarnedPct(certifiedQty: number, approvedQty: number): number {
  if (!(approvedQty > 0)) return 0;
  const pct = (certifiedQty / approvedQty) * 100;
  return Math.min(100, Math.max(0, Math.round(pct * 100) / 100));
}

/* ── Erection / towers ──────────────────────────────────────────────────────────────────────── */

/**
 * One tower's contribution, as the tower module already computes it. Passed in rather than
 * recomputed so this module cannot disagree with the tower dashboards.
 */
export interface TowerProgressFact {
  towerId: string;
  towerNo: string;
  /** `computeTowerProgressPct(tower, weights)` — includes work awaiting verification. */
  progressPct: number;
  /** The same roll-up counting only `Approved` activities. */
  verifiedProgressPct: number;
  /** `per-span` towers are weighted by their span length; `per-tower` ones weigh equally. */
  boqBasis?: "per-tower" | "per-span";
  spanToNextM?: number;
}

export interface TowerLaneResult {
  earnedPct: number;
  verifiedEarnedPct: number;
  towerCount: number;
  /** Towers included in the roll-up — `per-span` excludes the last tower, which has no span. */
  countedTowers: number;
}

/**
 * Rolls towers up to their BOQ line.
 *
 * `per-span` weights each tower by the span leading away from it, because "5 spans strung" is only
 * meaningful in kilometres — and the final tower on a line carries no span, so it is excluded from
 * the denominator rather than counted as 0%. That is the same clamp
 * `calculateTowerProgressSummary` already applies for `stringing` and `opgw`; counting it would
 * cap a fully strung line just short of complete.
 */
export function computeTowerEarnedPct(towers: readonly TowerProgressFact[]): TowerLaneResult {
  const basis = towers[0]?.boqBasis ?? "per-tower";

  if (basis === "per-span") {
    let weighted = 0;
    let verifiedWeighted = 0;
    let totalSpan = 0;
    let counted = 0;
    for (const tower of towers) {
      const span = projectManagementNumber(tower.spanToNextM);
      if (span <= 0) continue; // the last tower on the line
      totalSpan += span;
      counted += 1;
      weighted += span * clampPct(tower.progressPct);
      verifiedWeighted += span * clampPct(tower.verifiedProgressPct);
    }
    return {
      earnedPct: totalSpan > 0 ? round2(weighted / totalSpan) : 0,
      verifiedEarnedPct: totalSpan > 0 ? round2(verifiedWeighted / totalSpan) : 0,
      towerCount: towers.length,
      countedTowers: counted,
    };
  }

  if (!towers.length) {
    return { earnedPct: 0, verifiedEarnedPct: 0, towerCount: 0, countedTowers: 0 };
  }
  const sum = towers.reduce((total, tower) => total + clampPct(tower.progressPct), 0);
  const verifiedSum = towers.reduce(
    (total, tower) => total + clampPct(tower.verifiedProgressPct),
    0,
  );
  return {
    earnedPct: round2(sum / towers.length),
    verifiedEarnedPct: round2(verifiedSum / towers.length),
    towerCount: towers.length,
    countedTowers: towers.length,
  };
}

const clampPct = (value: unknown): number =>
  Math.min(100, Math.max(0, projectManagementNumber(value)));
const round2 = (value: number): number => Math.round(value * 100) / 100;

/* ── Per-line roll-up ───────────────────────────────────────────────────────────────────────── */

/** Everything known about one BOQ line, from whichever lane it belongs to. */
export interface LineProgressInput {
  boqItemId: string;
  /** The BOQ document, for lane detection, dimensions and budget value. */
  boqItem: Record<string, unknown>;
  controlAccountId?: string;
  /** Overrides lane detection when the caller already knows. */
  lane?: ExecutionLane;
  supply?: SupplyGateFacts;
  civil?: { certifiedQty?: number; approvedQty?: number };
  towers?: readonly TowerProgressFact[];
}

export interface LineProgress {
  boqItemId: string;
  controlAccountId?: string;
  lane: ExecutionLane;
  budgetValue: number;
  earnedPct: number;
  verifiedEarnedPct: number;
  earnedValue: number;
  verifiedEarnedValue: number;
  /** earnedValue − verifiedEarnedValue. The §3.4a gap, in money. */
  unverifiedValue: number;
}

/**
 * Which lane a BOQ line belongs to. Scope 2 is the field the module already routes on — the
 * costing page, the workspaces and the quantity ladder all key civil/erection off it — so lane
 * detection follows rather than introducing a new classification.
 */
export function detectLane(boqItem: Record<string, unknown>): ExecutionLane {
  const scope2 = readBoqDimension(boqItem, "scope2").toLowerCase();
  if (scope2 === "erection") return "erection";
  if (scope2 === "civil") return "civil";
  return "supply";
}

/** Earned value for one BOQ line, in its own lane. */
export function computeLineProgress(
  input: LineProgressInput,
  settings: Pick<ProjectControlSettings, "supplyEarningRule" | "supplyEarningOverrides">,
): LineProgress {
  const lane = input.lane ?? detectLane(input.boqItem);
  const budgetValue = projectBoqValue(input.boqItem);

  let earnedPct = 0;
  let verifiedEarnedPct = 0;

  if (lane === "supply") {
    const rule = resolveSupplyEarningRule(settings, {
      scope2: readBoqDimension(input.boqItem, "scope2"),
      category1: readBoqDimension(input.boqItem, "category1"),
    });
    earnedPct = computeSupplyEarnedPct(input.supply ?? {}, rule);
    // Every supply stage is a gate record that has already passed its own predicate, so the live
    // and verified figures are the same by construction.
    verifiedEarnedPct = earnedPct;
  } else if (lane === "civil") {
    earnedPct = computeCivilEarnedPct(
      projectManagementNumber(input.civil?.certifiedQty),
      projectManagementNumber(input.civil?.approvedQty),
    );
    verifiedEarnedPct = earnedPct; // certified means verified
  } else {
    const towerResult = computeTowerEarnedPct(input.towers ?? []);
    earnedPct = towerResult.earnedPct;
    verifiedEarnedPct = towerResult.verifiedEarnedPct;
  }

  const earnedValue = round2((budgetValue * earnedPct) / 100);
  const verifiedEarnedValue = round2((budgetValue * verifiedEarnedPct) / 100);

  return {
    boqItemId: input.boqItemId,
    controlAccountId: input.controlAccountId,
    lane,
    budgetValue: round2(budgetValue),
    earnedPct,
    verifiedEarnedPct,
    earnedValue,
    verifiedEarnedValue,
    unverifiedValue: round2(earnedValue - verifiedEarnedValue),
  };
}

/* ── Project roll-up ────────────────────────────────────────────────────────────────────────── */

export interface LaneSummary {
  lane: ExecutionLane;
  lineCount: number;
  budgetValue: number;
  earnedValue: number;
  verifiedEarnedValue: number;
  earnedPct: number;
}

export interface ProgressRollUp {
  /** Σ budgetValue across every non-header line. */
  budgetValue: number;
  earnedValue: number;
  verifiedEarnedValue: number;
  /** Value-weighted, not a mean of percentages — a 2-crore line does not count the same as a
   *  2-lakh one. */
  earnedPct: number;
  verifiedEarnedPct: number;
  unverifiedValue: number;
  lines: LineProgress[];
  byLane: LaneSummary[];
  byControlAccount: Map<string, { budgetValue: number; earnedValue: number; verifiedEarnedValue: number }>;
  /** Lines whose budget value is zero — they can never earn, so they are reported rather than
   *  silently diluting nothing. */
  zeroValueLineCount: number;
}

/**
 * Rolls every BOQ line up to lane, control account and project.
 *
 * Section headers are skipped: they carry no unit and no quantity, so they are not work.
 * Percentages are **value-weighted** throughout — averaging line percentages would let a hundred
 * trivial lines outvote the transformer that is actually the project.
 */
export function rollUpProgress(
  inputs: readonly LineProgressInput[],
  settings: Pick<ProjectControlSettings, "supplyEarningRule" | "supplyEarningOverrides">,
): ProgressRollUp {
  const lines: LineProgress[] = [];
  let zeroValueLineCount = 0;

  for (const input of inputs) {
    if (isBoqSectionHeader(input.boqItem as { Unit?: unknown; QTY?: unknown })) continue;
    const line = computeLineProgress(input, settings);
    if (line.budgetValue <= 0) zeroValueLineCount += 1;
    lines.push(line);
  }

  const budgetValue = round2(lines.reduce((sum, line) => sum + line.budgetValue, 0));
  const earnedValue = round2(lines.reduce((sum, line) => sum + line.earnedValue, 0));
  const verifiedEarnedValue = round2(
    lines.reduce((sum, line) => sum + line.verifiedEarnedValue, 0),
  );

  const byLane: LaneSummary[] = EXECUTION_LANES.map((lane) => {
    const laneLines = lines.filter((line) => line.lane === lane);
    const laneBudget = round2(laneLines.reduce((sum, line) => sum + line.budgetValue, 0));
    const laneEarned = round2(laneLines.reduce((sum, line) => sum + line.earnedValue, 0));
    return {
      lane,
      lineCount: laneLines.length,
      budgetValue: laneBudget,
      earnedValue: laneEarned,
      verifiedEarnedValue: round2(
        laneLines.reduce((sum, line) => sum + line.verifiedEarnedValue, 0),
      ),
      earnedPct: laneBudget > 0 ? round2((laneEarned / laneBudget) * 100) : 0,
    };
  }).filter((summary) => summary.lineCount > 0);

  const byControlAccount = new Map<
    string,
    { budgetValue: number; earnedValue: number; verifiedEarnedValue: number }
  >();
  for (const line of lines) {
    if (!line.controlAccountId) continue;
    const bucket =
      byControlAccount.get(line.controlAccountId) ??
      { budgetValue: 0, earnedValue: 0, verifiedEarnedValue: 0 };
    bucket.budgetValue = round2(bucket.budgetValue + line.budgetValue);
    bucket.earnedValue = round2(bucket.earnedValue + line.earnedValue);
    bucket.verifiedEarnedValue = round2(bucket.verifiedEarnedValue + line.verifiedEarnedValue);
    byControlAccount.set(line.controlAccountId, bucket);
  }

  return {
    budgetValue,
    earnedValue,
    verifiedEarnedValue,
    earnedPct: budgetValue > 0 ? round2((earnedValue / budgetValue) * 100) : 0,
    verifiedEarnedPct: budgetValue > 0 ? round2((verifiedEarnedValue / budgetValue) * 100) : 0,
    unverifiedValue: round2(earnedValue - verifiedEarnedValue),
    lines,
    byLane,
    byControlAccount,
    zeroValueLineCount,
  };
}
