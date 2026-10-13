"use client";

import { collection, onSnapshot, query, where, type FirestoreError, type QueryConstraint } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { RP_COLLECTIONS, type PaymentObligation } from "@/lib/recurring-payments";

/**
 * Every field an obligation names a person in — the ones a workflow step resolves its assignees
 * from (`resolveAssignees` in recurring-payments-workflow.ts). The security rules let a person who
 * holds no Recurring Payments permission read an obligation only when one of these names them,
 * and a query is allowed only when its own constraint proves that, so each is its own query.
 */
const NAMED_FIELDS: Array<{ field: string; op: "==" | "array-contains" }> = [
  { field: "assignees", op: "array-contains" },
  { field: "assignedTo", op: "==" },
  { field: "backupAssignedTo", op: "==" },
  { field: "verifierId", op: "==" },
  { field: "approverId", op: "==" },
  { field: "accountsProcessorId", op: "==" },
  { field: "approvalLevels", op: "array-contains" },
  { field: "approvalCompletedBy", op: "array-contains" },
];

export interface ObligationSubscriptionOptions {
  organizationId: string;
  /** The `users` document id (`useAuth().user.id`). */
  userId: string;
  /**
   * Holds a Recurring Payments permission (`canAccessModule('Recurring Payments')`), and so reads
   * the organization's whole register. Otherwise only the obligations that name `userId`.
   */
  moduleWide: boolean;
}

/**
 * The obligations a screen may show, live: the whole organization for a module user, exactly as
 * every register in the module subscribes; the obligations that name the user for anyone else.
 *
 * A module-wide subscription the rules refuse — a grant the browser counts as module access and the
 * rules do not — falls back to the named queries rather than leaving the screen empty.
 */
export function subscribeVisibleObligations(
  { organizationId, userId, moduleWide }: ObligationSubscriptionOptions,
  onNext: (payments: PaymentObligation[]) => void,
  onError: (error: FirestoreError) => void,
): () => void {
  const toPayments = (docs: Array<{ id: string; data: () => unknown }>) =>
    docs.map((item) => ({ id: item.id, ...(item.data() as object) }) as PaymentObligation);

  let stopNamed: (() => void) | null = null;
  const startNamed = () => {
    if (!userId) {
      onNext([]);
      return () => undefined;
    }
    const results = new Map<string, PaymentObligation[]>();
    let failed = false;
    const emit = () => {
      if (results.size < NAMED_FIELDS.length) return;
      const byId = new Map<string, PaymentObligation>();
      for (const rows of results.values()) for (const row of rows) byId.set(row.id, row);
      // The org filter the module-wide query applies in Firestore, applied here instead: the
      // named queries carry only the field the rules can check.
      onNext([...byId.values()].filter((payment) => payment.organizationId === organizationId));
    };
    const stops = NAMED_FIELDS.map(({ field, op }) => {
      const constraint: QueryConstraint = where(field, op, userId);
      return onSnapshot(
        query(collection(db, RP_COLLECTIONS.payments), constraint),
        (snapshot) => {
          results.set(field, toPayments(snapshot.docs));
          emit();
        },
        (error) => {
          if (failed) return;
          failed = true;
          onError(error);
        },
      );
    });
    return () => stops.forEach((stop) => stop());
  };

  if (!moduleWide) {
    stopNamed = startNamed();
    return () => stopNamed?.();
  }

  const stopAll = onSnapshot(
    query(collection(db, RP_COLLECTIONS.payments), where("organizationId", "==", organizationId)),
    (snapshot) => onNext(toPayments(snapshot.docs)),
    (error) => {
      if (error.code === "permission-denied" && !stopNamed) stopNamed = startNamed();
      else onError(error);
    },
  );
  return () => {
    stopAll();
    stopNamed?.();
  };
}
