/**
 * The bill workflow as configuration (Settings → Workflow).
 *
 * The stages are fixed — Draft → Submitted → Under verification → Verified → Approved → Bill raised →
 * Certified by client → Payment follow-up → Reconciliation → Closed — because reports, ageing and
 * the receipt rule read them. What is configured, per stage:
 *
 * - **Used or not.** Submitted, Under verification, Verified and Approved are optional; a switched-off
 *   stage is skipped (its button is not offered, and a returned bill steps back past it).
 * - **Done by.** Who moves a bill *into* the stage — anyone holding the role permission (the
 *   default), named people, or the bill's collection owner. Being named is itself the authority:
 *   a named person needs no role permission and no project grant to do that stage. "Only them"
 *   takes the permission holders out.
 * - **Notify.** The named people hear when a bill is waiting for them.
 *
 * "Waiting for" a bill = the people of the next stage it will move into. Pure: the API, the screens
 * and the tests apply the same rules.
 */

import { WORKFLOW_PATH } from './calculations.ts';
import { WORKFLOW_STATUS_LABELS, type Bill, type BillTrackingSettings, type BillWorkflowStatus, type WorkflowStepSetting } from './types.ts';

export const WORKFLOW_ACTIONS = ['submit', 'start_verification', 'verify', 'approve', 'raise', 'start_followup', 'reconcile', 'close', 'resubmit', 'reopen', 'return'] as const;
export type WorkflowActionName = (typeof WORKFLOW_ACTIONS)[number];

export interface WorkflowActionRule {
  label: string;
  from: readonly BillWorkflowStatus[];
  /** `resubmit` = back to the step before the one that returned it. */
  to: BillWorkflowStatus | 'resubmit';
  /** The role permission that allows it when nobody is named (or alongside the named people). */
  permission: [resource: 'Bills', action: string];
  tone?: 'danger';
}

export const WORKFLOW_ACTION_RULES: Record<WorkflowActionName, WorkflowActionRule> = {
  submit: { label: 'Submit', from: ['draft'], to: 'submitted', permission: ['Bills', 'Edit'] },
  start_verification: { label: 'Start verification', from: ['submitted'], to: 'under_verification', permission: ['Bills', 'Verify'] },
  verify: { label: 'Verify', from: ['submitted', 'under_verification'], to: 'verified', permission: ['Bills', 'Verify'] },
  approve: { label: 'Approve', from: ['submitted', 'under_verification', 'verified'], to: 'approved', permission: ['Bills', 'Approve'] },
  raise: { label: 'Mark bill raised', from: ['draft', 'submitted', 'under_verification', 'verified', 'approved'], to: 'raised', permission: ['Bills', 'Edit'] },
  start_followup: { label: 'Start payment follow-up', from: ['raised', 'certified'], to: 'payment_followup', permission: ['Bills', 'Edit'] },
  reconcile: { label: 'Send to reconciliation', from: ['raised', 'certified', 'payment_followup'], to: 'reconciliation', permission: ['Bills', 'Verify'] },
  close: { label: 'Close bill', from: ['raised', 'certified', 'payment_followup', 'reconciliation'], to: 'closed', permission: ['Bills', 'Approve'] },
  resubmit: { label: 'Resubmit after correction', from: ['returned'], to: 'resubmit', permission: ['Bills', 'Edit'] },
  reopen: { label: 'Reopen', from: ['closed'], to: 'payment_followup', permission: ['Bills', 'Approve'] },
  return: { label: 'Return for correction', from: ['submitted', 'under_verification', 'verified', 'approved'], to: 'returned', permission: ['Bills', 'Verify'], tone: 'danger' },
};

/** Stages with their own settings — every stage a bill can be moved into (Draft is where it starts). */
export const CONFIGURABLE_STEPS: readonly BillWorkflowStatus[] = WORKFLOW_PATH.filter((status) => status !== 'draft');
/** Stages that can be switched off. */
export const OPTIONAL_STEPS: readonly BillWorkflowStatus[] = ['submitted', 'under_verification', 'verified', 'approved'];

/** The role permission each stage falls back to: what the action into it needs. */
export const STEP_PERMISSION: Record<string, string> = {
  submitted: 'Bills · Edit',
  under_verification: 'Bills · Verify',
  verified: 'Bills · Verify',
  approved: 'Bills · Approve',
  raised: 'Bills · Edit',
  certified: 'Bills · Certify',
  payment_followup: 'Bills · Edit',
  reconciliation: 'Bills · Verify',
  closed: 'Bills · Approve',
};

export const defaultWorkflowStep = (status: BillWorkflowStatus): WorkflowStepSetting => ({ status, enabled: true, assignment: 'permission', userIds: [], onlyAssigned: false, notify: true });

/** One setting per configurable stage, in workflow order; anything missing or stray is repaired. */
export function normaliseWorkflowSteps(stored: readonly Partial<WorkflowStepSetting>[] | undefined): WorkflowStepSetting[] {
  return CONFIGURABLE_STEPS.map((status) => {
    const saved = stored?.find((entry) => entry.status === status);
    const step = { ...defaultWorkflowStep(status), ...(saved ?? {}), status };
    return {
      ...step,
      // Only the optional stages can be switched off.
      enabled: OPTIONAL_STEPS.includes(status) ? step.enabled !== false : true,
      userIds: [...new Set((step.userIds ?? []).filter(Boolean))],
      onlyAssigned: Boolean(step.onlyAssigned),
      notify: step.notify !== false,
    };
  });
}

type WorkflowSettings = Pick<BillTrackingSettings, 'workflowSteps'> | undefined;

export function workflowStep(settings: WorkflowSettings, status: BillWorkflowStatus): WorkflowStepSetting {
  return settings?.workflowSteps?.find((entry) => entry.status === status) ?? defaultWorkflowStep(status);
}

export const isStepEnabled = (settings: WorkflowSettings, status: BillWorkflowStatus): boolean => !OPTIONAL_STEPS.includes(status) || workflowStep(settings, status).enabled;

/** The named people of a stage for this bill (none when the stage is left to permission holders). */
export function stepDoers(step: WorkflowStepSetting, bill: Pick<Bill, 'collectionOwnerId'>): string[] {
  if (step.assignment === 'permission') return [];
  const ids = step.assignment === 'collection_owner' ? [bill.collectionOwnerId, ...step.userIds] : step.userIds;
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/** The next stage in use after this one (skipping switched-off optional stages), or null at the end. */
export function nextStepAfter(status: BillWorkflowStatus, settings: WorkflowSettings): BillWorkflowStatus | null {
  const index = WORKFLOW_PATH.indexOf(status);
  if (index < 0) return null;
  return WORKFLOW_PATH.slice(index + 1).find((candidate) => isStepEnabled(settings, candidate)) ?? null;
}

/** Where a corrected bill goes: the step in use before the one that returned it (Draft at the earliest). */
export function resubmitTo(returnedFrom: BillWorkflowStatus | undefined, settings: WorkflowSettings): BillWorkflowStatus {
  const index = returnedFrom ? WORKFLOW_PATH.indexOf(returnedFrom) : -1;
  for (let at = index - 1; at > 0; at -= 1) if (isStepEnabled(settings, WORKFLOW_PATH[at])) return WORKFLOW_PATH[at];
  return 'draft';
}

/** The stage whose people decide on an action: the stage it moves into; for Return, the stage that would have come next. */
function governingStep(action: WorkflowActionName, bill: Pick<Bill, 'workflowStatus'>, settings: WorkflowSettings): BillWorkflowStatus | null {
  if (action === 'resubmit') return null;
  if (action === 'return') return nextStepAfter(bill.workflowStatus, settings);
  if (action === 'reopen') return 'closed';
  return WORKFLOW_ACTION_RULES[action].to as BillWorkflowStatus;
}

export interface WorkflowActor {
  userId: string;
  /** The role-permission check (on the bill's project when given). */
  can: (resource: string, action: string, projectId?: string) => boolean;
}

type ActionBill = Pick<Bill, 'workflowStatus' | 'projectId' | 'collectionOwnerId' | 'createdBy' | 'isDeleted'>;

const stepLabel = (status: BillWorkflowStatus) => WORKFLOW_STATUS_LABELS[status];

/** Why this person cannot take this action on this bill now, or null if they can. */
export function actionBlocked(action: WorkflowActionName, bill: ActionBill, settings: WorkflowSettings, actor: WorkflowActor): string | null {
  const rule = WORKFLOW_ACTION_RULES[action];
  if (bill.isDeleted) return 'This bill has been deleted.';
  if (!rule.from.includes(bill.workflowStatus)) return `A ${stepLabel(bill.workflowStatus).toLowerCase()} bill cannot be moved by “${rule.label}”.`;
  if (rule.to !== 'resubmit' && rule.to !== 'returned' && !isStepEnabled(settings, rule.to)) return `${stepLabel(rule.to)} is switched off in Settings → Workflow.`;

  const governing = governingStep(action, bill, settings);
  const step = governing ? workflowStep(settings, governing) : null;
  const doers = step ? stepDoers(step, bill) : [];
  // Named on the stage: that is the authority — no role permission or project grant needed.
  if (doers.includes(actor.userId)) return null;
  if (action === 'resubmit' && bill.createdBy === actor.userId) return null;
  if (step && step.onlyAssigned && doers.length) return `Only the people assigned to “${stepLabel(step.status)}” in Settings → Workflow can do this.`;
  if (actor.can(rule.permission[0], rule.permission[1], bill.projectId)) return null;
  return `${rule.label} needs the Bill Tracking · ${rule.permission[0]} · ${rule.permission[1]} permission${step ? `, or being assigned to “${stepLabel(step.status)}” in Settings → Workflow` : ''}.`;
}

/** The workflow buttons this person gets on this bill, in display order. */
export function availableActions(bill: ActionBill, settings: WorkflowSettings, actor: WorkflowActor): { action: WorkflowActionName; label: string; tone?: 'danger' }[] {
  return WORKFLOW_ACTIONS.filter((action) => actionBlocked(action, bill, settings, actor) === null).map((action) => ({ action, label: WORKFLOW_ACTION_RULES[action].label, tone: WORKFLOW_ACTION_RULES[action].tone }));
}

/** Recording (or changing, or removing) the client's certification is the Certified stage's job. */
export function certificationBlocked(bill: Pick<Bill, 'projectId' | 'collectionOwnerId' | 'isDeleted'>, settings: WorkflowSettings, actor: WorkflowActor): string | null {
  if (bill.isDeleted) return 'This bill has been deleted.';
  const step = workflowStep(settings, 'certified');
  const doers = stepDoers(step, bill);
  if (doers.includes(actor.userId)) return null;
  if (step.onlyAssigned && doers.length) return 'Only the people assigned to “Certified by Client” in Settings → Workflow can record the certification.';
  if (actor.can('Bills', 'Certify', bill.projectId)) return null;
  return `Recording the client's certification needs Bill Tracking · Bills · Certify${doers.length ? ', or being assigned to “Certified by Client” in Settings → Workflow' : ''}.`;
}

export interface WaitingFor {
  /** The stage the bill will move into next; null while it is back with the preparer. */
  status: BillWorkflowStatus | null;
  /** The people it is waiting for — empty when the stage is left to permission holders. */
  userIds: string[];
}

/** Who the bill is waiting for now: the people of the next stage in use (the preparer when returned). */
export function waitingFor(bill: Pick<Bill, 'workflowStatus' | 'collectionOwnerId' | 'createdBy' | 'isDeleted'>, settings: WorkflowSettings): WaitingFor | null {
  if (bill.isDeleted || bill.workflowStatus === 'closed') return null;
  if (bill.workflowStatus === 'returned') return { status: null, userIds: bill.createdBy ? [bill.createdBy] : [] };
  const next = nextStepAfter(bill.workflowStatus, settings);
  if (!next) return null;
  return { status: next, userIds: stepDoers(workflowStep(settings, next), bill) };
}

export const isWaitingFor = (bill: Parameters<typeof waitingFor>[0], settings: WorkflowSettings, userId: string): boolean => Boolean(waitingFor(bill, settings)?.userIds.includes(userId));

const ACTION_INTO: Partial<Record<BillWorkflowStatus, WorkflowActionName>> = {
  submitted: 'submit',
  under_verification: 'start_verification',
  verified: 'verify',
  approved: 'approve',
  raised: 'raise',
  payment_followup: 'start_followup',
  reconciliation: 'reconcile',
  closed: 'close',
};

/**
 * Is the bill waiting for this person? Named people of its next stage, when there are any;
 * otherwise whoever holds that stage's permission on the bill's project. A returned bill waits for
 * its preparer.
 */
export function isMyTask(bill: Pick<Bill, 'workflowStatus' | 'collectionOwnerId' | 'createdBy' | 'isDeleted' | 'projectId'>, settings: WorkflowSettings, actor: WorkflowActor): boolean {
  const waiting = waitingFor(bill, settings);
  if (!waiting) return false;
  if (waiting.status === null || waiting.userIds.length) return waiting.userIds.includes(actor.userId);
  if (waiting.status === 'certified') return actor.can('Bills', 'Certify', bill.projectId);
  const action = ACTION_INTO[waiting.status];
  if (!action) return false;
  const [resource, permission] = WORKFLOW_ACTION_RULES[action].permission;
  return actor.can(resource, permission, bill.projectId);
}

/** Named on any stage of this bill's workflow — enough to open the bill and act on it. */
export function isInvolved(bill: Pick<Bill, 'collectionOwnerId'>, settings: WorkflowSettings, userId: string): boolean {
  return CONFIGURABLE_STEPS.some((status) => stepDoers(workflowStep(settings, status), bill).includes(userId));
}

/** Named on any stage at all — lets someone without the module permission into the module for their work. */
export const isNamedInWorkflow = (settings: WorkflowSettings, userId: string): boolean => Boolean(settings?.workflowSteps?.some((step) => step.assignment !== 'permission' && step.userIds.includes(userId)));
