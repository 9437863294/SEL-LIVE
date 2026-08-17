"use client";

/**
 * Firestore operations for RFQ award approvals.
 *
 * The rules live in project-management-rfq-workflow.ts (pure, unit-tested); this persists them, and
 * on final approval hands off to createPurchaseOrdersForAwards so the PO is built exactly as the
 * direct award path builds it.
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
import { createPurchaseOrdersForAwards } from "@/lib/project-management-rfq-awards";
import {
  RFQ_AWARD_APPROVAL_COLLECTION,
  initialRfqAwardState,
  nextRfqAwardState,
  type RfqAwardAction,
  type RfqAwardApproval,
  type RfqAwardApprovalItem,
} from "@/lib/project-management-rfq-workflow";

interface StepResolvers {
  resolveAssignees: (step: WorkflowStep) => Promise<string[]>;
  resolveDeadline: (step: WorkflowStep) => Promise<Date | null>;
}

export interface RequestAwardApprovalParams extends StepResolvers {
  globalProjectId: string;
  mappingId: string;
  rfq: { id: string; rfqNumber: string; rfqDate: string };
  vendorId: string;
  vendorName: string;
  items: RfqAwardApprovalItem[];
  lowestLandedCost?: number;
  steps: WorkflowStep[];
  requestedBy: { id: string; name: string };
}

/** Opens an approval request for one vendor's slice of an award. */
export async function requestRfqAwardApproval({
  globalProjectId,
  mappingId,
  rfq,
  vendorId,
  vendorName,
  items,
  lowestLandedCost,
  steps,
  requestedBy,
  resolveAssignees,
  resolveDeadline,
}: RequestAwardApprovalParams): Promise<{ id: string; status: string }> {
  const initial = initialRfqAwardState(steps);
  const firstStep = initial.currentStepIndex >= 0 ? steps[initial.currentStepIndex] : undefined;
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

  const assignees = firstStep ? await resolveAssignees(firstStep) : [];
  const deadline = firstStep ? await resolveDeadline(firstStep) : null;

  const payload: Omit<RfqAwardApproval, "id"> = {
    rfqId: rfq.id,
    rfqNumber: rfq.rfqNumber,
    rfqDate: rfq.rfqDate,
    vendorId,
    vendorName,
    items,
    totalAmount,
    ...(lowestLandedCost != null ? { lowestLandedCost } : {}),
    requestedBy: requestedBy.id,
    requestedByName: requestedBy.name,
    createdAt: serverTimestamp(),
    status: initial.status,
    currentStepIndex: initial.currentStepIndex,
    currentStepName: initial.currentStepName,
    assignees,
    ...(deadline ? { deadline } : {}),
    actionLogs: [],
    projectId: globalProjectId,
    mappingId,
  };

  const created = await addDoc(
    collection(db, "projects", globalProjectId, RFQ_AWARD_APPROVAL_COLLECTION),
    payload,
  );

  return { id: created.id, status: initial.status };
}

export interface ActOnRfqAwardParams extends StepResolvers {
  globalProjectId: string;
  projectMappingId: string;
  projectManagementProjectName: string;
  globalProjectName: string;
  approvalId: string;
  action: RfqAwardAction;
  comment: string;
  steps: WorkflowStep[];
  actor: { id: string; name: string };
}

/**
 * Applies `action` to an award approval and, on final approval, creates the purchase orders.
 *
 * The status write happens in a transaction that re-checks the step, so two reviewers can't both
 * advance the same request. PO creation runs after that write rather than inside it: it touches
 * several documents and has its own transactional double-award guard, and claiming the approval
 * first is what stops a retry from producing a second set of purchase orders.
 */
export async function actOnRfqAward({
  globalProjectId,
  projectMappingId,
  projectManagementProjectName,
  globalProjectName,
  approvalId,
  action,
  comment,
  steps,
  actor,
  resolveAssignees,
  resolveDeadline,
}: ActOnRfqAwardParams): Promise<{ status: string; poCount: number }> {
  const approvalRef = doc(
    db,
    "projects",
    globalProjectId,
    RFQ_AWARD_APPROVAL_COLLECTION,
    approvalId,
  );

  const initial = await getDoc(approvalRef);
  if (!initial.exists()) throw new Error("This award request no longer exists.");
  const snapshot = { id: initial.id, ...initial.data() } as RfqAwardApproval;

  const transition = nextRfqAwardState(action, snapshot.currentStepIndex, steps);
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
    if (!current.exists()) throw new Error("This award request no longer exists.");
    const live = current.data() as RfqAwardApproval;

    if (live.currentStepIndex !== snapshot.currentStepIndex || live.status !== snapshot.status) {
      throw new Error("This request was already actioned by someone else. Refresh and try again.");
    }

    transaction.update(approvalRef, {
      status: transition.status,
      currentStepIndex: transition.currentStepIndex,
      currentStepName: transition.currentStepName,
      assignees,
      deadline: deadline ?? null,
      actionLogs: arrayUnion(log),
    });
  });

  if (!transition.createsPurchaseOrder) {
    return { status: transition.status, poCount: 0 };
  }

  const { poCount } = await createPurchaseOrdersForAwards({
    globalProjectId,
    projectMappingId,
    projectManagementProjectName,
    globalProjectName,
    rfq: { id: snapshot.rfqId, rfqNumber: snapshot.rfqNumber, rfqDate: snapshot.rfqDate },
    groups: [
      {
        vendorId: snapshot.vendorId,
        vendorName: snapshot.vendorName,
        items: snapshot.items.map((item) => ({
          rfqItemId: item.rfqItemId,
          description: item.description,
          unit: item.unit,
          qty: item.qty,
          rate: item.rate,
          amount: item.amount,
          sourceIndentId: item.sourceIndentId,
          sourceIndentNumber: item.sourceIndentNumber,
          boqItemId: item.boqItemId,
        })),
      },
    ],
  });

  await runTransaction(db, async (transaction) => {
    transaction.update(approvalRef, { poCreatedAt: serverTimestamp() });
  });

  return { status: transition.status, poCount };
}
