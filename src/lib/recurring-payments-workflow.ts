/**
 * Workflow assignment and activation for the Recurring Payments module.
 *
 * Deliberately dependency-free — no Firestore SDK, no React — for the same reason as
 * `recurring-payments-schedule.ts`: the same decisions run in the browser (the "Generate now" and
 * "Generate all" actions, the workflow-stage view) and in the Admin-SDK cron route, and this is the
 * path in the module that has regressed most often. Keeping it loadable outside a bundler is what
 * makes it directly unit-testable.
 *
 * Types come from `recurring-payments.ts` as type-only imports, which are erased at runtime, so
 * there is no runtime cycle back to that module (and no dependency on the Firestore client helper
 * it re-exports).
 */

import type {
  PaymentObligation,
  PaymentStatus,
  RecurringAmountAssignee,
  RecurringWorkflowStep,
} from './recurring-payments';
import type { EApprovalMirrorMode } from './e-approval-link';

const DAY_MS = 86_400_000;

/**
 * Parses a `YYYY-MM-DD` string as a local date. Deliberately a local copy of the schedule module's
 * identical three-line helper: importing it would give this module a runtime dependency, and the
 * whole point of the split is that this file loads standalone so the activation rules can be
 * tested. Three lines of date parsing is a much smaller risk than an untested activation decision.
 */
function localDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** The timing fields an obligation needs for its workflow to be scheduled; a structural subset of `PaymentObligation`. */
export interface ActivationTimingPayment {
  dueDate: string;
  expectedBillDate?: string;
}

/**
 * Whether an obligation should be in its workflow's first step by `today`.
 *
 * Two triggers, whichever comes first:
 *
 * 1. **Its bill is expected.** The first step is Bill Collection, and that step has real work to do
 *    the moment the vendor's bill exists. This is the trigger that matters under arrears billing,
 *    where the gap between bill date and due date is routinely wider than an organization's
 *    activation window — a telecom bill raised on the 18th and due on the 5th is 18 days apart, so
 *    a 7-day window left the obligation sitting Scheduled and *unassigned* for eleven days, through
 *    exactly the period its owner was meant to be chasing the bill. Anchoring only to the due date
 *    also made the master's own lead time pointless: the record was created early, then hidden.
 * 2. **Its due date is inside the organization's activation window.** Retained as the backstop for
 *    obligations with no expected bill date at all — manual payments, and anything generated before
 *    the bill date became computable — which must keep behaving exactly as they did.
 *
 * Both the client generate actions and the Admin-SDK cron sweep call this; those two had already
 * drifted into separate inline copies of the due-date rule.
 */
export function isWorkflowActivationDue(
  payment: ActivationTimingPayment,
  options: { activationDays: number; today: Date },
): boolean {
  // Callers pass `new Date()`, so normalize to midnight before any day arithmetic — otherwise the
  // time of day skews the rounding and activation can land a day early or late.
  const today = new Date(options.today.getFullYear(), options.today.getMonth(), options.today.getDate());
  if (payment.expectedBillDate && localDate(payment.expectedBillDate) <= today) return true;
  return Math.round((localDate(payment.dueDate).getTime() - today.getTime()) / DAY_MS) <= options.activationDays;
}

export type AssigneeResolutionPayment = Pick<PaymentObligation,
  'assignedTo' | 'backupAssignedTo' | 'verifierId' | 'approverId' | 'accountsProcessorId' |
  'billAmount' | 'expectedAmount' | 'approvalLevels' | 'approvalMode' | 'approvalCompletedBy' | 'currentApprovalLevel'>;

/**
 * Resolves which user id(s) a workflow step's task should be assigned to for a given payment
 * obligation, based on the step's configured assignment type — and, for approval steps, the
 * approval rule already matched onto the obligation, which takes priority over the step's own
 * amount ranges. Shared by the automated workflow-activation route (moving a "Scheduled"
 * obligation into its first step) and the client "advance to next step" action, so both agree
 * on exactly who a step belongs to and both benefit from the same fallbacks (e.g. falling back
 * to a master's backup assignee when no primary owner is resolvable).
 */
export function resolveAssignees(step: RecurringWorkflowStep, payment: AssigneeResolutionPayment): string[] {
  if (step.name.toLowerCase().includes('approval') && payment.approvalLevels?.length) {
    if (payment.approvalMode === 'Parallel') {
      const completed = payment.approvalCompletedBy || [];
      return payment.approvalLevels.filter(userId => !completed.includes(userId));
    }
    return [payment.approvalLevels[Math.max(0, Number(payment.currentApprovalLevel || 1) - 1)]].filter(Boolean);
  }
  if (step.assignmentType === 'Payment-owner') {
    if (payment.assignedTo) return [payment.assignedTo];
    if (payment.backupAssignedTo) return [payment.backupAssignedTo];
    return [];
  }
  if (step.assignmentType === 'User-based') {
    const configured = (step.assignedTo as string[]).filter(Boolean);
    if (configured.length) return configured;
    const name = step.name.toLowerCase();
    if (name.includes('verification') && payment.verifierId) return [payment.verifierId];
    if (name.includes('approval') && payment.approverId) return [payment.approverId];
    if ((name.includes('processing') || name.includes('receipt') || name.includes('closure')) && payment.accountsProcessorId) return [payment.accountsProcessorId];
    return [];
  }
  const amount = Number(payment.billAmount || payment.expectedAmount || 0);
  const match = (step.assignedTo as RecurringAmountAssignee[]).find(rule => amount >= Number(rule.minAmount || 0) && amount <= (rule.maxAmount == null ? Number.POSITIVE_INFINITY : Number(rule.maxAmount)));
  if (match) return [match.userId, match.alternativeUserId].filter(Boolean) as string[];
  if (step.name.toLowerCase().includes('approval') && payment.approverId) return [payment.approverId];
  return [];
}

/**
 * Assignees for the workflow's **entry** step, falling back to the payment's own owner when the
 * step's configuration resolves nobody.
 *
 * Without the fallback, a first step configured as "User-based" with no users chosen — the state a
 * workflow is in until an admin fills it in — silently resolved to nobody, so generation left the
 * obligation at "Scheduled" with an empty assignee list. That is invisible work: it appears in no
 * queue, nobody is accountable, and the only signal is an audit line. Assigning it to the master's
 * designated owner is strictly better; they are the person answerable for the payment anyway.
 *
 * Deliberately separate from `resolveAssignees` and used only for workflow entry. Applying the same
 * fallback to a mid-workflow step would be wrong — routing an unconfigured *approval* step to the
 * payment owner would let them approve their own bill.
 */
export function resolveEntryAssignees(step: RecurringWorkflowStep, payment: AssigneeResolutionPayment): string[] {
  const configured = resolveAssignees(step, payment);
  if (configured.length) return configured;
  return [payment.assignedTo || payment.backupAssignedTo].filter(Boolean) as string[];
}

/**
 * Maps a workflow step to the payment obligation status it represents while sitting at that
 * step. Shared by workflow activation (server cron and client "Generate now" flows) and the
 * client workflow-stage view, so a payment's status always agrees with which step it's actually
 * on — note this only covers the 5 default step names; a custom step name that doesn't match any
 * of these falls back to the generic 'Generated'.
 */
export function stepStatus(step?: RecurringWorkflowStep): PaymentStatus {
  const name = step?.name.toLowerCase() || '';
  if (name.includes('bill collection')) return 'Awaiting Bill';
  if (name.includes('verification')) return 'Under Verification';
  if (name.includes('approval')) return 'Pending Approval';
  if (name.includes('processing')) return 'Payment Processing';
  if (name.includes('receipt') || name.includes('closure')) return 'Paid';
  return 'Generated';
}

/* ------------------------------------------------------------------------------------------------
 * Routing an action through the workflow
 * ---------------------------------------------------------------------------------------------- */

/** Actions that move an obligation *forward* when they succeed, as opposed to parking or ending it. */
export const RECURRING_FORWARD_ACTIONS = ['Submit Bill', 'Verify', 'Approve', 'Record Payment', 'Close', 'Create Expense Request'];

/**
 * Actions that need data only the Recurring Payments form can collect — a bill number, a UTR, an
 * expense-request department. A step offering any of these cannot be completed from another module's
 * screen, whatever that screen thinks it is approving.
 */
export const RECURRING_DATA_ENTRY_ACTIONS = ['Submit Bill', 'Record Payment', 'Create Expense Request'];

/** The state a routing decision reads. A structural subset of `PaymentObligation`. */
export type RoutingPayment = AssigneeResolutionPayment & {
  status: PaymentStatus;
  assignees?: string[];
  finalAccountsVerification?: boolean;
};

export interface RouteRecurringWorkflowInput {
  /** The configured workflow, in order. */
  workflow: RecurringWorkflowStep[];
  /** The step the action is being taken at. */
  step: RecurringWorkflowStep;
  action: string;
  payment: RoutingPayment;
  /** Who is acting — recorded against a sequential/parallel approval level. */
  actorId: string;
  /**
   * Whether the action itself completed the step's work. Only "Record Payment" ever passes `false`
   * with a forward action: a part-settlement is a forward action that has not finished yet, and the
   * caller is the only one that knows the arithmetic. Defaults to whether `action` is forward.
   */
  advance?: boolean;
  /** The status the payment already has after the caller's own field updates (part-payment sets 'Partially Paid'). */
  baseStatus?: PaymentStatus;
}

export interface RouteRecurringWorkflowResult {
  workflowStatus: NonNullable<PaymentObligation['workflowStatus']>;
  status: PaymentStatus;
  /** The readable stage label written to `payment.stage`. */
  stage: string;
  currentStepId: string | null;
  assignees: string[];
  currentApprovalLevel: number;
  approvalCompletedBy: string[];
  /** The workflow step the payment ends up at — undefined when it left the chain. */
  target?: RecurringWorkflowStep;
  /** Step id for the "open your queue" deep link; empty once the payment has left the chain. */
  destinationStepId: string;
  /** Who to notify. Empty when the payment stayed exactly where it was. */
  notify: string[];
}

/**
 * Decides where an obligation goes when an action is taken on it, and who holds it next.
 *
 * Extracted from the workflow-stage screen because it stopped being that screen's business the
 * moment a second caller existed: the E-Approval mirror has to move a payment forward on exactly the
 * same rules when an approver acts from the other module, and a second inline copy of "advance,
 * unless it's a sequential approval with levels remaining, unless final accounts verification is
 * off…" would be wrong within a release. Pure and dependency-free, for the reason the rest of this
 * module is: these are the decisions worth testing.
 *
 * Throws when the step it would move to has nobody on it. Deliberately loud — an obligation parked at
 * a step with an empty assignee list is invisible work, and refusing the transition leaves it
 * somewhere a person is still accountable for it.
 */
export function routeRecurringWorkflow(input: RouteRecurringWorkflowInput): RouteRecurringWorkflowResult {
  const { workflow, step, action, payment, actorId } = input;
  let advance = input.advance ?? RECURRING_FORWARD_ACTIONS.includes(action);
  let workflowStatus: RouteRecurringWorkflowResult['workflowStatus'] = 'In Progress';
  let status = input.baseStatus ?? payment.status;
  let currentStepId: string | null = step.id;
  let assignees = payment.assignees || [];
  let currentApprovalLevel = Number(payment.currentApprovalLevel || 1);
  let approvalCompletedBy = payment.approvalCompletedBy || [];
  let target: RecurringWorkflowStep | undefined;
  let stage = step.name;
  let destinationStepId = step.id;
  let notify: string[] = [];

  // An approval step with a matched rule collects one decision per level, so it can be entered once
  // and left several actions later — the step does not move until the last level has signed.
  const isApproval = step.name.toLowerCase().includes('approval') && action === 'Approve' && payment.approvalLevels?.length;
  if (isApproval && payment.approvalMode === 'Sequential' && currentApprovalLevel < payment.approvalLevels!.length) {
    currentApprovalLevel += 1;
    assignees = [payment.approvalLevels![currentApprovalLevel - 1]];
    approvalCompletedBy = [...new Set([...approvalCompletedBy, actorId])];
    stage = `${step.name} · Level ${currentApprovalLevel}`;
    notify = assignees;
    advance = false;
  } else if (isApproval && payment.approvalMode === 'Parallel') {
    approvalCompletedBy = [...new Set([...approvalCompletedBy, actorId])];
    assignees = payment.approvalLevels!.filter((id) => !approvalCompletedBy.includes(id));
    advance = assignees.length === 0;
    if (!advance) {
      stage = `${step.name} · ${assignees.length} approval(s) remaining`;
      notify = assignees;
    }
  }

  if (advance) {
    target = workflow[workflow.findIndex((item) => item.id === step.id) + 1];
    // An organization that does not run a separate receipt/closure check ends the workflow at the
    // payment itself rather than parking it at a step nobody is meant to work.
    if (action === 'Record Payment' && target && (target.name.toLowerCase().includes('receipt') || target.name.toLowerCase().includes('closure')) && payment.finalAccountsVerification === false) target = undefined;
    if (target) {
      currentStepId = target.id;
      assignees = resolveAssignees(target, { ...payment, currentApprovalLevel, approvalCompletedBy });
      if (!assignees.length) throw new Error(`No assignee is configured for ${target.name}.`);
      status = stepStatus(target);
      stage = target.name;
      destinationStepId = target.id;
      notify = assignees;
    } else {
      workflowStatus = 'Completed';
      status = 'Closed';
      currentStepId = null;
      assignees = [];
      stage = 'Completed';
      destinationStepId = '';
    }
  } else if (action === 'Return for Correction') {
    target = workflow[Math.max(0, workflow.findIndex((item) => item.id === step.id) - 1)];
    currentStepId = target.id;
    // Returning *into* an approval step restarts it: the levels that had already signed did so
    // against figures the correction is about to change.
    if (target.name.toLowerCase().includes('approval')) {
      currentApprovalLevel = 1;
      approvalCompletedBy = [];
    }
    assignees = resolveAssignees(target, { ...payment, currentApprovalLevel, approvalCompletedBy });
    if (!assignees.length) throw new Error(`No assignee is configured for ${target.name}.`);
    status = stepStatus(target);
    stage = target.name;
    destinationStepId = target.id;
    notify = assignees;
  } else if (action === 'Reject') {
    workflowStatus = 'Rejected';
    status = 'Rejected';
    currentStepId = null;
    assignees = [];
    stage = 'Rejected';
    destinationStepId = '';
  } else if (!RECURRING_FORWARD_ACTIONS.includes(action)) {
    status = action === 'Dispute' ? 'Disputed' : action === 'Payment Failed' ? 'Payment Failed' : 'On Hold';
  }

  return { workflowStatus, status, stage, currentStepId, assignees, currentApprovalLevel, approvalCompletedBy, target, destinationStepId, notify };
}

/**
 * How a step behaves when it is mirrored into E-Approval.
 *
 * Derived from the step's own configured actions rather than set by hand, so an administrator who
 * adds "Record Payment" to a step cannot leave behind a mirror that offers to approve it from a
 * screen with no field for the UTR. A step that can only be completed with data the Recurring
 * Payments form collects is 'Visibility': shown, notified, linked back — but not decidable there.
 */
export function recurringMirrorMode(step: RecurringWorkflowStep): EApprovalMirrorMode {
  const actions = step.actions || [];
  if (actions.some((action) => RECURRING_DATA_ENTRY_ACTIONS.includes(action))) return 'Visibility';
  return actions.some((action) => action === 'Approve' || action === 'Verify' || action === 'Close') ? 'Decision' : 'Visibility';
}

/**
 * The action a mirrored E-Approval stage applies back to the payment when it is approved.
 *
 * Prefers the step's own decision verb, so a "Bill Verification" step verifies rather than approves
 * and the payment's status line stays truthful. Undefined for a 'Visibility' step, which is never
 * completed from E-Approval at all.
 */
export function recurringMirrorAction(step: RecurringWorkflowStep): string | undefined {
  if (recurringMirrorMode(step) !== 'Decision') return undefined;
  return ['Approve', 'Verify', 'Close'].find((action) => (step.actions || []).includes(action));
}

export type WorkflowActivation = {
  assignees: string[];
  status: PaymentStatus;
  workflowStatus: 'In Progress';
  stage: string;
  currentStepId: string;
  workflowDeadlineMs: number;
};

/**
 * Decides whether a payment obligation should enter the workflow's first step right now — per
 * `isWorkflowActivationDue`, i.e. its bill is expected or its due date is inside the organization's
 * activation window — and, if so, who it should be assigned to.
 *
 * This exists so a manually-generated obligation (the "Generate now" actions on the master form
 * and master detail pages) doesn't sit at status "Scheduled" with no owner until the next daily
 * automation run happens to pick it up — previously that was the *only* path that ever moved an
 * obligation into a workflow step, so a master due soon enough to be actionable immediately
 * still silently waited (up to 24h, or forever if nobody ever runs automation) before its owner
 * could see it. Returns null when the obligation isn't due soon enough yet, or when no assignee
 * can be resolved even after the owner fallback — callers should leave the obligation "Scheduled"
 * in either case, and should distinguish the two when reporting back, since one resolves itself
 * with time and the other needs someone to fix the configuration.
 *
 * This function is pure and has no Firestore access, so `workflowDeadlineMs` here is only a naive
 * calendar-hour approximation (used as-is by the Automation Health report's preview, which only
 * checks whether activation is possible at all, not the exact deadline). Callers that actually
 * *write* the obligation should instead recompute the real deadline with `addBusinessHours`
 * (from `./working-hours`) against the org's configured working hours/holidays — loaded via
 * `recurring-payments.ts`'s re-exported `loadWorkingCalendar` — and use that value instead.
 */
export function resolveWorkflowActivation(
  step: RecurringWorkflowStep | undefined,
  payment: AssigneeResolutionPayment & ActivationTimingPayment,
  options: { activationDays: number; today: Date },
): WorkflowActivation | null {
  if (!step) return null;
  if (!isWorkflowActivationDue(payment, options)) return null;
  const assignees = resolveEntryAssignees(step, payment);
  if (!assignees.length) return null;
  return {
    assignees,
    status: stepStatus(step),
    workflowStatus: 'In Progress',
    stage: step.name,
    currentStepId: step.id,
    workflowDeadlineMs: Date.now() + Math.max(1, step.tat) * 3_600_000,
  };
}
