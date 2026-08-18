"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { RP_COLLECTIONS, type PaymentObligation } from "@/lib/recurring-payments";

/**
 * Workflow steps where the signed-in user is a current assignee.
 *
 * Being named on a step is itself the authority to act on it — the assignment is made per
 * user (master owner, approval level, step configuration), so an assignee must not also
 * need the step's role permission to open that step or run its actions. Without this,
 * assigning someone an action silently did nothing unless their role happened to carry the
 * matching permission, and the payment stalled in a queue nobody could clear.
 */
export function useAssignedWorkflowSteps() {
  const { user } = useAuth();
  const organizationId = user?.organizationId || "default";
  const userId = user?.id || "";
  // Tagged with the query it came from, so a result for the previous user or organization is
  // never read as the current one while the new subscription is still opening.
  const queryKey = `${organizationId}::${userId}`;
  const [result, setResult] = useState<{ queryKey: string; stepIds: string[] } | null>(null);

  useEffect(() => {
    if (!userId) return;
    // Matches every other page in the module: subscribe on organizationId and filter the
    // assignee locally, so this needs no extra composite index to be deployed.
    return onSnapshot(
      query(
        collection(db, RP_COLLECTIONS.payments),
        where("organizationId", "==", organizationId),
      ),
      (snapshot) => {
        setResult({
          queryKey,
          stepIds: snapshot.docs
            .map((item) => item.data() as PaymentObligation)
            .filter(
              (payment) =>
                !!payment.currentStepId &&
                (payment.assignees || []).includes(userId) &&
                !["Completed", "Rejected"].includes(payment.workflowStatus || ""),
            )
            .map((payment) => payment.currentStepId as string),
        });
      },
      () => setResult({ queryKey, stepIds: [] }),
    );
  }, [organizationId, queryKey, userId]);

  const stepIds = result?.queryKey === queryKey ? result.stepIds : null;
  const assignedStepIds = useMemo(() => new Set(stepIds || []), [stepIds]);

  return {
    assignedStepIds,
    hasAssignedWork: assignedStepIds.size > 0,
    loading: !!userId && stepIds === null,
  };
}
