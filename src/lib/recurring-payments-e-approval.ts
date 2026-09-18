/**
 * Mapping a payment obligation's workflow onto an E-Approval chain, and back.
 *
 * Dependency-free — no Firestore, no React — for the same reason as the two modules either side of
 * it: this is where the two workflows are reconciled, it is the part most likely to be wrong, and it
 * has to be unit-testable without an emulator. Everything that touches the network lives in
 * `recurring-payments-e-approval-service.ts`, which does no thinking of its own.
 *
 * The shape of the mapping is one idea:
 *
 *     one obligation  →  one approval request  →  one stage per *decision opportunity*
 *
 * A "decision opportunity" is not the same as a workflow step. A payment approval step carrying
 * three sequential amount-based levels is one step in Recurring Payments and three stages here,
 * because three people sign in turn and the trail has to show three signatures. Collapsing them
 * would make the approval chain say "Payment Approval — approved by Nandini" when in fact Nandini,
 * Ravi and the director all signed. Conversely a parallel approval is *one* stage with three people
 * on it, because that is precisely what a parallel group is.
 *
 * Both sides are then reduced to an index into that stage list, and `planEApprovalMirrorSync` (in
 * `e-approval-link.ts`) decides who has to catch up with whom. That is the whole reconciliation
 * model: no locks, no owner flag, no "which module is authoritative" — just two integers and a rule
 * for what to do when they differ.
 */

import type { EApprovalMirrorMode, EApprovalMirrorPosition } from './e-approval-link';
import type {
  EApprovalAssignment,
  EApprovalPriority,
  EApprovalStepRecord,
  EApprovalTemplateStep,
} from './e-approval-policy';
// Explicit extension, as `e-approval-analytics.ts` uses: this module is unit-tested directly under
// Node, whose ESM resolver will not guess it. See the note in tsconfig.json.
import {
  recurringMirrorAction,
  recurringMirrorMode,
  resolveAssignees,
  resolveEntryAssignees,
} from './recurring-payments-workflow.ts';
import type {
  PaymentObligation,
  RecurringEApprovalSettings,
  RecurringWorkflowStep,
} from './recurring-payments';

/* ------------------------------------------------------------------------------------------------
 * The stage list
 * ---------------------------------------------------------------------------------------------- */

/** One decision opportunity: a workflow step, or one level within a multi-level approval step. */
export interface RecurringMirrorStage {
  /** The Recurring Payments workflow step this stage stands for. */
  stepId: string;
  stepName: string;
  /** Which decision within that step, when it collects several in sequence. 1-based; absent otherwise. */
  level?: number;
  /** The action applied back to the payment when this stage is approved. Absent on a 'Visibility' stage. */
  action?: string;
  mode: EApprovalMirrorMode;
  /** Who holds it. Empty is legal here and reported by `recurringMirrorIssues` rather than thrown. */
  assignees: string[];
  /** 'All' for a parallel approval — every named approver must sign. 'Any' otherwise: one is enough. */
  groupMode: 'All' | 'Any' | 'Single';
  /** Turnaround in hours, carried from the step so E-Approval's SLA clock matches the payment's TAT. */
  slaHours: number;
  /**
   * Position of this stage's step in the *full* workflow, including steps this scope leaves out.
   *
   * Needed because 'Decision' scope produces a chain with gaps in it, and a payment spends most of
   * its life in those gaps — sitting at Bill Collection, which is not a stage. Without knowing where
   * the missing steps were, a payment at a skipped step reads as "not on the chain at all", and the
   * reconciler concludes the approval has run ahead of it and tries to walk it forward.
   */
  workflowIndex: number;
  /** Ids of the approval-chain steps standing for this stage. Filled in once the chain exists. */
  approvalStepIds: string[];
}

const isApprovalStep = (step: RecurringWorkflowStep) => step.name.toLowerCase().includes('approval');

/**
 * Expands the configured workflow into the stage list for one obligation.
 *
 * Resolved against *this* payment, not in the abstract: an amount-based assignment depends on the
 * bill amount, and a matched approval rule replaces the step's own approvers entirely. Rebuilt on
 * every sync for exactly that reason — a bill that comes in at three times the estimate changes who
 * has to sign it, and a chain frozen at generation time would send it to the wrong desk.
 */
export function buildRecurringMirrorStages(
  workflow: RecurringWorkflowStep[],
  payment: PaymentObligation,
  settings: Pick<RecurringEApprovalSettings, 'scope'>,
): RecurringMirrorStage[] {
  const stages: RecurringMirrorStage[] = [];
  workflow.forEach((step, index) => {
    const mode = recurringMirrorMode(step);
    if (settings.scope === 'Decision' && mode !== 'Decision') return;
    const slaHours = Math.max(1, Number(step.tat) || 1);
    const levels = payment.approvalLevels || [];

    // A sequential approval step is as many stages as it has levels — see the module note.
    if (isApprovalStep(step) && levels.length > 1 && payment.approvalMode === 'Sequential') {
      levels.forEach((approverId, levelIndex) => {
        stages.push({
          stepId: step.id,
          stepName: `${step.name} · Level ${levelIndex + 1}`,
          level: levelIndex + 1,
          action: 'Approve',
          mode,
          assignees: [approverId].filter(Boolean),
          groupMode: 'Single',
          slaHours,
          workflowIndex: index,
          approvalStepIds: [],
        });
      });
      return;
    }
    if (isApprovalStep(step) && levels.length && payment.approvalMode === 'Parallel') {
      stages.push({
        stepId: step.id,
        stepName: step.name,
        action: 'Approve',
        mode,
        assignees: levels.filter(Boolean),
        groupMode: 'All',
        slaHours,
        workflowIndex: index,
        approvalStepIds: [],
      });
      return;
    }

    // Everything else is one stage. The entry step gets the owner fallback the module already
    // applies there, so an unconfigured first step mirrors to its owner rather than to nobody.
    const assignees = index === 0 ? resolveEntryAssignees(step, payment) : resolveAssignees(step, payment);
    stages.push({
      stepId: step.id,
      stepName: step.name,
      action: recurringMirrorAction(step),
      mode,
      assignees: assignees.filter(Boolean),
      // Recurring Payments treats a step's several assignees as alternates — the primary and their
      // backup — so one of them acting is the step done. 'Any' is that rule stated in E-Approval's
      // vocabulary; 'All' here would silently require the backup to sign as well.
      groupMode: assignees.length > 1 ? 'Any' : 'Single',
      slaHours,
      workflowIndex: index,
      approvalStepIds: [],
    });
  });
  return stages;
}

/**
 * Configuration problems that would leave a mirrored file stranded, phrased for an administrator.
 *
 * Reported rather than thrown: a payment whose third stage has no approver should still mirror its
 * first two, and the person who can fix it needs to be told which stage and why — not handed a
 * failed sync. Returned by the settings screen's preview and recorded on the payment when a sync
 * cannot proceed.
 */
export function recurringMirrorIssues(stages: RecurringMirrorStage[]): string[] {
  const issues: string[] = [];
  if (!stages.length) return ['This workflow produces no stages to mirror.'];
  stages.forEach((stage) => {
    if (!stage.assignees.length) issues.push(`"${stage.stepName}" has no assignee, so it would reach nobody.`);
    if (stage.mode === 'Decision' && !stage.action) {
      issues.push(`"${stage.stepName}" is decidable but offers no Approve, Verify or Close action.`);
    }
  });
  return issues;
}

/* ------------------------------------------------------------------------------------------------
 * Building the approval chain
 * ---------------------------------------------------------------------------------------------- */

/**
 * The stage list as E-Approval template steps.
 *
 * A 'Visibility' stage is carried into the chain like any other — it is a real stage of the real
 * workflow and hiding it would make the timeline lie about how the payment got where it is.
 */
export function recurringMirrorTemplateSteps(stages: RecurringMirrorStage[]): EApprovalTemplateStep[] {
  return stages.map((stage, index) => ({
    id: `rp-${stage.stepId}${stage.level ? `-l${stage.level}` : ''}`,
    name: stage.stepName,
    type: stage.action === 'Verify' ? ('VERIFICATION' as const) : ('APPROVAL' as const),
    assignments: stage.assignees.map(
      (userId): EApprovalAssignment => ({ kind: 'User', userId }),
    ),
    groupMode: stage.groupMode,
    slaHours: stage.slaHours,
    mandatory: true,
    description:
      stage.mode === 'Visibility'
        ? 'Completed on the payment’s own form in Recurring Payments — this stage tracks it here.'
        : undefined,
    // Position is meaningful: the sync lines the two chains up by order, so a stage list that came
    // back in a different order than it went in would silently re-route the payment.
    sourceStepId: String(index),
  }));
}

/**
 * Stamps the mirror pointers onto freshly built step records, in stage order.
 *
 * Every mirrored stage is marked `requesterMustAct`, which keeps `skipSelfApprovalSteps` off the
 * whole chain. That is not a detail — it is the difference between a mirror that tracks a workflow
 * and one that runs away with it.
 *
 * The self-approval rule exists for a note-sheet: a stage naming the person who raised it is already
 * satisfied, because submitting *was* their approval. A mirrored stage is not that. It is a step of
 * a real workflow in another module — verify the bill, approve the payment, close the obligation —
 * and it carries that module's own controls: the verification checklist, the approval-level record,
 * the audit entry. Treating it as satisfied does not merely tick a box here; the reconciler then
 * drags the payment through the corresponding step *there*, skipping all of it.
 *
 * The failure that taught us this: an organization where one person is the payment's owner, its
 * verifier and its approver — a small office, or anyone testing with a single account. Completing
 * step 1 of 5 auto-approved stages 2 and 3, and where no later stage happened to need a bill number
 * to stop the cascade, all five went at once and the request read "Approved" against a payment whose
 * bill had only just been submitted.
 */
export function attachRecurringMirrorFields(
  steps: EApprovalStepRecord[],
  stages: RecurringMirrorStage[],
): EApprovalStepRecord[] {
  // Steps come back one per assignment, grouped by sequence — so map by sequence, not by index.
  return steps.map((step) => {
    const stage = stages[step.sequence - 1];
    if (!stage) return step;
    return {
      ...step,
      mirrorStepId: stage.stepId,
      mirrorAction: stage.action,
      mirrorLevel: stage.level,
      requesterMustAct: true,
    };
  });
}

/** Maps a payment's urgency onto an approval priority, so an overdue bill does not queue as routine. */
export function recurringMirrorPriority(payment: PaymentObligation, today: Date = new Date()): EApprovalPriority {
  if (payment.priority === 'Critical') return 'Urgent';
  if (payment.priority === 'High') return 'High';
  const due = new Date(`${payment.dueDate}T00:00:00`);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((due.getTime() - midnight.getTime()) / 86_400_000);
  if (days < 0) return 'Urgent';
  if (days <= 3) return 'High';
  return 'Normal';
}

/* ------------------------------------------------------------------------------------------------
 * Positions
 * ---------------------------------------------------------------------------------------------- */

/**
 * Where the payment stands in the stage list.
 *
 * `currentApprovalLevel` is only consulted on a step that actually has levels — it is left at 1 on
 * every ordinary step, and reading it there would match the wrong stage the moment a workflow grew a
 * second approval step.
 */
export function recurringSourcePosition(
  payment: PaymentObligation,
  stages: RecurringMirrorStage[],
  /**
   * The full workflow, in order. Only needed under 'Decision' scope, where the chain has gaps — see
   * `workflowIndex`. Omitting it is safe for a chain that mirrors every step, since then every step
   * the payment can be at is a stage.
   */
  workflow?: Array<{ id: string }>,
): EApprovalMirrorPosition {
  if (payment.workflowStatus === 'Completed' || payment.status === 'Closed') {
    return { index: stages.length, closed: true, outcome: 'Approved' };
  }
  if (payment.workflowStatus === 'Rejected' || payment.status === 'Rejected') {
    return { index: -1, closed: true, outcome: 'Rejected' };
  }
  if (payment.status === 'Cancelled') return { index: -1, closed: true, outcome: 'Cancelled' };
  if (!payment.currentStepId) return { index: -1, closed: false };

  const level = Number(payment.currentApprovalLevel || 1);
  const index = stages.findIndex(
    (stage) => stage.stepId === payment.currentStepId && (stage.level == null || stage.level === level),
  );
  if (index >= 0) return { index, closed: false };

  // The payment is at a step this chain does not mirror — under 'Decision' scope that is most of its
  // life. It has not reached the next stage yet, so it stands *at* that stage rather than off the
  // chain: the approval waiting there is waiting correctly, and reading this as "the approval has
  // run ahead" would have the reconciler try to walk the payment through steps it is not at.
  const here = workflow?.findIndex((step) => step.id === payment.currentStepId) ?? -1;
  if (here < 0) return { index: -1, closed: false };
  const next = stages.findIndex((stage) => stage.workflowIndex > here);
  return { index: next >= 0 ? next : stages.length, closed: false };
}

/**
 * Where the approval chain stands in the same list.
 *
 * "Standing at stage N" means N is the first stage still open — not the first stage with an *active*
 * step, which would read a request paused for a clarification as having no position at all and let
 * the payment be walked forward past a question nobody has answered.
 */
export function recurringApprovalPosition(
  request: { status: string; returnResumeStepId?: string | null },
  steps: Array<Pick<EApprovalStepRecord, 'id' | 'status' | 'reopened' | 'mirrorStepId' | 'mirrorLevel'>>,
  stages: RecurringMirrorStage[],
): EApprovalMirrorPosition {
  if (request.status === 'Approved') return { index: stages.length, closed: true, outcome: 'Approved' };
  if (request.status === 'Rejected') return { index: -1, closed: true, outcome: 'Rejected' };
  if (request.status === 'Cancelled') return { index: -1, closed: true, outcome: 'Cancelled' };

  const byId = new Map(steps.map((step) => [step.id, step]));
  const openIds = new Set(
    steps
      .filter((step) => ['Pending', 'Active', 'On Hold', 'Awaiting Verification', 'Awaiting Clarification'].includes(step.status))
      .map((step) => step.id),
  );

  /**
   * Did the chain reach a later stage and come back?
   *
   * A stage the chain has never seen has no completed step and is not marked reopened; a stage it
   * passed and was sent back through has one or the other. That is the only reliable difference
   * between "returned" and "not started yet", and getting it wrong in the second direction would
   * send a healthy payment backwards every time a mirror was created after the fact.
   */
  const returnedFrom = (index: number) =>
    request.status === 'Returned' ||
    stages.slice(index + 1).some((stage) =>
      stage.approvalStepIds.some((id) => {
        const step = byId.get(id);
        return Boolean(step && (step.reopened || step.status === 'Completed' || step.status === 'Returned'));
      }),
    );

  const index = stages.findIndex((stage) => stage.approvalStepIds.some((id) => openIds.has(id)));
  if (index >= 0) return { index, closed: false, returned: returnedFrom(index) };

  // Returned to the requester: no step is open, but the file has very much gone backwards. It
  // resumes at the step it was returned from, so that is the stage the payment must come back to.
  if (request.status === 'Returned') {
    const resumeIndex = request.returnResumeStepId
      ? stages.findIndex((stage) => stage.approvalStepIds.includes(request.returnResumeStepId as string))
      : 0;
    return { index: Math.max(0, resumeIndex), closed: false, returned: true };
  }
  // Nothing open and not terminal — the chain has run out, which is an approval in all but name.
  return { index: stages.length, closed: false };
}

/** The stage list in the shape `planEApprovalMirrorSync` reads. */
export function recurringMirrorPlanStages(stages: RecurringMirrorStage[]) {
  return stages.map((stage) => ({
    stepId: stage.stepId,
    action: stage.action ?? '',
    level: stage.level,
    approvalStepIds: stage.approvalStepIds,
  }));
}

/* ------------------------------------------------------------------------------------------------
 * Eligibility
 * ---------------------------------------------------------------------------------------------- */

/**
 * Whether an obligation should have a mirrored approval at all.
 *
 * Checked on every sync rather than only at generation, so turning the bridge off stops new mirrors
 * immediately and turning it on picks up payments already in flight — an organization that switches
 * this on mid-month should not have to wait a cycle to see anything.
 */
export function shouldMirrorRecurringPayment(
  payment: PaymentObligation,
  settings: RecurringEApprovalSettings,
): boolean {
  if (!settings.enabled) return false;
  if (payment.deleted) return false;
  if (payment.eApproval?.detachedAt) return false;
  // Nothing left to approve. A closed payment keeps whatever approval it already had — the trail is
  // the point — it just never grows a new one.
  if (['Closed', 'Cancelled', 'Rejected', 'Waived'].includes(payment.status)) return false;
  if (payment.workflowStatus === 'Completed' || payment.workflowStatus === 'Rejected') return false;
  // Not yet in anybody's hands. Mirroring here would raise a note-sheet for work that has not started.
  if (!payment.currentStepId) return false;
  const amount = Number(payment.billAmount || payment.expectedAmount || 0);
  return amount >= Number(settings.minAmount || 0);
}

/**
 * The mirror's state said in the payment module's vocabulary rather than the approval module's.
 *
 * A five-step obligation whose first step is done is at "Bill Verification" — it is not "Pending
 * Verification", and it is certainly not "Approved". E-Approval's own words are right for E-Approval
 * (its chain really has approved everything asked of it) but wrong on a payment row, where the
 * question is which step the payment has reached and whether the workflow has finished. Translating
 * here rather than renaming anything in the approval engine keeps each module honest in its own
 * terms.
 */
export function recurringMirrorLabel(
  mirror: { status?: string; stageName?: string; detachedAt?: unknown } | undefined | null,
): string {
  if (!mirror) return '';
  if (mirror.detachedAt) return 'Unlinked';
  switch (mirror.status) {
    // The chain has cleared every stage, which for a mirrored workflow means the work is done.
    case 'Approved':
      return 'Completed';
    case 'Rejected':
      return 'Rejected';
    case 'Cancelled':
      return 'Cancelled';
    default:
      return mirror.stageName || mirror.status || '';
  }
}

/** Whether the mirror has finished — nothing further will happen on the approval side. */
export function isRecurringMirrorClosed(mirror: { status?: string } | undefined | null): boolean {
  return ['Approved', 'Rejected', 'Cancelled'].includes(String(mirror?.status));
}

/** The approval's subject line — what an approver sees before they open anything. */
export function recurringMirrorSubject(payment: PaymentObligation): string {
  return `${payment.title}${payment.vendorName ? ` — ${payment.vendorName}` : ''}`;
}

/** The proposal body: everything an approver needs to decide without opening the payment. */
export function recurringMirrorBody(payment: PaymentObligation): string {
  const amount = Number(payment.billAmount || payment.expectedAmount || 0);
  const lines = [
    `Recurring payment obligation for ${payment.category || 'an uncategorised head'}.`,
    '',
    `Vendor: ${payment.vendorName || '—'}`,
    `Billing period: ${payment.billingPeriodStart} to ${payment.billingPeriodEnd}`,
    `Due date: ${payment.dueDate}`,
    `Amount: ${amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}${
      payment.billAmount ? ' (billed)' : ' (estimated — bill not yet received)'
    }`,
  ];
  if (payment.billNumber) lines.push(`Bill number: ${payment.billNumber}`);
  if (payment.varianceWarning) {
    lines.push(
      '',
      `⚠ Variance ${Number(payment.variancePercent || 0).toFixed(1)}% against a baseline of ${Number(
        payment.varianceBaseline || 0,
      ).toLocaleString('en-IN')}${payment.amountLimitExceeded ? ', and above the master’s maximum limit' : ''}.`,
    );
  }
  if (payment.description) lines.push('', payment.description);
  return lines.join('\n');
}
