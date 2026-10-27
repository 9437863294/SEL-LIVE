import 'server-only';

/**
 * Over-limit approvals on the server: a driver asks, the chain decides, the clock escalates and
 * expires (../approvals.ts holds the rules). Approve-and-raise also lifts the vehicle's daily limit.
 */

import { reportingAuthorityOf } from '@/lib/employee-trips/server/lookups';
import { projectAllowed } from '@/lib/employee-projects/links';
import { employeeTripProjectIdsOf } from '@/lib/employee-projects/server';
import { addDays } from '../dates.ts';
import { buildChain, cancelApproval, createApproval, decideApproval, tickApproval, type ApprovalChain } from '../approvals.ts';
import { dayAllowance, kmUsedOn } from '../limits.ts';
import { approvalDecisionSchema, approvalRequestSchema } from '../schemas.ts';
import { APPROVAL_DECISION_LABELS, FLEET_COLLECTIONS, formatKm, stripUndefined, type FleetApproval, type FleetSettings, type FleetTrip, type FleetVehicle } from '../types.ts';
import { db, FleetError, type FleetContext } from './context';
import { afterAudit, afterMessages, sendFleetMessage, type FleetMessage } from './notify';
import { activePurposes, fleetTripProjects, fleetVehicles, forgetVehicles, loadFleetSettings } from './lookups';
import { tripsOnDays } from './trips';

const approvalsCol = () => db().collection(FLEET_COLLECTIONS.approvals);
const approvalLink = (id: string) => `/driver-management/approvals?tab=fleet&open=${id}`;

const toApproval = (id: string, data: Record<string, unknown>) => ({ ...(data as unknown as FleetApproval), id });

export async function chainFor(vehicle: FleetVehicle, driverUserId: string, settings: FleetSettings): Promise<ApprovalChain> {
  const approverIds = vehicle.approverUid ? [vehicle.approverUid] : (await reportingAuthorityOf(driverUserId)).ids;
  return buildChain({ approverIds, backupIds: vehicle.backupApproverUid ? [vehicle.backupApproverUid] : [], escalationIds: settings.escalationUserIds, driverUserId });
}

function requestMessage(approval: FleetApproval, userIds: string[], escalated: boolean): FleetMessage {
  return {
    userIds,
    title: `${escalated ? 'Escalated: ' : ''}${approval.vehicleNumber} needs ${formatKm(approval.requestedKm)} over its limit`,
    body: `${approval.driverName} has used ${formatKm(approval.usedKm)} of ${formatKm(approval.limitKm)} today — ${approval.purposeName}${approval.projectName ? `, ${approval.projectName}` : ''}: ${approval.reason}`,
    link: approvalLink(approval.id),
    channels: ['push', 'email', 'whatsapp'],
    severity: escalated ? 'WARNING' : 'INFO',
    type: 'approval_required',
    itemId: approval.id,
    itemRef: approval.vehicleNumber,
    organizationId: approval.organizationId,
  };
}

export async function requestApproval(context: FleetContext, body: unknown): Promise<{ approval: FleetApproval; reused: boolean }> {
  const input = approvalRequestSchema.parse(body);
  const settings = await loadFleetSettings(context.organizationId);
  const [vehicles, purposes, projects] = await Promise.all([fleetVehicles(settings), activePurposes(), fleetTripProjects()]);
  const vehicle = vehicles.find((entry) => entry.id === input.vehicleId);
  if (!vehicle || !vehicle.active) throw new FleetError('That vehicle is not available.', 404);
  const purpose = purposes.find((entry) => entry.id === input.purposeId);
  if (!purpose) throw new FleetError('Choose the purpose of the trip.', 400, { fields: { purposeId: 'Choose a purpose.' } });
  const project = input.projectId ? projects.find((entry) => entry.id === input.projectId) ?? null : null;
  // Settings › Fleet may limit a trip to the employee's own projects (their greytHR project, linked
  // on Employee › Category); someone with no linked project may pick any.
  if (settings.employeeProjectsOnly && input.projectId && !projectAllowed(input.projectId, await employeeTripProjectIdsOf(context.userId), true)) {
    throw new FleetError('Choose one of your projects — Settings › Fleet limits trips to the employee’s own projects.', 400, { fields: { projectId: 'Choose one of your projects.' } });
  }

  const today = context.today;
  const [touching, existing] = await Promise.all([tripsOnDays([today, addDays(today, -1)]), approvalsCol().where('vehicleId', '==', vehicle.id).get()]);
  const approvals = existing.docs.map((doc) => toApproval(doc.id, doc.data())).filter((approval) => approval.dateKey === today);
  const waiting = approvals.find((approval) => approval.status === 'pending' && approval.driverUserId === context.userId);
  if (waiting) return { approval: waiting, reused: true };

  const usedKm = kmUsedOn(touching, vehicle.id, today);
  const allowance = dayAllowance(vehicle, today, approvals);
  if (usedKm + input.requestedKm <= allowance.allowedKm) {
    throw new FleetError(`No approval is needed: ${vehicle.vehicleNumber} has ${formatKm(allowance.allowedKm - usedKm)} left today.`, 400, { code: 'within_limit' });
  }

  const chain = await chainFor(vehicle, context.userId, settings);
  const ref = approvalsCol().doc();
  const approval = createApproval(
    {
      id: ref.id,
      organizationId: context.organizationId,
      vehicleId: vehicle.id,
      vehicleNumber: vehicle.vehicleNumber,
      driverUserId: context.userId,
      driverName: context.userName,
      dateKey: today,
      usedKm,
      limitKm: allowance.allowedKm,
      requestedKm: input.requestedKm,
      reason: input.reason,
      projectId: project?.id ?? null,
      projectName: project?.name ?? '',
      purposeId: purpose.id,
      purposeName: purpose.name,
    },
    chain,
    settings,
    context.now,
  );
  await ref.set(stripUndefined(approval));
  afterMessages([requestMessage(approval, approval.assigneeIds, false)], context.userId);
  afterAudit(context, 'Request Fleet Approval', { after: { vehicle: approval.vehicleNumber, usedKm, limitKm: approval.limitKm, requestedKm: approval.requestedKm, reason: approval.reason, level: approval.level } }, approval.id, approval.vehicleNumber);
  return { approval, reused: false };
}

export async function actOnApproval(context: FleetContext, approvalId: string, body: unknown): Promise<{ approval: FleetApproval }> {
  const input = approvalDecisionSchema.parse(body);
  const ref = approvalsCol().doc(approvalId);
  const approval = await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new FleetError('That request was not found.', 404);
    const current = toApproval(snapshot.id, snapshot.data()!);
    let next: FleetApproval;
    if (input.action === 'cancel') next = cancelApproval(current, { id: context.userId, name: context.userName }, context.now);
    else {
      next = decideApproval(current, { decision: input.action, capKm: input.capKm, newLimitKm: input.newLimitKm, note: input.note }, { id: context.userId, name: context.userName, override: context.fleet.review }, context.now);
      if (next.decision === 'approve_raise' && next.newLimitKm) {
        transaction.set(db().collection(FLEET_COLLECTIONS.vehicles).doc(current.vehicleId), { dailyKmLimit: next.newLimitKm, updatedAt: context.now, updatedBy: context.userId }, { merge: true });
      }
    }
    transaction.set(ref, stripUndefined(next));
    return next;
  });
  if (approval.decision === 'approve_raise') forgetVehicles();

  if (input.action !== 'cancel') {
    const approved = approval.status === 'approved';
    afterMessages(
      [
        {
          userIds: [approval.driverUserId],
          title: approved ? `Approved: ${approval.vehicleNumber} may run ${formatKm(approval.allowedKm)} today` : `Not approved: ${approval.vehicleNumber}`,
          body: approved ? `${approval.decidedByName} ${APPROVAL_DECISION_LABELS[approval.decision!].toLowerCase()}d. You can start the trip now.${approval.decisionNote ? ` Note: ${approval.decisionNote}` : ''}` : `${approval.decidedByName}: ${approval.decisionNote}`,
          link: '/driver-management/fleet',
          channels: ['push', 'whatsapp'],
          severity: approved ? 'INFO' : 'WARNING',
          type: 'record_assigned',
          itemId: approval.id,
          organizationId: approval.organizationId,
        },
      ],
      context.userId,
    );
  }
  afterAudit(context, input.action === 'cancel' ? 'Withdraw Fleet Approval' : 'Decide Fleet Approval', { before: { status: 'pending' }, after: { status: approval.status, decision: approval.decision, allowedKm: approval.allowedKm, newLimitKm: approval.newLimitKm, note: approval.decisionNote } }, approval.id, approval.vehicleNumber);
  return { approval };
}

export async function myApprovals(context: FleetContext): Promise<FleetApproval[]> {
  const snapshot = await approvalsCol().where('driverUserId', '==', context.userId).get();
  return snapshot.docs.map((doc) => toApproval(doc.id, doc.data())).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
}

/** Requests that have reached the caller, waiting first; with Fleet Trips · Review, every waiting one. */
export async function approvalInbox(context: FleetContext): Promise<{ approvals: FleetApproval[]; canOverride: boolean }> {
  const [mine, pending] = await Promise.all([
    approvalsCol().where('notifiedIds', 'array-contains', context.userId).get(),
    context.fleet.review ? approvalsCol().where('status', '==', 'pending').get() : Promise.resolve(null),
  ]);
  const byId = new Map<string, FleetApproval>();
  for (const doc of [...mine.docs, ...(pending?.docs ?? [])]) byId.set(doc.id, toApproval(doc.id, doc.data()));
  const approvals = [...byId.values()]
    .filter((approval) => approval.driverUserId !== context.userId)
    .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 200);
  return { approvals, canOverride: context.fleet.review };
}

export async function approvalDetail(context: FleetContext, approvalId: string): Promise<{ approval: FleetApproval; todaysTrips: FleetTrip[] }> {
  const snapshot = await approvalsCol().doc(approvalId).get();
  if (!snapshot.exists) throw new FleetError('That request was not found.', 404);
  const approval = toApproval(snapshot.id, snapshot.data()!);
  const allowed = approval.driverUserId === context.userId || approval.notifiedIds.includes(context.userId) || context.fleet.review || context.fleet.viewAll;
  if (!allowed) throw new FleetError('You cannot view this request.', 403);
  const trips = (await tripsOnDays([approval.dateKey, addDays(approval.dateKey, -1)])).filter((trip) => trip.vehicleId === approval.vehicleId && (trip.dateKey === approval.dateKey || trip.kmByDate[approval.dateKey]));
  return { approval, todaysTrips: trips.sort((a, b) => a.startedAt.localeCompare(b.startedAt)) };
}

/** Five-minute job: escalate and expire waiting requests. */
export async function tickApprovals(now: string): Promise<{ pending: number; escalated: number; expired: number }> {
  const snapshot = await approvalsCol().where('status', '==', 'pending').get();
  let escalated = 0;
  let expired = 0;
  const settingsByOrg = new Map<string, FleetSettings>();
  for (const doc of snapshot.docs) {
    const approval = toApproval(doc.id, doc.data());
    const organizationId = approval.organizationId || 'default';
    const settings = settingsByOrg.get(organizationId) ?? (await loadFleetSettings(organizationId));
    settingsByOrg.set(organizationId, settings);
    const vehicle = (await fleetVehicles(settings)).find((entry) => entry.id === approval.vehicleId);
    if (!vehicle) continue;
    const chain = await chainFor(vehicle, approval.driverUserId, settings);
    const result = tickApproval(approval, chain, settings, now);
    if (!result.action && result.approval === approval) continue;
    // Written only if it is still waiting: a decision a second ago wins over the clock.
    const ref = approvalsCol().doc(approval.id);
    const written = await db().runTransaction(async (transaction) => {
      const fresh = await transaction.get(ref);
      if (fresh.data()?.status !== 'pending' || fresh.data()?.updatedAt !== approval.updatedAt) return false;
      transaction.set(ref, stripUndefined(result.approval));
      return true;
    });
    if (!written) continue;
    if (result.action === 'escalated') {
      escalated += 1;
      const added = result.approval.notifiedIds.filter((id) => !approval.notifiedIds.includes(id));
      await sendFleetMessage({ ...requestMessage(result.approval, added, true), dedupeKey: `fleet-approval-${approval.id}-l${result.approval.level}` });
    } else if (result.action === 'expired') {
      expired += 1;
      await sendFleetMessage({
        userIds: [approval.driverUserId],
        title: `Request expired: ${approval.vehicleNumber}`,
        body: 'Nobody decided in time. Ask again, or use an emergency start if it cannot wait.',
        link: '/driver-management/fleet',
        type: 'record_assigned',
        severity: 'WARNING',
        itemId: approval.id,
        dedupeKey: `fleet-approval-${approval.id}-expired`,
        organizationId: approval.organizationId,
      });
    }
  }
  return { pending: snapshot.size, escalated, expired };
}
