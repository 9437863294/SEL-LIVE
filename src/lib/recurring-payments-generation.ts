'use client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { dispatchNotification } from '@/lib/notifications';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { addBusinessHours, makeIsWorkingDay } from '@/lib/working-hours';
import {
  buildPaymentObligationFields,
  DEFAULT_RECURRING_WORKFLOW,
  loadWorkingCalendar,
  matchApprovalRule,
  recurringObligationId,
  resolveWorkflowActivation,
  RP_COLLECTIONS,
  type ApprovalRule,
  type RecurrenceOptions,
  type RecurringCycle,
  type RecurringPaymentMaster,
  type RecurringWorkflowStep,
} from '@/lib/recurring-payments';

/**
 * Manual obligation generation — "Generate now" on a master, "Save & generate" on the master form,
 * and "Generate all" on the register.
 *
 * Those three were separate inline copies of the same sequence and had drifted: none of them
 * notified the assignee an activated obligation landed on (the cron does, and then skips anything
 * already activated, so nobody was ever told), and none of them wrote atomically. Two checked for
 * an existing obligation and then wrote with a plain `set`; the master form did not check at all.
 * "Save & generate" on a master whose current cycle already existed therefore *replaced* that
 * obligation — bill, payments and workflow history included — with a fresh Scheduled one.
 *
 * Here the write is a transaction that creates only when the document is absent, matching the
 * cron's `create()`: losing a race to the cron or to a second click is reported as "already
 * exists", never as an overwrite.
 */

/** Everything a generation run needs that doesn't change per master — loaded once per run. */
export interface ManualGenerationContext {
  organizationId: string;
  actor: { id: string; name: string };
  rules: ApprovalRule[];
  workflow: RecurringWorkflowStep[];
  calendar: Awaited<ReturnType<typeof loadWorkingCalendar>>;
  /** The org's working calendar as the schedule math consumes it, so due dates match the cron's. */
  scheduleOptions: RecurrenceOptions;
}

export async function loadManualGenerationContext(
  organizationId: string,
  actor: { id: string; name?: string },
): Promise<ManualGenerationContext> {
  const [ruleSnapshot, settingsSnap, workflowSnap, calendar] = await Promise.all([
    getDocs(query(collection(db, RP_COLLECTIONS.approvalRules), where('organizationId', '==', organizationId))),
    getDoc(doc(db, RP_COLLECTIONS.settings, organizationId.replace(/[^a-zA-Z0-9_-]/g, '_'))),
    getDoc(doc(db, 'workflows', 'recurring-payments-workflow')),
    loadWorkingCalendar(),
  ]);
  const steps = workflowSnap.data()?.steps as RecurringWorkflowStep[] | undefined;
  return {
    organizationId,
    actor: { id: actor.id, name: actor.name || 'User' },
    rules: ruleSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ApprovalRule),
    // An empty saved list is not a workflow; fall back exactly as the cron and the stage screen do.
    workflow: steps?.length ? steps : DEFAULT_RECURRING_WORKFLOW,
    calendar,
    scheduleOptions: { isWorkingDay: makeIsWorkingDay(calendar.workingHours, calendar.holidays) },
  };
}

/**
 * Doc ids of every obligation this org has for a master, soft-deleted ones included — a deleted
 * obligation still occupies its cycle's id, so it counts as generated. Feed it to
 * `actionableRecurringCycle`'s `isGenerated` so "the next cycle" means the next *missing* one.
 */
export function generatedCyclePredicate(organizationId: string, masterId: string, obligationIds: Iterable<string>) {
  const ids = new Set(obligationIds);
  return (cycle: RecurringCycle) => ids.has(recurringObligationId(organizationId, masterId, cycle.key));
}

export type GenerationOutcome =
  | { kind: 'exists'; paymentId: string }
  | {
      kind: 'created';
      paymentId: string;
      /** The first step it entered, or null when it stays Scheduled. */
      activationStage: string | null;
      /** True when activation was due but nobody could be assigned — a configuration problem, not timing. */
      noAssignee: boolean;
    };

/** Creates `master`'s obligation for `cycle` unless one already exists, and enters it into the workflow when due. */
export async function generateMasterCycle(
  master: RecurringPaymentMaster,
  cycle: RecurringCycle,
  context: ManualGenerationContext,
): Promise<GenerationOutcome> {
  const { organizationId, actor, workflow, calendar } = context;
  const paymentId = recurringObligationId(organizationId, master.id, cycle.key);
  const paymentRef = doc(db, RP_COLLECTIONS.payments, paymentId);
  const amount = Number(master.amount || 0);
  const fields = buildPaymentObligationFields({
    organizationId,
    masterId: master.id,
    cycle,
    generatedAutomatically: false,
    title: master.title,
    category: master.category,
    vendorName: master.vendorName,
    branchId: master.branchId,
    branchName: master.branchName,
    projectId: master.projectId,
    projectName: master.projectName,
    departmentId: master.departmentId,
    department: master.department,
    costCentre: master.costCentre,
    ledger: master.ledger,
    // A master saved before amount types existed has none, and the client SDK rejects `undefined`.
    amountType: master.amountType || 'Fixed',
    description: master.description,
    accountNumber: master.accountNumber,
    amount,
    maximumAmount: master.maximumAmount,
    assignedTo: master.assignedTo,
    backupAssignedTo: master.backupAssignedTo,
    verifierId: master.verifierId,
    approverId: master.approverId,
    accountsProcessorId: master.accountsProcessorId,
    approvalRule: matchApprovalRule(context.rules, {
      amount, category: master.category, projectId: master.projectId, projectName: master.projectName,
    }),
  });
  const firstStep = workflow[0];
  // Enters its first step the moment it is created — no waiting window before the due date.
  const activation = resolveWorkflowActivation(firstStep, fields);
  const noAssignee = !activation && Boolean(firstStep);

  const created = await runTransaction(db, async (transaction) => {
    if ((await transaction.get(paymentRef)).exists()) return false;
    transaction.set(paymentRef, {
      ...fields,
      ...(activation
        ? {
            status: activation.status,
            workflowStatus: activation.workflowStatus,
            stage: activation.stage,
            currentStepId: activation.currentStepId,
            assignees: activation.assignees,
            workflowStartedAt: serverTimestamp(),
            stepEnteredAt: serverTimestamp(),
            // The real deadline against the org's working hours, not resolveWorkflowActivation's
            // naive calendar-hour approximation.
            workflowDeadline: Timestamp.fromMillis(
              addBusinessHours(new Date(), Math.max(1, firstStep.tat), calendar.workingHours, calendar.holidays).getTime(),
            ),
          }
        : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (noAssignee) {
      // Recorded on the obligation itself so it is diagnosable later, not just in a toast.
      transaction.set(doc(collection(paymentRef, RP_COLLECTIONS.auditLogs)), {
        organizationId,
        paymentId,
        action: 'Workflow activation skipped',
        summary: `No assignee could be resolved for step "${firstStep.name}" — check this master's payment owner, or that step's configured users in Settings › Workflow.`,
        userId: actor.id,
        userName: actor.name,
        createdAt: serverTimestamp(),
      });
    }
    return true;
  });
  if (!created) return { kind: 'exists', paymentId };

  if (activation) {
    // Same notice the cron sends on activation. Best-effort: the obligation exists either way, and
    // a failed notification must not read as a failed generation.
    await dispatchNotification(
      { userIds: activation.assignees },
      {
        type: 'recurring_payment_workflow',
        title: `Action required: ${activation.stage}`,
        body: `${fields.title} is due on ${fields.dueDate} and has entered your workflow queue.`,
        module: ACTIVITY_MODULES.RECURRING_PAYMENTS,
        severity: 'WARNING',
        itemId: paymentId,
        itemRef: fields.title,
        stepName: activation.stage,
        link: `/recurring-payments/stage/${activation.currentStepId}`,
      },
    ).catch(() => undefined);
  }
  return { kind: 'created', paymentId, activationStage: activation?.stage ?? null, noAssignee };
}
