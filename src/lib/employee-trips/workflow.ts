/**
 * The claim workflow as configuration (Settings › Workflow).
 *
 * Approval stages in order, then one payment stage. A stage goes to the claimant's reporting
 * authority (the default for the first stage), to the same named people for every claim, or to
 * people per project or department — always with the stage's own people as the fallback — and
 * approval stages after the first may apply only from an amount up. Being assigned a stage is the
 * authority to work it: no role permission is needed (and none is enough, short of Trip Claims ·
 * Override Workflow, which exists for the absent approver). Nobody acts on their own claim.
 *
 * Stages are resolved onto the claim at submission, so a claim always shows who it waits for.
 * Saving the workflow re-resolves the people of every claim still in process (`rerouteClaim`).
 */

import { roundMoney, sumMoney } from './rates.ts';
import type {
  ClaimStage,
  ClaimTotals,
  LineDecision,
  StageRouting,
  TripClaim,
  TripClaimSettings,
  TripDecision,
  TripRecord,
  TripRules,
  WorkflowStage,
} from './types.ts';

export const DEFAULT_RULES: TripRules = {
  allowOwnVehicle: true,
  allowCompanyVehicle: true,
  requireOdometer: true,
  allowTollParking: true,
  requireProject: false,
  maxKmPerTrip: 300,
  maxKmPerDay: 400,
  claimWindowDays: 60,
};

export const DEFAULT_STAGES: WorkflowStage[] = [
  { id: 'verify', name: 'Reporting Authority Approval', kind: 'approval', routing: 'reporting', userIds: [], routes: [], minAmount: null, tatHours: 48 },
  { id: 'payment', name: 'Payment Processing', kind: 'payment', routing: 'users', userIds: [], routes: [], minAmount: null, tatHours: 72 },
];

const unique = (ids: readonly unknown[] | undefined): string[] => [...new Set((ids ?? []).map((id) => String(id ?? '').trim()).filter(Boolean))];
const positiveOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
const ROUTINGS: readonly StageRouting[] = ['reporting', 'users', 'project', 'department'];

function normaliseStage(stage: Partial<WorkflowStage>, kind: WorkflowStage['kind'], index: number): WorkflowStage {
  const routing = ROUTINGS.includes(stage.routing as StageRouting) ? (stage.routing as StageRouting) : 'users';
  // One route per project/department, and only routes that name someone.
  const routes = new Map<string, string[]>();
  for (const route of stage.routes ?? []) {
    const key = String(route?.key ?? '').trim();
    const userIds = unique(route?.userIds);
    if (key && userIds.length && !routes.has(key)) routes.set(key, userIds);
  }
  return {
    id: String(stage.id ?? '').trim() || (kind === 'payment' ? 'payment' : `stage-${index + 1}`),
    name: String(stage.name ?? '').trim().slice(0, 60) || (kind === 'payment' ? 'Payment Processing' : `Approval ${index + 1}`),
    kind,
    routing,
    userIds: unique(stage.userIds),
    routes: routing === 'users' ? [] : [...routes].map(([key, userIds]) => ({ key, userIds })),
    // The first approval stage sees every claim, so no claim reaches payment unapproved.
    minAmount: kind === 'approval' && index > 0 ? positiveOrNull(stage.minAmount) : null,
    tatHours: positiveOrNull(stage.tatHours),
  };
}

/**
 * Settings as stored, repaired: rules filled from the defaults, at least one approval stage, exactly
 * one payment stage and it last, stage ids unique. A settings document saved before an option
 * existed reads that option at its default instead of `undefined`.
 */
export function normaliseSettings(stored: Partial<TripClaimSettings> | null | undefined): TripClaimSettings {
  const rules: TripRules = { ...DEFAULT_RULES, ...(stored?.rules ?? {}) };
  for (const key of ['maxKmPerTrip', 'maxKmPerDay', 'claimWindowDays'] as const) rules[key] = positiveOrNull(rules[key]);
  if (!rules.allowOwnVehicle && !rules.allowCompanyVehicle) rules.allowOwnVehicle = true;

  const storedStages = Array.isArray(stored?.stages) ? stored!.stages : DEFAULT_STAGES;
  const approvals = storedStages.filter((stage) => stage?.kind !== 'payment');
  const payment = [...storedStages].reverse().find((stage) => stage?.kind === 'payment') ?? DEFAULT_STAGES[1];
  const stages = [
    ...(approvals.length ? approvals : [DEFAULT_STAGES[0]]).map((stage, index) => normaliseStage(stage, 'approval', index)),
    normaliseStage(payment, 'payment', 0),
  ];
  const ids = new Set<string>();
  for (const [index, stage] of stages.entries()) {
    if (ids.has(stage.id)) stage.id = `${stage.id}-${index + 1}`;
    ids.add(stage.id);
  }

  return {
    rateRevisions: Array.isArray(stored?.rateRevisions) ? stored!.rateRevisions : [],
    rules,
    stages,
    updatedAt: stored?.updatedAt,
    updatedById: stored?.updatedById,
    updatedByName: stored?.updatedByName,
  };
}

/** Routing keys the workflow needs on a claim: every trip on one claim must share these. */
export function routingFields(stages: readonly WorkflowStage[]): { project: boolean; department: boolean } {
  return { project: stages.some((stage) => stage.routing === 'project'), department: stages.some((stage) => stage.routing === 'department') };
}

export interface RoutingTarget {
  employeeId: string;
  projectId: string | null;
  departmentId: string | null;
  /** The claimant's reporting authority from their login or greytHR (resolved by the server). */
  reportingAuthorityIds?: readonly string[];
}

/**
 * The people of a stage for this claim, never the claimant. A routed stage whose route names nobody
 * else (or no route at all) falls back to the stage's own people.
 */
export function stageAssignees(stage: WorkflowStage, target: RoutingTarget): string[] {
  const others = (ids: readonly string[]) => unique(ids).filter((id) => id !== target.employeeId);
  let routed: string[] = [];
  if (stage.routing === 'reporting') {
    // An exception set for this employee on the stage wins over their profile.
    const exception = stage.routes.find((entry) => entry.key === target.employeeId);
    routed = others(exception?.userIds.length ? exception.userIds : target.reportingAuthorityIds ?? []);
  } else if (stage.routing === 'project' || stage.routing === 'department') {
    const key = stage.routing === 'project' ? target.projectId : target.departmentId;
    routed = others(stage.routes.find((entry) => entry.key === key)?.userIds ?? []);
  }
  return routed.length ? routed : others(stage.userIds);
}

/** The stages a claim of this amount goes through, people resolved. */
export function resolveClaimStages(
  settings: Pick<TripClaimSettings, 'stages'>,
  target: RoutingTarget & { amount: number },
  nameOf: (userId: string) => string,
): ClaimStage[] {
  return settings.stages
    .filter((stage) => stage.kind === 'payment' || stage.minAmount === null || target.amount >= stage.minAmount)
    .map((stage) => {
      const assigneeIds = stageAssignees(stage, target);
      return { id: stage.id, name: stage.name, kind: stage.kind, assigneeIds, assigneeNames: assigneeIds.map(nameOf), tatHours: stage.tatHours };
    });
}

/** Is anyone named on any stage (for any route) — lets them into Approvals or Payments. */
export function namedStageKinds(settings: Pick<TripClaimSettings, 'stages'>, userId: string): { approval: boolean; payment: boolean } {
  const named = (stage: WorkflowStage) => stage.userIds.includes(userId) || stage.routes.some((route) => route.userIds.includes(userId));
  return {
    approval: settings.stages.some((stage) => stage.kind === 'approval' && named(stage)),
    payment: settings.stages.some((stage) => stage.kind === 'payment' && named(stage)),
  };
}

/* ── who may do what ───────────────────────────────────────────────────── */

export interface ClaimActor {
  userId: string;
  /** Trip Claims · Override Workflow. */
  override: boolean;
}

export interface ClaimAbilities {
  /** Approve / send back / reject at the current approval stage. */
  decide: boolean;
  /** Record the payment, or send back / reject at the payment stage. */
  pay: boolean;
  withdraw: boolean;
  /** Acting only through the override, not as a named assignee. */
  viaOverride: boolean;
  /** Why the viewer cannot act, when they are close to being able to (shown on the claim). */
  reason: string | null;
}

type AbilityClaim = Pick<TripClaim, 'status' | 'employeeId' | 'currentAssigneeIds' | 'currentStageIndex' | 'history' | 'stages'>;

export function claimAbilities(claim: AbilityClaim, actor: ClaimActor): ClaimAbilities {
  const none: ClaimAbilities = { decide: false, pay: false, withdraw: false, viaOverride: false, reason: null };
  const own = claim.employeeId === actor.userId;
  const active = claim.status === 'pending' || claim.status === 'approved';
  if (!active) return none;

  if (own) {
    // Until anyone has acted on it, the claimant may pull it back.
    const untouched = claim.status === 'pending' && claim.currentStageIndex === 0 && claim.history.every((entry) => entry.action === 'submitted' || entry.action === 'rerouted');
    return { ...none, withdraw: untouched, reason: untouched ? null : 'This is your own claim; it is with the approvers now.' };
  }

  const assigned = claim.currentAssigneeIds.includes(actor.userId);
  if (!assigned && !actor.override) return none;
  const stage = claim.stages[claim.currentStageIndex];
  const atPayment = stage?.kind === 'payment' && claim.status === 'approved';
  return { ...none, decide: claim.status === 'pending', pay: atPayment, viaOverride: !assigned };
}

/** Is the claim waiting for this person now? */
export const isWaitingFor = (claim: Pick<TripClaim, 'status' | 'currentAssigneeIds' | 'employeeId'>, userId: string): boolean =>
  (claim.status === 'pending' || claim.status === 'approved') && claim.employeeId !== userId && claim.currentAssigneeIds.includes(userId);

/** Hours the claim has waited at its current stage, and whether that is past the stage's TAT. */
export function stageAge(claim: Pick<TripClaim, 'stageEnteredAt' | 'stages' | 'currentStageIndex' | 'status'>, now: Date = new Date()): { hours: number; overdue: boolean } {
  const entered = Date.parse(claim.stageEnteredAt);
  const hours = Number.isNaN(entered) ? 0 : Math.max(0, (now.getTime() - entered) / 3_600_000);
  const tat = claim.stages[claim.currentStageIndex]?.tatHours ?? null;
  return { hours, overdue: (claim.status === 'pending' || claim.status === 'approved') && tat !== null && hours > tat };
}

/* ── decisions ─────────────────────────────────────────────────────────── */

export interface LineDecisionInput {
  tripId: string;
  decision: LineDecision;
  approvedKm?: number | null;
  remarks?: string;
}

type DecisionTrip = Pick<TripRecord, 'id' | 'distanceKm' | 'ratePerKm' | 'tollAmount' | 'parkingAmount' | 'distanceAmount' | 'totalAmount' | 'decision' | 'status'>;

export interface DecisionOutcome {
  /** The trips staying on the claim with their new decision. */
  kept: { tripId: string; decision: TripDecision }[];
  /** Trips sent back to the employee as drafts. */
  returned: { tripId: string; remarks: string }[];
  summary: string;
}

/** Thrown for a decision the approver can correct; the message is shown as is. */
export class DecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionError';
  }
}

/**
 * Applies an approver's per-trip decisions. A trip without an entry is approved at what the
 * previous stage allowed (or as claimed). A cut needs a lower distance and a reason; a rejection
 * and a send-back need a reason. At least one trip must stay approved — rejecting or sending back
 * the whole claim has its own buttons.
 */
export function applyDecisions(
  trips: readonly DecisionTrip[],
  inputs: readonly LineDecisionInput[],
  who: { stageName: string; byId: string; byName: string; at: string },
): DecisionOutcome {
  const byTrip = new Map(inputs.map((input) => [input.tripId, input]));
  for (const input of inputs) if (!trips.some((trip) => trip.id === input.tripId)) throw new DecisionError('A decision names a trip that is not on this claim.');

  const kept: DecisionOutcome['kept'] = [];
  const returned: DecisionOutcome['returned'] = [];
  let cut = 0;
  let rejected = 0;
  for (const trip of trips) {
    if (trip.status === 'rejected' || trip.decision?.decision === 'reject') {
      if (trip.decision) kept.push({ tripId: trip.id, decision: trip.decision });
      continue;
    }
    const input = byTrip.get(trip.id);
    const remarks = String(input?.remarks ?? '').trim().slice(0, 300);
    const allowedKm = trip.decision ? trip.decision.approvedKm : trip.distanceKm;
    const extras = sumMoney([trip.tollAmount, trip.parkingAmount]);
    const base = { stageName: who.stageName, byId: who.byId, byName: who.byName, at: who.at };

    switch (input?.decision ?? 'approve') {
      case 'approve':
        // Agreeing with an earlier stage keeps that stage's decision, so a cut still names who made it.
        kept.push({ tripId: trip.id, decision: trip.decision ?? { ...base, decision: 'approve', approvedKm: allowedKm, approvedAmount: trip.totalAmount } });
        break;
      case 'adjust': {
        const km = Number(input?.approvedKm);
        if (!Number.isFinite(km) || km < 0 || km >= allowedKm) throw new DecisionError(`A cut must be below ${allowedKm} km for the trip on that line.`);
        if (!remarks) throw new DecisionError('Say why the distance was cut.');
        const roundedKm = Math.round(km * 10) / 10;
        const distanceAmount = trip.ratePerKm === null ? 0 : roundMoney(roundedKm * trip.ratePerKm);
        kept.push({ tripId: trip.id, decision: { ...base, decision: 'adjust', approvedKm: roundedKm, approvedAmount: sumMoney([distanceAmount, extras]), remarks } });
        cut += 1;
        break;
      }
      case 'reject':
        if (!remarks) throw new DecisionError('Say why the trip is rejected.');
        kept.push({ tripId: trip.id, decision: { ...base, decision: 'reject', approvedKm: 0, approvedAmount: 0, remarks } });
        rejected += 1;
        break;
      case 'return':
        if (!remarks) throw new DecisionError('Say what the employee should correct.');
        returned.push({ tripId: trip.id, remarks });
        break;
    }
  }

  if (!kept.some((entry) => entry.decision.decision !== 'reject')) {
    throw new DecisionError('No trip would stay approved. Use “Reject claim” or “Send back” for the whole claim instead.');
  }
  const parts = [rejected && `${rejected} rejected`, cut && `${cut} cut`, returned.length && `${returned.length} sent back`].filter(Boolean);
  return { kept, returned, summary: parts.join(', ') };
}

/** Claim totals over the trips on it; approved figures over those not rejected. */
export function claimTotals(trips: readonly Pick<TripRecord, 'distanceKm' | 'totalAmount' | 'tollAmount' | 'parkingAmount' | 'decision'>[]): ClaimTotals {
  const live = trips.filter((trip) => trip.decision?.decision !== 'reject');
  return {
    tripCount: trips.length,
    distanceKm: Math.round(trips.reduce((total, trip) => total + trip.distanceKm, 0) * 10) / 10,
    claimedAmount: sumMoney(trips.map((trip) => trip.totalAmount)),
    tollParking: sumMoney(trips.flatMap((trip) => [trip.tollAmount, trip.parkingAmount])),
    approvedKm: Math.round(live.reduce((total, trip) => total + (trip.decision ? trip.decision.approvedKm : trip.distanceKm), 0) * 10) / 10,
    approvedAmount: sumMoney(live.map((trip) => (trip.decision ? trip.decision.approvedAmount : trip.totalAmount))),
  };
}

/**
 * New people for a claim still in process after the workflow was saved: the current and later
 * stages are re-resolved by stage id (a stage removed from the workflow keeps the people it had).
 * Returns null when nothing changes.
 */
export function rerouteClaim(
  claim: Pick<TripClaim, 'status' | 'stages' | 'currentStageIndex' | 'employeeId' | 'projectId' | 'departmentId' | 'reportingAuthorityIds'>,
  settings: Pick<TripClaimSettings, 'stages'>,
  nameOf: (userId: string) => string,
): { stages: ClaimStage[]; currentAssigneeIds: string[] } | null {
  if (claim.status !== 'pending' && claim.status !== 'approved') return null;
  const target = { employeeId: claim.employeeId, projectId: claim.projectId, departmentId: claim.departmentId, reportingAuthorityIds: claim.reportingAuthorityIds ?? [] };
  let changed = false;
  const stages = claim.stages.map((stage, index) => {
    if (index < claim.currentStageIndex) return stage;
    const configured = settings.stages.find((entry) => entry.id === stage.id);
    if (!configured) return stage;
    const assigneeIds = stageAssignees(configured, target);
    const same = assigneeIds.length === stage.assigneeIds.length && assigneeIds.every((id) => stage.assigneeIds.includes(id));
    if (same && configured.name === stage.name && configured.tatHours === stage.tatHours) return stage;
    changed = true;
    return { ...stage, name: configured.name, tatHours: configured.tatHours, assigneeIds, assigneeNames: assigneeIds.map(nameOf) };
  });
  return changed ? { stages, currentAssigneeIds: stages[claim.currentStageIndex]?.assigneeIds ?? [] } : null;
}

/** "TC-2026-27-0042". */
export const claimNumberFor = (financialYear: string, sequence: number): string => `TC-${financialYear}-${String(sequence).padStart(4, '0')}`;
