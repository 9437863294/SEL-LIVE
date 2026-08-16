/**
 * BOQ quantity reconciliation — the control that stops quantity drifting silently as a BOQ line
 * moves down the chain.
 *
 * Every stage records its own quantity in its own collection. Individually each looks reasonable;
 * together they can quietly disagree — 10 ordered, 12 dispatched, 11 received, 12 accepted. Nothing
 * in the system notices, because no single page sees the whole ladder. This module does.
 *
 * The ladder, in order:
 *   supply: BOQ → Survey → Indented → Ordered → Inspected → Dispatched → Received → Site-Accepted
 *           → Client-Accepted → Billed
 *   civil:  BOQ → Survey → WO-Ordered → Executed → JMC → Subcontractor-Billed → Billed
 *   (WO-Ordered, Executed, JMC and Subcontractor-Billed are joined from the registers Billing
 *   Recon and Subcontractors Management own — see src/lib/civil-execution.ts.)
 *
 * Two rules are enforced:
 *   1. MONOTONIC — each rung must be ≤ the rung above it. You cannot dispatch more than was
 *      inspected, or bill more than the client accepted. A violation is `critical`: it means two
 *      registers are telling different stories about the same physical material.
 *   2. WITHIN SCOPE — procurement-side rungs must stay within the BOQ quantity plus the configured
 *      variation tolerance plus any approved variation order. Exceeding that is `warning`: it may
 *      be legitimate (a variation is pending) but it is uncontrolled scope until approved.
 *
 * Pure (no Firebase, no React) so it is unit-testable with `node --test`.
 */

import { computeAvailableQty } from "./project-management-variations.ts";

export type QuantityRungKey =
  | "boq"
  | "survey"
  | "indented"
  | "ordered"
  | "inspected"
  | "dispatched"
  | "received"
  | "siteAccepted"
  | "clientAccepted"
  | "woOrdered"
  | "executed"
  | "jmc"
  | "subBilled"
  | "billed";

export interface QuantityRung {
  key: QuantityRungKey;
  label: string;
  /** Undefined means "this stage has not recorded a quantity yet", which is different from zero. */
  qty?: number;
  /** Difference against the nearest preceding rung that has a value. */
  deltaFromPrevious?: number;
}

export type QuantityExceptionSeverity = "critical" | "warning";

export interface QuantityException {
  severity: QuantityExceptionSeverity;
  rung: QuantityRungKey;
  comparedTo: QuantityRungKey | "allowance";
  message: string;
  qty: number;
  limit: number;
}

export interface QuantityLedger {
  rungs: QuantityRung[];
  exceptions: QuantityException[];
  /** Convenience for badges/filters — the worst severity present, or null when clean. */
  worstSeverity: QuantityExceptionSeverity | null;
  /** Quantity still available to indent/order, from computeAvailableQty(). */
  availableToOrder: number;
}

export interface BoqQuantityInput {
  lane?: "supply" | "civil";
  boqQty: number;
  surveyedQty?: number;
  indentedQty?: number;
  orderedQty?: number;
  inspectedAcceptedQty?: number;
  dispatchedQty?: number;
  receivedQty?: number;
  /** GRN accepted (i.e. received minus rejected/short/damaged). */
  siteAcceptedQty?: number;
  /** MVAC accepted — what the client has actually signed for. */
  clientAcceptedQty?: number;
  /** Subcontract work-order commitment (civil lane) — civil's analog of `orderedQty`. */
  woOrderedQty?: number;
  executedQty?: number;
  jmcQty?: number;
  /** Quantity billed BY subcontractors (civil lane, cost side) — checked against JMC certified,
   * never against client billing. */
  subcontractorBilledQty?: number;
  /** Undefined while no client-billing module exists; excluded from checks rather than treated as 0. */
  billedQty?: number;
  approvedVariationQty?: number;
  tolerancePct?: number;
}

const RUNG_LABELS: Record<QuantityRungKey, string> = {
  boq: "BOQ",
  survey: "Surveyed",
  indented: "Indented",
  ordered: "Ordered (PO)",
  inspected: "Inspected & accepted",
  dispatched: "Dispatched (DI)",
  received: "Received (GRN)",
  siteAccepted: "Accepted at site",
  clientAccepted: "Client accepted (MVAC)",
  woOrdered: "Ordered (Work Order)",
  executed: "Executed (JMC)",
  jmc: "JMC certified",
  subBilled: "Subcontractor billed",
  billed: "Billed",
};

const SUPPLY_LADDER: QuantityRungKey[] = [
  "boq",
  "survey",
  "indented",
  "ordered",
  "inspected",
  "dispatched",
  "received",
  "siteAccepted",
  "clientAccepted",
  "billed",
];

const CIVIL_LADDER: QuantityRungKey[] = [
  "boq",
  "survey",
  "woOrdered",
  "executed",
  "jmc",
  "subBilled",
  "billed",
];

/** Rungs measured against the BOQ + tolerance + approved-variation allowance rather than against
 * the rung above. These are the commitment-side ones — once material is inspected onward, the
 * meaningful comparison is to the previous physical step, not to the contract quantity.
 * `woOrdered` is civil's commitment rung, exactly as `ordered` is supply's. */
const SCOPE_CHECKED_RUNGS = new Set<QuantityRungKey>(["indented", "ordered", "woOrdered"]);

/**
 * Rungs that are never flagged. `boq` has nothing above it, and `survey` legitimately differs from
 * the BOQ in both directions — establishing the real quantity is exactly what a survey is for, and
 * it becomes the base every downstream check then uses. Treating "surveyed 120 vs BOQ 100" as a
 * register disagreement would fire on almost every site-verified line; the BOQ→survey delta is
 * reported as `deltaFromPrevious` and handled by the variation-order flow instead.
 */
const UNCHECKED_RUNGS = new Set<QuantityRungKey>(["boq", "survey"]);

/**
 * Rungs that never become the "previous" for the physical chain below them. Unlike supply — where
 * material only exists via the PO, so `ordered` genuinely caps `inspected` — civil execution can
 * legitimately exceed the subcontracted quantity when part of the work is departmental, so
 * `executed` must be measured against the surveyed base, not against `woOrdered`. `subBilled` is
 * cost-side: it gets its own check against JMC certified below and must not cap client `billed`.
 */
const NON_CHAINING_RUNGS = new Set<QuantityRungKey>(["woOrdered", "subBilled"]);

/** Floating-point slack. Quantities carry up to 3 decimals across the app (step="0.001"). */
const EPSILON = 0.0005;

export function reconcileBoqQuantities(input: BoqQuantityInput): QuantityLedger {
  const tolerancePct = input.tolerancePct ?? 0;
  const approvedVariationQty = input.approvedVariationQty ?? 0;
  // Survey supersedes the stated BOQ quantity once it exists — the same base the Indent screen and
  // Requirement Planner use.
  const baseQty = input.surveyedQty ?? input.boqQty;

  const values: Partial<Record<QuantityRungKey, number | undefined>> = {
    boq: input.boqQty,
    survey: input.surveyedQty,
    indented: input.indentedQty,
    ordered: input.orderedQty,
    inspected: input.inspectedAcceptedQty,
    dispatched: input.dispatchedQty,
    received: input.receivedQty,
    siteAccepted: input.siteAcceptedQty,
    clientAccepted: input.clientAcceptedQty,
    woOrdered: input.woOrderedQty,
    executed: input.executedQty,
    jmc: input.jmcQty,
    subBilled: input.subcontractorBilledQty,
    billed: input.billedQty,
  };

  const ladder = input.lane === "civil" ? CIVIL_LADDER : SUPPLY_LADDER;
  const allowance = baseQty * (1 + tolerancePct / 100) + approvedVariationQty;

  const rungs: QuantityRung[] = [];
  const exceptions: QuantityException[] = [];

  let previousKey: QuantityRungKey | null = null;
  let previousQty: number | null = null;

  for (const key of ladder) {
    const qty = values[key];
    if (qty == null) {
      rungs.push({ key, label: RUNG_LABELS[key] });
      continue;
    }

    rungs.push({
      key,
      label: RUNG_LABELS[key],
      qty,
      ...(previousQty != null
        ? { deltaFromPrevious: Math.round((qty - previousQty) * 1000) / 1000 }
        : {}),
    });

    if (UNCHECKED_RUNGS.has(key)) {
      // Deliberately no check — see UNCHECKED_RUNGS.
    } else if (SCOPE_CHECKED_RUNGS.has(key)) {
      if (qty > allowance + EPSILON) {
        exceptions.push({
          severity: "warning",
          rung: key,
          comparedTo: "allowance",
          message: `${RUNG_LABELS[key]} ${qty} exceeds the approved scope of ${
            Math.round(allowance * 1000) / 1000
          } (BOQ ${baseQty}${tolerancePct ? ` +${tolerancePct}% tolerance` : ""}${
            approvedVariationQty ? ` +${approvedVariationQty} approved variation` : ""
          }). Raise a variation order.`,
          qty,
          limit: allowance,
        });
      }
    } else if (key === "subBilled") {
      // The one cost-side rung: what subcontractors have billed may never exceed what the joint
      // measurement certified — that is paying for work nobody has certified.
      const certifiedQty = values.jmc;
      if (certifiedQty != null && qty > certifiedQty + EPSILON) {
        exceptions.push({
          severity: "critical",
          rung: key,
          comparedTo: "jmc",
          message: `${RUNG_LABELS.subBilled} ${qty} exceeds ${RUNG_LABELS.jmc} ${certifiedQty} — billing beyond certified measurement.`,
          qty,
          limit: certifiedQty,
        });
      } else if (certifiedQty == null && qty > EPSILON) {
        exceptions.push({
          severity: "warning",
          rung: key,
          comparedTo: "jmc",
          message: `${RUNG_LABELS.subBilled} ${qty} with no JMC certified quantity recorded against this line.`,
          qty,
          limit: 0,
        });
      }
    } else if (previousKey && previousQty != null && qty > previousQty + EPSILON) {
      exceptions.push({
        severity: "critical",
        rung: key,
        comparedTo: previousKey,
        message: `${RUNG_LABELS[key]} ${qty} exceeds ${RUNG_LABELS[previousKey]} ${previousQty} — these two registers disagree.`,
        qty,
        limit: previousQty,
      });
    }

    if (!NON_CHAINING_RUNGS.has(key)) {
      previousKey = key;
      previousQty = qty;
    }
  }

  // What "consumed" means depends on the lane: supply commitment is the PO (or the indent while
  // no PO exists yet); civil commitment is the subcontract work order.
  const consumedQty =
    input.lane === "civil"
      ? (input.woOrderedQty ?? 0)
      : (input.orderedQty ?? input.indentedQty ?? 0);

  return {
    rungs,
    exceptions,
    worstSeverity: exceptions.some((item) => item.severity === "critical")
      ? "critical"
      : exceptions.length
        ? "warning"
        : null,
    availableToOrder: computeAvailableQty(baseQty, tolerancePct, approvedVariationQty, consumedQty),
  };
}

export const quantityExceptionStyles: Record<QuantityExceptionSeverity, string> = {
  critical: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
};
