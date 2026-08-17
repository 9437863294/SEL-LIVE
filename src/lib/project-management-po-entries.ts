"use client";

/**
 * Firestore operations for purchase order issue approvals.
 *
 * The rules live in project-management-po-workflow.ts (pure, unit-tested); this persists them, and
 * on final approval flips the PO itself to Issued. That flip is the only thing that turns a draft
 * into a commitment, so it happens in the same transaction that settles the approval — an approved
 * request can never be left recorded as approved with the PO still sitting in Draft.
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
import { PO_COLLECTION } from "@/lib/purchase-orders";
import {
  PO_ISSUE_APPROVAL_COLLECTION,
  initialPoIssueState,
  nextPoIssueState,
  type PoIssueAction,
  type PoIssueApproval,
  type PoIssueException,
} from "@/lib/project-management-po-workflow";

interface StepResolvers {
  resolveAssignees: (step: WorkflowStep) => Promise<string[]>;
  resolveDeadline: (step: WorkflowStep) => Promise<Date | null>;
}

export interface RequestPoIssueApprovalParams extends StepResolvers {
  globalProjectId: string;
  mappingId: string;
  po: {
    id: string;
    poNumber: string;
    poDate: string;
    vendorId: string;
    vendorName: string;
    totalAmount: number;
    itemCount: number;
  };
  exceptions: PoIssueException[];
  overrideReason?: string;
  steps: WorkflowStep[];
  requestedBy: { id: string; name: string };
}

/**
 * Opens an approval request to issue a PO, or issues it outright when no workflow applies.
 *
 * Refuses if the PO is no longer a Draft, so a request can't be opened against an order that has
 * already been issued or cancelled out from under the buyer.
 */
export async function requestPoIssueApproval({
  globalProjectId,
  mappingId,
  po,
  exceptions,
  overrideReason,
  steps,
  requestedBy,
  resolveAssignees,
  resolveDeadline,
}: RequestPoIssueApprovalParams): Promise<{ id: string; status: string; issued: boolean }> {
  const initial = initialPoIssueState(steps);
  const firstStep = initial.currentStepIndex >= 0 ? steps[initial.currentStepIndex] : undefined;

  const assignees = firstStep ? await resolveAssignees(firstStep) : [];
  const deadline = firstStep ? await resolveDeadline(firstStep) : null;

  const poRef = doc(db, "projects", globalProjectId, PO_COLLECTION, po.id);
  const current = await getDoc(poRef);
  if (!current.exists()) throw new Error("This purchase order no longer exists.");
  if (String(current.data()?.status) !== "Draft") {
    throw new Error("Only a draft purchase order can be submitted for issue approval.");
  }

  const payload: Omit<PoIssueApproval, "id"> = {
    poId: po.id,
    poNumber: po.poNumber,
    poDate: po.poDate,
    vendorId: po.vendorId,
    vendorName: po.vendorName,
    totalAmount: po.totalAmount,
    itemCount: po.itemCount,
    exceptions,
    ...(overrideReason ? { overrideReason } : {}),
    requestedBy: requestedBy.id,
    requestedByName: requestedBy.name,
    createdAt: serverTimestamp(),
    status: initial.status,
    currentStepIndex: initial.currentStepIndex,
    currentStepName: initial.currentStepName,
    assignees,
    ...(deadline ? { deadline } : {}),
    actionLogs: [],
    ...(initial.issuesPurchaseOrder ? { issuedAt: serverTimestamp() } : {}),
    projectId: globalProjectId,
    mappingId,
  };

  const created = await addDoc(
    collection(db, "projects", globalProjectId, PO_ISSUE_APPROVAL_COLLECTION),
    payload,
  );

  // No workflow configured — the request is born approved, so issue the PO here rather than
  // leaving it a draft with an approved request pointing at it.
  if (initial.issuesPurchaseOrder) {
    await runTransaction(db, async (transaction) => {
      const live = await transaction.get(poRef);
      if (!live.exists()) throw new Error("This purchase order no longer exists.");
      if (String(live.data()?.status) !== "Draft") {
        throw new Error("This purchase order is no longer a draft.");
      }
      transaction.update(poRef, {
        status: "Issued",
        ...(overrideReason
          ? {
              ...(exceptions.some((e) => e.kind === "flow-down")
                ? { flowDownOverrideReason: overrideReason }
                : {}),
              ...(exceptions.some((e) => e.kind === "commitment")
                ? { commitmentOverrideReason: overrideReason }
                : {}),
              issueOverrideBy: requestedBy.id,
              issueOverrideByName: requestedBy.name,
            }
          : {}),
        updatedAt: serverTimestamp(),
      });
    });
  }

  return { id: created.id, status: initial.status, issued: initial.issuesPurchaseOrder };
}

export interface ActOnPoIssueParams extends StepResolvers {
  globalProjectId: string;
  approvalId: string;
  action: PoIssueAction;
  comment: string;
  steps: WorkflowStep[];
  actor: { id: string; name: string };
}

/**
 * Applies `action` to an issue request and, on final approval, flips the PO to Issued.
 *
 * Both writes happen in one transaction, which also re-checks the step index — so two reviewers
 * can't both advance the same request, and the PO can't be marked Issued twice.
 */
export async function actOnPoIssue({
  globalProjectId,
  approvalId,
  action,
  comment,
  steps,
  actor,
  resolveAssignees,
  resolveDeadline,
}: ActOnPoIssueParams): Promise<{ status: string; issued: boolean }> {
  const approvalRef = doc(
    db,
    "projects",
    globalProjectId,
    PO_ISSUE_APPROVAL_COLLECTION,
    approvalId,
  );

  const initial = await getDoc(approvalRef);
  if (!initial.exists()) throw new Error("This issue request no longer exists.");
  const snapshot = { id: initial.id, ...initial.data() } as PoIssueApproval;

  const transition = nextPoIssueState(action, snapshot.currentStepIndex, steps);
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

  const poRef = doc(db, "projects", globalProjectId, PO_COLLECTION, snapshot.poId);

  await runTransaction(db, async (transaction) => {
    const currentApproval = await transaction.get(approvalRef);
    if (!currentApproval.exists()) throw new Error("This issue request no longer exists.");
    const live = currentApproval.data() as PoIssueApproval;

    if (live.currentStepIndex !== snapshot.currentStepIndex || live.status !== snapshot.status) {
      throw new Error("This request was already actioned by someone else. Refresh and try again.");
    }

    if (transition.issuesPurchaseOrder) {
      const currentPo = await transaction.get(poRef);
      if (!currentPo.exists()) throw new Error("This purchase order no longer exists.");
      if (String(currentPo.data()?.status) !== "Draft") {
        throw new Error("This purchase order is no longer a draft — it may already be issued.");
      }
      transaction.update(poRef, {
        status: "Issued",
        ...(snapshot.overrideReason
          ? {
              ...(snapshot.exceptions?.some((e) => e.kind === "flow-down")
                ? { flowDownOverrideReason: snapshot.overrideReason }
                : {}),
              ...(snapshot.exceptions?.some((e) => e.kind === "commitment")
                ? { commitmentOverrideReason: snapshot.overrideReason }
                : {}),
              // The approver is who accepted the exception, not the buyer who raised it.
              issueOverrideBy: actor.id,
              issueOverrideByName: actor.name,
            }
          : {}),
        updatedAt: serverTimestamp(),
      });
    }

    transaction.update(approvalRef, {
      status: transition.status,
      currentStepIndex: transition.currentStepIndex,
      currentStepName: transition.currentStepName,
      assignees,
      deadline: deadline ?? null,
      ...(transition.issuesPurchaseOrder ? { issuedAt: serverTimestamp() } : {}),
      actionLogs: arrayUnion(log),
    });
  });

  return { status: transition.status, issued: transition.issuesPurchaseOrder };
}
