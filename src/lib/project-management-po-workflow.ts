/**
 * The purchase order issue approval lifecycle.
 *
 * Issuing is already the commitment point everywhere downstream: costing, the supply gates and the
 * survey exposure columns all count Issued/Received only, and a Draft PO is deliberately not a
 * commitment. So the gate goes on Issue — a draft PO must be approved before it becomes an order
 * a vendor can hold the business to.
 *
 * Issuing already had a soft control: a PO with unresolved flow-down gaps or commitment exceptions
 * demanded a typed override reason. That reason is now carried onto the approval request rather than
 * being the whole control, so the person accepting the exception is not the same person raising it.
 *
 * Pure (no Firebase, no React) so the transition rules stay unit-testable.
 */

import type { ActionLog, WorkflowStep } from "@/lib/types";

export const PO_PERMISSION_RESOURCE = "Project Management.Purchase Orders";
export const PO_ACTIVITY_MODULE = "Project Management";
export const PO_BASE_PATH = "/project-management/purchase-orders";

export const PO_ISSUE_WORKFLOW_DOC_ID = "po-issue-workflow";
/** Project-level register: `projects/{globalProjectId}/poIssueApprovals`. */
export const PO_ISSUE_APPROVAL_COLLECTION = "poIssueApprovals";

export const PO_ISSUE_STATUSES = [
  "Pending",
  "In Progress",
  "Needs Correction",
  "Approved",
  "Rejected",
] as const;

export type PoIssueStatus = (typeof PO_ISSUE_STATUSES)[number];

export function isTerminalPoIssueStatus(status: PoIssueStatus): boolean {
  return status === "Approved" || status === "Rejected";
}

/** An exception the buyer is asking the approver to accept along with the PO. */
export interface PoIssueException {
  kind: "flow-down" | "commitment";
  label: string;
  detail?: string;
}

export interface PoIssueApproval {
  id: string;
  poId: string;
  poNumber: string;
  poDate: string;
  vendorId: string;
  vendorName: string;
  totalAmount: number;
  itemCount: number;
  /** Unresolved gaps at the time of submission, snapshotted so the approver judges the same PO the
   * buyer submitted rather than a re-derived view of it. */
  exceptions: PoIssueException[];
  /** The buyer's stated reason for issuing despite those exceptions. */
  overrideReason?: string;
  requestedBy: string;
  requestedByName: string;
  createdAt?: unknown;
  status: PoIssueStatus;
  currentStepIndex: number;
  currentStepName: string;
  assignees: string[];
  deadline?: unknown;
  actionLogs: ActionLog[];
  /** Set once the approved request has actually flipped the PO to Issued. */
  issuedAt?: unknown;
  projectId: string;
  mappingId: string;
}

export const PO_ISSUE_ACTIONS = ["Approve", "Reject", "Needs Correction"] as const;

export type PoIssueAction = (typeof PO_ISSUE_ACTIONS)[number];

export const DEFAULT_PO_ISSUE_STEPS: WorkflowStep[] = [
  {
    id: "1",
    name: "Commercial Review",
    tat: 24,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Approve", "Reject", "Needs Correction"],
    upload: "Optional",
    description: "Check rates, terms and any commitment exceptions before the order is committed.",
  },
  {
    id: "2",
    name: "Issue Approval",
    tat: 24,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Approve", "Reject"],
    upload: "Optional",
    description: "Authorise issuing this purchase order to the vendor.",
  },
];

/** Only the fields the rules below read, so callers can pass their own PO row types. */
export interface PoLike {
  status?: unknown;
  workflowEnrolled?: boolean;
}

/**
 * Whether issuing this PO needs approval first.
 *
 * POs raised before this workflow existed carry no marker and issue directly, exactly as they
 * always did — so nothing already in flight is stalled by turning the feature on. A project with no
 * stages configured also issues directly.
 */
export function poIssueRequiresApproval(po: PoLike, steps: WorkflowStep[]): boolean {
  if (!po.workflowEnrolled) return false;
  return steps.length > 0;
}

/** True for POs that predate the workflow, which the register flags rather than hides. */
export function isLegacyPo(po: PoLike): boolean {
  return !po.workflowEnrolled;
}

export interface PoIssueTransition {
  status: PoIssueStatus;
  currentStepIndex: number;
  currentStepName: string;
  /** True when this transition is what flips the PO to Issued. */
  issuesPurchaseOrder: boolean;
}

/** The state a freshly submitted issue request starts in. */
export function initialPoIssueState(steps: WorkflowStep[]): PoIssueTransition {
  if (!steps.length) {
    return {
      status: "Approved",
      currentStepIndex: -1,
      currentStepName: "",
      issuesPurchaseOrder: true,
    };
  }
  return {
    status: "Pending",
    currentStepIndex: 0,
    currentStepName: steps[0].name,
    issuesPurchaseOrder: false,
  };
}

/** Where an issue request lands after `action` is taken on step `currentStepIndex`. */
export function nextPoIssueState(
  action: PoIssueAction,
  currentStepIndex: number,
  steps: WorkflowStep[],
): PoIssueTransition {
  if (action === "Reject") {
    return {
      status: "Rejected",
      currentStepIndex: -1,
      currentStepName: "",
      issuesPurchaseOrder: false,
    };
  }

  if (action === "Needs Correction") {
    // Back to the buyer. The PO stays a Draft they can edit and resubmit.
    return {
      status: "Needs Correction",
      currentStepIndex: 0,
      currentStepName: steps[0]?.name ?? "",
      issuesPurchaseOrder: false,
    };
  }

  const nextIndex = currentStepIndex + 1;
  if (nextIndex >= steps.length) {
    return {
      status: "Approved",
      currentStepIndex: -1,
      currentStepName: "",
      issuesPurchaseOrder: true,
    };
  }

  return {
    status: "In Progress",
    currentStepIndex: nextIndex,
    currentStepName: steps[nextIndex]?.name ?? "",
    issuesPurchaseOrder: false,
  };
}

export function canActOnPoIssue(
  approval: Pick<PoIssueApproval, "status" | "assignees">,
  userId: string,
): boolean {
  if (isTerminalPoIssueStatus(approval.status)) return false;
  return approval.assignees.includes(userId);
}

/** Issue requests sitting on a given step, for the stage screens. */
export function poIssuesForStep<T extends Pick<PoIssueApproval, "status" | "currentStepIndex">>(
  approvals: T[],
  stepId: string,
  steps: WorkflowStep[],
): T[] {
  const stepIndex = steps.findIndex((step) => String(step.id) === String(stepId));
  if (stepIndex < 0) return [];
  return approvals.filter(
    (approval) =>
      !isTerminalPoIssueStatus(approval.status) && approval.currentStepIndex === stepIndex,
  );
}

/**
 * The open request for a PO, if any — so the detail screen can show "awaiting approval" rather than
 * offering Issue again, and the register can show where a draft has got to.
 */
export function openIssueRequestForPo<T extends Pick<PoIssueApproval, "poId" | "status">>(
  approvals: T[],
  poId: string,
): T | null {
  return (
    approvals.find(
      (approval) => approval.poId === poId && !isTerminalPoIssueStatus(approval.status),
    ) ?? null
  );
}

export const poIssueStatusStyles: Record<PoIssueStatus, string> = {
  Pending: "bg-amber-100 text-amber-800 border-amber-200",
  "In Progress": "bg-blue-100 text-blue-800 border-blue-200",
  "Needs Correction": "bg-orange-100 text-orange-800 border-orange-200",
  Approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Rejected: "bg-red-100 text-red-800 border-red-200",
};

/* ---------------- host context ---------------- */

export interface PmPoContext {
  mappingId: string;
  globalProjectId: string;
  permissionResource: string;
  activityModule: string;
  /** `poHref()` is the hub, `poHref("register")`, ``poHref(`stage/${stepId}`)`` the rest.
   * Returns "#" with no mapping id, which the nav cards already render as disabled. */
  poHref: (suffix?: string) => string;
  parentHref: string;
}

export function projectManagementPoContext(
  mappingId: string,
  globalProjectId: string,
): PmPoContext {
  const query = mappingId ? `?project=${encodeURIComponent(mappingId)}` : "";
  return {
    mappingId,
    globalProjectId,
    permissionResource: PO_PERMISSION_RESOURCE,
    activityModule: PO_ACTIVITY_MODULE,
    poHref: (suffix) =>
      mappingId ? `${suffix ? `${PO_BASE_PATH}/${suffix}` : PO_BASE_PATH}${query}` : "#",
    parentHref: mappingId ? `/project-management/supply${query}` : "#",
  };
}
