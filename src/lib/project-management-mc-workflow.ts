/**
 * The manufacturing clearance approval lifecycle.
 *
 * Clearing manufacturing is what lets a vendor start production: `canRequestInspection` in
 * supply-gates.ts only opens once MC reads "Cleared", and the traceability and dashboard views
 * treat it as the gate being passed. Until now a single person holding the Clear permission opened
 * that gate outright, with only an automatic check that the MDL drawing was approved first.
 *
 * So the gate goes on Clear: the decision becomes a request, MC stays Pending, and the record is
 * only written as Cleared when the final stage approves.
 *
 * Rejecting is deliberately NOT routed. It is the conservative action — a rejection holds the gate
 * shut and lets nothing proceed — so requiring sign-off to say "no" would add friction without
 * adding control.
 *
 * Unlike the other modules this needs no `workflowEnrolled` marker: the meaning of an existing
 * "Cleared" record is unchanged, so anything already cleared stays cleared and only new clearance
 * decisions route. That makes it migration-free by construction.
 *
 * Pure (no Firebase, no React) so the transition rules stay unit-testable.
 */

import type { ActionLog, WorkflowStep } from "@/lib/types";

export const MC_PERMISSION_RESOURCE = "Project Management.Manufacturing Clearance";
export const MC_ACTIVITY_MODULE = "Project Management";
export const MC_BASE_PATH = "/project-management/manufacturing-clearance";

export const MC_CLEARANCE_WORKFLOW_DOC_ID = "mc-clearance-workflow";
/** Project-level register: `projects/{globalProjectId}/mcClearanceApprovals`. */
export const MC_CLEARANCE_APPROVAL_COLLECTION = "mcClearanceApprovals";

export const MC_APPROVAL_STATUSES = [
  "Pending",
  "In Progress",
  "Needs Correction",
  "Approved",
  "Rejected",
] as const;

export type McApprovalStatus = (typeof MC_APPROVAL_STATUSES)[number];

export function isTerminalMcApprovalStatus(status: McApprovalStatus): boolean {
  return status === "Approved" || status === "Rejected";
}

export interface McClearanceApproval {
  id: string;
  /** The BOQ item whose gate this would open — also the MC record's document id. */
  boqItemId: string;
  boqSlNo: string;
  description: string;
  poId: string;
  poNumber: string;
  vendorName: string;
  /** The clearance date the requester proposed. */
  clearedDate: string;
  remarks: string;
  requestedBy: string;
  requestedByName: string;
  createdAt?: unknown;
  status: McApprovalStatus;
  currentStepIndex: number;
  currentStepName: string;
  assignees: string[];
  deadline?: unknown;
  actionLogs: ActionLog[];
  /** Set once the approved request has actually written the MC record as Cleared. */
  clearedAt?: unknown;
  projectId: string;
  mappingId: string;
}

export const MC_APPROVAL_ACTIONS = ["Approve", "Reject", "Needs Correction"] as const;

export type McApprovalAction = (typeof MC_APPROVAL_ACTIONS)[number];

export const DEFAULT_MC_CLEARANCE_STEPS: WorkflowStep[] = [
  {
    id: "1",
    name: "Technical Review",
    tat: 24,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Approve", "Reject", "Needs Correction"],
    upload: "Optional",
    description: "Confirm the approved drawing and specification match what the vendor will build.",
  },
  {
    id: "2",
    name: "Clearance Approval",
    tat: 24,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Approve", "Reject"],
    upload: "Optional",
    description: "Authorise the vendor to begin manufacturing.",
  },
];

/**
 * Whether clearing manufacturing needs approval first.
 *
 * A project with no stages configured clears directly, exactly as it did before this workflow —
 * so turning the feature on changes nothing until someone configures it.
 */
export function mcClearanceRequiresApproval(steps: WorkflowStep[]): boolean {
  return steps.length > 0;
}

export interface McApprovalTransition {
  status: McApprovalStatus;
  currentStepIndex: number;
  currentStepName: string;
  /** True when this transition is what writes the MC record as Cleared. */
  clearsManufacturing: boolean;
}

/** The state a freshly submitted clearance request starts in. */
export function initialMcApprovalState(steps: WorkflowStep[]): McApprovalTransition {
  if (!steps.length) {
    return {
      status: "Approved",
      currentStepIndex: -1,
      currentStepName: "",
      clearsManufacturing: true,
    };
  }
  return {
    status: "Pending",
    currentStepIndex: 0,
    currentStepName: steps[0].name,
    clearsManufacturing: false,
  };
}

/** Where a clearance request lands after `action` is taken on step `currentStepIndex`. */
export function nextMcApprovalState(
  action: McApprovalAction,
  currentStepIndex: number,
  steps: WorkflowStep[],
): McApprovalTransition {
  if (action === "Reject") {
    // The request is refused; the gate stays shut. This is distinct from rejecting the clearance
    // itself, which the register does directly.
    return {
      status: "Rejected",
      currentStepIndex: -1,
      currentStepName: "",
      clearsManufacturing: false,
    };
  }

  if (action === "Needs Correction") {
    return {
      status: "Needs Correction",
      currentStepIndex: 0,
      currentStepName: steps[0]?.name ?? "",
      clearsManufacturing: false,
    };
  }

  const nextIndex = currentStepIndex + 1;
  if (nextIndex >= steps.length) {
    return {
      status: "Approved",
      currentStepIndex: -1,
      currentStepName: "",
      clearsManufacturing: true,
    };
  }

  return {
    status: "In Progress",
    currentStepIndex: nextIndex,
    currentStepName: steps[nextIndex]?.name ?? "",
    clearsManufacturing: false,
  };
}

export function canActOnMcApproval(
  approval: Pick<McClearanceApproval, "status" | "assignees">,
  userId: string,
): boolean {
  if (isTerminalMcApprovalStatus(approval.status)) return false;
  return approval.assignees.includes(userId);
}

/** Clearance requests sitting on a given step, for the stage screens. */
export function mcApprovalsForStep<
  T extends Pick<McClearanceApproval, "status" | "currentStepIndex">,
>(approvals: T[], stepId: string, steps: WorkflowStep[]): T[] {
  const stepIndex = steps.findIndex((step) => String(step.id) === String(stepId));
  if (stepIndex < 0) return [];
  return approvals.filter(
    (approval) =>
      !isTerminalMcApprovalStatus(approval.status) && approval.currentStepIndex === stepIndex,
  );
}

/**
 * The open request for a BOQ item, if any — so the register can show "awaiting approval" on that
 * row rather than offering Clear again.
 */
export function openMcRequestForBoqItem<
  T extends Pick<McClearanceApproval, "boqItemId" | "status">,
>(approvals: T[], boqItemId: string): T | null {
  return (
    approvals.find(
      (approval) =>
        approval.boqItemId === boqItemId && !isTerminalMcApprovalStatus(approval.status),
    ) ?? null
  );
}

export const mcApprovalStatusStyles: Record<McApprovalStatus, string> = {
  Pending: "bg-amber-100 text-amber-800 border-amber-200",
  "In Progress": "bg-blue-100 text-blue-800 border-blue-200",
  "Needs Correction": "bg-orange-100 text-orange-800 border-orange-200",
  Approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Rejected: "bg-red-100 text-red-800 border-red-200",
};

/* ---------------- host context ---------------- */

export interface PmMcContext {
  mappingId: string;
  globalProjectId: string;
  permissionResource: string;
  activityModule: string;
  /** `mcHref()` is the hub, `mcHref("register")`, ``mcHref(`stage/${stepId}`)`` the rest.
   * Returns "#" with no mapping id, which the nav cards already render as disabled. */
  mcHref: (suffix?: string) => string;
  parentHref: string;
}

export function projectManagementMcContext(
  mappingId: string,
  globalProjectId: string,
): PmMcContext {
  const query = mappingId ? `?project=${encodeURIComponent(mappingId)}` : "";
  return {
    mappingId,
    globalProjectId,
    permissionResource: MC_PERMISSION_RESOURCE,
    activityModule: MC_ACTIVITY_MODULE,
    mcHref: (suffix) =>
      mappingId ? `${suffix ? `${MC_BASE_PATH}/${suffix}` : MC_BASE_PATH}${query}` : "#",
    parentHref: mappingId ? `/project-management/supply${query}` : "#",
  };
}
