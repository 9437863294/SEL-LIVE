"use client";

/**
 * Firestore operations for indent workflow transitions.
 *
 * The rules live in project-management-indent-workflow.ts (pure, unit-tested); this persists them.
 * Both submitting a draft and actioning a stage go through here so there is one place that decides
 * what an indent's status becomes.
 */

import { arrayUnion, doc, getDoc, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ActionLog, WorkflowStep } from "@/lib/types";
import {
  INDENT_COLLECTION,
  nextIndentState,
  submitIndentState,
  type IndentAction,
  type IndentStatus,
} from "@/lib/project-management-indent-workflow";

interface StepResolvers {
  /** Resolves who owns the step the indent is moving into. Async because assignment can be
   * project/department/amount-based (see workflow-utils.getAssigneeForStep). */
  resolveAssignees: (step: WorkflowStep) => Promise<string[]>;
  /** Deadline for the next step, or null when working hours aren't configured. */
  resolveDeadline: (step: WorkflowStep) => Promise<Date | null>;
}

export interface SubmitIndentParams extends StepResolvers {
  projectId: string;
  indentId: string;
  steps: WorkflowStep[];
  actor: { id: string; name: string };
}

/** Moves a draft indent into the workflow (or straight to Approved when none is configured). */
export async function submitIndentForApproval({
  projectId,
  indentId,
  steps,
  actor,
  resolveAssignees,
  resolveDeadline,
}: SubmitIndentParams): Promise<IndentTransitionResult> {
  const indentRef = doc(db, "projects", projectId, INDENT_COLLECTION, indentId);
  const transition = submitIndentState(steps);
  const nextStep = transition.currentStepIndex >= 0 ? steps[transition.currentStepIndex] : undefined;

  const assignees = nextStep ? await resolveAssignees(nextStep) : [];
  const deadline = nextStep ? await resolveDeadline(nextStep) : null;

  const log: ActionLog = {
    action: "Submitted",
    comment: "",
    userId: actor.id,
    userName: actor.name,
    timestamp: Timestamp.now(),
    stepName: "Draft",
  };

  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(indentRef);
    if (!current.exists()) throw new Error("This indent no longer exists.");
    if (String(current.data()?.status) !== "Draft") {
      throw new Error("This indent has already been submitted.");
    }

    transaction.update(indentRef, {
      status: transition.status,
      // Marks this indent as workflow-aware. Its absence is what grandfathers the indents raised
      // before this feature — see indentReservesQuantity.
      workflowEnrolled: true,
      currentStepIndex: transition.currentStepIndex,
      currentStepName: transition.currentStepName,
      assignees,
      deadline: deadline ?? null,
      ...(transition.reservesOnCommit ? { approvedAt: serverTimestamp() } : {}),
      actionLogs: arrayUnion(log),
    });
  });

  return { status: transition.status, reserves: transition.reservesOnCommit };
}

export interface IndentTransitionResult {
  status: IndentStatus;
  /** True when the indent just became one that reserves BOQ quantity. */
  reserves: boolean;
}

export interface ActOnIndentParams extends StepResolvers {
  projectId: string;
  indentId: string;
  action: IndentAction;
  comment: string;
  steps: WorkflowStep[];
  actor: { id: string; name: string };
}

/**
 * Applies `action` to an indent and moves it wherever the workflow says next.
 *
 * The write re-checks the step index inside the transaction, so two reviewers acting at the same
 * moment can't both advance the same indent — the second aborts rather than double-approving.
 */
export async function actOnIndent({
  projectId,
  indentId,
  action,
  comment,
  steps,
  actor,
  resolveAssignees,
  resolveDeadline,
}: ActOnIndentParams): Promise<IndentTransitionResult> {
  const indentRef = doc(db, "projects", projectId, INDENT_COLLECTION, indentId);

  // Read first, outside the transaction: resolving assignees and deadlines does its own Firestore
  // reads, which a transaction callback must not await on.
  const initial = await getDoc(indentRef);
  if (!initial.exists()) throw new Error("This indent no longer exists.");
  const snapshot = initial.data() as { status?: string; currentStepIndex?: number; currentStepName?: string };

  const transition = nextIndentState(action, snapshot.currentStepIndex ?? 0, steps);
  const nextStep = transition.currentStepIndex >= 0 ? steps[transition.currentStepIndex] : undefined;

  const assignees = nextStep ? await resolveAssignees(nextStep) : [];
  const deadline = nextStep ? await resolveDeadline(nextStep) : null;

  const log: ActionLog = {
    action,
    comment,
    userId: actor.id,
    userName: actor.name,
    timestamp: Timestamp.now(),
    stepName: snapshot.currentStepName || "",
  };

  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(indentRef);
    if (!current.exists()) throw new Error("This indent no longer exists.");
    const live = current.data() as { status?: string; currentStepIndex?: number };

    if (live.currentStepIndex !== snapshot.currentStepIndex || live.status !== snapshot.status) {
      throw new Error("This indent was already actioned by someone else. Refresh and try again.");
    }

    transaction.update(indentRef, {
      status: transition.status,
      currentStepIndex: transition.currentStepIndex,
      currentStepName: transition.currentStepName,
      assignees,
      deadline: deadline ?? null,
      ...(transition.reservesOnCommit ? { approvedAt: serverTimestamp() } : {}),
      actionLogs: arrayUnion(log),
    });
  });

  return { status: transition.status, reserves: transition.reservesOnCommit };
}
