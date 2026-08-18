"use client";

/**
 * Firestore operations for inspection result approvals.
 *
 * The rules live in project-management-inspection-workflow.ts (pure, unit-tested); this persists
 * them, and on final approval writes the result onto the inspection record. That write is what opens
 * the MDCC gate, so it happens in the same transaction that settles the approval — an approved
 * result can never be left recorded as approved with the inspection still showing "Requested".
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
import { INSPECTION_COLLECTION, type InspectionStatus, type PunchItem } from "@/lib/supply-gates";
import {
  INSPECTION_RESULT_APPROVAL_COLLECTION,
  initialInspectionApprovalState,
  nextInspectionApprovalState,
  type InspectionApprovalAction,
  type InspectionResultApproval,
} from "@/lib/project-management-inspection-workflow";

interface StepResolvers {
  resolveAssignees: (step: WorkflowStep) => Promise<string[]>;
  resolveDeadline: (step: WorkflowStep) => Promise<Date | null>;
}

/** The recorded result an inspection carries. Shared by both write paths below so a directly
 * recorded result and an approved one are byte-for-byte the same. */
function recordedResultFields(input: {
  boqItemId: string;
  boqSlNo: string;
  description: string;
  poId: string;
  poNumber: string;
  result: InspectionStatus;
  inspectionDate: string;
  inspectorName: string;
  remarks: string;
  qtyAccepted: number;
  qtyRejected: number;
  punchItems: PunchItem[];
  serials: string[];
  reportDocumentId?: string;
  reportFileName?: string;
  reportFileUrl?: string;
}) {
  return {
    boqItemId: input.boqItemId,
    boqSlNo: input.boqSlNo,
    description: input.description,
    poId: input.poId,
    poNumber: input.poNumber,
    status: input.result,
    inspectionDate: input.inspectionDate,
    inspectorName: input.inspectorName,
    remarks: input.remarks,
    qtyAccepted: input.qtyAccepted,
    qtyRejected: input.qtyRejected,
    punchItems: input.punchItems,
    serials: input.serials,
    ...(input.reportDocumentId
      ? {
          reportDocumentId: input.reportDocumentId,
          reportFileName: input.reportFileName,
          reportFileUrl: input.reportFileUrl,
        }
      : {}),
    updatedAt: serverTimestamp(),
  };
}

export interface RequestInspectionResultParams extends StepResolvers {
  globalProjectId: string;
  mappingId: string;
  item: {
    boqItemId: string;
    boqSlNo: string;
    description: string;
    poId: string;
    poNumber: string;
  };
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
  steps: WorkflowStep[];
  requestedBy: { id: string; name: string };
}

/**
 * Opens an approval request for a passing inspection result, or records it outright when no workflow
 * applies.
 */
export async function requestInspectionResult({
  globalProjectId,
  mappingId,
  item,
  result,
  inspectionDate,
  inspectorName,
  remarks,
  qtyOffered,
  qtyAccepted,
  qtyRejected,
  punchItems,
  serials,
  reportDocumentId,
  reportFileName,
  reportFileUrl,
  steps,
  requestedBy,
  resolveAssignees,
  resolveDeadline,
}: RequestInspectionResultParams): Promise<{ id: string; status: string; recorded: boolean }> {
  const initial = initialInspectionApprovalState(steps);
  const firstStep = initial.currentStepIndex >= 0 ? steps[initial.currentStepIndex] : undefined;

  const assignees = firstStep ? await resolveAssignees(firstStep) : [];
  const deadline = firstStep ? await resolveDeadline(firstStep) : null;

  const reportFields = reportDocumentId
    ? { reportDocumentId, reportFileName, reportFileUrl }
    : {};

  const payload: Omit<InspectionResultApproval, "id"> = {
    boqItemId: item.boqItemId,
    boqSlNo: item.boqSlNo,
    description: item.description,
    poId: item.poId,
    poNumber: item.poNumber,
    result,
    inspectionDate,
    inspectorName,
    remarks,
    qtyOffered,
    qtyAccepted,
    qtyRejected,
    punchItems,
    serials,
    ...reportFields,
    requestedBy: requestedBy.id,
    requestedByName: requestedBy.name,
    createdAt: serverTimestamp(),
    status: initial.status,
    currentStepIndex: initial.currentStepIndex,
    currentStepName: initial.currentStepName,
    assignees,
    ...(deadline ? { deadline } : {}),
    actionLogs: [],
    ...(initial.recordsResult ? { recordedAt: serverTimestamp() } : {}),
    projectId: globalProjectId,
    mappingId,
  };

  const created = await addDoc(
    collection(db, "projects", globalProjectId, INSPECTION_RESULT_APPROVAL_COLLECTION),
    payload,
  );

  // No workflow configured — the request is born approved, so record the result here rather than
  // leaving the inspection stuck at "Requested" behind an approved request.
  if (initial.recordsResult) {
    await runTransaction(db, async (transaction) => {
      transaction.set(
        doc(db, "projects", globalProjectId, INSPECTION_COLLECTION, item.boqItemId),
        recordedResultFields({
          ...item,
          result,
          inspectionDate,
          inspectorName,
          remarks,
          qtyAccepted,
          qtyRejected,
          punchItems,
          serials,
          ...reportFields,
        }),
        { merge: true },
      );
    });
  }

  return { id: created.id, status: initial.status, recorded: initial.recordsResult };
}

export interface ActOnInspectionResultParams extends StepResolvers {
  globalProjectId: string;
  approvalId: string;
  action: InspectionApprovalAction;
  comment: string;
  steps: WorkflowStep[];
  actor: { id: string; name: string };
}

/**
 * Applies `action` to a result request and, on final approval, writes the result onto the inspection
 * record.
 *
 * Both writes happen in one transaction, which also re-checks the step index — so two reviewers
 * can't both advance the same request, and the result can't be recorded twice.
 */
export async function actOnInspectionResult({
  globalProjectId,
  approvalId,
  action,
  comment,
  steps,
  actor,
  resolveAssignees,
  resolveDeadline,
}: ActOnInspectionResultParams): Promise<{ status: string; recorded: boolean }> {
  const approvalRef = doc(
    db,
    "projects",
    globalProjectId,
    INSPECTION_RESULT_APPROVAL_COLLECTION,
    approvalId,
  );

  const initial = await getDoc(approvalRef);
  if (!initial.exists()) throw new Error("This inspection result request no longer exists.");
  const snapshot = { id: initial.id, ...initial.data() } as InspectionResultApproval;

  const transition = nextInspectionApprovalState(action, snapshot.currentStepIndex, steps);
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
    if (!current.exists()) throw new Error("This inspection result request no longer exists.");
    const live = current.data() as InspectionResultApproval;

    if (live.currentStepIndex !== snapshot.currentStepIndex || live.status !== snapshot.status) {
      throw new Error("This request was already actioned by someone else. Refresh and try again.");
    }

    if (transition.recordsResult) {
      transaction.set(
        doc(db, "projects", globalProjectId, INSPECTION_COLLECTION, snapshot.boqItemId),
        recordedResultFields({
          boqItemId: snapshot.boqItemId,
          boqSlNo: snapshot.boqSlNo,
          description: snapshot.description,
          poId: snapshot.poId,
          poNumber: snapshot.poNumber,
          result: snapshot.result,
          inspectionDate: snapshot.inspectionDate,
          // The inspector's own name stays on the record — the approver accepted the finding, they
          // did not carry out the inspection.
          inspectorName: snapshot.inspectorName,
          remarks: snapshot.remarks,
          qtyAccepted: snapshot.qtyAccepted,
          qtyRejected: snapshot.qtyRejected,
          punchItems: snapshot.punchItems ?? [],
          serials: snapshot.serials ?? [],
          ...(snapshot.reportDocumentId
            ? {
                reportDocumentId: snapshot.reportDocumentId,
                reportFileName: snapshot.reportFileName,
                reportFileUrl: snapshot.reportFileUrl,
              }
            : {}),
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
      ...(transition.recordsResult ? { recordedAt: serverTimestamp() } : {}),
      actionLogs: arrayUnion(log),
    });
  });

  return { status: transition.status, recorded: transition.recordsResult };
}
