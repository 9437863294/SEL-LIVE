/**
 * The bill workflow as configuration (Settings → Workflow).
 *
 * The workflow is an ordered list of steps after Draft. A new configuration starts from the default
 * — Submitted → Under verification → Verified → Approved → Bill raised → Certified by client →
 * Payment follow-up → Reconciliation → Closed — and from there:
 *
 * - **Review steps** can be added, renamed, removed and reordered anywhere between Draft and Closed
 *   (the four defaults before Bill raised are review steps too). Each says which permission moves a
 *   bill in (Bills · Edit / Verify / Approve), whether reaching it locks the amounts, and whether a
 *   bill at it can be returned for correction.
 * - **Role steps** — Bill raised, Certified by client, Payment follow-up, Reconciliation, Closed —
 *   have jobs of their own (certification, the receipt rule, closing, reports), so they can be
 *   renamed but not removed, and keep their order among themselves. Payment follow-up and
 *   Reconciliation can be switched off; Closed is always last.
 *
 * For every step: whether it is used, who moves a bill *into* it — anyone holding its permission
 * (the default), named people, or the bill's collection owner; being named is itself the authority —
 * and whether those people are told when a bill is waiting for them.
 *
 * Moving on: up to Bill raised a bill goes only into the next step in use, so it cannot be raised
 * without passing every review step before it. After Bill raised the moves are free (a credit note
 * is never certified; a paid bill may close from wherever it stands). Certified by client is
 * reached by recording the certification, never by a button.
 *
 * A step's id is what a bill stores as its `workflowStatus`, so the default steps keep their keys
 * and existing bills need no migration. Pure: the API, the screens and the tests apply the same rules.
 */

import {
  WORKFLOW_ROLES,
  WORKFLOW_STATUS_LABELS,
  WORKFLOW_STEP_PERMISSIONS,
  type Bill,
  type BillTrackingSettings,
  type BillWorkflowStatus,
  type KnownWorkflowStatus,
  type WorkflowRole,
  type WorkflowStepPermission,
  type WorkflowStepSetting,
} from './types.ts';

/* ── the steps ────────────────────────────────────────────────────────────── */

/** Role steps that cannot be switched off. */
const REQUIRED_ROLES: readonly WorkflowRole[] = ['raised', 'certified', 'closed'];

export const isRoleStep = (status: BillWorkflowStatus): status is WorkflowRole => (WORKFLOW_ROLES as readonly string[]).includes(status);
/** A step that can be switched off: every one but Bill raised, Certified by client and Closed. */
export const isOptionalStep = (status: BillWorkflowStatus): boolean => !(REQUIRED_ROLES as readonly string[]).includes(status);

/** An id for a step added in Settings: lower case, digits and underscores, starting with a letter. */
export const STEP_ID_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

type StepDefaults = Pick<WorkflowStepSetting, 'label' | 'actionLabel' | 'description' | 'permissions' | 'locksAmounts' | 'canReturn'>;

/** The default steps, in order — the workflow before it was configurable. */
const DEFAULT_STEPS: { status: KnownWorkflowStatus; defaults: StepDefaults }[] = [
  { status: 'submitted', defaults: { label: 'Submitted', actionLabel: 'Submit', description: 'Handed over for checking.', permissions: ['Edit'], locksAmounts: false, canReturn: true } },
  { status: 'under_verification', defaults: { label: 'Under Verification', actionLabel: 'Start verification', description: 'Finance is checking the figures and documents.', permissions: ['Verify'], locksAmounts: false, canReturn: true } },
  { status: 'verified', defaults: { label: 'Verified', actionLabel: 'Verify', description: 'Checked.', permissions: ['Verify'], locksAmounts: false, canReturn: true } },
  { status: 'approved', defaults: { label: 'Approved', actionLabel: 'Approve', description: 'Approved. From here amounts, GST and deductions change only with Edit After Approval and a reason.', permissions: ['Approve'], locksAmounts: true, canReturn: true } },
  { status: 'raised', defaults: { label: 'Bill Raised', actionLabel: 'Mark bill raised', description: 'Sent to the client and waiting for their certification.', permissions: ['Edit'], locksAmounts: true, canReturn: false } },
  {
    status: 'certified',
    defaults: {
      label: 'Certified by Client',
      actionLabel: 'Record client certification',
      description: 'The client has certified it. Its certified deductions apply to the bill as they are; only if the client certified a different taxable or GST, raise the credit or debit note the bill page fills in.',
      permissions: ['Certify'],
      locksAmounts: true,
      canReturn: false,
    },
  },
  { status: 'payment_followup', defaults: { label: 'Payment Follow-up', actionLabel: 'Start payment follow-up', description: 'Chasing payment: follow-ups, commitments and receipts.', permissions: ['Edit'], locksAmounts: true, canReturn: false } },
  { status: 'reconciliation', defaults: { label: 'Reconciliation', actionLabel: 'Send to reconciliation', description: 'Checking receipts and deductions against the client’s statement.', permissions: ['Verify'], locksAmounts: true, canReturn: false } },
  { status: 'closed', defaults: { label: 'Closed', actionLabel: 'Close bill', description: 'Settled. The same people can reopen it.', permissions: ['Approve'], locksAmounts: true, canReturn: false } },
];

const DEFAULT_BY_STATUS = new Map<string, StepDefaults>(DEFAULT_STEPS.map((entry) => [entry.status, entry.defaults]));

/** The default steps' ids, in order (Draft excluded) — what a new configuration has. */
export const CONFIGURABLE_STEPS: readonly KnownWorkflowStatus[] = DEFAULT_STEPS.map((entry) => entry.status);

/** A step with every setting at its default; a new review step gets a generic one. */
export function defaultWorkflowStep(status: BillWorkflowStatus, label?: string): WorkflowStepSetting {
  const defaults = DEFAULT_BY_STATUS.get(status) ?? {
    label: label || 'New step',
    actionLabel: `Move to ${label || 'new step'}`,
    description: '',
    permissions: ['Verify'],
    locksAmounts: false,
    canReturn: true,
  };
  return { status, ...defaults, enabled: true, assignment: 'permission', userIds: [], onlyAssigned: false, notify: true };
}

const cleanText = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * The configured steps, in order, repaired: anything missing is filled from the defaults, duplicates
 * and invalid ids are dropped, a missing role step is put back where it belongs, the role steps keep
 * their order among themselves, and Closed is last. Stored settings from before the workflow was
 * configurable (the nine default steps, flags only) come out exactly as the default workflow.
 */
/**
 * One step being edited, with any field it lacks filled from its defaults — a step loaded in an
 * older shape (one `permission`, no rules) — while what is there, a name being retyped included,
 * is kept exactly as typed. For the settings screen; saving goes through `normaliseWorkflowSteps`.
 */
export function completeWorkflowStep(step: Partial<WorkflowStepSetting> & Pick<WorkflowStepSetting, 'status'>): WorkflowStepSetting {
  const base = defaultWorkflowStep(step.status, typeof step.label === 'string' ? step.label : undefined);
  const single = (step as { permission?: unknown }).permission;
  const known = (value: unknown): value is WorkflowStepPermission => typeof value === 'string' && (WORKFLOW_STEP_PERMISSIONS as readonly string[]).includes(value);
  const permissions = Array.isArray(step.permissions) && step.permissions.some(known) ? step.permissions.filter(known) : known(single) ? [single] : base.permissions;
  return {
    ...base,
    ...step,
    label: typeof step.label === 'string' ? step.label : base.label,
    actionLabel: typeof step.actionLabel === 'string' ? step.actionLabel : base.actionLabel,
    description: typeof step.description === 'string' ? step.description : base.description,
    permissions,
    userIds: Array.isArray(step.userIds) ? step.userIds : base.userIds,
  };
}

export function normaliseWorkflowSteps(stored: readonly Partial<WorkflowStepSetting>[] | undefined): WorkflowStepSetting[] {
  // Settings saved before steps had names carry flags for the default steps only — overrides on
  // the default workflow, not a list of its own: every default step stays, in the default order.
  const legacy = Boolean(stored?.length) && (stored ?? []).every((entry) => entry?.label === undefined);
  const source: readonly Partial<WorkflowStepSetting>[] = legacy
    ? DEFAULT_STEPS.map((entry) => ({ ...(stored ?? []).find((saved) => saved?.status === entry.status), status: entry.status }))
    : (stored ?? []);
  const seen = new Set<string>();
  const steps: WorkflowStepSetting[] = [];
  for (const entry of source) {
    const status = entry?.status;
    if (!status || status === 'draft' || status === 'returned' || seen.has(status)) continue;
    if (!DEFAULT_BY_STATUS.has(status) && !STEP_ID_PATTERN.test(status)) continue;
    seen.add(status);
    const base = defaultWorkflowStep(status, cleanText(entry.label, 40));
    // A list now; a step saved with one `permission` keeps it as a list of one.
    const known = (value: unknown): value is WorkflowStepPermission => typeof value === 'string' && (WORKFLOW_STEP_PERMISSIONS as readonly string[]).includes(value);
    const single = (entry as { permission?: unknown }).permission;
    const stored = Array.isArray(entry.permissions) ? entry.permissions.filter(known) : known(single) ? [single] : [];
    const permissions = stored.length ? [...new Set(stored)] : base.permissions;
    steps.push({
      status,
      label: cleanText(entry.label, 40) || base.label,
      actionLabel: cleanText(entry.actionLabel, 40) || base.actionLabel,
      description: typeof entry.description === 'string' ? cleanText(entry.description, 300) : base.description,
      permissions,
      // A role step's lock and return rules are its own; only review steps choose them.
      locksAmounts: isRoleStep(status) ? base.locksAmounts : typeof entry.locksAmounts === 'boolean' ? entry.locksAmounts : base.locksAmounts,
      canReturn: isRoleStep(status) ? false : typeof entry.canReturn === 'boolean' ? entry.canReturn : base.canReturn,
      enabled: isOptionalStep(status) ? entry.enabled !== false : true,
      assignment: entry.assignment === 'users' || entry.assignment === 'collection_owner' ? entry.assignment : 'permission',
      userIds: [...new Set((entry.userIds ?? []).filter((id): id is string => typeof id === 'string' && Boolean(id)))],
      onlyAssigned: Boolean(entry.onlyAssigned),
      notify: entry.notify !== false,
    });
  }
  if (!steps.length) return DEFAULT_STEPS.map((entry) => defaultWorkflowStep(entry.status));

  // Put back any role step that is missing, just before the next role step after it (or at the end).
  for (const role of WORKFLOW_ROLES) {
    if (seen.has(role)) continue;
    const later = WORKFLOW_ROLES.slice(WORKFLOW_ROLES.indexOf(role) + 1);
    const at = steps.findIndex((step) => (later as readonly string[]).includes(step.status));
    steps.splice(at < 0 ? steps.length : at, 0, defaultWorkflowStep(role));
    seen.add(role);
  }
  // The role steps keep their order among themselves: their places stay, filled in role order.
  const rolePlaces = steps.map((step, index) => (isRoleStep(step.status) ? index : -1)).filter((index) => index >= 0);
  const roleSteps = rolePlaces.map((index) => steps[index]).sort((a, b) => WORKFLOW_ROLES.indexOf(a.status as WorkflowRole) - WORKFLOW_ROLES.indexOf(b.status as WorkflowRole));
  rolePlaces.forEach((place, index) => {
    steps[place] = roleSteps[index];
  });
  // Closed is the end of the line.
  const closed = steps.findIndex((step) => step.status === 'closed');
  steps.push(...steps.splice(closed, 1));
  return steps;
}

/** Why a configuration cannot be saved as it stands, or null. The server checks this before saving. */
export function workflowProblem(stored: readonly Partial<WorkflowStepSetting>[]): string | null {
  const ids = stored.map((step) => step.status ?? '');
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) return `Two steps share the id “${duplicate}”.`;
  for (const step of stored) {
    if (!step.status || (!DEFAULT_BY_STATUS.has(step.status) && !STEP_ID_PATTERN.test(step.status))) return 'A step has an invalid id.';
    if (!cleanText(step.label, 40)) return 'Every step needs a name.';
  }
  const labels = stored.map((step) => cleanText(step.label, 40).toLowerCase());
  const sameName = labels.find((label, index) => labels.indexOf(label) !== index);
  if (sameName) return `Two steps are called “${stored[labels.indexOf(sameName)].label}” — give each its own name.`;
  const missing = WORKFLOW_ROLES.filter((role) => !ids.includes(role));
  if (missing.length) return `${missing.map((role) => DEFAULT_BY_STATUS.get(role)?.label).join(', ')} cannot be removed — certification, receipts and reports depend on ${missing.length === 1 ? 'it' : 'them'}.`;
  const roleOrder = ids.filter((id) => isRoleStep(id));
  if (roleOrder.some((id, index) => id !== WORKFLOW_ROLES[index])) return 'Bill Raised, Certified by Client, Payment Follow-up, Reconciliation and Closed must stay in that order.';
  if (ids[ids.length - 1] !== 'closed') return 'Closed must be the last step.';
  return null;
}

type WorkflowSettings = Pick<BillTrackingSettings, 'workflowSteps'> | undefined;

/** The configured steps, in order (Draft excluded) — the default workflow where nothing is set. */
export const workflowSteps = (settings: WorkflowSettings): WorkflowStepSetting[] => normaliseWorkflowSteps(settings?.workflowSteps);

/** Every step a bill can be at, in order: Draft, then the configured steps. */
export const workflowPath = (settings: WorkflowSettings): BillWorkflowStatus[] => ['draft', ...workflowSteps(settings).map((step) => step.status)];

const indexIn = (settings: WorkflowSettings, status: BillWorkflowStatus) => workflowPath(settings).indexOf(status);

export function workflowStep(settings: WorkflowSettings, status: BillWorkflowStatus): WorkflowStepSetting {
  return workflowSteps(settings).find((entry) => entry.status === status) ?? defaultWorkflowStep(status);
}

/** A step's name as configured — "Draft" and "Returned for Correction" are not steps of their own. */
export function stepLabel(settings: WorkflowSettings, status: BillWorkflowStatus | undefined | null): string {
  if (!status) return '—';
  if (status === 'draft' || status === 'returned') return WORKFLOW_STATUS_LABELS[status as 'draft' | 'returned'];
  return workflowSteps(settings).find((entry) => entry.status === status)?.label ?? WORKFLOW_STATUS_LABELS[status as KnownWorkflowStatus] ?? status.replace(/_/g, ' ');
}

/** The permissions that move a bill into a step when nobody is named on it — any one of them will do. */
export const stepPermissions = (settings: WorkflowSettings, status: BillWorkflowStatus): string[] => workflowStep(settings, status).permissions;

/** "Bills · Verify or Approve". */
export const permissionText = (permissions: readonly string[] | undefined): string => `Bills · ${(permissions?.length ? permissions : ['Edit']).join(' or ')}`;
export const stepPermissionText = (settings: WorkflowSettings, status: BillWorkflowStatus): string => permissionText(stepPermissions(settings, status));

/** Holds any of the step's permissions on the bill's project. */
const holdsAny = (actor: WorkflowActor, permissions: readonly string[], projectId?: string) => permissions.some((permission) => actor.can('Bills', permission, projectId));

export const isStepEnabled = (settings: WorkflowSettings, status: BillWorkflowStatus): boolean => status === 'draft' || !isOptionalStep(status) || workflowStep(settings, status).enabled;

/** Where Bill raised sits in the path. */
const raisedIndex = (settings: WorkflowSettings) => indexIn(settings, 'raised');

/** The step a returned bill is counted at (the one it was returned from). */
const effectiveStatus = (bill: Pick<Bill, 'workflowStatus' | 'returnedFrom'>): BillWorkflowStatus => (bill.workflowStatus === 'returned' ? (bill.returnedFrom ?? 'draft') : bill.workflowStatus);

/** At or past Bill raised: the client has been sent the bill. */
export const isRaisedOrLater = (bill: Pick<Bill, 'workflowStatus' | 'returnedFrom'>, settings: WorkflowSettings): boolean => indexIn(settings, effectiveStatus(bill)) >= raisedIndex(settings);

/** Past Reconciliation's start: the bookkeeping after the payment (Reconciliation, Closed). */
export const isAfterPayment = (status: BillWorkflowStatus): boolean => status === 'reconciliation' || status === 'closed';

/**
 * Reached the step that locks the amounts — the first step with "locks amounts" on, and at the
 * latest Bill raised — so amounts, GST and deductions change only with Edit After Approval.
 */
export function isPastApproval(status: BillWorkflowStatus, settings: WorkflowSettings): boolean {
  const path = workflowPath(settings);
  const index = path.indexOf(status);
  if (index < 0) return false;
  const firstLock = workflowSteps(settings).findIndex((step) => step.locksAmounts);
  const lockAt = Math.min(firstLock < 0 ? Number.POSITIVE_INFINITY : firstLock + 1, path.indexOf('raised'));
  return index >= lockAt;
}

/** The named people of a step for this bill (none when the step is left to permission holders). */
export function stepDoers(step: WorkflowStepSetting, bill: Pick<Bill, 'collectionOwnerId'>): string[] {
  if (step.assignment === 'permission') return [];
  const ids = step.assignment === 'collection_owner' ? [bill.collectionOwnerId, ...step.userIds] : step.userIds;
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/** The next step in use after this one (skipping switched-off steps), or null at the end. */
export function nextStepAfter(status: BillWorkflowStatus, settings: WorkflowSettings): BillWorkflowStatus | null {
  const path = workflowPath(settings);
  const index = path.indexOf(status);
  if (index < 0) return null;
  return path.slice(index + 1).find((candidate) => isStepEnabled(settings, candidate)) ?? null;
}

/**
 * Whether a bill's amounts, GST and deductions are locked (Edit After Approval and a reason to change).
 * A returned bill is unlocked only when its resubmission goes back before the lock step, so the
 * corrected amounts are approved again; one returned from a later step stays locked, since
 * resubmitting would land it past the approval.
 */
export function amountsLocked(bill: Pick<Bill, 'workflowStatus' | 'returnedFrom'>, settings: WorkflowSettings): boolean {
  if (bill.workflowStatus !== 'returned') return isPastApproval(bill.workflowStatus, settings);
  return isPastApproval(resubmitTo(bill.returnedFrom, settings), settings);
}

/** Where a corrected bill goes: the step in use before the one that returned it (Draft at the earliest). */
export function resubmitTo(returnedFrom: BillWorkflowStatus | undefined, settings: WorkflowSettings): BillWorkflowStatus {
  const path = workflowPath(settings);
  const index = returnedFrom ? path.indexOf(returnedFrom) : -1;
  for (let at = index - 1; at > 0; at -= 1) if (isStepEnabled(settings, path[at])) return path[at];
  return 'draft';
}

/** Where a reopened bill goes: Payment follow-up when it is in use, else the last step in use before Closed. */
export function reopenTo(settings: WorkflowSettings): BillWorkflowStatus {
  if (isStepEnabled(settings, 'payment_followup')) return 'payment_followup';
  const path = workflowPath(settings);
  for (let at = path.indexOf('closed') - 1; at > 0; at -= 1) if (isStepEnabled(settings, path[at]) && path[at] !== 'certified') return path[at];
  return 'raised';
}

/* ── moving a bill ────────────────────────────────────────────────────────── */

/**
 * The names the moves into the default steps have always had — still accepted by the API and given
 * back for those steps, so a button, a test or an old client says "approve" rather than "advance".
 */
const NAMED_ADVANCES = {
  submit: 'submitted',
  start_verification: 'under_verification',
  verify: 'verified',
  approve: 'approved',
  raise: 'raised',
  start_followup: 'payment_followup',
  reconcile: 'reconciliation',
  close: 'closed',
} as const satisfies Record<string, KnownWorkflowStatus>;
const NAME_OF_ADVANCE = new Map<string, keyof typeof NAMED_ADVANCES>(Object.entries(NAMED_ADVANCES).map(([name, status]) => [status, name as keyof typeof NAMED_ADVANCES]));

export const WORKFLOW_ACTIONS = ['advance', ...(Object.keys(NAMED_ADVANCES) as (keyof typeof NAMED_ADVANCES)[]), 'return', 'resubmit', 'reopen'] as const;
export type WorkflowActionName = (typeof WORKFLOW_ACTIONS)[number];

/** A move: into a step (`advance`, with `to`), or one of the side moves. */
export interface WorkflowMove {
  action: WorkflowActionName;
  /** The step an `advance` moves into; implied by a named move ("approve" → approved). */
  to?: BillWorkflowStatus;
}

/** What a move does: into a step, or a side move. */
function resolveMove(move: WorkflowMove): { kind: 'advance'; to: BillWorkflowStatus } | { kind: 'return' | 'resubmit' | 'reopen' } | null {
  if (move.action === 'return' || move.action === 'resubmit' || move.action === 'reopen') return { kind: move.action };
  if (move.action === 'advance') return move.to ? { kind: 'advance', to: move.to } : null;
  return { kind: 'advance', to: NAMED_ADVANCES[move.action] };
}

/** The step a move goes into (for a return, the step the bill is taken from). */
export function moveTarget(move: WorkflowMove, bill: Pick<Bill, 'returnedFrom'>, settings: WorkflowSettings): BillWorkflowStatus | null {
  const resolved = resolveMove(move);
  if (!resolved) return null;
  if (resolved.kind === 'advance') return resolved.to;
  if (resolved.kind === 'return') return 'returned';
  if (resolved.kind === 'resubmit') return resubmitTo(bill.returnedFrom, settings);
  return reopenTo(settings);
}

export interface WorkflowActor {
  userId: string;
  /** The role-permission check (on the bill's project when given). */
  can: (resource: string, action: string, projectId?: string) => boolean;
}

type ActionBill = Pick<Bill, 'workflowStatus' | 'projectId' | 'collectionOwnerId' | 'createdBy' | 'isDeleted'> & Partial<Pick<Bill, 'returnedFrom'>>;

/** A move's button text. */
export function moveLabel(move: WorkflowMove, settings: WorkflowSettings): string {
  const resolved = resolveMove(move);
  if (!resolved) return 'Move';
  if (resolved.kind === 'advance') return workflowStep(settings, resolved.to).actionLabel;
  return resolved.kind === 'return' ? 'Return for correction' : resolved.kind === 'resubmit' ? 'Resubmit after correction' : 'Reopen';
}

/** Why this person cannot make this move on this bill now, or null if they can. Accepts a move name ("approve") too. */
export function actionBlocked(moveOrName: WorkflowMove | WorkflowActionName, bill: ActionBill, settings: WorkflowSettings, actor: WorkflowActor): string | null {
  const move: WorkflowMove = typeof moveOrName === 'string' ? { action: moveOrName } : moveOrName;
  const resolved = resolveMove(move);
  if (bill.isDeleted) return 'This bill has been deleted.';
  if (!resolved) return 'Say which step to move the bill into.';
  const at = bill.workflowStatus;
  const label = moveLabel(move, settings);
  let governing: BillWorkflowStatus | null = null;
  let permissions: string[];

  if (resolved.kind === 'advance') {
    const { to } = resolved;
    const path = workflowPath(settings);
    const from = path.indexOf(at);
    const target = path.indexOf(to);
    if (target <= 0) return `There is no step “${to}” in Settings → Workflow.`;
    if (to === 'certified') return 'A bill becomes certified when the client’s certification is recorded on it.';
    if (at === 'returned') return 'A returned bill is resubmitted after correction first.';
    if (at === 'closed') return 'A closed bill is reopened first.';
    if (from < 0) return `This bill is at a step that is no longer in the workflow (“${stepLabel(settings, at)}”).`;
    if (!isStepEnabled(settings, to)) return `${stepLabel(settings, to)} is switched off in Settings → Workflow.`;
    if (target <= from) return `This bill is at “${stepLabel(settings, at)}”, already past “${stepLabel(settings, to)}”.`;
    // Up to Bill raised the steps are taken in order: a bill moves only into the next one in use,
    // so it cannot be raised without being submitted, or approved without being verified. A step
    // switched off is passed over. After Bill raised the moves stay free.
    const raised = path.indexOf('raised');
    if (from < raised) {
      const next = nextStepAfter(at, settings);
      if (next && to !== next) return `“${stepLabel(settings, next)}” comes first — the steps before ${stepLabel(settings, 'raised')} are taken in order.`;
    }
    governing = to;
    permissions = stepPermissions(settings, to);
  } else if (resolved.kind === 'return') {
    if (at === 'draft' || at === 'returned' || at === 'closed' || !workflowStep(settings, at).canReturn || indexIn(settings, at) < 0) {
      return `A bill at “${stepLabel(settings, at)}” cannot be returned for correction.`;
    }
    governing = nextStepAfter(at, settings);
    permissions = ['Verify'];
  } else if (resolved.kind === 'resubmit') {
    if (at !== 'returned') return 'Only a bill returned for correction is resubmitted.';
    if (bill.createdBy === actor.userId) return null;
    permissions = ['Edit'];
  } else {
    if (at !== 'closed') return 'Only a closed bill is reopened.';
    governing = 'closed';
    permissions = ['Approve'];
  }

  const step = governing ? workflowStep(settings, governing) : null;
  const doers = step ? stepDoers(step, bill) : [];
  // Named on the step: that is the authority — no role permission or project grant needed.
  if (doers.includes(actor.userId)) return null;
  if (step && step.onlyAssigned && doers.length) return `Only the people assigned to “${step.label}” in Settings → Workflow can do this.`;
  if (holdsAny(actor, permissions, bill.projectId)) return null;
  return `${label} needs the Bill Tracking · ${permissionText(permissions)} permission${step ? `, or being assigned to “${step.label}” in Settings → Workflow` : ''}.`;
}

export interface AvailableMove extends WorkflowMove {
  label: string;
  tone?: 'danger';
}

/**
 * The workflow buttons this person gets on this bill, in workflow order: each step they may move
 * it into, then the side moves. A move into a default step keeps its name ("approve").
 */
export function availableActions(bill: ActionBill, settings: WorkflowSettings, actor: WorkflowActor): AvailableMove[] {
  const advances: WorkflowMove[] = workflowSteps(settings).map((step) => {
    const name = NAME_OF_ADVANCE.get(step.status);
    return name ? { action: name, to: step.status } : { action: 'advance', to: step.status };
  });
  const side: WorkflowMove[] = [{ action: 'resubmit' }, { action: 'reopen' }, { action: 'return' }];
  return [...advances, ...side]
    .filter((move) => actionBlocked(move, bill, settings, actor) === null)
    .map((move) => ({ ...move, label: moveLabel(move, settings), tone: move.action === 'return' ? 'danger' : undefined }));
}

/* ── certification ────────────────────────────────────────────────────────── */

/**
 * The client certifies a bill it has been sent, so a certification follows the steps before it:
 * none can be recorded until the bill is raised (a bill returned from Bill raised or later counts —
 * it has been raised). A bill already carrying a certification keeps it correctable and removable
 * wherever it stands.
 */
export function certificationNotDue(bill: Pick<Bill, 'workflowStatus' | 'returnedFrom' | 'certification'>, settings?: WorkflowSettings): string | null {
  if (bill.certification) return null;
  if (isRaisedOrLater(bill, settings)) return null;
  return `The client certifies a raised bill — this one is at “${stepLabel(settings, bill.workflowStatus)}”. Take it to “${stepLabel(settings, 'raised')}” first.`;
}

/** Recording (or changing, or removing) the client's certification is the Certified step's job. */
export function certificationBlocked(
  bill: Pick<Bill, 'projectId' | 'collectionOwnerId' | 'isDeleted' | 'workflowStatus' | 'returnedFrom' | 'certification'>,
  settings: WorkflowSettings,
  actor: WorkflowActor,
): string | null {
  if (bill.isDeleted) return 'This bill has been deleted.';
  const notDue = certificationNotDue(bill, settings);
  if (notDue) return notDue;
  const step = workflowStep(settings, 'certified');
  const doers = stepDoers(step, bill);
  if (doers.includes(actor.userId)) return null;
  if (step.onlyAssigned && doers.length) return `Only the people assigned to “${step.label}” in Settings → Workflow can record the certification.`;
  const permissions = stepPermissions(settings, 'certified');
  if (holdsAny(actor, permissions, bill.projectId)) return null;
  return `Recording the client's certification needs Bill Tracking · ${permissionText(permissions)}${doers.length ? `, or being assigned to “${step.label}” in Settings → Workflow` : ''}.`;
}

/** Recording a certification moves the bill on to Certified when it is still before it. */
export const certificationAdvances = (status: BillWorkflowStatus, settings: WorkflowSettings): boolean => {
  const index = indexIn(settings, status);
  return index >= 0 && index < indexIn(settings, 'certified');
};

/* ── who a bill is waiting for ────────────────────────────────────────────── */

export interface WaitingFor {
  /** The step the bill will move into next; null while it is back with the preparer. */
  status: BillWorkflowStatus | null;
  /** The people it is waiting for — empty when the step is left to permission holders. */
  userIds: string[];
}

/** Who the bill is waiting for now: the people of the next step in use (the preparer when returned). */
export function waitingFor(bill: Pick<Bill, 'workflowStatus' | 'collectionOwnerId' | 'createdBy' | 'isDeleted'>, settings: WorkflowSettings): WaitingFor | null {
  if (bill.isDeleted || bill.workflowStatus === 'closed') return null;
  if (bill.workflowStatus === 'returned') return { status: null, userIds: bill.createdBy ? [bill.createdBy] : [] };
  const next = nextStepAfter(bill.workflowStatus, settings);
  if (!next) return null;
  return { status: next, userIds: stepDoers(workflowStep(settings, next), bill) };
}

export const isWaitingFor = (bill: Parameters<typeof waitingFor>[0], settings: WorkflowSettings, userId: string): boolean => Boolean(waitingFor(bill, settings)?.userIds.includes(userId));

/**
 * Is the bill waiting for this person? Named people of its next step, when there are any;
 * otherwise whoever holds that step's permission on the bill's project. A returned bill waits for
 * its preparer.
 */
export function isMyTask(bill: Pick<Bill, 'workflowStatus' | 'collectionOwnerId' | 'createdBy' | 'isDeleted' | 'projectId'>, settings: WorkflowSettings, actor: WorkflowActor): boolean {
  const waiting = waitingFor(bill, settings);
  if (!waiting) return false;
  if (waiting.status === null || waiting.userIds.length) return waiting.userIds.includes(actor.userId);
  return holdsAny(actor, stepPermissions(settings, waiting.status), bill.projectId);
}

/**
 * Named on any step in use of this bill's workflow — enough to open the bill and act on it. A
 * switched-off step gives its named people nothing.
 */
export function isInvolved(bill: Pick<Bill, 'collectionOwnerId'>, settings: WorkflowSettings, userId: string): boolean {
  return workflowSteps(settings).some((step) => isStepEnabled(settings, step.status) && stepDoers(step, bill).includes(userId));
}

/** Named on any step in use — lets someone without the module permission into the module for their work. */
export const isNamedInWorkflow = (settings: WorkflowSettings, userId: string): boolean =>
  Boolean(settings?.workflowSteps?.some((step) => step.assignment !== 'permission' && step.userIds.includes(userId) && isStepEnabled(settings, step.status)));
