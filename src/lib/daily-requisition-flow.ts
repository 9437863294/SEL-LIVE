/**
 * Daily Requisition's workflow beyond its built-in stages: Verification steps, handing a
 * verification to someone else, and taking a requisition early.
 *
 * ── The model ─────────────────────────────────────────────────────────────────────────────────
 *
 * Every step in Workflow Configuration has one list of actions (STEP_ACTIONS), and what it ticks
 * decides what it is. One that ticks Mark as Received does Receiving at Finance's work (Pending →
 * Received); one that ticks Verify, Re-verify or Send for Payment does GST & TDS Verification's
 * (Received → Verified → Received for Payment) — one step may do both. Those finance steps work
 * requisitions by status ([step]/page.tsx getStepConfig). Payment (Received for Payment → Paid) is
 * no step's: it is the fixed page after the last step (PAYMENT_PAGE_NAME). Bank Balance vouchers,
 * the reports and the rules all read those statuses, so every other step — an approval
 * (Verification) step, ticking only Approve, Send Back, Reject — does not add one. It *holds* a
 * requisition instead:
 *
 *   - It sits before the first built-in stage, or between two of them, and holds requisitions in
 *     the status they wait in there — `Pending` before Receiving at Finance (segment 0: a new
 *     requisition starts at the segment's first step, `holdForCreate`), `Received` before GST & TDS
 *     Verification (segment 1), `Received for Payment` before the payment stage (segment 2).
 *   - The requisition names the step holding it (`heldAt`, the step's `key`) and who must verify
 *     it there (`heldAssignees`: the step's assignees for its project or department, or whoever it
 *     was handed to). While held, the next stage does not show it, and Bank Balance cannot pay it.
 *   - Verifying passes it to the next Verification step of the same segment, or releases it to the
 *     next built-in stage. Handing over replaces `heldAssignees`; the new person's verification
 *     counts for the step. Where Workflow Configuration switches them on (`approvalActionsOf`), the
 *     holder may also send it back (`planSendBack`: to the segment's previous step, else to the
 *     stage before the segment) or reject it (`planReject`: cancelled).
 *   - A hold whose step has since been deleted, or whose status has moved on, is no hold at all
 *     (`heldStep`), so nothing is ever stuck behind a step that no longer exists.
 *
 * A step may also *take* requisitions early: from the step just before it, or from any earlier
 * steps Workflow Configuration ticks (`takeFrom`, by step key). Taking moves the requisition
 * straight to the taking step, passing over everything between (`planTake`).
 *
 * Any step Workflow Configuration marks (`allowHandOver`; on by default for Verification steps)
 * lets its people hand a requisition to someone else. At a Verification step that replaces the
 * holders. At a built-in stage it *assigns* the requisition there (`assignedStage`, the stage's
 * role, and `assignedTo`): the stage still shows it, marked as with that person, and the person
 * does the stage's own work on it - verify, send for payment, mark paid - whatever stage
 * permissions they hold. The assignment lapses the moment the requisition leaves the stage.
 *
 * Step ids are positions (Workflow Configuration renumbers them on every move), so steps refer to
 * one another by `key`, which never changes. When it is saved the workflow also lists who its steps
 * name (`workflowAccessLists`), so the Firestore rules can let a step's people read the register and
 * a stage's people do its work without walking the steps. Pure and importless — no React, no Firebase — so
 * `node --experimental-strip-types --test` loads it directly (tests/daily-requisition-flow.test.mjs).
 */

/* ── shapes ──────────────────────────────────────────────────────────────── */

export const VERIFICATION_KIND = 'verification';

/** The parts of a workflow step this module reads (src/lib/types.ts WorkflowStep). */
export interface FlowStepLike {
  id?: string;
  key?: string;
  name: string;
  kind?: string;
  assignmentType?: string;
  assignedTo?: unknown;
  allowHandOver?: boolean;
  handOverUserIds?: string[];
  takeFrom?: string[];
  /** The buttons Workflow Configuration switched on (names, or `{ name }`). */
  actions?: ReadonlyArray<string | { name?: string }>;
}

/** The parts of a requisition this module reads (src/lib/types.ts DailyRequisitionEntry). */
export interface FlowEntryLike {
  status?: string;
  projectId?: string;
  departmentId?: string;
  heldAt?: string | null;
  heldAssignees?: string[] | null;
  heldSince?: unknown;
  /** Handed over with "send it back to me" (`handBackOf`). */
  heldReturn?: { stepKey?: string; to?: string[]; since?: unknown } | null;
  assignedStage?: string | null;
  assignedTo?: string[] | null;
}

/** A built-in stage, by what it does. */
export type StageRole = 'receiving' | 'gst' | 'payment';

export type FlowRole = StageRole | 'other' | 'verification';

/**
 * Where Verification steps may hold: 0 = before Receiving at Finance, 1 = before GST & TDS
 * Verification, 2 = before payment. 0 is falsy: compare with `!== null`, never test it for truth.
 */
export type FlowSegment = 0 | 1 | 2;

export interface PlacedStep<S extends FlowStepLike = FlowStepLike> {
  step: S;
  index: number;
  key: string;
  /** Its first built-in work (or 'other' for a stage with none, 'verification' for a Verification step). */
  role: FlowRole;
  /** Every built-in work the stage does, in workflow order (`stageRolesFor`). Empty on other steps. */
  roles: StageRole[];
  /**
   * Stages only: its first built-in work as a position — 0 receiving, 1 GST & TDS Verification,
   * 2 payment — or 3 for a stage with none. Null on a Verification step.
   */
  builtinIndex: number | null;
  /** Verification steps only: the segment it holds in, or null where it can hold nothing. */
  segment: FlowSegment | null;
}

/** The status a requisition rests in while a Verification step of the segment holds it. */
export const SEGMENT_STATUS: Record<FlowSegment, string> = {
  0: 'Pending',
  1: 'Received',
  2: 'Received for Payment',
};

/** Statuses a requisition is waiting in at each built-in stage — what may be taken from there. */
const WAITING_AT: Record<'receiving' | 'gst' | 'payment', readonly string[]> = {
  receiving: ['Pending'],
  gst: ['Received', 'Needs Review', 'Verified'],
  payment: ['Received for Payment', 'Partially Paid'],
};

const BUILTIN_ROLES: readonly StageRole[] = ['receiving', 'gst', 'payment'];

/**
 * The actions that give a step each built-in work: a step that ticks one does that work, so the
 * actions Workflow Configuration ticks decide what a step is, not its place. One step may do both
 * (receive, and send for payment); each work goes to the first step that claims it. Payment is no
 * step's: it is the fixed page after the last step (PAYMENT_PAGE_NAME).
 *
 * Verify (GST & TDS) claims nothing: on the step that sends for payment it verifies there (status
 * Verified); on an approval step — before Finance, say — it is that step's check, which records the
 * GST & TDS figures and passes the requisition on (`approvalActionsOf().gstVerify`).
 */
export const ROLE_CLAIMS: Record<StageRole, readonly string[]> = {
  receiving: ['Mark as Received'],
  gst: ['Send for Payment'],
  payment: [],
};

/** The built-in works a workflow step can do. Payment is the fixed page after the last step. */
const STEP_ROLES: readonly StageRole[] = ['receiving', 'gst'];

/**
 * The payment page: not a workflow step, but always there, after the last one. It lists what was
 * sent for payment (and was let through by any approval steps after that), for whoever holds the
 * Processed for Payment permissions. src/lib/daily-requisition-settings.ts reserves its address.
 */
export const PAYMENT_PAGE_NAME = 'Processed for Payment';

/** The built-in works a step's buttons claim, in workflow order. */
export function claimedRoles(step: Pick<FlowStepLike, 'actions'>): StageRole[] {
  const names = new Set((step.actions ?? []).map((a) => (typeof a === 'string' ? a : (a?.name ?? ''))));
  return BUILTIN_ROLES.filter((role) => ROLE_CLAIMS[role].some((name) => names.has(name)));
}

/**
 * Which built-in works each stage does, by step index. Each work goes to the first stage whose
 * buttons claim it. A workflow none of whose stages claims any (one saved before buttons decided)
 * keeps the old rule: the first stage receives, the second does GST & TDS, by place.
 */
function stageRolesFor<S extends FlowStepLike>(steps: readonly S[]): Map<number, StageRole[]> {
  const stages = steps.map((step, index) => ({ step, index })).filter(({ step }) => !isVerificationStep(step));
  const out = new Map<number, StageRole[]>();
  if (!stages.some(({ step }) => claimedRoles(step).length > 0)) {
    stages.forEach(({ index }, n) => out.set(index, n < STEP_ROLES.length ? [STEP_ROLES[n]] : []));
    return out;
  }
  const taken = new Set<StageRole>();
  for (const { step, index } of stages) {
    const mine = claimedRoles(step).filter((role) => !taken.has(role));
    mine.forEach((role) => taken.add(role));
    out.set(index, mine);
  }
  return out;
}

/**
 * The permission page each built-in stage is gated by, by position: the same pages the Firestore
 * rules check (drReceiving, drVerification, drPayment), and the only three a role can grant. So a
 * stage renamed in Workflow Configuration keeps its permissions — its name is only a label.
 */
export const STAGE_PERMISSION_PAGES: readonly string[] = ['Receiving at Finance', 'GST & TDS Verification', 'Processed for Payment'];

/** Each built-in work's permission page: what a role must hold to do that work on any stage. */
export const ROLE_PERMISSION_PAGE: Record<StageRole, string> = {
  receiving: 'Receiving at Finance',
  gst: 'GST & TDS Verification',
  payment: 'Processed for Payment',
};

/**
 * The `Daily Requisition.<page>` a step's permissions live under: a built-in stage's by its
 * position, whatever it is named; a fourth or later built-in stage, or a Verification step, by its
 * own name (none of them has a permission a role can grant).
 */
export function stagePermissionPage(builtinIndex: number | null | undefined, name: string): string {
  return (typeof builtinIndex === 'number' ? STAGE_PERMISSION_PAGES[builtinIndex] : undefined) ?? name;
}

/** The hold fields a requisition carries. `T` is the caller's timestamp type (Firestore's Timestamp). */
export interface HoldFields<T> {
  heldAt: string | null;
  heldAssignees: string[];
  heldSince: T | null;
}

/** A requisition handed to someone at a built-in stage. */
export interface AssignmentFields<T> {
  assignedStage: StageRole | null;
  assignedTo: string[];
  assignedSince: T | null;
}

const UNASSIGNED = { assignedStage: null, assignedTo: [] as string[], assignedSince: null };

/* ── reading the workflow ────────────────────────────────────────────────── */

export function isVerificationStep(step: Pick<FlowStepLike, 'kind'> | null | undefined): boolean {
  return step?.kind === VERIFICATION_KIND;
}

/** A step's stable reference. Workflow Configuration gives every step a key; older documents fall back to the id. */
export function stepKey(step: Pick<FlowStepLike, 'key' | 'id' | 'name'>): string {
  const key = typeof step.key === 'string' ? step.key.trim() : '';
  if (key) return key;
  return step.id ? `id:${step.id}` : `name:${step.name}`;
}

/**
 * Every step with its role: a stage by the built-in works its buttons claim (stageRolesFor), a
 * Verification step by where it sits.
 */
export function placeSteps<S extends FlowStepLike>(steps: readonly S[]): PlacedStep<S>[] {
  const rolesOf = stageRolesFor(steps);
  const placed: PlacedStep<S>[] = steps.map((step, index) => {
    if (isVerificationStep(step)) {
      return { step, index, key: stepKey(step), role: 'verification', roles: [], builtinIndex: null, segment: null };
    }
    const roles = rolesOf.get(index) ?? [];
    const first = roles[0];
    return {
      step,
      index,
      key: stepKey(step),
      role: first ?? 'other',
      roles,
      builtinIndex: first ? BUILTIN_ROLES.indexOf(first) : BUILTIN_ROLES.length,
      segment: null,
    };
  });

  // A Verification step holds in the segment of the work the next stage starts with: before the
  // stage that receives, a new requisition waits there from the moment it is entered (segment 0);
  // after one, it waits there on its way to GST & TDS Verification (1) or payment (2). With no stage
  // after it, what comes next is the payment page. Before a stage with no work, or with no stage
  // before it that does any, there is nothing to hold for.
  for (const p of placed) {
    if (p.role !== 'verification') continue;
    const before = placed.slice(0, p.index).some((q) => q.roles.length > 0);
    const next = placed.slice(p.index + 1).find((q) => q.builtinIndex !== null);
    const first: StageRole | undefined = next ? next.roles[0] : 'payment';
    if (!first) continue;
    if (first === 'receiving') {
      if (!before) p.segment = 0;
    } else if (before) {
      p.segment = first === 'gst' ? 1 : 2;
    }
  }
  return placed;
}

/**
 * Why a Verification step cannot sit where it is, as a sentence completing "this step …", or null.
 * Workflow Configuration refuses to save one that could never hold anything.
 */
export function verificationPlacementProblem<S extends FlowStepLike>(steps: readonly S[], index: number): string | null {
  const placed = placeSteps(steps);
  const p = placed[index];
  if (!p || p.role !== 'verification' || p.segment !== null) return null;
  if (!placed.some((q) => q.roles.length > 0)) {
    return 'has no stage to pass requisitions on to: no step receives them. Tick Mark as Received on a step after it.';
  }
  const receiving = placed.find((q) => q.roles.includes('receiving'));
  return receiving && receiving.index > p.index
    ? `comes before "${receiving.step.name}", which receives requisitions, but after a step that already does Finance's work. Move it.`
    : `can hold nothing here. Move it before "${receiving?.step.name ?? 'the step that receives requisitions'}", or after it.`;
}

/** A project's or department's people on a step: its primary, alternative and anyone additional, in that order. */
export function assignedPeople(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const v = value as { primary?: unknown; alternative?: unknown; additional?: unknown };
  const ids = [v.primary, v.alternative, ...(Array.isArray(v.additional) ? v.additional : [])];
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))];
}

/** The same people as a stored row: the first is primary, the second alternative, the rest additional. */
export function peopleToAssignment(ids: readonly string[]): { primary: string; alternative: string; additional?: string[] } {
  const clean = [...new Set(ids.filter((id) => typeof id === 'string' && id.trim() !== ''))];
  const [primary = '', alternative = '', ...additional] = clean;
  return additional.length > 0 ? { primary, alternative, additional } : { primary, alternative };
}

/**
 * Who a step assigns for this requisition: every user a person-based step names, or everyone it
 * names for the requisition's project or department.
 */
export function resolveStepAssignees(step: FlowStepLike, entry: Pick<FlowEntryLike, 'projectId' | 'departmentId'>): string[] {
  const ids: unknown[] = [];
  const pair = (value: unknown) => ids.push(...assignedPeople(value));
  const map = step.assignedTo && typeof step.assignedTo === 'object' && !Array.isArray(step.assignedTo)
    ? (step.assignedTo as Record<string, unknown>)
    : {};
  switch (step.assignmentType) {
    case 'User-based':
      if (Array.isArray(step.assignedTo)) ids.push(...step.assignedTo);
      break;
    case 'Project-based':
      if (entry.projectId) pair(map[entry.projectId]);
      break;
    case 'Department-based':
      if (entry.departmentId) pair(map[entry.departmentId]);
      break;
  }
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))];
}

/** Whether the step names this user anywhere in its assignment — for menus and pages, before a requisition is in view. */
export function stepNamesUser(step: FlowStepLike, userId: string | null | undefined): boolean {
  if (!userId) return false;
  if (step.assignmentType === 'User-based') return Array.isArray(step.assignedTo) && step.assignedTo.includes(userId);
  if (step.assignmentType === 'Project-based' || step.assignmentType === 'Department-based') {
    const map = step.assignedTo && typeof step.assignedTo === 'object' ? (step.assignedTo as Record<string, unknown>) : {};
    return Object.values(map).some((value) => assignedPeople(value).includes(userId));
  }
  return false;
}

/**
 * Whether the step lets its people hand a requisition to someone else: a Verification step unless
 * switched off, a built-in stage only when switched on.
 */
export function allowsHandOver(step: Pick<FlowStepLike, 'kind' | 'allowHandOver'> | null | undefined): boolean {
  if (!step) return false;
  return isVerificationStep(step) ? step.allowHandOver !== false : step.allowHandOver === true;
}

/**
 * Every action a workflow step can be given, in one list: any of them, on any step (Hand over is
 * the step's `allowHandOver`, beside them). What the ticked ones add up to decides the step:
 *
 *   - Ticking Finance's work (ROLE_CLAIMS: Mark as Received, Send for Payment) makes it a finance
 *     step, which works requisitions by status. Its page shows, in each work's section, the ticked
 *     actions that act there: Verify and Re-verify check GST & TDS before sending for payment;
 *     Revise or Send Back on Finance's Pending list send a requisition back to the last approval
 *     step before Finance; Return to Pending (or Revise) sends a received one back; Cancel or
 *     Reject cancels it.
 *   - Ticking neither makes it an approval step, which holds requisitions in turn: Approve passes
 *     one on, Verify (GST & TDS) checks the GST & TDS figures and passes it on, Send Back (or
 *     Revise, or Return to Pending) returns it to the step before, Reject (or Cancel) cancels it.
 *
 * (Payment is the fixed page after the last step; Bank Balance's Pay via voucher is Bank Balance's
 * own permission.)
 */
export const STEP_ACTIONS: readonly string[] = [
  'Approve',
  'Send Back',
  'Reject',
  'Mark as Received',
  'Verify',
  'Re-verify',
  'Send for Payment',
  'Revise',
  'Return to Pending',
  'Cancel',
];

/**
 * An approval step's actions, by what they do, under each name a step may have ticked: passing it
 * on, sending it back, and rejecting it. Verify (GST & TDS) passes it on too, with the GST & TDS
 * figures (`approvalActionsOf().gstVerify`). Handing over is `allowsHandOver`. Stored in the step's
 * `actions`, by name. (Complete and Verified pass it on only at approval steps saved before every
 * step had one list of actions; `upgradeWorkflowSteps` makes them Approve.)
 */
export const APPROVAL_BUTTONS = {
  forward: ['Approve', 'Complete', 'Verified'],
  back: ['Send Back', 'Revise', 'Return to Pending'],
  reject: ['Reject', 'Cancel'],
} as const;

const buttonName = (a: string | { name?: string }) => (typeof a === 'string' ? a : (a?.name ?? ''));

/**
 * The step as its ticked actions make it: a finance step when they claim Receiving or GST & TDS
 * work, an approval step otherwise. Hand over keeps what it was (the two kinds default it
 * differently, so it is written out).
 */
export function withDerivedKind<S extends FlowStepLike>(step: S): S {
  const approval = claimedRoles(step).length === 0;
  if (approval === isVerificationStep(step)) return step;
  const { kind: _kind, ...rest } = step;
  const allowHandOver = allowsHandOver(step);
  return (approval ? { ...rest, kind: VERIFICATION_KIND, allowHandOver } : { ...rest, allowHandOver }) as unknown as S;
}

/**
 * A workflow saved before every step had one list of actions, as that list reads it:
 *
 *   - In one that ticks no Receiving or GST & TDS work anywhere (stages did their work by place),
 *     the first stage gets Mark as Received and the second Send for Payment, as they did.
 *   - Mark as Received for Payment goes: payment is the fixed page after the last step.
 *   - A stage that does no work becomes an approval step (it had no page; now its people approve).
 *   - An approval step passes requisitions on with Approve (or Verify (GST & TDS)): its older
 *     names for Approve (Verified, Complete) become Approve, and one with neither gets Approve.
 *
 * Steps it leaves as they are come back as the same objects.
 */
export function upgradeWorkflowSteps<S extends FlowStepLike>(steps: readonly S[]): S[] {
  type Action = string | { name?: string };
  const legacy = !steps.some((step) => !isVerificationStep(step) && claimedRoles(step).length > 0);
  /** An approval step's actions: its old names for passing on are Approve, and it has a way on. */
  const asApproval = (list: Action[]): Action[] => {
    const renamed = list.map((a) => (['Verified', 'Complete'].includes(buttonName(a)) ? 'Approve' : a));
    const kept = renamed.filter((a, i) => renamed.findIndex((b) => buttonName(b) === buttonName(a)) === i);
    return kept.some((a) => ['Approve', 'Verify'].includes(buttonName(a))) ? kept : ['Approve', ...kept];
  };
  let stageNumber = 0;
  return steps.map((step) => {
    let actions: Action[] = [...(step.actions ?? [])];
    if (legacy && !isVerificationStep(step)) {
      const added = stageNumber === 0 ? 'Mark as Received' : stageNumber === 1 ? 'Send for Payment' : null;
      if (added) actions.push(added);
      stageNumber += 1;
    }
    actions = actions.filter((a) => buttonName(a) !== 'Mark as Received for Payment');
    if (isVerificationStep(step)) actions = asApproval(actions);
    let next = withDerivedKind({ ...step, actions } as S);
    if (isVerificationStep(next) && !isVerificationStep(step)) next = { ...next, actions: asApproval(actions) };
    return JSON.stringify(next) === JSON.stringify(step) ? step : next;
  });
}

/** What an action is called in Workflow Configuration, where its bare name says too little. */
const ACTION_LABEL: Record<string, string> = { Verify: 'Verify (GST & TDS)', 'Re-verify': 'Re-verify (GST & TDS)' };

/** The ticked actions that give a step a work, as Workflow Configuration names them ("Verify (GST & TDS) and Send for Payment"). */
function claimingTicks(step: FlowStepLike, role: StageRole): string {
  const names = (step.actions ?? []).map(buttonName).filter((name) => ROLE_CLAIMS[role].includes(name));
  return names.map((name) => ACTION_LABEL[name] ?? name).join(' and ');
}

/** What each work is called, as a work (the checks in Workflow Configuration). */
export const STAGE_WORK_LABEL: Record<StageRole, string> = {
  receiving: 'Receiving',
  gst: 'GST & TDS Verification',
  payment: 'Payment',
};

/** Whether a step that sends for payment verifies GST & TDS first (Verify ticked), or only sends what was received. */
export function verifiesGst(step: Pick<FlowStepLike, 'actions'> | null | undefined): boolean {
  return (step?.actions ?? []).some((a) => ['Verify', 'Verified'].includes(buttonName(a)));
}

/**
 * What a step's work is called where people work it — its page's section switcher, the dashboard,
 * the step's type in Workflow Configuration: GST & TDS work that does not verify is Send for Payment.
 */
export function stepWorkLabel(step: Pick<FlowStepLike, 'actions'> | null | undefined, role: StageRole): string {
  return role === 'gst' && !verifiesGst(step) ? 'Send for Payment' : STAGE_WORK_LABEL[role];
}

/**
 * Why the stages' works cannot stand as ticked, as sentences, or none: each work in order —
 * receiving, then GST & TDS Verification, then payment — and each claimed by one stage only.
 */
export function stageWorkProblems<S extends FlowStepLike>(steps: readonly S[]): Map<number, string[]> {
  const placed = placeSteps(steps);
  const out = new Map<number, string[]>();
  const add = (index: number, text: string) => out.set(index, [...(out.get(index) ?? []), text]);
  const owner = new Map<StageRole, PlacedStep<S>>();
  for (const p of placed) for (const role of p.roles) owner.set(role, p);
  for (const p of placed) {
    if (p.role === 'verification') continue;
    // Ticked here, but an earlier stage already does it.
    for (const role of claimedRoles(p.step)) {
      const other = owner.get(role);
      if (other && other.index !== p.index) {
        add(p.index, `"${other.step.name}" already does ${STAGE_WORK_LABEL[role]}: untick its buttons here, or there.`);
      }
    }
  }
  // Each work after the one before it: a requisition is received, then verified, then paid. Said
  // with the ticks that give the step the work, since ticking one is how it usually happens.
  for (let i = 1; i < BUILTIN_ROLES.length; i++) {
    const later = owner.get(BUILTIN_ROLES[i]);
    for (let j = 0; j < i; j++) {
      const earlier = owner.get(BUILTIN_ROLES[j]);
      if (later && earlier && later.index < earlier.index) {
        const ticks = claimingTicks(later.step, BUILTIN_ROLES[i]);
        add(
          later.index,
          `does ${STAGE_WORK_LABEL[BUILTIN_ROLES[i]]}${ticks ? ` (${ticks} is ticked)` : ''}, which must come after ${STAGE_WORK_LABEL[BUILTIN_ROLES[j]]} at "${earlier.step.name}". ` +
            `Untick ${ticks || 'it'} here, or move this step below "${earlier.step.name}".`,
        );
      }
    }
  }
  // Both works, somewhere: what is received must be sent for payment, and what is sent must have been received.
  const receiving = owner.get('receiving');
  const gst = owner.get('gst');
  if (receiving && !gst) {
    add(receiving.index, 'receives requisitions, but no step sends them for payment. Tick Send for Payment here or on a later step.');
  }
  if (gst && !receiving) {
    add(gst.index, 'sends requisitions for payment, but no step receives them first. Tick Mark as Received here or on an earlier step.');
  }
  // An approval step without Approve or Verify (GST & TDS) could never pass on what it holds.
  for (const p of placed) {
    const forward: readonly string[] = [...APPROVAL_BUTTONS.forward, 'Verify'];
    if (p.role === 'verification' && !(p.step.actions ?? []).some((a) => forward.includes(buttonName(a)))) {
      add(p.index, 'has no Approve or Verify (GST & TDS), so what waits here could never move on. Tick one.');
    }
  }
  return out;
}

/**
 * An approval step's actions as configured, by their names: the one that passes it on as it is
 * (null when not ticked), whether Verify (GST & TDS) passes it on with the GST & TDS figures, and the
 * ones that send it back or reject it, or null when not ticked. (One saved with no way on still
 * has Approve, so nothing is stuck there; Workflow Configuration asks for one.)
 */
export function approvalActionsOf(step: Pick<FlowStepLike, 'actions'> | null | undefined): {
  forward: string | null;
  gstVerify: boolean;
  sendBack: string | null;
  reject: string | null;
} {
  const names = (step?.actions ?? []).map((a) => (typeof a === 'string' ? a : (a?.name ?? '')));
  const first = (options: readonly string[]) => names.find((name) => options.includes(name)) ?? null;
  const gstVerify = names.includes('Verify');
  return {
    forward: first(APPROVAL_BUTTONS.forward) ?? (gstVerify ? null : 'Approve'),
    gstVerify,
    sendBack: first(APPROVAL_BUTTONS.back),
    reject: first(APPROVAL_BUTTONS.reject),
  };
}

/** The built-in stage a status belongs to, or null once paid or cancelled. */
export function stageOfStatus(status: string | undefined): StageRole | null {
  const s = status || 'Pending';
  for (const role of ['receiving', 'gst', 'payment'] as const) if (WAITING_AT[role].includes(s)) return role;
  return null;
}

/** Who a step may be handed to: its list when it has one, otherwise anyone but those excluded. */
export function handOverCandidates<U extends { id: string }>(step: FlowStepLike, users: readonly U[], exclude: readonly string[] = []): U[] {
  const pool = (step.handOverUserIds ?? []).filter(Boolean);
  const skip = new Set(exclude);
  return users.filter((u) => !skip.has(u.id) && (pool.length === 0 || pool.includes(u.id)));
}

/* ── where a requisition is ──────────────────────────────────────────────── */

/** The Verification step holding the requisition, or null when it is not (validly) held. */
export function heldStep<S extends FlowStepLike>(placed: readonly PlacedStep<S>[], entry: FlowEntryLike): PlacedStep<S> | null {
  const key = typeof entry.heldAt === 'string' ? entry.heldAt : '';
  if (!key) return null;
  const p = placed.find((q) => q.key === key && q.role === 'verification');
  if (!p || p.segment === null || entry.status !== SEGMENT_STATUS[p.segment]) return null;
  return p;
}

export function isHeld<S extends FlowStepLike>(steps: readonly S[], entry: FlowEntryLike): boolean {
  return heldStep(placeSteps(steps), entry) !== null;
}

/** The index of the step a requisition is waiting at, or null once it is paid, cancelled or at no step. */
export function positionOf<S extends FlowStepLike>(placed: readonly PlacedStep<S>[], entry: FlowEntryLike): number | null {
  const held = heldStep(placed, entry);
  if (held) return held.index;
  const status = entry.status || 'Pending';
  for (const role of ['receiving', 'gst', 'payment'] as const) {
    if (WAITING_AT[role].includes(status)) return placed.find((q) => q.roles.includes(role))?.index ?? null;
  }
  return null;
}

/**
 * The built-in stage a requisition is assigned at, while the assignment stands: it names someone,
 * the requisition is still at that stage, and no Verification step holds it.
 */
export function assignedStageOf<S extends FlowStepLike>(placed: readonly PlacedStep<S>[], entry: FlowEntryLike): PlacedStep<S> | null {
  const role = entry.assignedStage;
  if (!role || (entry.assignedTo?.length ?? 0) === 0 || heldStep(placed, entry)) return null;
  if (stageOfStatus(entry.status) !== role) return null;
  return placed.find((q) => q.roles.includes(role)) ?? null;
}

/**
 * A place an open requisition can wait — the dashboard's pipeline and the reports' "where it is":
 * each approval step that can hold, each finance work (a step doing two appears for each), then the
 * payment page.
 */
export interface PipelinePosition {
  /** `step:<step key>` for an approval step, `work:<role>` for a finance work or the payment page. */
  key: string;
  role: StageRole | 'verification';
  /** The workflow step it is, or null for the payment page. */
  stepIndex: number | null;
  stepName: string;
}

/** The workflow's pipeline, in order. */
export function pipelineOf<S extends FlowStepLike>(steps: readonly S[]): PipelinePosition[] {
  const out: PipelinePosition[] = [];
  for (const p of placeSteps(steps)) {
    if (p.role === 'verification') {
      if (p.segment !== null) out.push({ key: `step:${p.key}`, role: 'verification', stepIndex: p.index, stepName: p.step.name });
      continue;
    }
    for (const role of p.roles) out.push({ key: `work:${role}`, role, stepIndex: p.index, stepName: p.step.name });
  }
  out.push({ key: 'work:payment', role: 'payment', stepIndex: null, stepName: PAYMENT_PAGE_NAME });
  return out;
}

/** Where an open requisition waits on the pipeline (`PipelinePosition.key`), or null once paid or cancelled. */
export function pipelineKeyOf<S extends FlowStepLike>(placed: readonly PlacedStep<S>[], entry: FlowEntryLike): string | null {
  const held = heldStep(placed, entry);
  if (held) return `step:${held.key}`;
  const role = stageOfStatus(entry.status);
  return role ? `work:${role}` : null;
}

/** The statuses a requisition can be in while it waits at the step (what a query for that step asks for). */
export function waitingStatusesAt<S extends FlowStepLike>(placed: readonly PlacedStep<S>[], index: number): string[] {
  const p = placed[index];
  if (!p) return [];
  if (p.role === 'verification') return p.segment !== null ? [SEGMENT_STATUS[p.segment]] : [];
  return p.roles.flatMap((role) => WAITING_AT[role]);
}

/* ── moving it ───────────────────────────────────────────────────────────── */

const RELEASED = { heldAt: null, heldAssignees: [] as string[], heldSince: null };

/** The first Verification step of the segment after `afterIndex` that names someone for this requisition. */
function nextHolder<S extends FlowStepLike>(
  placed: readonly PlacedStep<S>[],
  segment: FlowSegment,
  afterIndex: number,
  entry: FlowEntryLike,
): { step: PlacedStep<S>; assignees: string[] } | null {
  for (const p of placed) {
    if (p.index <= afterIndex || p.role !== 'verification' || p.segment !== segment) continue;
    const assignees = resolveStepAssignees(p.step, entry);
    // A step that names nobody for this project or department does not apply to it.
    if (assignees.length > 0) return { step: p, assignees };
  }
  return null;
}

/**
 * Where a new requisition starts: held at the first Verification step before Receiving at Finance
 * that names someone for its project or department, or nowhere (Finance receives it directly).
 * Only a Pending one: an import bringing paid history is past every step. Empty when not held.
 */
export function holdForCreate<S extends FlowStepLike, T>(steps: readonly S[], entry: FlowEntryLike, now: T): Partial<HoldFields<T>> {
  if ((entry.status || 'Pending') !== 'Pending') return {};
  const target = nextHolder(placeSteps(steps), 0, -1, { ...entry, status: 'Pending' });
  return target ? { heldAt: target.step.key, heldAssignees: target.assignees, heldSince: now } : {};
}

/**
 * The hold and assignment fields a stage's status move writes. Handing over into a segment —
 * received at Finance (Pending → Received), or sent for payment (into Received for Payment from
 * GST & TDS Verification) — lands the requisition at the segment's first Verification step, when
 * there is one for it; so does reopening a cancelled one (back to Pending), which goes through the
 * steps before Finance again. Any other move releases a hold it had. Leaving the stage it was
 * assigned at ends the assignment; a move within that stage (verified, flagged for review) keeps
 * it. Empty when there is nothing to write.
 */
export function holdForMove<S extends FlowStepLike, T>(
  steps: readonly S[],
  current: FlowEntryLike,
  to: string,
  now: T,
): Partial<HoldFields<T> & AssignmentFields<T>> {
  const assignment = current.assignedStage && stageOfStatus(to) !== current.assignedStage ? { ...UNASSIGNED } : {};
  return { ...holdOnly(steps, current, to, now), ...assignment };
}

function holdOnly<S extends FlowStepLike, T>(steps: readonly S[], current: FlowEntryLike, to: string, now: T): Partial<HoldFields<T>> {
  const placed = placeSteps(steps);
  const from = current.status || 'Pending';
  const segment: FlowSegment | null =
    to === SEGMENT_STATUS[1] && from === 'Pending'
      ? 1
      : to === SEGMENT_STATUS[2] && WAITING_AT.gst.includes(from)
        ? 2
        : to === SEGMENT_STATUS[0] && from === 'Cancelled'
          ? 0
          : null;
  const target = segment !== null ? nextHolder(placed, segment, -1, { ...current, status: to }) : null;
  if (target) return { heldAt: target.step.key, heldAssignees: target.assignees, heldSince: now };
  const hasHold = Boolean(current.heldAt) || (current.heldAssignees?.length ?? 0) > 0;
  return hasHold ? { ...RELEASED } : {};
}

/** A moment as something comparable, whichever form it is in (a Firestore Timestamp, a Date, plain fields). */
function momentKey(value: unknown): string {
  if (!value) return '';
  const v = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
  if (typeof v.toMillis === 'function') return String(v.toMillis());
  if (value instanceof Date) return String(value.getTime());
  if (typeof v.seconds === 'number') return String(v.seconds * 1000 + Math.floor((v.nanoseconds ?? 0) / 1e6));
  return String(value);
}

/**
 * Who a held requisition goes back to once the person it was handed to verifies it, or null. Set by
 * a hand-over with "send it back to me" (`heldReturn`: the step, who it returns to, and the moment of
 * the hand-over, which is its `heldSince`). Any later move or hand-over writes a new `heldSince`, so
 * an old request to send it back never applies to a later hold.
 */
export function handBackOf(entry: FlowEntryLike, stepKey: string): string[] | null {
  const back = entry.heldReturn;
  if (!back || back.stepKey !== stepKey || !Array.isArray(back.to) || back.to.length === 0) return null;
  if (!entry.heldSince || momentKey(back.since) !== momentKey(entry.heldSince)) return null;
  return back.to.filter((id) => typeof id === 'string' && id !== '');
}

/**
 * After the holder verifies: back to whoever handed it over asking for it back (`handBackOf`), else
 * the segment's next Verification step for it, else released to the next stage.
 */
export function holdAfterVerify<S extends FlowStepLike, T>(
  steps: readonly S[],
  entry: FlowEntryLike,
  now: T,
): HoldFields<T> & { heldReturn?: null } {
  const placed = placeSteps(steps);
  const held = heldStep(placed, entry);
  if (!held || held.segment === null) return { ...RELEASED };
  const back = handBackOf(entry, held.key);
  if (back && back.length > 0) return { heldAt: held.key, heldAssignees: back, heldSince: now, heldReturn: null };
  const next = nextHolder(placed, held.segment, held.index, entry);
  return next ? { heldAt: next.step.key, heldAssignees: next.assignees, heldSince: now } : { ...RELEASED };
}

/** What the step after a Verification step is called — where verifying sends a requisition. */
export function stepAfterVerify<S extends FlowStepLike>(steps: readonly S[], index: number): string | null {
  const placed = placeSteps(steps);
  // A Verification step that can hold is followed by another of its segment or by the stage it leads into.
  const p = placed[index];
  return p && p.segment !== null ? (placed[index + 1]?.step.name ?? null) : null;
}

export type FlowMoveResult = { ok: true; update: Record<string, unknown>; toName: string } | { ok: false; reason: string };

/**
 * Sending a held requisition back: to the previous Verification step of its segment that names
 * someone for it, else out of the segment to the stage before it — Receiving at Finance (Pending,
 * no longer received) from before GST & TDS Verification, GST & TDS Verification (Verified) from
 * before payment. Before Finance there is nothing earlier: reject it instead.
 */
export function planSendBack<S extends FlowStepLike, T>(steps: readonly S[], entry: FlowEntryLike, now: T): FlowMoveResult {
  const placed = placeSteps(steps);
  const held = heldStep(placed, entry);
  if (!held || held.segment === null) return { ok: false, reason: 'It is not waiting at a Verification step.' };
  for (let i = held.index - 1; i >= 0; i--) {
    const p = placed[i];
    if (p.role !== 'verification' || p.segment !== held.segment) break;
    const assignees = resolveStepAssignees(p.step, entry);
    if (assignees.length > 0) {
      return { ok: true, toName: p.step.name, update: { heldAt: p.key, heldAssignees: assignees, heldSince: now } };
    }
  }
  if (held.segment === 1) {
    const receiving = placed.find((q) => q.roles.includes('receiving'));
    return {
      ok: true,
      toName: receiving?.step.name ?? 'Receiving at Finance',
      update: { ...RELEASED, status: 'Pending', receivedAt: null, receivedById: null },
    };
  }
  if (held.segment === 2) {
    const gst = placed.find((q) => q.roles.includes('gst'));
    return { ok: true, toName: gst?.step.name ?? 'GST & TDS Verification', update: { ...RELEASED, status: 'Verified' } };
  }
  return { ok: false, reason: 'Nothing comes before this step to send it back to. Reject it instead.' };
}

/**
 * Finance's Revise on a requisition it has not received: back to the last Verification step before
 * Finance that names someone for it — still Pending, now held there again. Nothing before Finance
 * names anyone: nowhere to send it.
 */
export function planReviseToApproval<S extends FlowStepLike, T>(steps: readonly S[], entry: FlowEntryLike, now: T): FlowMoveResult {
  if ((entry.status || 'Pending') !== 'Pending') return { ok: false, reason: 'It has been received already.' };
  const placed = placeSteps(steps);
  if (heldStep(placed, entry)) return { ok: false, reason: 'It is still waiting at a step before Finance.' };
  const before = placed.filter((p) => p.role === 'verification' && p.segment === 0).reverse();
  for (const p of before) {
    const assignees = resolveStepAssignees(p.step, entry);
    if (assignees.length > 0) return { ok: true, toName: p.step.name, update: { heldAt: p.key, heldAssignees: assignees, heldSince: now } };
  }
  return { ok: false, reason: 'No step before Finance names anyone for it.' };
}

/** Rejecting a held requisition at its Verification step: cancelled, the hold released. */
export function planReject<S extends FlowStepLike>(steps: readonly S[], entry: FlowEntryLike): FlowMoveResult {
  const held = heldStep(placeSteps(steps), entry);
  if (!held) return { ok: false, reason: 'It is not waiting at a Verification step.' };
  return { ok: true, toName: 'Cancelled', update: { ...RELEASED, status: 'Cancelled' } };
}

/* ── taking early ────────────────────────────────────────────────────────── */

/** Whether the step may take requisitions early at all: GST & TDS Verification, payment, or a Verification step that can hold. */
export function canTakeInto<S extends FlowStepLike>(placed: readonly PlacedStep<S>[], index: number): boolean {
  const p = placed[index];
  if (!p || index === 0) return false;
  return p.roles.includes('gst') || p.roles.includes('payment') || (p.role === 'verification' && p.segment !== null);
}

/** The earlier steps the step is set to take from, in workflow order. Keys of later or deleted steps are ignored. */
export function takeSourcesOf<S extends FlowStepLike>(placed: readonly PlacedStep<S>[], index: number): PlacedStep<S>[] {
  const p = placed[index];
  if (!p || !canTakeInto(placed, index)) return [];
  const keys = new Set((p.step.takeFrom ?? []).filter(Boolean));
  return placed.filter((q) => q.index < index && keys.has(q.key) && waitingStatusesAt(placed, q.index).length > 0);
}

export interface TakePlan<S extends FlowStepLike, T> {
  from: PlacedStep<S>;
  to: PlacedStep<S>;
  /** The steps passed over, the one it is taken from first. */
  skipped: string[];
  /** The fields to write: hold fields always, the status (and receipt stamps) when it changes. */
  update: Record<string, unknown> & HoldFields<T>;
  /** It is taken past GST & TDS Verification without having been verified there. */
  skipsGstVerification: boolean;
}

export type TakeResult<S extends FlowStepLike, T> = { ok: true; plan: TakePlan<S, T> } | { ok: false; reason: string };

/**
 * Taking a requisition early into step `targetIndex`, as the requisition stands now. The taker must
 * be one of the step's assignees for it when the step is a Verification step; a built-in stage's
 * permission is the caller's to check (`Take Early` on that stage).
 */
export function planTake<S extends FlowStepLike, T>(
  steps: readonly S[],
  entry: FlowEntryLike,
  targetIndex: number,
  options: { now: T; actorId: string },
): TakeResult<S, T> {
  const placed = placeSteps(steps);
  const to = placed[targetIndex];
  if (!to || !canTakeInto(placed, targetIndex)) return { ok: false, reason: 'This step does not take requisitions early.' };

  const position = positionOf(placed, entry);
  if (position === null) return { ok: false, reason: 'It is no longer waiting in the workflow.' };
  if (position >= targetIndex) return { ok: false, reason: `It has already reached "${to.step.name}".` };
  const from = placed[position];
  if (!takeSourcesOf(placed, targetIndex).some((q) => q.index === position)) {
    return { ok: false, reason: `"${to.step.name}" is not set to take requisitions from "${from.step.name}".` };
  }
  if (entry.status === 'Partially Paid') return { ok: false, reason: 'It has been part paid.' };

  let hold: HoldFields<T> = { ...RELEASED };
  let status: string;
  if (to.role === 'verification' && to.segment !== null) {
    status = SEGMENT_STATUS[to.segment];
    const assignees = resolveStepAssignees(to.step, entry);
    if (assignees.length === 0) return { ok: false, reason: `"${to.step.name}" names nobody for this requisition's project or department.` };
    if (!assignees.includes(options.actorId)) return { ok: false, reason: `You are not assigned to "${to.step.name}" for this requisition.` };
    hold = { heldAt: to.key, heldAssignees: assignees, heldSince: options.now };
  } else {
    status = to.roles.includes('gst') ? SEGMENT_STATUS[1] : SEGMENT_STATUS[2];
  }

  const current = entry.status || 'Pending';
  const update: Record<string, unknown> & HoldFields<T> = { ...hold };
  if (status !== current) update.status = status;
  // Taken past Receiving at Finance: it is received now, by whoever took it. (Taken into a step
  // before Finance, it is still Pending.)
  if (current === 'Pending' && status !== 'Pending') {
    update.receivedAt = options.now;
    update.receivedById = options.actorId;
  }
  // Whoever it was handed to at the stage it is taken from no longer has it.
  if (entry.assignedStage) Object.assign(update, UNASSIGNED);

  const gst = placed.find((q) => q.roles.includes('gst'));
  const skipsGstVerification = Boolean(gst && gst.index >= position && gst.index < targetIndex && current !== 'Verified');

  return {
    ok: true,
    plan: {
      from,
      to,
      skipped: placed.slice(position, targetIndex).map((q) => q.step.name),
      update,
      skipsGstVerification,
    },
  };
}

/* ── Workflow Configuration ──────────────────────────────────────────────── */

/** Every step with a key, unique across the workflow. `makeKey` makes a fresh one (crypto.randomUUID in the browser). */
export function withStepKeys<S extends FlowStepLike>(steps: readonly S[], makeKey: () => string): S[] {
  const seen = new Set<string>();
  return steps.map((step) => {
    let key = typeof step.key === 'string' ? step.key.trim() : '';
    while (!key || seen.has(key)) key = makeKey();
    seen.add(key);
    return key === step.key ? step : { ...step, key };
  });
}

/**
 * Ids renumbered to positions (the stage pages and the audit diff rely on it), each step's
 * `takeFrom` kept to steps that still come before it, and settings that only one kind of step
 * uses dropped from the other.
 */
export function renumberSteps<S extends FlowStepLike>(steps: readonly S[]): S[] {
  const placed = placeSteps(steps);
  return placed.map((p) => {
    const earlier = new Set(placed.slice(0, p.index).map((q) => q.key));
    const takeFrom = canTakeInto(placed, p.index) ? (p.step.takeFrom ?? []).filter((key) => earlier.has(key)) : [];
    const next: S = { ...p.step, id: String(p.index + 1) };
    if (takeFrom.length > 0) next.takeFrom = takeFrom;
    else delete (next as FlowStepLike).takeFrom;
    if (!allowsHandOver(p.step) || p.role === 'other') delete (next as FlowStepLike).handOverUserIds;
    return next;
  });
}

/** Everyone a step names, for any project or department. */
function namedOn(step: FlowStepLike): string[] {
  const ids: unknown[] = [];
  if (step.assignmentType === 'User-based') {
    if (Array.isArray(step.assignedTo)) ids.push(...step.assignedTo);
  } else if (step.assignmentType === 'Project-based' || step.assignmentType === 'Department-based') {
    const map = step.assignedTo && typeof step.assignedTo === 'object' ? (step.assignedTo as Record<string, unknown>) : {};
    for (const value of Object.values(map)) ids.push(...assignedPeople(value));
  }
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))].sort();
}

/**
 * Who the workflow names, saved beside its steps by Workflow Configuration for the Firestore rules,
 * which cannot walk each step's per-project assignment: `members`, everyone named on any step (they
 * may read the requisitions their pages list), and `stageMembers`, everyone named on each built-in
 * stage (they may do its work as its permissions would let them; the stage page keeps each to the
 * projects and departments the step names them for).
 */
export function workflowAccessLists<S extends FlowStepLike>(steps: readonly S[]): { members: string[]; stageMembers: Record<StageRole, string[]> } {
  const stageMembers: Record<StageRole, string[]> = { receiving: [], gst: [], payment: [] };
  for (const p of placeSteps(steps)) {
    for (const role of p.roles) stageMembers[role] = namedOn(p.step);
  }
  const members = [...new Set(steps.flatMap((step) => namedOn(step)))].sort();
  return { members, stageMembers };
}
