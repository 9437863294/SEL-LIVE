/**
 * The survey approval lifecycle.
 *
 * Survey started life without one: `project-management-survey.ts` wrote a surveyed quantity
 * straight onto the BOQ item, because there was no request to track. That is no longer true —
 * a surveyed quantity now has to be verified before it is allowed to influence variations or
 * procurement, so each recorded survey becomes an entry that walks the configured workflow and
 * only lands on the BOQ item when the final step approves it.
 *
 * Modelled on JMC (see src/lib/jmc-module.ts): the same global `workflows/{id}.steps` state
 * machine, the same per-project entry subcollection, the same action-log shape. The difference is
 * what an entry carries — one BOQ item and its surveyed quantity, rather than a certificate.
 *
 * Pure (no Firebase, no React) so the transition rules stay unit-testable.
 */

import type { ActionLog, WorkflowStep } from "@/lib/types";

export const SURVEY_PERMISSION_RESOURCE = "Project Management.Survey";
export const SURVEY_ACTIVITY_MODULE = "Project Management";
export const SURVEY_BASE_PATH = "/project-management/survey";

/** Global workflow document, matching how `workflows/jmc-workflow` is stored. */
export const SURVEY_WORKFLOW_DOC_ID = "survey-workflow";
/** Per-project entry register: `projects/{globalProjectId}/surveyEntries`. */
export const SURVEY_ENTRY_COLLECTION = "surveyEntries";

export const SURVEY_ENTRY_STATUSES = [
  "Pending",
  "In Progress",
  "Needs Correction",
  "Approved",
  "Rejected",
] as const;

export type SurveyEntryStatus = (typeof SURVEY_ENTRY_STATUSES)[number];

/** Statuses that still sit in someone's queue. */
export const SURVEY_OPEN_STATUSES: SurveyEntryStatus[] = [
  "Pending",
  "In Progress",
  "Needs Correction",
];

export function isTerminalSurveyStatus(status: SurveyEntryStatus): boolean {
  return status === "Approved" || status === "Rejected";
}

export interface SurveyEntry {
  id: string;
  /** BOQ item this survey measures — `projects/{projectId}/boqItems/{boqItemId}`. */
  boqItemId: string;
  boqSlNo: string;
  description: string;
  unit: string;
  /** The contracted quantity at the time of survey, snapshotted so later BOQ edits don't
   * retroactively change what a reviewer was looking at. */
  boqQty: number;
  budgetPrice: number;
  /** The proposed figure. Not written to the BOQ item until the workflow approves it. */
  surveyedQty: number;
  remarks: string;
  surveyedBy: string;
  surveyedByName: string;
  createdAt?: unknown;
  status: SurveyEntryStatus;
  /** Index into the workflow's `steps`. -1 once the entry reaches a terminal status. */
  currentStepIndex: number;
  currentStepName: string;
  /** User ids who may act on the current step. */
  assignees: string[];
  deadline?: unknown;
  actionLogs: ActionLog[];
  /** Set when an approved quantity has been written through to the BOQ item. */
  appliedAt?: unknown;
  projectId: string;
  mappingId: string;
}

/**
 * What a step offers a reviewer. Kept deliberately small — Survey has no certified-quantity or
 * billing actions, so offering JMC's full action list would only invite misconfiguration.
 */
export const SURVEY_ACTIONS = [
  "Approve",
  "Reject",
  "Needs Correction",
] as const;

export type SurveyAction = (typeof SURVEY_ACTIONS)[number];

/**
 * Seeded when no workflow document exists yet, so a project that has never opened Workflow
 * Configuration still routes entries somewhere sensible rather than auto-approving them.
 */
export const DEFAULT_SURVEY_STEPS: WorkflowStep[] = [
  {
    id: "1",
    name: "Verification",
    tat: 24,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Approve", "Reject", "Needs Correction"],
    upload: "Optional",
    description: "Check the surveyed quantity against site measurement records.",
  },
  {
    id: "2",
    name: "Certification",
    tat: 24,
    assignmentType: "User-based",
    assignedTo: [],
    actions: ["Approve", "Reject"],
    upload: "Optional",
    description: "Certify the surveyed quantity so it can drive variations and procurement.",
  },
];

export interface SurveyTransition {
  status: SurveyEntryStatus;
  currentStepIndex: number;
  currentStepName: string;
  /** True when this transition is what writes the surveyed quantity onto the BOQ item. */
  applyToBoq: boolean;
}

/**
 * Where an entry lands after `action` is taken on step `currentStepIndex`.
 *
 * Approving the last configured step is the only transition that applies the quantity — that is
 * the whole point of routing surveys through a workflow rather than writing them on record.
 * A workflow with no steps configured approves immediately, which keeps a project that has not
 * set one up working the way Survey did before the workflow existed.
 */
export function nextSurveyState(
  action: SurveyAction,
  currentStepIndex: number,
  steps: WorkflowStep[],
): SurveyTransition {
  if (action === "Reject") {
    return { status: "Rejected", currentStepIndex: -1, currentStepName: "", applyToBoq: false };
  }

  if (action === "Needs Correction") {
    // Back to the surveyor. The entry stays open and re-enters at the first step once resubmitted.
    return {
      status: "Needs Correction",
      currentStepIndex: 0,
      currentStepName: steps[0]?.name ?? "",
      applyToBoq: false,
    };
  }

  const nextIndex = currentStepIndex + 1;
  if (nextIndex >= steps.length) {
    return { status: "Approved", currentStepIndex: -1, currentStepName: "", applyToBoq: true };
  }

  return {
    status: "In Progress",
    currentStepIndex: nextIndex,
    currentStepName: steps[nextIndex]?.name ?? "",
    applyToBoq: false,
  };
}

/** The state a freshly recorded survey starts in. */
export function initialSurveyState(steps: WorkflowStep[]): SurveyTransition {
  if (!steps.length) {
    return { status: "Approved", currentStepIndex: -1, currentStepName: "", applyToBoq: true };
  }
  return {
    status: "Pending",
    currentStepIndex: 0,
    currentStepName: steps[0].name,
    applyToBoq: false,
  };
}

/**
 * Whether `userId` may act on `entry` right now. Assignees are resolved when the entry enters a
 * step, so this is a membership test rather than a re-resolution — an assignment changed midway
 * through does not silently pull an entry out from under whoever was already working it.
 */
export function canActOnSurveyEntry(entry: SurveyEntry, userId: string): boolean {
  if (isTerminalSurveyStatus(entry.status)) return false;
  return entry.assignees.includes(userId);
}

/** Entries sitting on a given step, for the stage screens. */
export function entriesForStep(entries: SurveyEntry[], stepId: string, steps: WorkflowStep[]) {
  const stepIndex = steps.findIndex((step) => String(step.id) === String(stepId));
  if (stepIndex < 0) return [];
  return entries.filter(
    (entry) => !isTerminalSurveyStatus(entry.status) && entry.currentStepIndex === stepIndex,
  );
}

export const surveyStatusStyles: Record<SurveyEntryStatus, string> = {
  Pending: "bg-amber-100 text-amber-800 border-amber-200",
  "In Progress": "bg-blue-100 text-blue-800 border-blue-200",
  "Needs Correction": "bg-orange-100 text-orange-800 border-orange-200",
  Approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Rejected: "bg-red-100 text-red-800 border-red-200",
};

/* ---------------- host context ---------------- */

export interface PmSurveyContext {
  mappingId: string;
  globalProjectId: string;
  permissionResource: string;
  activityModule: string;
  /** `surveyHref()` is the hub, `surveyHref("record")`, ``surveyHref(`stage/${stepId}`)`` the rest.
   * Returns "#" with no mapping id, which the nav cards already render as disabled. */
  surveyHref: (suffix?: string) => string;
  parentHref: string;
}

export function projectManagementSurveyContext(
  mappingId: string,
  globalProjectId: string,
): PmSurveyContext {
  const query = mappingId ? `?project=${encodeURIComponent(mappingId)}` : "";
  return {
    mappingId,
    globalProjectId,
    permissionResource: SURVEY_PERMISSION_RESOURCE,
    activityModule: SURVEY_ACTIVITY_MODULE,
    surveyHref: (suffix) =>
      mappingId
        ? `${suffix ? `${SURVEY_BASE_PATH}/${suffix}` : SURVEY_BASE_PATH}${query}`
        : "#",
    parentHref: mappingId ? `/project-management/supply${query}` : "#",
  };
}
