/**
 * The indent approval lifecycle.
 *
 * Indents already carried a `status` enum, but nothing ever moved one off "Draft" — and every
 * downstream consumer (costing, BOQ traceability, PO creation) counted anything that wasn't
 * Rejected or Cancelled. So an unreviewed draft reserved BOQ quantity exactly as a signed-off
 * indent did. Routing indents through the same `workflows/{id}.steps` state machine JMC and Survey
 * use makes approval the thing that grants a reservation.
 *
 * An indent is already a header plus line items, so the document routes as a whole — unlike Survey
 * there is no question of what the unit is.
 *
 * Pure (no Firebase, no React) so the transition and reservation rules stay unit-testable.
 */

import type { ActionLog, WorkflowStep } from "@/lib/types";

export const INDENT_PERMISSION_RESOURCE = "Project Management.Indent";
export const INDENT_ACTIVITY_MODULE = "Project Management";
export const INDENT_BASE_PATH = "/project-management/indent";

export const INDENT_WORKFLOW_DOC_ID = "indent-workflow";
export const INDENT_COLLECTION = "indents";

/** Unchanged from the original enum — these values already exist on live documents. */
export const INDENT_STATUSES = [
  "Draft",
  "Submitted",
  "Approved",
  "Rejected",
  "Cancelled",
] as const;

export type IndentStatus = (typeof INDENT_STATUSES)[number];

export function isTerminalIndentStatus(status: IndentStatus): boolean {
  return status === "Approved" || status === "Rejected" || status === "Cancelled";
}

/**
 * The workflow fields layered onto an indent document.
 *
 * `workflowEnrolled` is the marker that separates indents raised after this feature from the ones
 * that predate it. It is what makes the change migration-free: a legacy indent has no such field,
 * and is grandfathered as approved rather than silently losing its reservation or appearing in
 * somebody's review queue as a surprise backlog.
 */
export interface IndentWorkflowFields {
  workflowEnrolled?: boolean;
  /** Index into the workflow's `steps`. -1 while a draft, and again once terminal. */
  currentStepIndex?: number;
  currentStepName?: string;
  assignees?: string[];
  deadline?: unknown;
  actionLogs?: ActionLog[];
  approvedAt?: unknown;
}

/** Only the fields the rules below read — deliberately structural, so callers can pass their own
 * indent row types without converting. */
export interface IndentLike extends IndentWorkflowFields {
  status: IndentStatus | string;
}

/**
 * Whether this indent's quantities count against the BOQ.
 *
 * The single predicate every downstream consumer uses, so "what reserves quantity" is answered in
 * one place rather than re-derived as a status filter at each call site (which is how a draft came
 * to reserve in the first place).
 */
export function indentReservesQuantity(indent: IndentLike): boolean {
  const status = String(indent.status ?? "");
  if (status === "Rejected" || status === "Cancelled") return false;
  // Raised before the workflow existed — grandfathered, keeps reserving.
  if (!indent.workflowEnrolled) return true;
  return status === "Approved";
}

/** True for indents that predate the workflow, which the register flags rather than hides. */
export function isLegacyIndent(indent: IndentLike): boolean {
  return !indent.workflowEnrolled;
}

export const INDENT_ACTIONS = ["Approve", "Reject", "Needs Correction"] as const;

export type IndentAction = (typeof INDENT_ACTIONS)[number];

export const DEFAULT_INDENT_STEPS: WorkflowStep[] = [
  {
    id: "1",
    name: "Review",
    tat: 24,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Approve", "Reject", "Needs Correction"],
    upload: "Optional",
    description: "Check the requested quantities against the BOQ and the requirement plan.",
  },
  {
    id: "2",
    name: "Approval",
    tat: 24,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Approve", "Reject"],
    upload: "Optional",
    description: "Authorise the indent so its quantities may be ordered.",
  },
];

export interface IndentTransition {
  status: IndentStatus;
  currentStepIndex: number;
  currentStepName: string;
  /** True when this transition is what grants the indent its BOQ reservation. */
  reservesOnCommit: boolean;
}

/**
 * Where an indent lands when it is submitted out of Draft.
 *
 * With no stages configured it is approved outright, which keeps a project that never opens
 * Workflow Configuration behaving as indents did before.
 */
export function submitIndentState(steps: WorkflowStep[]): IndentTransition {
  if (!steps.length) {
    return { status: "Approved", currentStepIndex: -1, currentStepName: "", reservesOnCommit: true };
  }
  return {
    status: "Submitted",
    currentStepIndex: 0,
    currentStepName: steps[0].name,
    reservesOnCommit: false,
  };
}

/** Where an indent lands after `action` is taken on step `currentStepIndex`. */
export function nextIndentState(
  action: IndentAction,
  currentStepIndex: number,
  steps: WorkflowStep[],
): IndentTransition {
  if (action === "Reject") {
    return { status: "Rejected", currentStepIndex: -1, currentStepName: "", reservesOnCommit: false };
  }

  if (action === "Needs Correction") {
    // Back to the raiser as an editable draft, so quantities can be corrected and resubmitted.
    return { status: "Draft", currentStepIndex: -1, currentStepName: "", reservesOnCommit: false };
  }

  const nextIndex = currentStepIndex + 1;
  if (nextIndex >= steps.length) {
    return { status: "Approved", currentStepIndex: -1, currentStepName: "", reservesOnCommit: true };
  }

  return {
    status: "Submitted",
    currentStepIndex: nextIndex,
    currentStepName: steps[nextIndex]?.name ?? "",
    reservesOnCommit: false,
  };
}

export function canActOnIndent(indent: IndentLike, userId: string): boolean {
  if (isTerminalIndentStatus(indent.status as IndentStatus)) return false;
  if (String(indent.status) === "Draft") return false;
  return (indent.assignees ?? []).includes(userId);
}

/** Indents sitting on a given step, for the stage screens. */
export function indentsForStep<T extends IndentLike>(
  indents: T[],
  stepId: string,
  steps: WorkflowStep[],
): T[] {
  const stepIndex = steps.findIndex((step) => String(step.id) === String(stepId));
  if (stepIndex < 0) return [];
  return indents.filter(
    (indent) =>
      String(indent.status) === "Submitted" &&
      indent.workflowEnrolled === true &&
      indent.currentStepIndex === stepIndex,
  );
}

export const indentStatusStyles: Record<IndentStatus, string> = {
  Draft: "bg-slate-100 text-slate-700 border-slate-200",
  Submitted: "bg-blue-100 text-blue-800 border-blue-200",
  Approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Rejected: "bg-red-100 text-red-800 border-red-200",
  Cancelled: "bg-muted text-muted-foreground",
};

/* ---------------- host context ---------------- */

export interface PmIndentContext {
  mappingId: string;
  globalProjectId: string;
  permissionResource: string;
  activityModule: string;
  /** `indentHref()` is the hub, `indentHref("register")`, ``indentHref(`stage/${stepId}`)`` the
   * rest. Returns "#" with no mapping id, which the nav cards already render as disabled. */
  indentHref: (suffix?: string) => string;
  parentHref: string;
}

export function projectManagementIndentContext(
  mappingId: string,
  globalProjectId: string,
): PmIndentContext {
  const query = mappingId ? `?project=${encodeURIComponent(mappingId)}` : "";
  return {
    mappingId,
    globalProjectId,
    permissionResource: INDENT_PERMISSION_RESOURCE,
    activityModule: INDENT_ACTIVITY_MODULE,
    indentHref: (suffix) =>
      mappingId
        ? `${suffix ? `${INDENT_BASE_PATH}/${suffix}` : INDENT_BASE_PATH}${query}`
        : "#",
    parentHref: mappingId ? `/project-management/supply${query}` : "#",
  };
}
