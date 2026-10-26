/**
 * Over-limit approvals: a driver asks before a trip that would take the vehicle past its daily km
 * limit; the vehicle's approver decides.
 *
 * The chain: level 1 is the vehicle's approver (`approverUid`), or the driver's reporting authority
 * when none is set (decision D4); level 2 the vehicle's backup approver; level 3 the fleet's
 * escalation list in Settings. An undecided request moves up a level every `approvalEscalateMinutes`
 * and expires `approvalExpiryMinutes` after it was raised (spec: two hours). Everyone it has reached
 * may still decide — escalation adds people, it does not take the request away from the first.
 *
 * Nobody decides their own request, whatever level they sit at.
 */

import { addMinutesIso, toMs } from './dates.ts';
import { round1, type ApprovalDecision, type ApprovalHistoryEntry, type FleetApproval, type FleetSettings } from './types.ts';

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalError';
  }
}

export interface ApprovalChain {
  /** Level 1, 2, 3 — empty levels are skipped. */
  levels: [string[], string[], string[]];
}

export function buildChain(input: { approverIds: string[]; backupIds: string[]; escalationIds: string[]; driverUserId: string }): ApprovalChain {
  const clean = (list: string[]) => [...new Set(list.filter((id) => id && id !== input.driverUserId))];
  return { levels: [clean(input.approverIds), clean(input.backupIds), clean(input.escalationIds)] };
}

/** The first level at or after `from` that has someone on it. */
export function levelFrom(chain: ApprovalChain, from: number): number | null {
  for (let level = from; level <= 3; level += 1) if (chain.levels[level - 1].length) return level;
  return null;
}

const entry = (at: string, action: ApprovalHistoryEntry['action'], level: number, by: { id: string | null; name: string }, note = ''): ApprovalHistoryEntry => ({
  at,
  action,
  byId: by.id,
  byName: by.name,
  level,
  note,
});

export interface NewApprovalInput {
  id: string;
  organizationId: string;
  vehicleId: string;
  vehicleNumber: string;
  driverUserId: string;
  driverName: string;
  dateKey: string;
  usedKm: number;
  limitKm: number;
  requestedKm: number;
  reason: string;
  projectId: string | null;
  projectName: string;
  purposeId: string;
  purposeName: string;
}

export function createApproval(input: NewApprovalInput, chain: ApprovalChain, settings: Pick<FleetSettings, 'approvalEscalateMinutes' | 'approvalExpiryMinutes'>, now: string): FleetApproval {
  const level = levelFrom(chain, 1);
  if (level === null) {
    throw new ApprovalError('Nobody is set to approve running on this vehicle. Ask the fleet admin to set its approver, or use an emergency start.');
  }
  const assignees = chain.levels[level - 1];
  const nextLevel = levelFrom(chain, level + 1);
  return {
    ...input,
    status: 'pending',
    requestedKm: round1(input.requestedKm),
    level,
    assigneeIds: assignees,
    notifiedIds: assignees,
    escalateAt: nextLevel === null ? null : addMinutesIso(now, settings.approvalEscalateMinutes),
    expiresAt: addMinutesIso(now, settings.approvalExpiryMinutes),
    decision: null,
    allowedKm: null,
    newLimitKm: null,
    decidedById: null,
    decidedByName: '',
    decidedAt: null,
    decisionNote: '',
    tripId: null,
    history: [entry(now, 'requested', level, { id: input.driverUserId, name: input.driverName }, input.reason)],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * What the clock does to a waiting request: nothing yet, up a level, or expired. Run by the
 * five-minute job; idempotent (a request already moved this period is left alone).
 */
export function tickApproval(approval: FleetApproval, chain: ApprovalChain, settings: Pick<FleetSettings, 'approvalEscalateMinutes'>, now: string): { approval: FleetApproval; action: 'escalated' | 'expired' | null } {
  if (approval.status !== 'pending') return { approval, action: null };
  const nowMs = toMs(now);
  if (nowMs >= toMs(approval.expiresAt)) {
    return {
      approval: { ...approval, status: 'expired', escalateAt: null, updatedAt: now, history: [...approval.history, entry(now, 'expired', approval.level, { id: null, name: 'System' })] },
      action: 'expired',
    };
  }
  if (approval.escalateAt && nowMs >= toMs(approval.escalateAt)) {
    const level = levelFrom(chain, approval.level + 1);
    if (level === null) return { approval: { ...approval, escalateAt: null, updatedAt: now }, action: null };
    const added = chain.levels[level - 1];
    const further = levelFrom(chain, level + 1);
    return {
      approval: {
        ...approval,
        level,
        assigneeIds: added,
        notifiedIds: [...new Set([...approval.notifiedIds, ...added])],
        escalateAt: further === null ? null : addMinutesIso(now, settings.approvalEscalateMinutes),
        updatedAt: now,
        history: [...approval.history, entry(now, 'escalated', level, { id: null, name: 'System' }, 'Not decided in time')],
      },
      action: 'escalated',
    };
  }
  return { approval, action: null };
}

export function canDecide(approval: Pick<FleetApproval, 'status' | 'notifiedIds' | 'driverUserId'>, userId: string, override: boolean): boolean {
  if (approval.status !== 'pending' || approval.driverUserId === userId) return false;
  return approval.notifiedIds.includes(userId) || override;
}

export interface DecisionInput {
  decision: ApprovalDecision;
  /** approve_cap: the km this trip may run. */
  capKm?: number | null;
  /** approve_raise: the vehicle's new daily limit. */
  newLimitKm?: number | null;
  note?: string;
}

/**
 * Decide a request. Approve allows the day what was asked; approve with a cap allows less;
 * approve-and-raise also lifts the vehicle's daily limit for good (the caller writes it).
 */
export function decideApproval(approval: FleetApproval, input: DecisionInput, actor: { id: string; name: string; override: boolean }, now: string): FleetApproval {
  if (approval.status !== 'pending') throw new ApprovalError(`This request is already ${approval.status}.`);
  if (approval.driverUserId === actor.id) throw new ApprovalError('You cannot decide your own request.');
  if (!canDecide(approval, actor.id, actor.override)) throw new ApprovalError('This request is not with you.');
  if (toMs(now) >= toMs(approval.expiresAt)) throw new ApprovalError('This request has expired; the driver can ask again.');
  const note = (input.note ?? '').trim().slice(0, 500);
  let allowedKm: number | null = null;
  let newLimitKm: number | null = null;
  switch (input.decision) {
    case 'approve':
      allowedKm = round1(approval.usedKm + approval.requestedKm);
      break;
    case 'approve_cap': {
      const cap = Number(input.capKm);
      if (!Number.isFinite(cap) || cap <= 0) throw new ApprovalError('Enter the km this trip may run.');
      // A cap inside what the limit already leaves would allow less than no approval at all.
      const left = round1(Math.max(0, approval.limitKm - approval.usedKm));
      if (cap <= left) throw new ApprovalError(`${left} km are left within the limit already — cap above that, or reject.`);
      allowedKm = round1(approval.usedKm + cap);
      break;
    }
    case 'approve_raise': {
      const limit = Number(input.newLimitKm);
      if (!Number.isFinite(limit) || limit <= approval.limitKm) throw new ApprovalError(`Enter a new daily limit above ${approval.limitKm} km.`);
      if (limit > 2000) throw new ApprovalError('A daily limit above 2,000 km is not plausible.');
      newLimitKm = Math.round(limit);
      allowedKm = round1(Math.max(newLimitKm, approval.usedKm + approval.requestedKm));
      break;
    }
    case 'reject':
      if (!note) throw new ApprovalError('Say why the request is rejected.');
      break;
    default:
      throw new ApprovalError('Choose a decision.');
  }
  return {
    ...approval,
    status: input.decision === 'reject' ? 'rejected' : 'approved',
    decision: input.decision,
    allowedKm,
    newLimitKm,
    decidedById: actor.id,
    decidedByName: actor.name,
    decidedAt: now,
    decisionNote: note,
    escalateAt: null,
    updatedAt: now,
    history: [...approval.history, entry(now, input.decision, approval.level, { id: actor.id, name: actor.name }, actor.override && !approval.notifiedIds.includes(actor.id) ? `${note} (override)`.trim() : note)],
  };
}

export function cancelApproval(approval: FleetApproval, actor: { id: string; name: string }, now: string): FleetApproval {
  if (approval.status !== 'pending') throw new ApprovalError('Only a waiting request can be withdrawn.');
  if (approval.driverUserId !== actor.id) throw new ApprovalError('Only the driver who asked can withdraw it.');
  return { ...approval, status: 'cancelled', escalateAt: null, updatedAt: now, history: [...approval.history, entry(now, 'cancelled', approval.level, actor)] };
}

/** An approved request is used by the trip that started on it. */
export function useApproval(approval: FleetApproval, tripId: string, now: string): FleetApproval {
  if (approval.status !== 'approved') return approval;
  return { ...approval, status: 'used', tripId, updatedAt: now, history: [...approval.history, entry(now, 'used', approval.level, { id: approval.driverUserId, name: approval.driverName }, tripId)] };
}
