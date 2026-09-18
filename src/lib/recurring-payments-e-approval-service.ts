'use client';

import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { dispatchNotification } from '@/lib/notifications';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { addBusinessHours } from '@/lib/working-hours';
import {
  DEFAULT_RECURRING_E_APPROVAL_SETTINGS,
  DEFAULT_RECURRING_PAYMENT_SETTINGS,
  DEFAULT_RECURRING_WORKFLOW,
  loadWorkingCalendar,
  routeRecurringWorkflow,
  RP_COLLECTIONS,
  type PaymentObligation,
  type RecurringEApprovalSettings,
  type RecurringPaymentSettings,
  type RecurringWorkflowHistoryEntry,
  type RecurringWorkflowStep,
} from '@/lib/recurring-payments';
import {
  attachRecurringMirrorFields,
  buildRecurringMirrorStages,
  recurringApprovalPosition,
  recurringMirrorBody,
  recurringMirrorIssues,
  recurringMirrorPlanStages,
  recurringMirrorPriority,
  recurringMirrorSubject,
  recurringMirrorTemplateSteps,
  recurringSourcePosition,
  shouldMirrorRecurringPayment,
  type RecurringMirrorStage,
} from '@/lib/recurring-payments-e-approval';
import { planEApprovalMirrorSync, type EApprovalSourceLink } from '@/lib/e-approval-link';
import {
  applyMirroredEApprovalAction,
  createMirroredEApproval,
  getEApprovalRequest,
  listEApprovalSteps,
  updateEApprovalSourceLink,
  type EApprovalServiceActor,
} from '@/lib/e-approval-service';
import type { EApprovalStep } from '@/lib/e-approval';

/**
 * The bridge between a payment obligation's workflow and the approval request mirroring it.
 *
 * All of the deciding happens in `recurring-payments-e-approval.ts` and `e-approval-link.ts`, which
 * are pure and unit-tested; this file only reads, writes and sequences. Keeping it that way is
 * deliberate — reconciliation logic that lives next to `runTransaction` is logic nobody can test.
 *
 * There is exactly one entry point, `syncRecurringPaymentApproval`, and it is **idempotent**: run it
 * twice and the second run does nothing. That is what lets it be called from everywhere it needs to
 * be — after an action on either side, when a screen loads a payment, from the settings page's
 * "sync now" — without any caller having to know whether another one has already run. A reconcile
 * that had to be called exactly once would be a reconcile that silently stopped working the first
 * time somebody added a fourth screen.
 *
 * It never throws at its callers. A payment whose mirror cannot be brought into line is still a
 * payment its owner has to work, and blocking their action because a note-sheet is out of step would
 * be the wrong trade every time. Failures are recorded on `payment.eApproval.lastError`, which the
 * payment screen shows, so a stuck mirror is visible rather than merely logged.
 */

/* ------------------------------------------------------------------------------------------------
 * Actor
 * ---------------------------------------------------------------------------------------------- */

/** The session user as the recurring-payments screens already hold it. */
export interface RecurringPaymentActorUser {
  id: string;
  name?: string;
  email?: string | null;
  role?: string;
  organizationId?: string;
}

/**
 * Translates a session user into the actor the E-Approval service takes.
 *
 * Kept here rather than asking every payment screen to build one: they all hold `user` from
 * `AuthProvider`, and the two modules name the same fields differently (`id`/`name` against
 * `userId`/`userName`). One adapter is a smaller surface than four call sites that each have to
 * remember the mapping — and remember it identically.
 */
export function recurringPaymentEApprovalActor(
  user: RecurringPaymentActorUser | null | undefined,
): EApprovalServiceActor | null {
  if (!user?.id) return null;
  return {
    userId: user.id,
    userName: user.name || user.email || 'User',
    userEmail: user.email ?? null,
    designation: user.role,
    role: user.role,
    organizationId: user.organizationId,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Loading
 * ---------------------------------------------------------------------------------------------- */

const settingDocId = (organizationId: string) => organizationId.replace(/[^a-zA-Z0-9_-]/g, '_');

export async function loadRecurringEApprovalSettings(organizationId: string): Promise<RecurringEApprovalSettings> {
  const snapshot = await getDoc(doc(db, RP_COLLECTIONS.settings, settingDocId(organizationId)));
  const data = snapshot.exists() ? (snapshot.data() as Partial<RecurringPaymentSettings>) : {};
  // Field by field over the defaults, as the rest of this module's settings loading does: a document
  // written before an option existed must resolve it to its default, not to undefined.
  return { ...DEFAULT_RECURRING_E_APPROVAL_SETTINGS, ...(data.eApproval || {}) };
}

export async function loadRecurringWorkflow(): Promise<RecurringWorkflowStep[]> {
  const snapshot = await getDoc(doc(db, 'workflows', 'recurring-payments-workflow'));
  const steps = snapshot.exists() ? (snapshot.data().steps as RecurringWorkflowStep[] | undefined) : undefined;
  return steps?.length ? steps : DEFAULT_RECURRING_WORKFLOW;
}

async function loadPayment(paymentId: string): Promise<PaymentObligation | null> {
  const snapshot = await getDoc(doc(db, RP_COLLECTIONS.payments, paymentId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as PaymentObligation) : null;
}

/**
 * Fills in which approval steps stand for which stage.
 *
 * Matched on the `mirrorStepId`/`mirrorLevel` the steps carry rather than on position, so a workflow
 * that grew a step after the mirror was created lines up on the stages that still exist instead of
 * silently shifting every later stage by one.
 */
function linkStagesToSteps(stages: RecurringMirrorStage[], steps: EApprovalStep[]): RecurringMirrorStage[] {
  return stages.map((stage) => ({
    ...stage,
    approvalStepIds: steps
      .filter((step) => step.mirrorStepId === stage.stepId && (step.mirrorLevel ?? null) === (stage.level ?? null))
      .map((step) => step.id),
  }));
}

/* ------------------------------------------------------------------------------------------------
 * Writing back to the payment
 * ---------------------------------------------------------------------------------------------- */

const PAYMENT_PATH = (paymentId: string) => `/recurring-payments/payments/${paymentId}`;

/** Records the mirror's current state on the payment, so its screens can show it without a join. */
async function stampMirror(
  paymentId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await updateDoc(doc(db, RP_COLLECTIONS.payments, paymentId), {
    ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [`eApproval.${key}`, value])),
    'eApproval.syncedAt': serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Moves the payment one stage, exactly as its own workflow screen would.
 *
 * Guarded on `currentStepId` inside the transaction: by the time an approval reaches here the
 * payment may already have been moved by somebody working it directly, and applying the approval's
 * decision on top of that would skip a step nobody took.
 */
async function advancePayment(
  payment: PaymentObligation,
  workflow: RecurringWorkflowStep[],
  step: RecurringWorkflowStep,
  action: string,
  actor: EApprovalServiceActor,
  comment: string,
  calendar: Awaited<ReturnType<typeof loadWorkingCalendar>>,
): Promise<{ moved: boolean; stage: string; notify: string[]; destinationStepId: string }> {
  const paymentRef = doc(db, RP_COLLECTIONS.payments, payment.id);
  const auditRef = doc(collection(paymentRef, RP_COLLECTIONS.auditLogs));
  let result: Awaited<ReturnType<typeof advancePayment>> = { moved: false, stage: '', notify: [], destinationStepId: '' };

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(paymentRef);
    if (!snapshot.exists()) throw new Error('The payment no longer exists.');
    const current = { id: snapshot.id, ...snapshot.data() } as PaymentObligation;
    if (current.currentStepId !== step.id) {
      // Somebody moved it while the approval was being given. Not an error: the reconcile will read
      // the new position next time round and decide again from there.
      result = { moved: false, stage: current.stage || '', notify: [], destinationStepId: '' };
      return;
    }

    const routed = routeRecurringWorkflow({ workflow, step, action, payment: current, actorId: actor.userId });
    const history: RecurringWorkflowHistoryEntry = {
      action,
      comment,
      userId: actor.userId,
      userName: actor.userName,
      stepId: step.id,
      stepName: step.name,
      timestamp: Timestamp.now(),
    };
    transaction.update(paymentRef, {
      workflowHistory: arrayUnion(history),
      workflowStatus: routed.workflowStatus,
      status: routed.status,
      stage: routed.stage,
      currentStepId: routed.currentStepId,
      assignees: routed.assignees,
      currentApprovalLevel: routed.currentApprovalLevel,
      approvalCompletedBy: routed.approvalCompletedBy,
      stepEnteredAt: Timestamp.now(),
      workflowDeadline: routed.target
        ? Timestamp.fromMillis(
            addBusinessHours(new Date(), Math.max(1, routed.target.tat), calendar.workingHours, calendar.holidays).getTime(),
          )
        : current.workflowDeadline || null,
      updatedAt: Timestamp.now(),
    });
    transaction.set(auditRef, {
      organizationId: current.organizationId,
      paymentId: current.id,
      action,
      summary: `${step.name}: ${action} — given in E-Approval${comment ? ` (${comment})` : ''}.`,
      userId: actor.userId,
      userName: actor.userName,
      metadata: { fromStep: step.name, destination: routed.stage, source: 'E-Approval' },
      createdAt: Timestamp.now(),
    });
    result = { moved: true, stage: routed.stage, notify: routed.notify, destinationStepId: routed.destinationStepId };
  });

  return result;
}

/* ------------------------------------------------------------------------------------------------
 * The reconcile
 * ---------------------------------------------------------------------------------------------- */

export interface RecurringMirrorSyncResult {
  /** What the reconcile did, for a toast or a log line. Empty when there was nothing to do. */
  summary: string;
  approvalId?: string;
  referenceNo?: string;
  /** Set when the mirror could not be brought into line; also stamped onto the payment. */
  error?: string;
}

const NOTHING: RecurringMirrorSyncResult = { summary: '' };

/**
 * Payments a reconcile is already running for.
 *
 * Single-flight, and the reason is re-entrancy rather than performance. Bringing the approval into
 * line calls `performEApprovalAction`, which pushes the result back to the source module — which
 * calls this function again, from inside the call it is still in the middle of. The nested run would
 * act on the same stages the outer one is part-way through, and the outer one would then be working
 * from a step list that is no longer true. Refusing the nested call is correct as well as simple:
 * the outer run has not finished deciding yet, and whatever the nested one would do it will do.
 */
const inFlight = new Set<string>();

/**
 * Brings a payment and its mirrored approval into agreement, whichever of them moved.
 *
 * Safe to call from anywhere and as often as you like — see the module note. Returns rather than
 * throws.
 */
export async function syncRecurringPaymentApproval(
  paymentId: string,
  actor: EApprovalServiceActor,
  preloaded?: { settings?: RecurringEApprovalSettings; workflow?: RecurringWorkflowStep[] },
): Promise<RecurringMirrorSyncResult> {
  if (!actor?.userId) return NOTHING;
  if (inFlight.has(paymentId)) return NOTHING;
  inFlight.add(paymentId);
  try {
    const payment = await loadPayment(paymentId);
    if (!payment) return NOTHING;

    const organizationId = payment.organizationId || actor.organizationId || 'default';
    const settings = preloaded?.settings ?? (await loadRecurringEApprovalSettings(organizationId));
    const linked = payment.eApproval?.requestId && !payment.eApproval.detachedAt;

    // Off, or not eligible, and nothing linked yet: the two modules are simply running alone.
    if (!linked && !shouldMirrorRecurringPayment(payment, settings)) return NOTHING;
    // Off *after* something was linked: leave the existing approval alone rather than tearing it
    // down. Switching the bridge off should stop new mirrors, not delete the trail of old ones.
    if (linked && !settings.enabled) return NOTHING;

    const workflow = preloaded?.workflow ?? (await loadRecurringWorkflow());
    const stages = buildRecurringMirrorStages(workflow, payment, settings);
    if (!stages.length) return NOTHING;

    if (linked) return await reconcileMirror(payment, workflow, stages, actor);

    const raised = await raiseMirror(payment, stages, settings, actor);
    if (raised.error || !raised.approvalId) return raised;
    // A chain always starts at its first stage, but the payment it mirrors may be at its third —
    // switch the bridge on mid-month and most obligations are already part-way through. Reconciling
    // straight away signs off the stages that have demonstrably been passed, so the approval opens
    // showing the payment where it actually is rather than back at bill collection.
    const fresh = await loadPayment(paymentId);
    if (!fresh) return raised;
    const caughtUp = await reconcileMirror(fresh, workflow, buildRecurringMirrorStages(workflow, fresh, settings), actor);
    return caughtUp.error ? { ...raised, error: caughtUp.error } : raised;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The approval mirror could not be synchronised.';
    await stampMirror(paymentId, { lastError: message }).catch(() => undefined);
    return { summary: '', error: message };
  } finally {
    inFlight.delete(paymentId);
  }
}

/**
 * Who the mirrored approval is raised by.
 *
 * The obligation's own owner, not whoever happened to trigger the sync — a reconcile fired by an
 * approver opening a screen must not make that approver the requester of somebody else's payment.
 * Their name is read here rather than denormalised onto the obligation, which only ever stored the
 * id; a request whose header says "raised by a colleague" is not much of a header.
 */
async function resolveRequester(
  payment: PaymentObligation,
  actor: EApprovalServiceActor,
): Promise<{ userId: string; userName?: string }> {
  const userId = payment.assignedTo || payment.backupAssignedTo || actor.userId;
  if (userId === actor.userId) return { userId, userName: actor.userName };
  const snapshot = await getDoc(doc(db, 'users', userId)).catch(() => null);
  const name = snapshot?.exists() ? String(snapshot.data().name || '') : '';
  return { userId, userName: name || undefined };
}

/** Raises the approval for a payment that does not have one yet. */
async function raiseMirror(
  payment: PaymentObligation,
  stages: RecurringMirrorStage[],
  settings: RecurringEApprovalSettings,
  actor: EApprovalServiceActor,
): Promise<RecurringMirrorSyncResult> {
  const issues = recurringMirrorIssues(stages);
  if (issues.length) {
    // Refused rather than raised half-configured: an approval whose third stage reaches nobody
    // strands the payment there with no way forward but an administrator, and the person who can fix
    // it needs to be told which stage and why.
    const message = `Not mirrored — ${issues.join(' ')}`;
    await stampMirror(payment.id, { lastError: message }).catch(() => undefined);
    return { summary: '', error: message };
  }

  const source: EApprovalSourceLink = {
    module: 'Recurring Payments',
    recordId: payment.id,
    recordLabel: payment.title,
    recordPath: PAYMENT_PATH(payment.id),
    stepId: payment.currentStepId ?? undefined,
    stepName: payment.stage,
    mirrorMode: stages.find((stage) => stage.stepId === payment.currentStepId)?.mode,
  };

  const { approvalId, referenceNo } = await createMirroredEApproval(
    {
      source,
      subject: recurringMirrorSubject(payment),
      body: recurringMirrorBody(payment),
      steps: recurringMirrorTemplateSteps(stages),
      decorateSteps: (records) => attachRecurringMirrorFields(records, stages),
      approvalTypeId: settings.approvalTypeId || undefined,
      approvalTypeName: settings.approvalTypeName || undefined,
      departmentId: payment.departmentId || undefined,
      departmentName: payment.department || undefined,
      projectId: payment.projectId || undefined,
      projectName: payment.projectName || undefined,
      externalRef: payment.billNumber || payment.cycleKey,
      priority: recurringMirrorPriority(payment),
      requiredBy: payment.dueDate,
      amount: Number(payment.billAmount || payment.expectedAmount || 0),
      vendorName: payment.vendorName,
      costCentre: payment.costCentre,
      budgetHead: payment.ledger,
      confidential: settings.confidential,
      // The payment's own owner raises it. That is who is answerable for the obligation, and it is
      // what makes "don't interrupt your own request" mean the right thing here: their stages are
      // theirs to work (they are marked `requesterMustAct`), while an approval stage that happens to
      // name them is already satisfied.
      requester: await resolveRequester(payment, actor),
    },
    actor,
  );

  await stampMirror(payment.id, {
    requestId: approvalId,
    referenceNo,
    status: 'Pending Approval',
    mode: source.mirrorMode ?? null,
    raisedBy: actor.userId,
    raisedByName: actor.userName,
    raisedAt: serverTimestamp(),
    detachedAt: null,
    detachedReason: null,
    lastError: null,
  });

  return { summary: `Raised ${referenceNo} in E-Approval.`, approvalId, referenceNo };
}

/** Brings an existing mirror back into line with the payment, or the payment with it. */
async function reconcileMirror(
  payment: PaymentObligation,
  workflow: RecurringWorkflowStep[],
  rawStages: RecurringMirrorStage[],
  actor: EApprovalServiceActor,
): Promise<RecurringMirrorSyncResult> {
  const approvalId = payment.eApproval!.requestId;
  const [request, steps] = await Promise.all([getEApprovalRequest(approvalId), listEApprovalSteps(approvalId)]);
  if (!request) {
    // The approval was deleted out from under the payment. Detach rather than raise a replacement:
    // silently re-creating a note-sheet somebody removed is not a decision this code should make.
    await stampMirror(payment.id, { detachedAt: serverTimestamp(), detachedReason: 'The linked approval no longer exists.' });
    return { summary: 'The linked approval no longer exists — the payment now runs on its own workflow.' };
  }

  const stages = linkStagesToSteps(rawStages, steps);
  const sourceAt = recurringSourcePosition(payment, stages, workflow);
  const approvalAt = recurringApprovalPosition(request, steps, stages);
  const action = planEApprovalMirrorSync(sourceAt, approvalAt, recurringMirrorPlanStages(stages));

  const stageOf = (stepId: string) => workflow.find((step) => step.id === stepId);
  const currentStage = stages.find((stage) => stage.stepId === payment.currentStepId);

  /**
   * Writes back where each side now stands.
   *
   * Re-reads both records rather than using the ones this function opened with. By the time it runs,
   * an advance may have moved the payment three steps and closed half the approval chain, and
   * stamping the state we started from would leave every payment row reporting the position it held
   * *before* the action that prompted the sync — which is the one thing this pointer exists to avoid.
   */
  const refresh = async () => {
    const [latest, current] = await Promise.all([
      loadPayment(payment.id),
      getEApprovalRequest(approvalId),
    ]);
    const record = latest ?? payment;
    const approval = current ?? request;
    // Looked up in the list already built rather than rebuilt: advancing changes which stage the
    // payment is on, not what the stages are.
    const stageNow = stages.find((stage) => stage.stepId === record.currentStepId) ?? currentStage;
    await Promise.all([
      updateEApprovalSourceLink(
        approvalId,
        {
          module: 'Recurring Payments',
          recordId: record.id,
          recordLabel: record.title,
          recordPath: PAYMENT_PATH(record.id),
          stepId: record.currentStepId ?? undefined,
          stepName: record.stage,
          mirrorMode: stageNow?.mode,
        },
        actor,
      ),
      stampMirror(record.id, {
        referenceNo: approval.referenceNo ?? null,
        status: approval.status,
        // The step the *payment* is on, which is what its own screens want to show. Falls back to
        // the approval's active stage while the payment is between steps.
        stageName: record.stage || approval.currentStepName || null,
        pendingLabel: approval.pendingLabel ?? null,
        mode: stageNow?.mode ?? null,
        lastError: null,
      }),
    ]);
  };

  switch (action.kind) {
    case 'In Sync':
      await refresh();
      return NOTHING;

    case 'Advance Source': {
      const calendar = await loadWorkingCalendar();
      let latest = payment;
      let moved = 0;
      for (const stage of action.steps) {
        const step = stageOf(stage.stepId);
        // A stage E-Approval approved that the payment cannot act on from here — a step that needs a
        // bill number, or one an administrator has since deleted. Left where it is, and said so.
        if (!step || !stage.action) {
          const message = `E-Approval approved "${step?.name || stage.stepId}", but that step must be completed on the payment's own form.`;
          await stampMirror(payment.id, { lastError: message });
          return { summary: '', error: message, approvalId };
        }
        const outcome = await advancePayment(latest, workflow, step, stage.action, actor, 'Approved in E-Approval.', calendar);
        if (!outcome.moved) break;
        moved += 1;
        if (outcome.notify.length) {
          await dispatchNotification(
            { userIds: [...new Set(outcome.notify)] },
            {
              type: 'recurring_payment_workflow',
              title: `Action required: ${outcome.stage}`,
              body: `${payment.title} has moved to your workflow queue.`,
              module: ACTIVITY_MODULES.RECURRING_PAYMENTS,
              severity: 'WARNING',
              itemId: payment.id,
              itemRef: payment.title,
              stepName: outcome.stage,
              link: outcome.destinationStepId ? `/recurring-payments/stage/${outcome.destinationStepId}` : '/recurring-payments/payments',
            },
          );
        }
        latest = (await loadPayment(payment.id)) ?? latest;
      }
      await refresh();
      return moved
        ? { summary: `Moved the payment forward ${moved} step${moved > 1 ? 's' : ''} on the E-Approval decision.`, approvalId }
        : NOTHING;
    }

    case 'Advance Approval': {
      let done = 0;
      for (const stage of action.stages) {
        // Re-read each time round: approving one stage activates the next, and on a stage held
        // jointly it skips the members who did not act. A list captured before the loop started
        // would have this trying to approve a step the previous iteration already closed.
        const fresh = await listEApprovalSteps(approvalId);
        const active = stage.approvalStepIds
          .map((id) => fresh.find((candidate) => candidate.id === id))
          .filter((candidate): candidate is EApprovalStep => candidate?.status === 'Active');
        if (!active.length) continue;
        // A stage held by a primary and a backup needs one of them, not both — and preferably the
        // one who actually did the work, so the trail does not have to record a reassignment it
        // could have avoided.
        const target =
          active.find((candidate) => candidate.assignment.kind === 'User' && candidate.assignment.userId === actor.userId) ??
          active[0];
        await applyMirroredEApprovalAction(
          approvalId,
          { kind: 'Approve', stepId: target.id, comment: 'Completed in Recurring Payments.' },
          actor,
          `Completed in Recurring Payments by ${actor.userName}.`,
        );
        done += 1;
      }
      await refresh();
      return done ? { summary: `Recorded ${done} stage${done > 1 ? 's' : ''} in E-Approval.`, approvalId } : NOTHING;
    }

    case 'Return Source': {
      const step = stageOf(payment.currentStepId || '');
      if (!step) return NOTHING;
      const calendar = await loadWorkingCalendar();
      const outcome = await advancePayment(
        payment, workflow, step, 'Return for Correction', actor,
        request.returnReason || 'Returned in E-Approval.', calendar,
      );
      await refresh();
      return outcome.moved ? { summary: `Returned the payment to ${outcome.stage}.`, approvalId } : NOTHING;
    }

    case 'Close Source': {
      if (action.outcome === 'Cancelled') {
        await stampMirror(payment.id, {
          status: 'Cancelled',
          detachedAt: serverTimestamp(),
          detachedReason: 'The linked approval was cancelled — the payment runs on its own workflow.',
        });
        return { summary: 'The approval was cancelled; the payment continues on its own workflow.', approvalId };
      }
      const step = stageOf(payment.currentStepId || '');
      if (!step) {
        await refresh();
        return NOTHING;
      }
      const calendar = await loadWorkingCalendar();
      const outcome = await advancePayment(
        payment, workflow, step, action.outcome === 'Rejected' ? 'Reject' : (currentStage?.action || 'Approve'), actor,
        action.outcome === 'Rejected' ? (request.rejectionReason || 'Rejected in E-Approval.') : 'Approved in E-Approval.',
        calendar,
      );
      await refresh();
      return outcome.moved ? { summary: `Payment ${action.outcome.toLowerCase()} on the E-Approval decision.`, approvalId } : NOTHING;
    }

    case 'Close Approval': {
      const open = steps.filter((step) => ['Pending', 'Active'].includes(step.status));
      if (action.outcome === 'Rejected' || action.outcome === 'Cancelled') {
        const target = open[0];
        if (target) {
          await applyMirroredEApprovalAction(
            approvalId,
            {
              kind: action.outcome === 'Rejected' ? 'Reject' : 'Cancel',
              stepId: target.id,
              reason: `The payment was ${action.outcome.toLowerCase()} in Recurring Payments.`,
            },
            actor,
            `Closed in Recurring Payments by ${actor.userName}.`,
          );
        }
      } else {
        // Approved: sign off whatever stages are still open, so the approval closes with a complete
        // trail rather than being cancelled — the work really was done, just on the other screen.
        // Bounded by the number of stages, and re-read each round because approving one stage
        // activates the next.
        for (let guard = 0; guard < steps.length; guard += 1) {
          const fresh = await listEApprovalSteps(approvalId);
          const next = fresh.find((step) => step.status === 'Active');
          if (!next) break;
          await applyMirroredEApprovalAction(
            approvalId,
            { kind: 'Approve', stepId: next.id, comment: 'Completed in Recurring Payments.' },
            actor,
            `Completed in Recurring Payments by ${actor.userName}.`,
          );
        }
      }
      await refresh();
      return { summary: `Closed ${request.referenceNo || 'the approval'} as ${action.outcome.toLowerCase()}.`, approvalId };
    }

    default:
      return NOTHING;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Detaching
 * ---------------------------------------------------------------------------------------------- */

/**
 * Breaks the link, leaving both records intact and each running on its own.
 *
 * The escape hatch for a mirror that has gone wrong — a workflow restructured underneath a live
 * payment, an approval chain that cannot be satisfied. The approval keeps its trail and can be
 * cancelled separately; the payment goes back to being worked entirely in this module. Deliberately
 * not a delete: the approvals given before the link broke were still given.
 */
export async function detachRecurringPaymentApproval(
  paymentId: string,
  reason: string,
  actor: EApprovalServiceActor,
): Promise<void> {
  if (!actor?.userId) throw new Error('You must be signed in to detach an approval.');
  const payment = await loadPayment(paymentId);
  if (!payment?.eApproval?.requestId) return;
  await stampMirror(paymentId, {
    detachedAt: serverTimestamp(),
    detachedReason: reason || 'Detached by an administrator.',
    lastError: null,
  });
  await updateEApprovalSourceLink(
    payment.eApproval.requestId,
    {
      module: 'Recurring Payments',
      recordId: paymentId,
      recordLabel: payment.title,
      recordPath: PAYMENT_PATH(paymentId),
      detachedAt: new Date().toISOString(),
      detachedReason: reason || 'Detached by an administrator.',
    },
    actor,
  ).catch(() => undefined);
}

/**
 * The reconcile, called from a screen that has just changed something.
 *
 * Swallows everything: a sync is never the reason a user's action fails, and the error is already on
 * the payment for whoever looks. Callers that want to show the outcome should use
 * `syncRecurringPaymentApproval` directly and read its result.
 */
export function syncRecurringPaymentApprovalInBackground(
  paymentId: string,
  user: RecurringPaymentActorUser | null | undefined,
): void {
  const actor = recurringPaymentEApprovalActor(user);
  if (!actor) return;
  void syncRecurringPaymentApproval(paymentId, actor).catch(() => undefined);
}

/* ------------------------------------------------------------------------------------------------
 * Sweep
 * ---------------------------------------------------------------------------------------------- */

export interface RecurringMirrorSweepResult {
  scanned: number;
  raised: number;
  updated: number;
  failed: number;
  errors: string[];
}

/**
 * Mirrors every eligible payment that does not have an approval yet, and reconciles the ones that do.
 *
 * This exists because obligations are generated by a nightly Admin-SDK route
 * (`/api/recurring-payments/generate`) that runs outside the browser, where this bridge — a
 * client-SDK module running under the signed-in user's security rules — cannot follow. Without a
 * sweep, a payment generated at 2 a.m. would not appear in E-Approval until somebody happened to
 * open it, which is exactly the wrong way round: the point of mirroring is that the approver finds
 * it waiting.
 *
 * Sequential rather than parallel, and capped. A first run after switching the bridge on can face
 * hundreds of open obligations, and firing hundreds of concurrent multi-document writes at Firestore
 * is how a "sync" becomes an outage. The cap is reported back so the caller can say the run was
 * partial and offer to continue.
 */
export async function sweepRecurringPaymentApprovals(
  payments: PaymentObligation[],
  actor: EApprovalServiceActor,
  options: { limit?: number } = {},
): Promise<RecurringMirrorSweepResult> {
  const result: RecurringMirrorSweepResult = { scanned: 0, raised: 0, updated: 0, failed: 0, errors: [] };
  if (!actor?.userId) return result;
  const organizationId = actor.organizationId || payments[0]?.organizationId || 'default';
  const settings = await loadRecurringEApprovalSettings(organizationId);
  if (!settings.enabled) return result;
  const workflow = await loadRecurringWorkflow();

  const eligible = payments.filter(
    (payment) => shouldMirrorRecurringPayment(payment, settings) || payment.eApproval?.requestId,
  );
  for (const payment of eligible.slice(0, options.limit ?? 100)) {
    result.scanned += 1;
    const outcome = await syncRecurringPaymentApproval(payment.id, actor, { settings, workflow });
    if (outcome.error) {
      result.failed += 1;
      if (result.errors.length < 5) result.errors.push(`${payment.title}: ${outcome.error}`);
    } else if (outcome.summary.startsWith('Raised')) result.raised += 1;
    else if (outcome.summary) result.updated += 1;
  }
  return result;
}
