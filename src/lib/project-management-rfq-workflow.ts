/**
 * The RFQ award approval lifecycle.
 *
 * RFQ already had real transitions — Draft → Sent → quotes in → Confirm Awards → purchase order.
 * The gap was that Confirm Awards created the PO outright: whoever could award decided both which
 * vendor won and at what rate, with no second pair of eyes. So the gate goes on the award, not on
 * issuing the RFQ: a confirmed award becomes an approval request, and the PO is created only when
 * the final stage approves.
 *
 * Approvals live in their own project-level register rather than on the RFQ document, because an
 * RFQ is awarded in parts — several vendors, often at different times — and each of those awards is
 * a separate decision to approve.
 *
 * Pure (no Firebase, no React) so the transition rules stay unit-testable.
 */

import type { ActionLog, WorkflowStep } from "@/lib/types";

export const RFQ_PERMISSION_RESOURCE = "Project Management.RFQ";
export const RFQ_ACTIVITY_MODULE = "Project Management";
export const RFQ_BASE_PATH = "/project-management/rfq";

export const RFQ_AWARD_WORKFLOW_DOC_ID = "rfq-award-workflow";
/** Project-level register: `projects/{globalProjectId}/rfqAwardApprovals`. */
export const RFQ_AWARD_APPROVAL_COLLECTION = "rfqAwardApprovals";

export const RFQ_AWARD_STATUSES = [
  "Pending",
  "In Progress",
  "Needs Correction",
  "Approved",
  "Rejected",
] as const;

export type RfqAwardStatus = (typeof RFQ_AWARD_STATUSES)[number];

export function isTerminalRfqAwardStatus(status: RfqAwardStatus): boolean {
  return status === "Approved" || status === "Rejected";
}

/** A line on an award being approved. Rates are snapshotted — see AwardGroup in
 * project-management-rfq-awards.ts for why. */
export interface RfqAwardApprovalItem {
  rfqItemId: string;
  boqItemId: string;
  boqSlNo: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
  sourceIndentId: string;
  sourceIndentNumber: string;
}

export interface RfqAwardApproval {
  id: string;
  rfqId: string;
  rfqNumber: string;
  rfqDate: string;
  vendorId: string;
  vendorName: string;
  items: RfqAwardApprovalItem[];
  totalAmount: number;
  /** Lowest comparable landed cost among the other quotes, snapshotted so a reviewer can see
   * whether the recommended vendor was actually the cheapest without re-opening the RFQ. */
  lowestLandedCost?: number;
  requestedBy: string;
  requestedByName: string;
  createdAt?: unknown;
  status: RfqAwardStatus;
  currentStepIndex: number;
  currentStepName: string;
  assignees: string[];
  deadline?: unknown;
  actionLogs: ActionLog[];
  /** Set once the approved award has been turned into purchase orders. */
  poCreatedAt?: unknown;
  poIds?: string[];
  projectId: string;
  mappingId: string;
}

export const RFQ_AWARD_ACTIONS = ["Approve", "Reject", "Needs Correction"] as const;

export type RfqAwardAction = (typeof RFQ_AWARD_ACTIONS)[number];

export const DEFAULT_RFQ_AWARD_STEPS: WorkflowStep[] = [
  {
    id: "1",
    name: "Award Review",
    tat: 24,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Approve", "Reject", "Needs Correction"],
    upload: "Optional",
    description: "Check the recommended vendor and rate against the other quotes received.",
  },
  {
    id: "2",
    name: "Award Approval",
    tat: 24,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Approve", "Reject"],
    upload: "Optional",
    description: "Authorise the award so a purchase order can be raised.",
  },
];

/** Only the fields the rules below read, so callers can pass their own RFQ row types. */
export interface RfqLike {
  status?: unknown;
  workflowEnrolled?: boolean;
}

/**
 * Whether confirming an award on this RFQ needs approval before a PO is created.
 *
 * RFQs raised before this workflow existed carry no marker and award directly, exactly as they
 * always did — so nothing mid-negotiation is stalled by turning the feature on. A project with no
 * stages configured also awards directly, which keeps a project that never opens Workflow
 * Configuration behaving as it did.
 */
export function rfqAwardRequiresApproval(rfq: RfqLike, steps: WorkflowStep[]): boolean {
  if (!rfq.workflowEnrolled) return false;
  return steps.length > 0;
}

/** True for RFQs that predate the workflow, which the register flags rather than hides. */
export function isLegacyRfq(rfq: RfqLike): boolean {
  return !rfq.workflowEnrolled;
}

export interface RfqAwardTransition {
  status: RfqAwardStatus;
  currentStepIndex: number;
  currentStepName: string;
  /** True when this transition is what causes purchase orders to be created. */
  createsPurchaseOrder: boolean;
}

/** The state a freshly submitted award request starts in. */
export function initialRfqAwardState(steps: WorkflowStep[]): RfqAwardTransition {
  if (!steps.length) {
    return {
      status: "Approved",
      currentStepIndex: -1,
      currentStepName: "",
      createsPurchaseOrder: true,
    };
  }
  return {
    status: "Pending",
    currentStepIndex: 0,
    currentStepName: steps[0].name,
    createsPurchaseOrder: false,
  };
}

/** Where an award request lands after `action` is taken on step `currentStepIndex`. */
export function nextRfqAwardState(
  action: RfqAwardAction,
  currentStepIndex: number,
  steps: WorkflowStep[],
): RfqAwardTransition {
  if (action === "Reject") {
    return {
      status: "Rejected",
      currentStepIndex: -1,
      currentStepName: "",
      createsPurchaseOrder: false,
    };
  }

  if (action === "Needs Correction") {
    // Back to the buyer, who reworks the recommendation and confirms a fresh award. The request
    // stays visible rather than vanishing, so the reason for the rework isn't lost.
    return {
      status: "Needs Correction",
      currentStepIndex: 0,
      currentStepName: steps[0]?.name ?? "",
      createsPurchaseOrder: false,
    };
  }

  const nextIndex = currentStepIndex + 1;
  if (nextIndex >= steps.length) {
    return {
      status: "Approved",
      currentStepIndex: -1,
      currentStepName: "",
      createsPurchaseOrder: true,
    };
  }

  return {
    status: "In Progress",
    currentStepIndex: nextIndex,
    currentStepName: steps[nextIndex]?.name ?? "",
    createsPurchaseOrder: false,
  };
}

export function canActOnRfqAward(
  approval: Pick<RfqAwardApproval, "status" | "assignees">,
  userId: string,
): boolean {
  if (isTerminalRfqAwardStatus(approval.status)) return false;
  return approval.assignees.includes(userId);
}

/** Award requests sitting on a given step, for the stage screens. */
export function rfqAwardsForStep<T extends Pick<RfqAwardApproval, "status" | "currentStepIndex">>(
  approvals: T[],
  stepId: string,
  steps: WorkflowStep[],
): T[] {
  const stepIndex = steps.findIndex((step) => String(step.id) === String(stepId));
  if (stepIndex < 0) return [];
  return approvals.filter(
    (approval) =>
      !isTerminalRfqAwardStatus(approval.status) && approval.currentStepIndex === stepIndex,
  );
}

/**
 * Whether the recommended vendor is the cheapest comparable quote.
 *
 * Surfaced to reviewers because awarding above the lowest landed cost is the decision that most
 * needs a stated reason — it isn't wrong, but it should be deliberate.
 */
export function awardPremium(
  totalAmount: number,
  lowestLandedCost?: number,
): { isLowest: boolean; premium: number; premiumPct: number } {
  if (lowestLandedCost == null || lowestLandedCost <= 0) {
    return { isLowest: true, premium: 0, premiumPct: 0 };
  }
  const premium = totalAmount - lowestLandedCost;
  return {
    isLowest: premium <= 0,
    premium,
    premiumPct: (premium / lowestLandedCost) * 100,
  };
}

export const rfqAwardStatusStyles: Record<RfqAwardStatus, string> = {
  Pending: "bg-amber-100 text-amber-800 border-amber-200",
  "In Progress": "bg-blue-100 text-blue-800 border-blue-200",
  "Needs Correction": "bg-orange-100 text-orange-800 border-orange-200",
  Approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Rejected: "bg-red-100 text-red-800 border-red-200",
};

/* ---------------- host context ---------------- */

export interface PmRfqContext {
  mappingId: string;
  globalProjectId: string;
  permissionResource: string;
  activityModule: string;
  /** `rfqHref()` is the hub, `rfqHref("register")`, ``rfqHref(`stage/${stepId}`)`` the rest.
   * Returns "#" with no mapping id, which the nav cards already render as disabled. */
  rfqHref: (suffix?: string) => string;
  parentHref: string;
}

export function projectManagementRfqContext(
  mappingId: string,
  globalProjectId: string,
): PmRfqContext {
  const query = mappingId ? `?project=${encodeURIComponent(mappingId)}` : "";
  return {
    mappingId,
    globalProjectId,
    permissionResource: RFQ_PERMISSION_RESOURCE,
    activityModule: RFQ_ACTIVITY_MODULE,
    rfqHref: (suffix) =>
      mappingId ? `${suffix ? `${RFQ_BASE_PATH}/${suffix}` : RFQ_BASE_PATH}${query}` : "#",
    parentHref: mappingId ? `/project-management/supply${query}` : "#",
  };
}
