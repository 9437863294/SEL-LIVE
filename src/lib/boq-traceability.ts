/**
 * BOQ item traceability — assembles one BOQ item's complete lifecycle into an ordered timeline.
 *
 * This module answers the question the whole Project Management module exists to answer: open a
 * BOQ item and see what was ordered, what was surveyed, indented, quoted, purchased, drawn,
 * cleared, inspected, dispatched, received, accepted and billed — and, where it has stopped, why
 * it stopped and what has to happen next.
 *
 * It is deliberately PURE (no Firebase, no React) so it can be unit-tested with `node --test`, and
 * it never re-implements gate logic: every "can this stage start yet" decision delegates to the
 * predicates already exported by src/lib/supply-gates.ts, so the timeline can never disagree with
 * what the stage pages themselves enforce.
 *
 * Two lanes, because an EPC BOQ line is either bought or built:
 *   supply → Survey → Indent → RFQ → PO → Drawing → MC → Inspection → MDCC → DI → GRN → MVAC → Billing
 *   civil  → Survey → Work Order → Work Package → JMC → Billing
 *
 * The civil lane's Work Order and JMC stages are joined from the registers Billing Recon and
 * Subcontractors Management own (`workOrders`, `jmcEntries`/`mvacEntries` — see
 * src/lib/civil-execution.ts): the subcontract work order is civil's analog of the supply PO, and
 * the joint measurement is what turns executed work into a certifiable quantity.
 */

import {
  canIssueDi,
  canIssueMdcc,
  canReceiveGrn,
  canRequestInspection,
  canSignMvac,
  hasOpenBlockingPunch,
  type DiRecord,
  type GrnRecord,
  type InspectionRecord,
  type ManufacturingClearance,
  type MdccRecord,
  type MvacRecord,
} from "./supply-gates.ts";
import { isMdlApproved, type MdlOverallStatus } from "./mdl.ts";
import type { ProjectWorkPackage } from "./project-management-work-packages.ts";

export type TraceLane = "supply" | "civil";

/**
 * `done`    — finished.
 * `active`  — current stage, started but not finished.
 * `blocked` — current stage, cannot start because an upstream condition is unmet (carries a reason).
 * `pending` — not started and not yet reached.
 * `na`      — does not apply to this item (e.g. Drawing when the BOQ line isn't MDL-tracked).
 */
export type TraceStageStatus = "done" | "active" | "blocked" | "pending" | "na";

export interface TraceStage {
  key: TraceStageKey;
  label: string;
  status: TraceStageStatus;
  /** ISO yyyy-mm-dd; the UI formats it with formatGateDate(). */
  date?: string;
  /** The document number a user would quote — indent no, PO no, MDCC no, DI no, GRN no. */
  reference?: string;
  qty?: number;
  /** Who acted, or who it is sitting with. */
  actor?: string;
  detail?: string;
  /** Only set when status === "blocked" — the specific unmet precondition. */
  blockedReason?: string;
}

export const SUPPLY_STAGE_ORDER = [
  "survey",
  "indent",
  "rfq",
  "po",
  "drawing",
  "mc",
  "inspection",
  "mdcc",
  "di",
  "grn",
  "mvac",
  "billing",
] as const;

export const CIVIL_STAGE_ORDER = [
  "survey",
  "workOrder",
  "workPackage",
  "jmc",
  "billing",
] as const;

export type TraceStageKey =
  | (typeof SUPPLY_STAGE_ORDER)[number]
  | (typeof CIVIL_STAGE_ORDER)[number];

export const TRACE_STAGE_LABELS: Record<TraceStageKey, string> = {
  survey: "Survey",
  indent: "Indent",
  rfq: "RFQ",
  po: "Purchase Order",
  drawing: "Drawing Approval",
  mc: "Manufacturing Clearance",
  inspection: "Inspection",
  mdcc: "MDCC",
  di: "Dispatch Instruction",
  grn: "Site Receipt (GRN)",
  mvac: "Material Acceptance (MVAC)",
  billing: "Client Billing",
  workOrder: "Work Order",
  workPackage: "Execution",
  jmc: "Joint Measurement (JMC)",
};

/** Minimal structural shapes, declared here rather than imported, so this module stays decoupled
 * from the Firestore-aware RFQ/PO libraries and remains node-testable. */
export interface TraceIndentLine {
  indentNumber?: string;
  indentDate?: string;
  status?: string;
  requestedQty: number;
}

export interface TraceRfqLine {
  rfqNumber?: string;
  rfqDate?: string;
  status?: string;
  qty: number;
  awardedVendorName?: string;
}

export interface TracePoLine {
  poNumber?: string;
  poDate?: string;
  status?: string;
  qty: number;
  vendorName?: string;
}

export interface TraceMdl {
  status: MdlOverallStatus;
  firstSubmittedOn?: string;
  currentRevision?: string;
}

export interface BoqTraceInput {
  lane: TraceLane;
  boqQty: number;
  surveyedQty?: number;
  surveyDate?: string;
  surveyedByName?: string;
  /** BOQ "MDL" column === yes. */
  mdlRequired: boolean;
  /** BOQ "Inspection Required" column !== no — see isInspectionRequired() in supply-gates.ts. */
  inspectionRequired: boolean;
  indentLines?: TraceIndentLine[];
  rfqLines?: TraceRfqLine[];
  poLines?: TracePoLine[];
  mdl?: TraceMdl;
  mc?: ManufacturingClearance;
  inspection?: InspectionRecord;
  mdcc?: MdccRecord;
  di?: DiRecord;
  grn?: GrnRecord;
  mvac?: MvacRecord;
  /** Already filtered to this BOQ item by the caller. */
  workPackages?: ProjectWorkPackage[];
  /** Subcontract commitment for this BOQ item (civil lane), already aggregated by the caller —
   * see aggregateWorkOrdersByBoqItem() in src/lib/civil-execution.ts. */
  workOrder?: {
    orderedQty: number;
    workOrderNos: string[];
    subcontractorNames: string[];
    latestDate?: string;
  };
  /** Joint measurement for this BOQ item (civil lane), already aggregated by the caller — see
   * aggregateMeasurementsByBoqKey() in src/lib/civil-execution.ts. */
  jmc?: {
    executedQty: number;
    certifiedQty: number;
    entryCount: number;
    latestNo?: string;
    latestDate?: string;
  };
  /** Undefined while no client-billing module exists — the Billing stage then reports as N/A
   * rather than permanently blocking every item at 11/12 complete. */
  billedQty?: number;
}

/** A stage before post-processing: either finished, not applicable, or not yet finished (with the
 * reason it cannot start, if any). */
type StageDraft = Omit<TraceStage, "key" | "label" | "status"> & {
  done: boolean;
  na?: boolean;
  /**
   * Set when the stage cannot start yet. Absent means "startable now".
   *
   * Note that a reason only ever surfaces on the CURRENT stage, and the current stage is the first
   * one that is neither done nor N/A — so a guard whose precondition is itself an earlier stage
   * (MC's "not yet on a purchase order", for instance) is defensive only: if the PO is missing,
   * the PO stage is the one the item is sitting at, and that is the more useful thing to report.
   * The reasons that actually reach a user are the ones where the previous stage is complete but
   * the gate still refuses — MDCC behind open punch items, MVAC behind a critical observation.
   */
  blockedReason?: string;
  /** Whether work has visibly begun (register moved off its initial status). Declared explicitly
   * rather than inferred from whichever incidental fields happen to be populated — a drawing
   * "Under Review" is genuinely in progress even before it has a date. */
  started?: boolean;
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function draftSurvey(input: BoqTraceInput): StageDraft {
  if (input.surveyedQty == null) {
    return { done: false, detail: `BOQ quantity ${input.boqQty} not yet verified at site` };
  }
  const delta = input.surveyedQty - input.boqQty;
  return {
    done: true,
    date: input.surveyDate,
    qty: input.surveyedQty,
    actor: input.surveyedByName,
    detail:
      delta === 0
        ? "Matches BOQ quantity"
        : `${delta > 0 ? "+" : ""}${Math.round(delta * 1000) / 1000} vs BOQ`,
  };
}

function draftIndent(input: BoqTraceInput): StageDraft {
  const lines = input.indentLines ?? [];
  if (!lines.length) return { done: false };
  const latest = lines[lines.length - 1];
  return {
    done: true,
    date: latest.indentDate,
    reference: latest.indentNumber,
    qty: sum(lines.map((line) => line.requestedQty)),
    detail: lines.length > 1 ? `${lines.length} indents` : latest.status,
  };
}

function draftRfq(input: BoqTraceInput): StageDraft {
  const lines = input.rfqLines ?? [];
  if (!lines.length) {
    return {
      done: false,
      ...(input.indentLines?.length ? {} : { blockedReason: "No indent raised yet" }),
    };
  }
  const latest = lines[lines.length - 1];
  const awarded = lines.find((line) => line.awardedVendorName);
  return {
    done: true,
    date: latest.rfqDate,
    reference: latest.rfqNumber,
    qty: sum(lines.map((line) => line.qty)),
    actor: awarded?.awardedVendorName,
    detail: awarded ? `Awarded to ${awarded.awardedVendorName}` : latest.status,
  };
}

function draftPo(input: BoqTraceInput): StageDraft {
  const lines = input.poLines ?? [];
  if (!lines.length) return { done: false };
  const latest = lines[lines.length - 1];
  return {
    done: true,
    date: latest.poDate,
    reference: latest.poNumber,
    qty: sum(lines.map((line) => line.qty)),
    actor: latest.vendorName,
    detail: latest.status,
  };
}

function draftDrawing(input: BoqTraceInput): StageDraft {
  if (!input.mdlRequired) return { done: false, na: true, detail: "Not an MDL-tracked item" };
  const status = input.mdl?.status ?? "Pending";
  return {
    done: isMdlApproved(status),
    started: status !== "Pending",
    date: input.mdl?.firstSubmittedOn,
    reference: input.mdl?.currentRevision,
    detail: status,
  };
}

function draftMc(input: BoqTraceInput): StageDraft {
  const onPo = Boolean(input.poLines?.length);
  if (!onPo) return { done: false, blockedReason: "Not yet on a purchase order" };
  if (input.mdlRequired && !isMdlApproved(input.mdl?.status ?? "Pending")) {
    return { done: false, blockedReason: "Drawing not approved" };
  }
  const status = input.mc?.status ?? "Pending";
  return {
    done: status === "Cleared",
    started: status !== "Pending",
    date: input.mc?.clearedDate,
    actor: input.mc?.clearedByName ?? input.mc?.vendorName,
    detail: status,
  };
}

function draftInspection(input: BoqTraceInput): StageDraft {
  if (!input.inspectionRequired) {
    return { done: false, na: true, detail: "Inspection not required for this item" };
  }
  const status = input.inspection?.status ?? "Not Requested";
  const done = status === "Passed" || status === "Passed with Punch Items";
  if (!done && !canRequestInspection(input.mc?.status)) {
    return { done: false, blockedReason: "Manufacturing clearance not cleared", detail: status };
  }
  const openBlocking = hasOpenBlockingPunch(input.inspection?.punchItems);
  return {
    done,
    started: status !== "Not Requested",
    date: input.inspection?.inspectionDate ?? input.inspection?.requestedDate,
    qty: input.inspection?.qtyAccepted,
    actor: input.inspection?.inspectorName,
    detail: openBlocking ? `${status} — open critical/major punch items` : status,
  };
}

function draftMdcc(input: BoqTraceInput): StageDraft {
  if (!input.inspectionRequired) {
    return { done: false, na: true, detail: "No client clearance required (direct dispatch)" };
  }
  const status = input.mdcc?.status ?? "Pending";
  const done = status === "Issued";
  if (!done && !canIssueMdcc(input.inspection?.status, input.inspection?.punchItems)) {
    return {
      done: false,
      blockedReason: hasOpenBlockingPunch(input.inspection?.punchItems)
        ? "Open critical/major punch items"
        : "Inspection not passed",
      detail: status,
    };
  }
  return {
    done,
    started: status !== "Pending",
    date: input.mdcc?.mdccDate ?? input.mdcc?.requestedDate,
    reference: input.mdcc?.mdccNumber,
    actor: input.mdcc?.issuedByName,
    detail: status === "Requested" ? "Requested — with client" : status,
  };
}

function draftDi(input: BoqTraceInput): StageDraft {
  const status = input.di?.status ?? "Pending";
  const done = status === "Dispatched";
  if (!done && !canIssueDi(input.mdcc?.status, input.inspectionRequired)) {
    return { done: false, blockedReason: "MDCC not issued", detail: status };
  }
  return {
    done,
    started: status !== "Pending",
    date: input.di?.dispatchedOn ?? input.di?.issuedOn,
    reference: input.di?.diNumber,
    qty: input.di?.dispatchQty,
    actor: input.di?.consignee,
    detail: input.di?.path === "direct" ? `${status} (direct path)` : status,
  };
}

function draftGrn(input: BoqTraceInput): StageDraft {
  const status = input.grn?.status ?? "Not Received";
  const done = status !== "Not Received";
  if (!done && !canReceiveGrn(input.di?.status)) {
    return { done: false, blockedReason: "Not yet dispatched", detail: status };
  }
  return {
    done,
    started: status !== "Not Received",
    date: input.grn?.receivedDate,
    reference: input.grn?.grnNumber,
    qty: input.grn?.acceptedQty,
    actor: input.grn?.receivedByName,
    detail:
      status === "Received with Discrepancy"
        ? "Received with shortage/damage/rejection"
        : status,
  };
}

function draftMvac(input: BoqTraceInput): StageDraft {
  const status = input.mvac?.status ?? "Pending";
  const done = status === "Signed";
  const grnAccepted = input.grn?.acceptedQty ?? 0;
  if (!done && grnAccepted <= 0) {
    return { done: false, blockedReason: "Nothing accepted at site yet", detail: status };
  }
  if (status === "Held") {
    return {
      done: false,
      blockedReason: "Held — open critical observation",
      qty: input.mvac?.qtyHeld,
      detail: status,
    };
  }
  if (!done && !canSignMvac(input.mvac?.observations)) {
    return { done: false, blockedReason: "Open critical observation", detail: status };
  }
  return {
    done,
    started: status !== "Pending",
    date: input.mvac?.signedOn ?? input.mvac?.requestedDate,
    qty: input.mvac?.qtyAccepted,
    actor: input.mvac?.signedByName ?? input.mvac?.clientRepName,
    detail: status === "Requested" ? "Requested — with client" : status,
  };
}

function draftBilling(input: BoqTraceInput): StageDraft {
  // No client-billing module exists yet. Reporting this as N/A (rather than a permanent block)
  // keeps progress honest instead of capping every fully-delivered item below 100%.
  if (input.billedQty == null) {
    return { done: false, na: true, detail: "Client billing module not built yet" };
  }
  const released = Boolean(input.mvac?.billingReleasedOn);
  if (!released && input.billedQty <= 0) {
    return { done: false, blockedReason: "Not released for billing", detail: "Not billed" };
  }
  return {
    done: input.billedQty > 0,
    date: input.mvac?.billingReleasedOn,
    qty: input.billedQty,
    detail: input.billedQty > 0 ? "Billed" : "Released, not yet billed",
  };
}

function draftWorkPackage(input: BoqTraceInput): StageDraft {
  const packages = input.workPackages ?? [];
  if (!packages.length) {
    // Execution is visibly happening in the measurement register even though no PM work package
    // was ever created — common for subcontracted work managed entirely through its work order.
    // N/A (not pending) so the item's current stage moves on to JMC instead of sticking here.
    if ((input.jmc?.executedQty ?? 0) > 0) {
      return { done: false, na: true, detail: "No PM work package — execution tracked via JMC" };
    }
    return { done: false, detail: "No work package linked to this BOQ item" };
  }
  const completed = packages.filter((item) => item.status === "Completed").length;
  const blocked = packages.find((item) => item.status === "Blocked");
  const averageProgress = Math.round(
    sum(packages.map((item) => item.progressPct)) / packages.length,
  );
  if (blocked) {
    return {
      done: false,
      blockedReason: blocked.blocker || "Work package blocked",
      actor: blocked.ownerName,
      detail: `${completed}/${packages.length} complete · ${averageProgress}%`,
    };
  }
  return {
    done: completed === packages.length,
    date: packages.find((item) => item.actualEndDate)?.actualEndDate,
    actor: packages[0]?.ownerName,
    detail: `${completed}/${packages.length} complete · ${averageProgress}%`,
  };
}

/** Subcontract work orders are optional — plenty of civil work is executed departmentally with no
 * subcontractor at all — so an absent work order is N/A, never a block: the lane must not imply a
 * commercial gate the business never defined. When one exists it is civil's analog of the PO. */
function draftWorkOrder(input: BoqTraceInput): StageDraft {
  const workOrder = input.workOrder;
  if (!workOrder || workOrder.orderedQty <= 0) {
    return { done: false, na: true, detail: "No subcontractor work order — departmental execution" };
  }
  return {
    done: true,
    date: workOrder.latestDate,
    reference: workOrder.workOrderNos.join(", "),
    qty: workOrder.orderedQty,
    actor: workOrder.subcontractorNames.join(", "),
    detail:
      workOrder.workOrderNos.length > 1
        ? `${workOrder.workOrderNos.length} work orders`
        : undefined,
  };
}

/** Joined from Billing Recon / Subcontractors Management's `jmcEntries`/`mvacEntries` (they share
 * one measurement shape). Done once every executed quantity has been certified; merely-executed
 * work shows as in progress with the uncertified balance named. */
function draftJmc(input: BoqTraceInput): StageDraft {
  const jmc = input.jmc;
  if (!jmc || jmc.entryCount === 0) {
    return { done: false, detail: "No joint measurement recorded yet" };
  }
  const fullyCertified = jmc.certifiedQty > 0 && jmc.certifiedQty >= jmc.executedQty - 0.0005;
  return {
    done: fullyCertified,
    started: jmc.executedQty > 0 || jmc.certifiedQty > 0,
    date: jmc.latestDate,
    reference: jmc.latestNo,
    qty: fullyCertified ? jmc.certifiedQty : jmc.executedQty,
    detail: fullyCertified
      ? `${jmc.certifiedQty} certified`
      : `${jmc.certifiedQty} certified of ${jmc.executedQty} executed`,
  };
}

const SUPPLY_DRAFTERS: Record<
  (typeof SUPPLY_STAGE_ORDER)[number],
  (input: BoqTraceInput) => StageDraft
> = {
  survey: draftSurvey,
  indent: draftIndent,
  rfq: draftRfq,
  po: draftPo,
  drawing: draftDrawing,
  mc: draftMc,
  inspection: draftInspection,
  mdcc: draftMdcc,
  di: draftDi,
  grn: draftGrn,
  mvac: draftMvac,
  billing: draftBilling,
};

const CIVIL_DRAFTERS: Record<
  (typeof CIVIL_STAGE_ORDER)[number],
  (input: BoqTraceInput) => StageDraft
> = {
  survey: draftSurvey,
  workOrder: draftWorkOrder,
  workPackage: draftWorkPackage,
  jmc: draftJmc,
  billing: draftBilling,
};

/**
 * Builds the ordered lifecycle for one BOQ item.
 *
 * Post-processing rule: stages are drafted independently, then the FIRST stage that is neither
 * done nor N/A becomes the current one — `blocked` if it named an unmet precondition, otherwise
 * `active` if work has visibly started, otherwise `pending`. Everything after it is `pending`.
 * This guarantees exactly one current stage, which is what makes "where is this item?" answerable.
 */
export function buildBoqTimeline(input: BoqTraceInput): TraceStage[] {
  const order: readonly TraceStageKey[] =
    input.lane === "civil" ? CIVIL_STAGE_ORDER : SUPPLY_STAGE_ORDER;

  const drafts = order.map((key) => {
    const drafter =
      input.lane === "civil"
        ? CIVIL_DRAFTERS[key as (typeof CIVIL_STAGE_ORDER)[number]]
        : SUPPLY_DRAFTERS[key as (typeof SUPPLY_STAGE_ORDER)[number]];
    return { key, draft: drafter(input) };
  });

  let currentAssigned = false;
  return drafts.map(({ key, draft }) => {
    const { done, na, blockedReason, started, ...rest } = draft;
    const base = { key, label: TRACE_STAGE_LABELS[key], ...rest };

    if (na) return { ...base, status: "na" as const };
    if (done) return { ...base, status: "done" as const };

    if (currentAssigned) return { ...base, status: "pending" as const };
    currentAssigned = true;

    if (blockedReason) {
      return { ...base, status: "blocked" as const, blockedReason };
    }
    // An explicit `started` from the drafter wins; otherwise fall back to "this stage already
    // carries a date, reference or quantity".
    const hasBegun = started ?? Boolean(rest.date || rest.reference || rest.qty);
    return { ...base, status: hasBegun ? ("active" as const) : ("pending" as const) };
  });
}

/** Progress from real workflow state (never a typed-in percentage). N/A stages are excluded from
 * the denominator so an item that legitimately skips Drawing/Inspection can still reach 100%. */
export function computeBoqProgressPct(stages: TraceStage[]): number {
  const applicable = stages.filter((stage) => stage.status !== "na");
  if (!applicable.length) return 0;
  const done = applicable.filter((stage) => stage.status === "done").length;
  return Math.round((done / applicable.length) * 100);
}

/** The one stage the item is sitting at — what a project manager actually needs to chase. */
export function currentTraceStage(stages: TraceStage[]): TraceStage | null {
  return (
    stages.find((stage) => stage.status === "blocked" || stage.status === "active") ??
    stages.find((stage) => stage.status === "pending") ??
    null
  );
}

export const traceStageStatusStyles: Record<TraceStageStatus, string> = {
  done: "bg-emerald-100 text-emerald-700",
  active: "bg-blue-100 text-blue-700",
  blocked: "bg-red-100 text-red-700",
  pending: "bg-muted text-muted-foreground",
  na: "bg-muted text-muted-foreground",
};
