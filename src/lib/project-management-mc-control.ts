/**
 * Manufacturing Clearance as a control, not a button.
 *
 * The existing MC record is a three-state gate — Pending, Cleared, Rejected — with an optional
 * approval workflow over it. That answers "has somebody clicked Cleared", which is not the same
 * question as "is this vendor actually allowed to start cutting steel". This module adds the three
 * things that make it a control:
 *
 *  1. **Readiness** (§4) — the prerequisites that must hold before clearance can be issued, each
 *     checked against data the application already holds, with a percentage and a hard block on
 *     the mandatory ones. Modelled on `checkInspectionReadiness` in supply-gates.ts, deliberately:
 *     the inspection gate already works this way and MC should not invent a second idiom.
 *  2. **Production progress** (§12, §13) — configurable manufacturing stages with planned/actual
 *     dates and a weighted roll-up. This is also the missing input the Control layer's supply
 *     earning rule needs: `manufacturingProgressPct` was designed as an optional field with no
 *     source, and this is the source.
 *  3. **Delay attribution** (§19) — which party is responsible for how many days. The control
 *     tower already ages waiting records by who they sit with (`stalledGates`); this attributes
 *     delay per MC, which is what a vendor review actually needs.
 *
 * Batches (§11) are defined here too, because partial clearance changes the record's shape and it
 * is far cheaper to define that now than to migrate it later.
 *
 * What this module deliberately does NOT do, because it already exists elsewhere and duplicating
 * it would create two disagreeing records:
 *
 *  - drawing submission and revision rounds — that is MDL (`mdl.ts`, R0–R3 with its own statuses,
 *    vendor collection and recollection requests);
 *  - inspection results, punch items and accepted/rejected quantities — that is `inspections`;
 *  - dispatch eligibility — that is MDCC + DI (`canIssueDi`);
 *  - the per-BOQ-item lifecycle timeline — that is `buildBoqTimeline`;
 *  - the approval chain itself — that is `mc-clearance-workflow`, or e-approval for anything richer.
 *
 * Pure (no Firebase, no React) so every rule here is unit-testable with `node --test`.
 */

export const MC_CONTROL_PERMISSION_RESOURCE = "Project Management.Manufacturing Clearance";

/* ── Readiness (§4) ─────────────────────────────────────────────────────────────────────────── */

/**
 * The prerequisites for issuing clearance.
 *
 * `mandatory` is the difference between a warning and a gate. A missing type-test certificate is
 * worth flagging but should not stop production on a repeat order; an unapproved drawing must,
 * because the vendor would be building the wrong thing. Only mandatory gaps block issue.
 */
export const MC_REQUIREMENTS = [
  { key: "poIssued", label: "PO released", mandatory: true },
  { key: "vendorApproved", label: "Approved vendor", mandatory: true },
  { key: "specApproved", label: "Technical specification approved", mandatory: true },
  { key: "drawingApproved", label: "Approved drawing", mandatory: true },
  { key: "datasheetApproved", label: "Approved data sheet", mandatory: false },
  { key: "qapApproved", label: "QAP approved", mandatory: true },
  { key: "itpApproved", label: "ITP approved", mandatory: false },
  { key: "typeTestCertificate", label: "Type test certificate", mandatory: false },
  { key: "clientApproved", label: "Client approval", mandatory: true },
  { key: "commentsClosed", label: "Technical comments closed", mandatory: true },
  { key: "noCommercialHold", label: "No commercial hold", mandatory: true },
] as const;

export type McRequirementKey = (typeof MC_REQUIREMENTS)[number]["key"];

/**
 * `undefined` means "not recorded", which is reported as pending rather than assumed either way —
 * the same convention the quantity ladder uses, and the reason a blank checklist reads as 0%
 * ready instead of silently clearing.
 */
export interface McReadinessInput {
  poIssued?: boolean;
  vendorApproved?: boolean;
  specApproved?: boolean;
  /** False when the BOQ line is not MDL-tracked, which makes the drawing check inapplicable. */
  drawingRequired?: boolean;
  drawingApproved?: boolean;
  datasheetApproved?: boolean;
  qapApproved?: boolean;
  itpApproved?: boolean;
  typeTestCertificate?: boolean;
  /** False on projects whose contract does not route clearance through the client. */
  clientApprovalRequired?: boolean;
  clientApproved?: boolean;
  /** Open technical comments against the drawing, QAP, datasheet or specification (§8). */
  openTechnicalComments?: number;
  /** Any commercial hold — unresolved commitment-over-BOQ, flow-down gap, or payment block. */
  commercialHold?: boolean;
}

export type McCheckStatus = "ok" | "pending" | "blocked" | "na";

export interface McRequirementCheck {
  key: McRequirementKey;
  label: string;
  mandatory: boolean;
  status: McCheckStatus;
  detail: string;
}

export interface McReadiness {
  checks: McRequirementCheck[];
  /** Percentage of *applicable* requirements satisfied. Excludes `na` from the denominator, so a
   *  line with no drawing is not permanently short of 100%. */
  readinessPct: number;
  /** Mandatory requirements not satisfied. Clearance is blocked while this is above zero. */
  blockingCount: number;
  canIssue: boolean;
}

const flag = (value: boolean | undefined, okDetail: string, gapDetail: string) =>
  value === true
    ? { status: "ok" as McCheckStatus, detail: okDetail }
    : { status: "pending" as McCheckStatus, detail: gapDetail };

/**
 * The §4 checklist, evaluated against what the application already knows.
 *
 * Requirements that do not apply to this line — a drawing on an untracked item, client approval on
 * a project that does not need it — are marked `na` and dropped from both the percentage and the
 * block, rather than sitting unsatisfiable forever.
 */
export function checkMcReadiness(input: McReadinessInput): McReadiness {
  const checks: McRequirementCheck[] = MC_REQUIREMENTS.map((requirement) => {
    const base = { key: requirement.key, label: requirement.label, mandatory: requirement.mandatory };

    switch (requirement.key) {
      case "poIssued":
        return { ...base, ...flag(input.poIssued, "Released", "Not released") };
      case "vendorApproved":
        return { ...base, ...flag(input.vendorApproved, "Approved", "Not on the approved list") };
      case "specApproved":
        return { ...base, ...flag(input.specApproved, "Approved", "Not approved") };
      case "drawingApproved":
        // Not MDL-tracked: there is no drawing to approve, so the check does not apply.
        if (input.drawingRequired === false) {
          return { ...base, status: "na", detail: "Not drawing-tracked" };
        }
        return { ...base, ...flag(input.drawingApproved, "Approved", "Not yet approved") };
      case "datasheetApproved":
        return { ...base, ...flag(input.datasheetApproved, "Approved", "Not approved") };
      case "qapApproved":
        return { ...base, ...flag(input.qapApproved, "Approved", "Not approved") };
      case "itpApproved":
        return { ...base, ...flag(input.itpApproved, "Approved", "Not approved") };
      case "typeTestCertificate":
        return { ...base, ...flag(input.typeTestCertificate, "On record", "Not on record") };
      case "clientApproved":
        if (input.clientApprovalRequired === false) {
          return { ...base, status: "na", detail: "Not required on this contract" };
        }
        return { ...base, ...flag(input.clientApproved, "Approved", "Awaiting client") };
      case "commentsClosed": {
        const open = input.openTechnicalComments ?? 0;
        // An open comment is `blocked`, not `pending`: pending is work nobody has done yet, this
        // is a reviewer actively saying the submission is wrong.
        return open > 0
          ? {
              ...base,
              status: "blocked",
              detail: `${open} comment${open === 1 ? "" : "s"} still open`,
            }
          : { ...base, status: "ok", detail: "All closed" };
      }
      case "noCommercialHold":
        return input.commercialHold === true
          ? { ...base, status: "blocked", detail: "Commercial hold in place" }
          : { ...base, status: "ok", detail: "No hold" };
      default:
        return { ...base, status: "pending", detail: "Not recorded" };
    }
  });

  const applicable = checks.filter((check) => check.status !== "na");
  const satisfied = applicable.filter((check) => check.status === "ok");
  const blocking = checks.filter(
    (check) => check.mandatory && (check.status === "pending" || check.status === "blocked"),
  );

  return {
    checks,
    readinessPct: applicable.length
      ? Math.round((satisfied.length / applicable.length) * 100)
      : 0,
    blockingCount: blocking.length,
    canIssue: blocking.length === 0,
  };
}

/** The mandatory requirements still standing in the way, for the screen's own message. */
export const mcBlockingRequirements = (readiness: McReadiness): McRequirementCheck[] =>
  readiness.checks.filter(
    (check) => check.mandatory && (check.status === "pending" || check.status === "blocked"),
  );

export const mcCheckStatusStyles: Record<McCheckStatus, string> = {
  ok: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-800",
  blocked: "bg-red-100 text-red-700",
  na: "bg-muted text-muted-foreground",
};

/* ── Production stages (§12, §13) ───────────────────────────────────────────────────────────── */

/**
 * The default fabrication sequence from the specification. Configurable per project because a
 * transformer, a conductor drum and a lattice tower share almost none of these steps — the same
 * reason Tower Progress makes its activity weights editable.
 */
export const DEFAULT_PRODUCTION_STAGES: Array<{ key: string; label: string; weightPct: number }> = [
  { key: "raw-material", label: "Raw material procurement", weightPct: 15 },
  { key: "cutting", label: "Cutting", weightPct: 10 },
  { key: "fabrication", label: "Fabrication", weightPct: 25 },
  { key: "welding", label: "Welding", weightPct: 15 },
  { key: "galvanizing", label: "Galvanizing", weightPct: 15 },
  { key: "assembly", label: "Assembly", weightPct: 10 },
  { key: "testing", label: "Testing", weightPct: 10 },
];

export interface McProductionStage {
  key: string;
  label: string;
  /** Contribution to overall manufacturing progress. Normalised on read, so a set that does not
   *  total 100 still produces a sane percentage rather than one over 100. */
  weightPct: number;
  plannedStart?: string;
  plannedFinish?: string;
  actualStart?: string;
  actualFinish?: string;
  /** 0–100. */
  progressPct?: number;
}

/**
 * Weighted manufacturing progress across the stages.
 *
 * Normalised by the weight actually present rather than by an assumed 100 — the same rule
 * `computeTowerProgressPct` follows — so a project that removes the galvanizing stage still reads
 * 100% when everything it does have is finished.
 */
export function computeManufacturingProgress(stages: readonly McProductionStage[]): number {
  let earned = 0;
  let available = 0;
  for (const stage of stages) {
    const weight = Number(stage.weightPct) || 0;
    if (weight <= 0) continue;
    available += weight;
    const pct = Math.min(100, Math.max(0, Number(stage.progressPct) || 0));
    // A finished stage counts fully even if nobody typed 100 — the actual finish date is the
    // stronger statement, and requiring both is how a schedule ends up at 95% forever.
    earned += weight * (stage.actualFinish ? 1 : pct / 100);
  }
  if (available <= 0) return 0;
  return Math.round((earned / available) * 10000) / 100;
}

/** The stage work is currently sitting on: the first that is neither finished nor untouched. */
export function currentProductionStage(
  stages: readonly McProductionStage[],
): McProductionStage | null {
  const started = stages.find(
    (stage) => !stage.actualFinish && (stage.actualStart || (stage.progressPct ?? 0) > 0),
  );
  if (started) return started;
  return stages.find((stage) => !stage.actualFinish) ?? null;
}

/** Stages past their planned finish without an actual finish, with how many days late. */
export function overdueProductionStages(
  stages: readonly McProductionStage[],
  today: Date = new Date(),
): Array<{ stage: McProductionStage; daysLate: number }> {
  const out: Array<{ stage: McProductionStage; daysLate: number }> = [];
  for (const stage of stages) {
    if (stage.actualFinish || !stage.plannedFinish) continue;
    const late = wholeDaysBetween(stage.plannedFinish, toDateKey(today));
    if (late > 0) out.push({ stage, daysLate: late });
  }
  return out;
}

export interface StageValidationError {
  stageKey: string;
  field: "weightPct" | "progressPct" | "plannedFinish" | "actualFinish";
  message: string;
}

export function validateProductionStages(
  stages: readonly McProductionStage[],
): StageValidationError[] {
  const errors: StageValidationError[] = [];
  for (const stage of stages) {
    const weight = Number(stage.weightPct);
    if (!Number.isFinite(weight) || weight < 0) {
      errors.push({ stageKey: stage.key, field: "weightPct", message: `${stage.label} weight must be zero or more.` });
    }
    const pct = stage.progressPct;
    if (pct !== undefined && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      errors.push({ stageKey: stage.key, field: "progressPct", message: `${stage.label} progress must be between 0 and 100.` });
    }
    if (stage.plannedStart && stage.plannedFinish && stage.plannedFinish < stage.plannedStart) {
      errors.push({ stageKey: stage.key, field: "plannedFinish", message: `${stage.label} planned finish cannot be before its planned start.` });
    }
    if (stage.actualStart && stage.actualFinish && stage.actualFinish < stage.actualStart) {
      errors.push({ stageKey: stage.key, field: "actualFinish", message: `${stage.label} actual finish cannot be before its actual start.` });
    }
    // Finished without ever starting is a data-entry slip, not a schedule.
    if (stage.actualFinish && !stage.actualStart) {
      errors.push({ stageKey: stage.key, field: "actualFinish", message: `${stage.label} is finished but has no actual start.` });
    }
  }
  return errors;
}

/* ── Batches / partial clearance (§11) ──────────────────────────────────────────────────────── */

export const MC_BATCH_STATUSES = ["Planned", "Cleared", "In Production", "Completed", "Cancelled"] as const;
export type McBatchStatus = (typeof MC_BATCH_STATUSES)[number];

/**
 * A tranche of the PO quantity cleared independently.
 *
 * 500 towers rarely clear in one go; each batch has its own clearance, its own production schedule
 * and its own inspection call. Modelled now rather than later because adding a quantity dimension
 * to an existing MC record is a migration, and today there is no data to migrate.
 */
export interface McBatch {
  batchNo: string;
  qty: number;
  status: McBatchStatus;
  clearedDate?: string;
  stages?: McProductionStage[];
}

export interface BatchValidationError {
  batchNo: string;
  message: string;
}

/**
 * Batches must be positive, uniquely numbered, and must not clear more than the PO ordered.
 * Cancelled batches are excluded from the total — a cancelled tranche has released its quantity
 * back, and counting it would block the replacement.
 */
export function validateMcBatches(
  batches: readonly McBatch[],
  poQty: number,
): BatchValidationError[] {
  const errors: BatchValidationError[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (const batch of batches) {
    const key = batch.batchNo.trim().toLowerCase();
    if (!key) {
      errors.push({ batchNo: batch.batchNo, message: "Every batch needs a number." });
    } else if (seen.has(key)) {
      errors.push({ batchNo: batch.batchNo, message: `Batch ${batch.batchNo} is listed more than once.` });
    }
    seen.add(key);

    if (!(batch.qty > 0)) {
      errors.push({ batchNo: batch.batchNo, message: `Batch ${batch.batchNo} quantity must be greater than zero.` });
    }
    if (batch.status !== "Cancelled") total += Number(batch.qty) || 0;
  }

  if (poQty > 0 && total > poQty) {
    errors.push({
      batchNo: "",
      message: `Batches total ${total}, which is more than the ${poQty} ordered on the PO.`,
    });
  }
  return errors;
}

export interface BatchSummary {
  batchCount: number;
  /** Σ qty of live (non-cancelled) batches. */
  clearedQty: number;
  /** poQty − clearedQty, floored at zero. */
  uncleraedQty: number;
  /** Quantity-weighted progress across the batches that have a schedule. */
  progressPct: number;
  fullyCleared: boolean;
}

export function summariseMcBatches(
  batches: readonly McBatch[],
  poQty: number,
): BatchSummary {
  const live = batches.filter((batch) => batch.status !== "Cancelled");
  const clearedQty = live.reduce((sum, batch) => sum + (Number(batch.qty) || 0), 0);

  let weighted = 0;
  let weight = 0;
  for (const batch of live) {
    const qty = Number(batch.qty) || 0;
    if (qty <= 0 || !batch.stages?.length) continue;
    weight += qty;
    weighted += qty * computeManufacturingProgress(batch.stages);
  }

  return {
    batchCount: live.length,
    clearedQty,
    uncleraedQty: Math.max(0, poQty - clearedQty),
    progressPct: weight > 0 ? Math.round((weighted / weight) * 100) / 100 : 0,
    fullyCleared: poQty > 0 && clearedQty >= poQty,
  };
}

/* ── Delay attribution (§19) ────────────────────────────────────────────────────────────────── */

/**
 * Who a delay belongs to.
 *
 * The control tower already ages *waiting* records by the party they sit with; this attributes
 * elapsed delay per MC, which is what a vendor review and a project post-mortem need. The parties
 * are the same set, deliberately, so the two views cannot disagree about whose fault something is.
 */
export const MC_DELAY_PARTIES = [
  "Vendor",
  "SEL Engineering",
  "SEL QA",
  "SEL Procurement",
  "Client",
] as const;
export type McDelayParty = (typeof MC_DELAY_PARTIES)[number];

export interface McDelayInput {
  /** Each leg: when the ball was passed, when it came back (or undefined if still out). */
  drawingSubmission?: { dueOn?: string; submittedOn?: string };
  drawingApproval?: { submittedOn?: string; approvedOn?: string };
  clientApproval?: { sentOn?: string; approvedOn?: string };
  manufacturing?: { plannedFinish?: string; actualFinish?: string };
  inspection?: { requestedOn?: string; inspectedOn?: string };
  today?: Date;
}

export interface McDelayLine {
  leg: string;
  party: McDelayParty;
  days: number;
  /** True when the leg is still open, so the figure is still growing. */
  ongoing: boolean;
}

export interface McDelaySummary {
  lines: McDelayLine[];
  totalDays: number;
  byParty: Array<{ party: McDelayParty; days: number }>;
  /** The party carrying the most delay, or null when there is none. */
  worstParty: McDelayParty | null;
}

/**
 * Delay per leg, attributed to the party that held it.
 *
 * A leg with no start date contributes nothing rather than being guessed at — the same rule the
 * stall-gate ageing follows, and the reason a half-filled MC does not manufacture blame.
 */
export function attributeMcDelays(input: McDelayInput): McDelaySummary {
  const today = toDateKey(input.today ?? new Date());
  const lines: McDelayLine[] = [];

  const leg = (
    name: string,
    party: McDelayParty,
    from: string | undefined,
    to: string | undefined,
  ) => {
    if (!from) return;
    const end = to ?? today;
    const days = wholeDaysBetween(from, end);
    if (days > 0) lines.push({ leg: name, party, days, ongoing: !to });
  };

  leg("Drawing submission", "Vendor", input.drawingSubmission?.dueOn, input.drawingSubmission?.submittedOn);
  leg("Drawing approval", "SEL Engineering", input.drawingApproval?.submittedOn, input.drawingApproval?.approvedOn);
  leg("Client approval", "Client", input.clientApproval?.sentOn, input.clientApproval?.approvedOn);
  leg("Manufacturing", "Vendor", input.manufacturing?.plannedFinish, input.manufacturing?.actualFinish);
  leg("Inspection", "SEL QA", input.inspection?.requestedOn, input.inspection?.inspectedOn);

  const byPartyMap = new Map<McDelayParty, number>();
  for (const line of lines) {
    byPartyMap.set(line.party, (byPartyMap.get(line.party) ?? 0) + line.days);
  }
  const byParty = [...byPartyMap.entries()]
    .map(([party, days]) => ({ party, days }))
    .sort((a, b) => b.days - a.days);

  return {
    lines,
    totalDays: lines.reduce((sum, line) => sum + line.days, 0),
    byParty,
    worstParty: byParty[0]?.party ?? null,
  };
}

/* ── Helpers ────────────────────────────────────────────────────────────────────────────────── */

const parseLocalDate = (value?: string): Date | null => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const toDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

/** Whole days from `from` to `to`; 0 when either is missing or unparsable. */
export function wholeDaysBetween(from: string, to: string): number {
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}
