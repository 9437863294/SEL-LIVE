import type { Timestamp } from "firebase/firestore";

/**
 * Variation orders — the blueprint's most-repeated warning (see the "BOQ revision loop" in the
 * source flowchart): quantities above the approved BOQ must never be indented, ordered, or billed
 * without a linked, approved variation document. Stored top-level (not nested under each project)
 * so a single query can build one cross-project approval queue, matching how an approver would
 * actually want to work — not project-by-project.
 *
 * On approval, the covered quantity is added to the BOQ item's own `variationApprovedQty` field
 * (a plain number on the otherwise-dynamic BOQ item document — see `BoqItem` in `src/lib/types.ts`),
 * which `computeAvailableQty` below adds to the BOQ item's base quantity (surveyed, or stated BOQ
 * quantity if not yet surveyed) when computing how much is left to indent.
 */
export const VARIATION_COLLECTION = "boqVariations";
export const VARIATION_PERMISSION_RESOURCE = "Project Management.Variation Orders";

export type VariationStatus = "Pending" | "Approved" | "Rejected";

export interface BoqVariation {
  id: string;
  projectMappingId: string;
  projectManagementProjectName: string;
  globalProjectId: string;
  globalProjectName: string;
  boqItemId: string;
  boqSlNo: string;
  description: string;
  boqQty: number;
  requestedQty: number;
  variancePct: number;
  reason: string;
  requestedBy: string;
  requestedByName: string;
  requestedOn?: Timestamp;
  status: VariationStatus;
  decidedBy?: string;
  decidedByName?: string;
  decidedOn?: Timestamp;
  decisionNote?: string;
}

export const DEFAULT_VARIATION_TOLERANCE_PCT = 5;

/** Whether a requested quantity for a BOQ item needs a variation order at all — i.e. it exceeds
 * the BOQ's stated quantity (plus whatever's already been approved) by more than the configured
 * tolerance. */
export function requiresVariation(
  requestedQty: number,
  boqQty: number,
  approvedVariationQty: number,
  tolerancePct: number,
): boolean {
  const allowance = boqQty * (1 + tolerancePct / 100) + approvedVariationQty;
  return requestedQty > allowance;
}

export function computeVariancePct(requestedQty: number, boqQty: number): number {
  if (!boqQty) return requestedQty > 0 ? 100 : 0;
  return Math.round(((requestedQty - boqQty) / boqQty) * 1000) / 10;
}

/**
 * The quantity still available to indent/order for a BOQ item: `baseQty` (the surveyed quantity
 * when a survey has been recorded, otherwise the raw BOQ quantity — see project-management-survey.ts)
 * plus the tolerance allowance and any approved variation, minus whatever's already been consumed.
 * Shared by Indent creation and the Requirement Planner so the two never compute it differently.
 */
export function computeAvailableQty(
  baseQty: number,
  tolerancePct: number,
  approvedVariationQty: number,
  consumedQty: number,
): number {
  return Math.max(0, baseQty * (1 + tolerancePct / 100) + approvedVariationQty - consumedQty);
}

/**
 * The quantity the project actually plans to procure. Tolerance is a control ceiling, not demand:
 * adding it here would make a fully indented BOQ line appear short and encourage systematic
 * over-procurement. Approved variation is real scope and therefore is included.
 */
export function computeNetRequirement(
  baseQty: number,
  approvedVariationQty: number,
  consumedQty: number,
): number {
  return Math.max(0, baseQty + approvedVariationQty - consumedQty);
}
