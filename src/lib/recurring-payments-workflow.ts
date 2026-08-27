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
