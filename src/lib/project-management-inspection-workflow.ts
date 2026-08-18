/**
 * The inspection result approval lifecycle.
 *
 * A passing inspection is what opens the MDCC gate: `canIssueMdcc` in supply-gates.ts returns true
 * for "Passed", and for "Passed with Punch Items" once nothing Critical or Major is still open. So a
 * single inspector recording a pass was enough to move material toward client sign-off, with the
 * accepted/rejected split and any punch items unreviewed.
 *
 * The gate therefore goes on a passing result: it becomes a request, the inspection record stays
 * "Requested", and the result is only written when the final stage approves.
 *
 * Recording "Failed" is deliberately NOT routed, for the same reason rejecting a manufacturing
 * clearance isn't — a failure holds the gate shut and lets nothing proceed, so requiring sign-off to
 * record bad news would add friction without adding control. It also keeps the re-inspection loop
 * (Failed → Request again) working exactly as it does today.
 *
 * Like MC and unlike the earlier modules, this needs no `workflowEnrolled` marker: the meaning of an
 * existing result is unchanged, so only new passing results route.
 *
 * Pure (no Firebase, no React) so the transition rules stay unit-testable.
 */

import type { ActionLog, WorkflowStep } from "@/lib/types";
import type { InspectionStatus, PunchItem } from "@/lib/supply-gates";

export const INSPECTION_PERMISSION_RESOURCE = "Project Management.Inspections";
export const INSPECTION_ACTIVITY_MODULE = "Project Management";
export const INSPECTION_BASE_PATH = "/project-management/inspections";

export const INSPECTION_RESULT_WORKFLOW_DOC_ID = "inspection-result-workflow";
/** Project-level register: `projects/{globalProjectId}/inspectionResultApprovals`. */
export const INSPECTION_RESULT_APPROVAL_COLLECTION = "inspectionResultApprovals";

/** The two results that open the MDCC gate, and therefore the ones that route. */
export const ROUTED_INSPECTION_RESULTS: InspectionStatus[] = ["Passed", "Passed with Punch Items"];

export function inspectionResultIsRouted(status: InspectionStatus): boolean {
  return ROUTED_INSPECTION_RESULTS.includes(status);
}

export const INSPECTION_APPROVAL_STATUSES = [
  "Pending",
  "In Progress",
  "Needs Correction",
  "Approved",
  "Rejected",
] as const;

export type InspectionApprovalStatus = (typeof INSPECTION_APPROVAL_STATUSES)[number];

export function isTerminalInspectionApprovalStatus(status: InspectionApprovalStatus): boolean {
  return status === "Approved" || status === "Rejected";
}

/**
 * A proposed inspection result awaiting approval.
 *
 * The whole result is snapshotted — quantities, punch items, serials and the uploaded report — so
 * the approver signs off on exactly what the inspector recorded, and the final write reproduces it
 * without depending on anything having stayed put in the meantime. The report file is uploaded at
 * submission rather than on approval: the inspector is the one holding it.
 */
export interface InspectionResultApproval {
  id: string;
  /** The BOQ item whose gate this would open — also the inspection record's document id. */
  boqItemId: string;
  boqSlNo: string;
  description: string;
  poId: string;
  poNumber: string;
  /** The proposed result: "Passed" or "Passed with Punch Items". */
  result: InspectionStatus;
  inspectionDate: string;
  inspectorName: string;
  remarks: string;
  qtyOffered: number;
  qtyAccepted: number;
  qtyRejected: number;
  punchItems: PunchItem[];
  serials: string[];
  reportDocumentId?: string;
  reportFileName?: string;
  reportFileUrl?: string;
  requestedBy: string;
  requestedByName: string;
  createdAt?: unknown;
  status: InspectionApprovalStatus;
  currentStepIndex: number;
  currentStepName: string;
  assignees: string[];
  deadline?: unknown;
  actionLogs: ActionLog[];
  /** Set once the approved result has been written onto the inspection record. */
  recordedAt?: unknown;
  projectId: string;
  mappingId: string;
}

export const INSPECTION_APPROVAL_ACTIONS = ["Approve", "Reject", "Needs Correction"] as const;

export type InspectionApprovalAction = (typeof INSPECTION_APPROVAL_ACTIONS)[number];

export const DEFAULT_INSPECTION_RESULT_STEPS: WorkflowStep[] = [
  {
    id: "1",
    name: "QA Review",
    tat: 24,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Approve", "Reject", "Needs Correction"],
    upload: "Optional",
    description:
      "Check the report, the accepted/rejected split and any punch items raised against the offered quantity.",
  },
  {
    id: "2",
    name: "Result Approval",
    tat: 24,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Approve", "Reject"],
    upload: "Optional",
    description: "Accept the inspection result so the item can move to MDCC.",
  },
];

/**
 * Whether recording a passing result needs approval first.
 *
 * A project with no stages configured records directly, exactly as it did before this workflow.
 */
export function inspectionResultRequiresApproval(
  result: InspectionStatus,
  steps: WorkflowStep[],
): boolean {
  if (!inspectionResultIsRouted(result)) return false;
  return steps.length > 0;
}

export interface InspectionApprovalTransition {
  status: InspectionApprovalStatus;
  currentStepIndex: number;
  currentStepName: string;
  /** True when this transition is what writes the result onto the inspection record. */
  recordsResult: boolean;
}

/** The state a freshly submitted result request starts in. */
export function initialInspectionApprovalState(steps: WorkflowStep[]): InspectionApprovalTransition {
  if (!steps.length) {
    return {
      status: "Approved",
      currentStepIndex: -1,
      currentStepName: "",
      recordsResult: true,
    };
  }
  return {
    status: "Pending",
    currentStepIndex: 0,
    currentStepName: steps[0].name,
    recordsResult: false,
  };
}

/** Where a result request lands after `action` is taken on step `currentStepIndex`. */
export function nextInspectionApprovalState(
  action: InspectionApprovalAction,
  currentStepIndex: number,
  steps: WorkflowStep[],
): InspectionApprovalTransition {
  if (action === "Reject") {
    // The proposed result is refused. The inspection stays "Requested" — this does NOT record a
    // Failed result, which is a substantive finding only an inspector should record.
    return {
      status: "Rejected",
      currentStepIndex: -1,
      currentStepName: "",
      recordsResult: false,
    };
  }

  if (action === "Needs Correction") {
    return {
      status: "Needs Correction",
      currentStepIndex: 0,
      currentStepName: steps[0]?.name ?? "",
      recordsResult: false,
    };
  }

  const nextIndex = currentStepIndex + 1;
  if (nextIndex >= steps.length) {
    return {
      status: "Approved",
      currentStepIndex: -1,
      currentStepName: "",
      recordsResult: true,
    };
  }

  return {
    status: "In Progress",
    currentStepIndex: nextIndex,
    currentStepName: steps[nextIndex]?.name ?? "",
    recordsResult: false,
  };
}

export function canActOnInspectionApproval(
  approval: Pick<InspectionResultApproval, "status" | "assignees">,
  userId: string,
): boolean {
  if (isTerminalInspectionApprovalStatus(approval.status)) return false;
  return approval.assignees.includes(userId);
}

/** Result requests sitting on a given step, for the stage screens. */
export function inspectionApprovalsForStep<
  T extends Pick<InspectionResultApproval, "status" | "currentStepIndex">,
>(approvals: T[], stepId: string, steps: WorkflowStep[]): T[] {
  const stepIndex = steps.findIndex((step) => String(step.id) === String(stepId));
  if (stepIndex < 0) return [];
  return approvals.filter(
    (approval) =>
      !isTerminalInspectionApprovalStatus(approval.status) &&
      approval.currentStepIndex === stepIndex,
  );
}

/**
 * The open request for a BOQ item, if any — so the register can show "awaiting approval" on that
 * row rather than offering Record Result again.
 */
export function openInspectionRequestForBoqItem<
  T extends Pick<InspectionResultApproval, "boqItemId" | "status">,
>(approvals: T[], boqItemId: string): T | null {
  return (
    approvals.find(
      (approval) =>
        approval.boqItemId === boqItemId &&
        !isTerminalInspectionApprovalStatus(approval.status),
    ) ?? null
  );
}

/**
 * What a reviewer most needs to notice about a proposed result: material was rejected, or punch
 * items are open that would block MDCC anyway.
 *
 * Kept here rather than in the screen so the wording and the thresholds can't drift between the
 * stage list and the confirm dialog.
 */
export function inspectionResultConcerns(
  approval: Pick<InspectionResultApproval, "result" | "qtyRejected" | "punchItems">,
): string[] {
  const concerns: string[] = [];
  if (approval.qtyRejected > 0) {
    concerns.push(`${approval.qtyRejected} unit(s) rejected`);
  }
  const punchItems = approval.punchItems ?? [];
  const blocking = punchItems.filter(
    (item) => !item.closed && (item.severity === "Critical" || item.severity === "Major"),
  );
  if (blocking.length) {
    concerns.push(
      `${blocking.length} open ${blocking.length === 1 ? "punch item" : "punch items"} that will block MDCC`,
    );
  }
  const openMinor = punchItems.filter((item) => !item.closed && item.severity === "Minor");
  if (openMinor.length) {
    concerns.push(`${openMinor.length} open minor punch item(s)`);
  }
  return concerns;
}

export const inspectionApprovalStatusStyles: Record<InspectionApprovalStatus, string> = {
  Pending: "bg-amber-100 text-amber-800 border-amber-200",
  "In Progress": "bg-blue-100 text-blue-800 border-blue-200",
  "Needs Correction": "bg-orange-100 text-orange-800 border-orange-200",
  Approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Rejected: "bg-red-100 text-red-800 border-red-200",
};

/* ---------------- host context ---------------- */

export interface PmInspectionContext {
  mappingId: string;
  globalProjectId: string;
  permissionResource: string;
  activityModule: string;
  /** `inspectionHref()` is the hub, `inspectionHref("register")`,
   * ``inspectionHref(`stage/${stepId}`)`` the rest. Returns "#" with no mapping id, which the nav
   * cards already render as disabled. */
  inspectionHref: (suffix?: string) => string;
  parentHref: string;
}

export function projectManagementInspectionContext(
  mappingId: string,
  globalProjectId: string,
): PmInspectionContext {
  const query = mappingId ? `?project=${encodeURIComponent(mappingId)}` : "";
  return {
    mappingId,
    globalProjectId,
    permissionResource: INSPECTION_PERMISSION_RESOURCE,
    activityModule: INSPECTION_ACTIVITY_MODULE,
    inspectionHref: (suffix) =>
      mappingId
        ? `${suffix ? `${INSPECTION_BASE_PATH}/${suffix}` : INSPECTION_BASE_PATH}${query}`
        : "#",
    parentHref: mappingId ? `/project-management/supply${query}` : "#",
  };
}
