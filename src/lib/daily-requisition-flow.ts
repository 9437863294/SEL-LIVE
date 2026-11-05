/**
 * Daily Requisition's workflow beyond its built-in stages: Verification steps, handing a
 * verification to someone else, and taking a requisition early.
 *
 * ── The model ─────────────────────────────────────────────────────────────────────────────────
 *
 * The module's built-in stages are worked by status ([step]/page.tsx getStepConfig): the first
 * non-verification step in Workflow Configuration is Receiving at Finance (Pending → Received),
 * the second GST & TDS Verification (Received → Verified → Received for Payment), the third the
 * payment stage (Received for Payment → Paid). Bank Balance vouchers, the reports and the rules all
 * read those statuses, so a Verification step does not add one. It *holds* a requisition instead:
 *
 *   - It sits between two built-in stages, and holds requisitions in the status the earlier stage
 *     hands over in — `Received` before GST & TDS Verification (segment 1), `Received for Payment`
 *     before the payment stage (segment 2).
 *   - The requisition names the step holding it (`heldAt`, the step's `key`) and who must verify
 *     it there (`heldAssignees`: the step's assignees for its project or department, or whoever it
 *     was handed to). While held, the next stage does not show it, and Bank Balance cannot pay it.
 *   - Verifying passes it to the next Verification step of the same segment, or releases it to the
 *     next built-in stage. Handing over replaces `heldAssignees`; the new person's verification
 *     counts for the step.
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
 * one another by `key`, which never changes. Pure and importless — no React, no Firebase — so
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
}

/** The parts of a requisition this module reads (src/lib/types.ts DailyRequisitionEntry). */
export interface FlowEntryLike {
  status?: string;
  projectId?: string;
  departmentId?: string;
  heldAt?: string | null;
  heldAssignees?: string[] | null;
  assignedStage?: string | null;
  assignedTo?: string[] | null;
}

/** A built-in stage, by what it does. */
export type StageRole = 'receiving' | 'gst' | 'payment';

export type FlowRole = StageRole | 'other' | 'verification';

/** A built-in stage between which two Verification steps may hold: 1 = before GST & TDS Verification, 2 = before payment. */
export type FlowSegment = 1 | 2;

export interface PlacedStep<S extends FlowStepLike = FlowStepLike> {
  step: S;
  index: number;
  key: string;
  role: FlowRole;
  /** Built-in stages only: 0, 1, 2… counting built-in stages alone. */
  builtinIndex: number | null;
  /** Verification steps only: the segment it holds in, or null where it can hold nothing. */
  segment: FlowSegment | null;
}

/** The status a requisition rests in while a Verification step of the segment holds it. */
export const SEGMENT_STATUS: Record<FlowSegment, string> = {
  1: 'Received',
  2: 'Received for Payment',
};

/** Statuses a requisition is waiting in at each built-in stage — what may be taken from there. */
const WAITING_AT: Record<'receiving' | 'gst' | 'payment', readonly string[]> = {
  receiving: ['Pending'],
  gst: ['Received', 'Needs Review', 'Verified'],
  payment: ['Received for Payment', 'Partially Paid'],
};

const BUILTIN_ROLES: readonly FlowRole[] = ['receiving', 'gst', 'payment'];

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

/** Every step with its role: built-in stages by their order among built-in stages, Verification steps by where they sit. */
export function placeSteps<S extends FlowStepLike>(steps: readonly S[]): PlacedStep<S>[] {
  let builtin = 0;
  const placed: PlacedStep<S>[] = steps.map((step, index) => {
    if (isVerificationStep(step)) {
      return { step, index, key: stepKey(step), role: 'verification', builtinIndex: null, segment: null };
    }
    const builtinIndex = builtin++;
    return { step, index, key: stepKey(step), role: BUILTIN_ROLES[builtinIndex] ?? 'other', builtinIndex, segment: null };
  });

  // A Verification step holds in the segment of the built-in stage that follows it, provided a
  // built-in stage comes before it (requisitions enter at the first) and that stage is GST & TDS
  // Verification or payment (after payment there is nothing left to hold for).
  for (const p of placed) {
    if (p.role !== 'verification') continue;
    const before = placed.slice(0, p.index).some((q) => q.builtinIndex !== null);
    const next = placed.slice(p.index + 1).find((q) => q.builtinIndex !== null);
    if (before && next && (next.builtinIndex === 1 || next.builtinIndex === 2)) p.segment = next.builtinIndex;
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
  const receiving = placed.find((q) => q.role === 'receiving')?.step.name ?? 'the receiving stage';
  const payment = placed.find((q) => q.role === 'payment')?.step.name;
  if (!placed.slice(0, index).some((q) => q.builtinIndex !== null)) {
    return `comes before "${receiving}", where requisitions enter the workflow. Move it after that stage.`;
  }
  return payment
    ? `must come before "${payment}": after payment there is nothing left to verify. Move it up.`
    : 'must come before the payment stage. Move it up, or add the stages after it.';
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
    if (WAITING_AT[role].includes(status)) return placed.find((q) => q.role === role)?.index ?? null;
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
  return placed.find((q) => q.role === role) ?? null;
}

/** The statuses a requisition can be in while it waits at the step (what a query for that step asks for). */
export function waitingStatusesAt<S extends FlowStepLike>(placed: readonly PlacedStep<S>[], index: number): string[] {
  const p = placed[index];
  if (!p) return [];
  if (p.role === 'verification') return p.segment ? [SEGMENT_STATUS[p.segment]] : [];
  return p.role === 'other' ? [] : [...WAITING_AT[p.role]];
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
 * The hold and assignment fields a stage's status move writes. Handing over into a segment —
 * received at Finance (Pending → Received), or sent for payment (into Received for Payment from
 * GST & TDS Verification) — lands the requisition at the segment's first Verification step, when
 * there is one for it. Any other move releases a hold it had. Leaving the stage it was assigned at
 * ends the assignment; a move within that stage (verified, flagged for review) keeps it. Empty when
 * there is nothing to write.
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
        : null;
  const target = segment ? nextHolder(placed, segment, -1, { ...current, status: to }) : null;
  if (target) return { heldAt: target.step.key, heldAssignees: target.assignees, heldSince: now };
  const hasHold = Boolean(current.heldAt) || (current.heldAssignees?.length ?? 0) > 0;
  return hasHold ? { ...RELEASED } : {};
}

/** After the holder verifies: the segment's next Verification step for it, or released to the next stage. */
export function holdAfterVerify<S extends FlowStepLike, T>(steps: readonly S[], entry: FlowEntryLike, now: T): HoldFields<T> {
  const placed = placeSteps(steps);
  const held = heldStep(placed, entry);
  if (!held || held.segment === null) return { ...RELEASED };
  const next = nextHolder(placed, held.segment, held.index, entry);
  return next ? { heldAt: next.step.key, heldAssignees: next.assignees, heldSince: now } : { ...RELEASED };
}

/** What the step after a Verification step is called — where verifying sends a requisition. */
export function stepAfterVerify<S extends FlowStepLike>(steps: readonly S[], index: number): string | null {
  const placed = placeSteps(steps);
  // A Verification step that can hold is followed by another of its segment or by the stage it leads into.
  return placed[index]?.segment ? (placed[index + 1]?.step.name ?? null) : null;
}

/* ── taking early ────────────────────────────────────────────────────────── */

/** Whether the step may take requisitions early at all: GST & TDS Verification, payment, or a Verification step that can hold. */
export function canTakeInto<S extends FlowStepLike>(placed: readonly PlacedStep<S>[], index: number): boolean {
  const p = placed[index];
  if (!p || index === 0) return false;
  return p.role === 'gst' || p.role === 'payment' || (p.role === 'verification' && p.segment !== null);
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
  if (to.role === 'verification' && to.segment) {
    status = SEGMENT_STATUS[to.segment];
    const assignees = resolveStepAssignees(to.step, entry);
    if (assignees.length === 0) return { ok: false, reason: `"${to.step.name}" names nobody for this requisition's project or department.` };
    if (!assignees.includes(options.actorId)) return { ok: false, reason: `You are not assigned to "${to.step.name}" for this requisition.` };
    hold = { heldAt: to.key, heldAssignees: assignees, heldSince: options.now };
  } else {
    status = to.role === 'gst' ? SEGMENT_STATUS[1] : SEGMENT_STATUS[2];
  }

  const current = entry.status || 'Pending';
  const update: Record<string, unknown> & HoldFields<T> = { ...hold };
  if (status !== current) update.status = status;
  // Taken past Receiving at Finance: it is received now, by whoever took it.
  if (current === 'Pending') {
    update.receivedAt = options.now;
    update.receivedById = options.actorId;
  }
  // Whoever it was handed to at the stage it is taken from no longer has it.
  if (entry.assignedStage) Object.assign(update, UNASSIGNED);

  const gst = placed.find((q) => q.role === 'gst');
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
