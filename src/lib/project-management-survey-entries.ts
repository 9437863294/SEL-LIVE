"use client";

/**
 * Firestore operations for survey entries.
 *
 * The transition rules live in project-management-survey-workflow.ts (pure, unit-tested); this is
 * the thin layer that persists them. Both the record screen (which can approve immediately when no
 * workflow is configured) and the stage screens (which approve at the final step) go through
 * `applySurveyEntryToBoq`, so there is exactly one place that decides what an approved survey
 * writes onto a BOQ item.
 */

import {
  arrayUnion,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type Transaction,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ActionLog, WorkflowStep } from "@/lib/types";
import {
  SURVEY_ENTRY_COLLECTION,
  nextSurveyState,
  type SurveyAction,
  type SurveyEntry,
} from "@/lib/project-management-survey-workflow";

/** The fields an approved survey writes onto `projects/{projectId}/boqItems/{boqItemId}`. */
function approvedBoqFields(entry: Pick<SurveyEntry, "surveyedQty" | "remarks" | "surveyedBy" | "surveyedByName">) {
  return {
    surveyedQty: entry.surveyedQty,
    surveyRemarks: entry.remarks,
    surveyedBy: entry.surveyedBy,
    surveyedByName: entry.surveyedByName,
    surveyedAt: serverTimestamp(),
  };
}

/**
 * Writes an approved surveyed quantity through to its BOQ item.
 *
 * Used directly by the record screen when a project has no workflow configured — in that case the
 * entry is born approved and there is no stage that would otherwise apply it.
 */
export function applySurveyEntryToBoqInTransaction(
  transaction: Transaction,
  projectId: string,
  entry: Pick<SurveyEntry, "boqItemId" | "surveyedQty" | "remarks" | "surveyedBy" | "surveyedByName">,
) {
  transaction.update(
    doc(db, "projects", projectId, "boqItems", entry.boqItemId),
    approvedBoqFields(entry),
  );
}

export interface ActOnSurveyEntryParams {
  projectId: string;
  entryId: string;
  action: SurveyAction;
  comment: string;
  steps: WorkflowStep[];
  actor: { id: string; name: string };
  /** Resolves who owns the step the entry is moving into. Async because assignment can be
   * project/department/amount-based (see workflow-utils.getAssigneeForStep). */
  resolveAssignees: (step: WorkflowStep) => Promise<string[]>;
  /** Deadline for the next step, or null when working hours aren't configured. */
  resolveDeadline: (step: WorkflowStep) => Promise<Date | null>;
}

/**
 * Applies `action` to an entry and moves it to wherever the workflow says next.
 *
 * Runs in a transaction and re-reads the entry inside it, so two reviewers acting at the same
 * moment can't both advance the same entry — the second sees the already-moved step and aborts
 * rather than double-approving.
 */
export async function actOnSurveyEntry({
  projectId,
  entryId,
  action,
  comment,
  steps,
  actor,
  resolveAssignees,
  resolveDeadline,
}: ActOnSurveyEntryParams): Promise<{ applied: boolean; status: string }> {
  const entryRef = doc(db, "projects", projectId, SURVEY_ENTRY_COLLECTION, entryId);

  // Read first, outside the transaction: resolving assignees and deadlines does its own Firestore
  // reads, which a transaction callback must not await on. The transaction below re-checks that
  // nothing moved in between.
  const initial = await getDoc(entryRef);
  if (!initial.exists()) throw new Error("This survey entry no longer exists.");
  const snapshot = { id: initial.id, ...initial.data() } as SurveyEntry;

  const transition = nextSurveyState(action, snapshot.currentStepIndex, steps);
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
    const current = await transaction.get(entryRef);
    if (!current.exists()) throw new Error("This survey entry no longer exists.");
    const live = current.data() as SurveyEntry;

    // Someone else acted between our read and this write.
    if (live.currentStepIndex !== snapshot.currentStepIndex || live.status !== snapshot.status) {
      throw new Error("This entry was already actioned by someone else. Refresh and try again.");
    }

    transaction.update(entryRef, {
      status: transition.status,
      currentStepIndex: transition.currentStepIndex,
      currentStepName: transition.currentStepName,
      assignees,
      ...(deadline ? { deadline } : { deadline: null }),
      ...(transition.applyToBoq ? { appliedAt: serverTimestamp() } : {}),
      actionLogs: arrayUnion(log),
    });

    if (transition.applyToBoq) {
      applySurveyEntryToBoqInTransaction(transaction, projectId, live);
    }
  });

  return { applied: transition.applyToBoq, status: transition.status };
}
