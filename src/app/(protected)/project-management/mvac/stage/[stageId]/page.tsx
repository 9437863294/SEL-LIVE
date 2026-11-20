"use client";

/**
 * An MVAC workflow stage: the certificates sitting on this desk, and what may be done to them.
 *
 * The screen is the shared `WorkflowStageView` — the same one JMC's stages use. What is here is
 * the module's own business: who may act, which actions this step offers, and the transaction that
 * moves a certificate on.
 *
 * Two MVAC-specific rules worth stating:
 *
 *   - **Recording acceptance is not done here.** The accepted and rejected quantity per line is
 *     written by the register's decision dialog, which already owns the balance arithmetic; the
 *     action on this page opens that dialog on the right certificate rather than keeping a second
 *     copy of it.
 *   - **Rejecting is a workflow verdict, not a cancellation.** It takes the certificate out of the
 *     run and off everyone's desk, but the quantity it reserved stays reserved — releasing that is
 *     `Cancel` on the register, which is a deliberate, separate act.
 */

import { useCallback, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Timestamp,
  arrayUnion,
  doc as firestoreDoc,
  runTransaction,
} from "firebase/firestore";
import { Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { logUserActivity } from "@/lib/activity-logger";
import { calculateDeadline, getAssigneeForStep } from "@/lib/workflow-utils";
import { useMvacRegister } from "@/components/mvac/mvac-shell";
import { useSupplyProject } from "@/components/project-management/supply-document-screens";
import {
  WorkflowStageView,
  type WorkflowStageTab,
  type WorkflowStageTask,
} from "@/components/workflow/workflow-stage-view";
import {
  PM_MVAC_PERMISSION_RESOURCE,
  PM_MVAC_RECORD_ACTION,
  mvacTabHref,
} from "@/lib/project-management-mvac-module";
import { supplyStage } from "@/lib/project-management-supply-ledger";
import {
  formatMvacQty,
  mvacDate,
  mvacDocTotals,
  type MvacDocLike,
  type MvacItemLike,
} from "@/lib/project-management-mvac-dashboard";
import { WORKFLOW_APPROVE_ACTIONS } from "@/lib/workflow-run-position";
import type { ActionConfig, ActionLog, WorkflowStep } from "@/lib/types";

const humanDate = (value: unknown): string => {
  const date = mvacDate(value);
  return date
    ? date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : "—";
};

/** The deadline as a person reads it; nothing where the certificate carries none. */
function dueFrom(value: unknown, now: Date): WorkflowStageTask["due"] {
  const deadline = mvacDate(value);
  if (!deadline) return null;
  const days = Math.round(
    (new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86400000,
  );
  if (days < 0) {
    const late = Math.abs(days);
    return { label: `${late} day${late === 1 ? "" : "s"} overdue`, overdue: true };
  }
  if (days === 0) return { label: "Due today", overdue: false };
  return { label: `Due in ${days} day${days === 1 ? "" : "s"}`, overdue: false };
}

const pastTense = (action: string): string =>
  ({
    Approve: "approved",
    Complete: "completed",
    Verified: "verified",
    Reject: "rejected",
    "Needs Correction": "sent back for correction",
  })[action] ?? `${action.toLowerCase()}ed`;

export default function MvacStagePage() {
  const { stageId } = useParams() as { stageId: string };
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { globalProjectId, projectName } = useSupplyProject(mappingId);
  const { workflow, steps, docs, items, isLoading, reload } = useMvacRegister();
  const back = useBackNavigation(mvacTabHref("", mappingId), { fallbackLabel: "Back to MVAC" });

  const definition = supplyStage("mvac");
  const userId = user?.id ?? "";
  const canRaise = !isAuthLoading && can(definition.raiseAction, PM_MVAC_PERMISSION_RESOURCE);

  const [busyId, setBusyId] = useState("");

  const stage = useMemo(
    () => workflow.find((step) => String(step.id) === String(stageId)) ?? null,
    [workflow, stageId],
  );
  const stageIndex = useMemo(
    () => workflow.findIndex((step) => String(step.id) === String(stageId)),
    [workflow, stageId],
  );

  const itemsByDoc = useMemo(() => {
    const map = new Map<string, MvacItemLike[]>();
    for (const item of items) {
      const docId = String(item.docId ?? "");
      if (!docId) continue;
      const list = map.get(docId);
      if (list) list.push(item);
      else map.set(docId, [item]);
    }
    return map;
  }, [items]);

  /** A certificate as the shared screen reads it. */
  const toTask = useCallback(
    (record: MvacDocLike, now: Date): WorkflowStageTask => {
      const totals = mvacDocTotals(itemsByDoc.get(record.id) ?? []);
      return {
        id: record.id,
        title: String(record.docNumber ?? ""),
        dateLabel: `MVAC date ${humanDate(record.docDate)}`,
        figure: formatMvacQty(totals.presented),
        status: String(record.workflowStatus ?? record.status ?? ""),
        due: dueFrom(record.deadline, now),
      };
    },
    [itemsByDoc],
  );

  /**
   * My two queues.
   *
   * Pending is what is assigned to me *and* sitting at this step. Completed is what I have already
   * acted on here, whether it went forward or back — read off the history, so it survives the
   * certificate moving on to somebody else.
   */
  const { pending, completed } = useMemo(() => {
    const now = new Date();
    if (!userId || !stage) {
      return { pending: [] as WorkflowStageTask[], completed: [] as WorkflowStageTask[] };
    }

    const mine = docs.filter(
      (record) =>
        String(record.workflowStepId ?? "") === String(stageId) &&
        (record.assignees ?? []).some((id) => String(id) === userId) &&
        String(record.workflowStatus ?? "") !== "Completed" &&
        String(record.workflowStatus ?? "") !== "Rejected" &&
        String(record.status ?? "") !== "Cancelled",
    );
    const mineIds = new Set(mine.map((record) => record.id));

    const done = docs.filter(
      (record) =>
        !mineIds.has(record.id) &&
        (record.history ?? []).some(
          (action) =>
            String((action as { stepName?: unknown }).stepName ?? "") === stage.name &&
            String((action as { userId?: unknown }).userId ?? "") === userId,
        ),
    );

    return {
      pending: mine.map((record) => toTask(record, now)),
      completed: done.map((record) => toTask(record, now)),
    };
  }, [docs, userId, stage, stageId, toTask]);

  /**
   * Moving a certificate on, in one transaction, exactly as JMC moves one of its own.
   *
   * No extra permission is asked for here: the certificate is on this desk because the workflow
   * put it there, and an assigned step action needs no matching role permission — the same rule
   * the other workflow modules follow.
   */
  const handleAction = async (docId: string, action: string | ActionConfig) => {
    if (!globalProjectId || !user || !stage) return;
    const actionName = typeof action === "string" ? action : action.name;
    setBusyId(docId);

    try {
      const docRef = firestoreDoc(
        db,
        "projects",
        globalProjectId,
        definition.headerCollection,
        docId,
      );
      const totals = mvacDocTotals(itemsByDoc.get(docId) ?? []);

      /*
       * The next step's assignees and deadline are resolved before the transaction: both read
       * other documents (the assignment map, the working-hours calendar), and a Firestore
       * transaction may not read outside itself once it has started writing.
       */
      const index = workflow.findIndex((step) => String(step.id) === String(stage.id));
      const nextStep: WorkflowStep | undefined = WORKFLOW_APPROVE_ACTIONS.includes(actionName)
        ? workflow[index + 1]
        : undefined;
      let nextAssignees: string[] = [];
      let nextDeadline: Timestamp | null = null;
      if (nextStep) {
        nextAssignees = await getAssigneeForStep(nextStep, {
          projectId: globalProjectId,
          amount: totals.presented,
        } as never);
        if (!nextAssignees.length) {
          throw new Error(
            `No one is assigned to ${nextStep.name}. Set its assignees in Settings › Workflow Configuration.`,
          );
        }
        nextDeadline = Timestamp.fromDate(await calculateDeadline(new Date(), nextStep.tat));
      }

      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot.exists()) throw new Error("This certificate no longer exists.");

        const log: ActionLog = {
          action: actionName,
          comment: "",
          userId: user.id,
          userName: user.name,
          timestamp: Timestamp.now(),
          stepName: stage.name,
        };

        const update: Record<string, unknown> = { history: arrayUnion(log) };

        if (WORKFLOW_APPROVE_ACTIONS.includes(actionName)) {
          if (nextStep) {
            update.workflowStepId = nextStep.id;
            update.workflowStage = nextStep.name;
            update.workflowStatus = "In Progress";
            update.assignees = nextAssignees;
            update.deadline = nextDeadline;
          } else {
            // The end of the run. The supply status stays as it is — what was accepted is the
            // decision dialog's business, not the workflow's.
            update.workflowStepId = null;
            update.workflowStage = "Completed";
            update.workflowStatus = "Completed";
            update.assignees = [];
            update.deadline = null;
          }
        } else if (actionName === "Reject") {
          update.workflowStepId = null;
          update.workflowStage = "Rejected";
          update.workflowStatus = "Rejected";
          update.assignees = [];
          update.deadline = null;
        }
        // Anything else — "Needs Correction" — is recorded and leaves the certificate where it is,
        // so the desk it is on can act again once the correction is made.

        transaction.update(docRef, update);
      });

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: `MVAC ${actionName}`,
        details: { project: projectName, step: stage.name, docId },
      });

      toast({
        title: `Certificate ${pastTense(actionName)}`,
        description:
          actionName === "Reject"
            ? "It is off everyone's desk. The quantity it holds is released by cancelling it on the register."
            : nextStep
              ? `It is now with ${nextStep.name}.`
              : undefined,
      });
      await reload();
    } catch (error) {
      console.error("Failed to action the certificate:", error);
      toast({
        title: "Unable to complete that action",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId("");
    }
  };

  /** Opening a certificate, and recording its acceptance, both happen on the register. */
  const openOnRegister = (docId: string, decide: boolean) =>
    router.push(
      `${mvacTabHref("documents", mappingId)}&${decide ? "decide" : "focus"}=${encodeURIComponent(docId)}`,
    );

  const renderActions = (task: WorkflowStageTask, tab: WorkflowStageTab) => {
    const actions = Array.isArray(stage?.actions)
      ? (stage!.actions as (string | ActionConfig)[])
      : [];

    return (
      <>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => openOnRegister(task.id, false)}
        >
          Details
        </Button>

        {busyId === task.id ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-label="Working" />
        ) : tab === "pending" && actions.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-8" aria-label={`Actions for ${task.title}`}>
                Actions
                <MoreHorizontal className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.map((action) => {
                const actionName = typeof action === "string" ? action : action.name;
                return (
                  <DropdownMenuItem
                    key={actionName}
                    onSelect={(event) => {
                      event.preventDefault();
                      if (actionName === PM_MVAC_RECORD_ACTION) openOnRegister(task.id, true);
                      else void handleAction(task.id, action);
                    }}
                  >
                    {actionName}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </>
    );
  };

  return (
    <WorkflowStageView
      back={back}
      crumbs={[
        { label: "MVAC", href: mvacTabHref("", mappingId) },
        ...(stageIndex >= 0 ? [{ label: `Stage ${stageIndex + 1}` }] : []),
      ]}
      stageName={stage?.name || "MVAC Stage"}
      stageIndex={stageIndex}
      steps={steps.map((step) => step.name)}
      projectName={projectName}
      description={
        projectName
          ? `Joint acceptance tasks assigned to you for ${projectName}`
          : "Joint acceptance tasks assigned to you"
      }
      pending={pending}
      completed={completed}
      recordPlural="MVACs"
      figureLabel="Presented qty"
      createStepLabel="Create MVAC"
      log={{ href: mvacTabHref("documents", mappingId), label: "MVAC register" }}
      create={canRaise ? { href: mvacTabHref("new", mappingId), label: "Create MVAC" } : undefined}
      onOpen={(task) => openOnRegister(task.id, false)}
      renderActions={renderActions}
      isLoading={isLoading || isAuthLoading}
      band="rose"
    />
  );
}
