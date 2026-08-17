"use client";

/**
 * Firestore operations for manufacturing clearance approvals.
 *
 * The rules live in project-management-mc-workflow.ts (pure, unit-tested); this persists them, and
 * on final approval writes the MC record as Cleared. That write is the thing that opens the gate,
 * so it happens in the same transaction that settles the approval — an approved request can never
 * be left recorded as approved with the gate still shut.
 */

import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ActionLog, WorkflowStep } from "@/lib/types";
import { MC_COLLECTION } from "@/lib/supply-gates";
import {
  MC_CLEARANCE_APPROVAL_COLLECTION,
  initialMcApprovalState,
  nextMcApprovalState,
  type McApprovalAction,
  type McClearanceApproval,
} from "@/lib/project-management-mc-workflow";

interface StepResolvers {
  resolveAssignees: (step: WorkflowStep) => Promise<string[]>;
  resolveDeadline: (step: WorkflowStep) => Promise<Date | null>;
}

/** The MC record fields a cleared gate carries. Shared by both write paths below. */
function clearedRecordFields(input: {
  boqItemId: string;
  boqSlNo: string;
  description: string;
  poId: string;
  poNumber: string;
  vendorName: string;
  clearedDate: string;
  remarks: string;
  clearedBy: string;
  clearedByName: string;
}) {
  return {
    boqItemId: input.boqItemId,
    boqSlNo: input.boqSlNo,
    description: input.description,
    poId: input.poId,
    poNumber: input.poNumber,
    vendorName: input.vendorName,
    status: "Cleared" as const,
    clearedDate: input.clearedDate,
    remarks: input.remarks,
    clearedBy: input.clearedBy,
    clearedByName: input.clearedByName,
    updatedAt: serverTimestamp(),
  };
}

export interface RequestMcClearanceParams extends StepResolvers {
  globalProjectId: string;
  mappingId: string;
  item: {
    boqItemId: string;
    boqSlNo: string;
    description: string;
    poId: string;
    poNumber: string;
    vendorName: string;
  };
  clearedDate: string;
  remarks: string;
  steps: WorkflowStep[];
  requestedBy: { id: string; name: string };
}

/**
 * Opens an approval request to clear manufacturing, or clears it outright when no workflow applies.
 */
export async function requestMcClearance({
  globalProjectId,
  mappingId,
  item,
  clearedDate,
  remarks,
  steps,
  requestedBy,
  resolveAssignees,
  resolveDeadline,
}: RequestMcClearanceParams): Promise<{ id: string; status: string; cleared: boolean }> {
  const initial = initialMcApprovalState(steps);
  const firstStep = initial.currentStepIndex >= 0 ? steps[initial.currentStepIndex] : undefined;

  const assignees = firstStep ? await resolveAssignees(firstStep) : [];
  const deadline = firstStep ? await resolveDeadline(firstStep) : null;

  const payload: Omit<McClearanceApproval, "id"> = {
    boqItemId: item.boqItemId,
    boqSlNo: item.boqSlNo,
    description: item.description,
    poId: item.poId,
    poNumber: item.poNumber,
    vendorName: item.vendorName,
    clearedDate,
    remarks,
    requestedBy: requestedBy.id,
    requestedByName: requestedBy.name,
    createdAt: serverTimestamp(),
    status: initial.status,
    currentStepIndex: initial.currentStepIndex,
    currentStepName: initial.currentStepName,
    assignees,
    ...(deadline ? { deadline } : {}),
    actionLogs: [],
    ...(initial.clearsManufacturing ? { clearedAt: serverTimestamp() } : {}),
    projectId: globalProjectId,
    mappingId,
  };

  const created = await addDoc(
    collection(db, "projects", globalProjectId, MC_CLEARANCE_APPROVAL_COLLECTION),
    payload,
  );

  // No workflow configured — the request is born approved, so open the gate here rather than
  // leaving it shut behind an approved request.
  if (initial.clearsManufacturing) {
    await runTransaction(db, async (transaction) => {
      transaction.set(
        doc(db, "projects", globalProjectId, MC_COLLECTION, item.boqItemId),
        clearedRecordFields({
          ...item,
          clearedDate,
          remarks,
          clearedBy: requestedBy.id,
          clearedByName: requestedBy.name,
        }),
        { merge: true },
      );
    });
  }

  return { id: created.id, status: initial.status, cleared: initial.clearsManufacturing };
}

export interface ActOnMcClearanceParams extends StepResolvers {
  globalProjectId: string;
  approvalId: string;
  action: McApprovalAction;
  comment: string;
  steps: WorkflowStep[];
  actor: { id: string; name: string };
}

/**
 * Applies `action` to a clearance request and, on final approval, writes the MC record as Cleared.
 *
 * Both writes happen in one transaction, which also re-checks the step index — so two reviewers
 * can't both advance the same request, and the gate can't be opened twice.
 */
export async function actOnMcClearance({
  globalProjectId,
  approvalId,
  action,
  comment,
  steps,
  actor,
  resolveAssignees,
  resolveDeadline,
}: ActOnMcClearanceParams): Promise<{ status: string; cleared: boolean }> {
  const approvalRef = doc(
    db,
    "projects",
    globalProjectId,
    MC_CLEARANCE_APPROVAL_COLLECTION,
    approvalId,
  );

  const initial = await getDoc(approvalRef);
  if (!initial.exists()) throw new Error("This clearance request no longer exists.");
  const snapshot = { id: initial.id, ...initial.data() } as McClearanceApproval;

  const transition = nextMcApprovalState(action, snapshot.currentStepIndex, steps);
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
    const current = await transaction.get(approvalRef);
    if (!current.exists()) throw new Error("This clearance request no longer exists.");
    const live = current.data() as McClearanceApproval;

    if (live.currentStepIndex !== snapshot.currentStepIndex || live.status !== snapshot.status) {
      throw new Error("This request was already actioned by someone else. Refresh and try again.");
    }

    if (transition.clearsManufacturing) {
      transaction.set(
        doc(db, "projects", globalProjectId, MC_COLLECTION, snapshot.boqItemId),
        clearedRecordFields({
          boqItemId: snapshot.boqItemId,
          boqSlNo: snapshot.boqSlNo,
          description: snapshot.description,
          poId: snapshot.poId,
          poNumber: snapshot.poNumber,
          vendorName: snapshot.vendorName,
          clearedDate: snapshot.clearedDate,
          remarks: snapshot.remarks,
          // The approver is who opened the gate, not the requester.
          clearedBy: actor.id,
          clearedByName: actor.name,
        }),
        { merge: true },
      );
    }

    transaction.update(approvalRef, {
      status: transition.status,
      currentStepIndex: transition.currentStepIndex,
      currentStepName: transition.currentStepName,
      assignees,
      deadline: deadline ?? null,
      ...(transition.clearsManufacturing ? { clearedAt: serverTimestamp() } : {}),
      actionLogs: arrayUnion(log),
    });
  });

  return { status: transition.status, cleared: transition.clearsManufacturing };
}
