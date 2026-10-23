import 'server-only';

/**
 * Claims: submitting trips, every workflow action, payment, and the lists each screen shows.
 *
 * Each change runs in one transaction that re-reads the claim and its trips, so two approvers
 * pressing Approve at once cannot both advance it, and a trip cannot land on two claims. Who may act
 * is `claimAbilities` from the pure workflow — the same answer the screen used to offer the button.
 */

import { FieldValue } from 'firebase-admin/firestore';

import { formatINR } from '../rates.ts';
import { bulkPaySchema, claimActionSchema, submitClaimSchema } from '../schemas.ts';
import { withinClaimWindow } from '../trips.ts';
import {
  ACTIVE_CLAIM_STATUSES,
  ET_COLLECTIONS,
  financialYearOf,
  type ClaimHistoryEntry,
  type ClaimPayment,
  type TripClaim,
  type TripRecord,
} from '../types.ts';
import { applyDecisions, claimAbilities, claimNumberFor, claimTotals, resolveClaimStages, routingFields } from '../workflow.ts';
import { TripError, db, nowIso, type TripContext } from './context';
import { departmentOptions, loadSettings, nameResolver, projectOptions, reportingAuthorityOf } from './lookups';
import { afterClaimChange, claimSummary, type ClaimNotice } from './notify';
import { listMyTrips, priceAndFlag, toTrip, vehicleTrips } from './trips';

const claimsCollection = () => db().collection(ET_COLLECTIONS.claims);
const tripsCollection = () => db().collection(ET_COLLECTIONS.trips);

export function toClaim(id: string, data: FirebaseFirestore.DocumentData): TripClaim {
  return {
    id,
    organizationId: String(data.organizationId ?? 'default'),
    claimNumber: String(data.claimNumber ?? ''),
    financialYear: String(data.financialYear ?? ''),
    employeeId: String(data.employeeId ?? ''),
    employeeName: String(data.employeeName ?? ''),
    projectId: data.projectId ?? null,
    projectName: data.projectName ?? null,
    departmentId: data.departmentId ?? null,
    departmentName: data.departmentName ?? null,
    reportingAuthorityIds: Array.isArray(data.reportingAuthorityIds) ? data.reportingAuthorityIds : [],
    tripIds: Array.isArray(data.tripIds) ? data.tripIds : [],
    periodFrom: String(data.periodFrom ?? ''),
    periodTo: String(data.periodTo ?? ''),
    totals: data.totals ?? { tripCount: 0, distanceKm: 0, claimedAmount: 0, tollParking: 0, approvedKm: 0, approvedAmount: 0 },
    status: data.status ?? 'pending',
    stages: Array.isArray(data.stages) ? data.stages : [],
    currentStageIndex: Number(data.currentStageIndex ?? 0),
    currentAssigneeIds: Array.isArray(data.currentAssigneeIds) ? data.currentAssigneeIds : [],
    stageEnteredAt: String(data.stageEnteredAt ?? ''),
    actedByIds: Array.isArray(data.actedByIds) ? data.actedByIds : [],
    history: Array.isArray(data.history) ? data.history : [],
    payment: data.payment ?? null,
    remarks: String(data.remarks ?? ''),
    submittedAt: String(data.submittedAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
  };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * A history entry with its unset optional fields left out: the Admin SDK here does not ignore
 * undefined properties, and one `remarks: undefined` makes Firestore refuse the whole write.
 */
const historyEntry = (fields: ClaimHistoryEntry): ClaimHistoryEntry =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as unknown as ClaimHistoryEntry;

/* ── submission ────────────────────────────────────────────────────────── */

/**
 * Submits the chosen drafts. When the workflow routes by project or department, trips of different
 * projects/departments become separate claims, each routed to its own people; otherwise one claim.
 * Drafts are re-priced from the current rate card here — a rate added since they were recorded
 * applies — and frozen from then on.
 */
export async function submitClaims(context: TripContext, body: unknown): Promise<{ claims: { id: string; claimNumber: string; amount: number }[] }> {
  const input = submitClaimSchema.parse(body);
  const [settings, mine, nameOf, projects, departments, authority] = await Promise.all([
    loadSettings(context.organizationId),
    listMyTrips(context),
    nameResolver(),
    projectOptions(),
    departmentOptions(),
    reportingAuthorityOf(context.userId),
  ]);

  const chosen = [...new Set(input.tripIds)].map((id) => mine.find((trip) => trip.id === id));
  if (chosen.some((trip) => !trip)) throw new TripError('Some of those trips are not yours or no longer exist. Refresh and try again.', 404);
  const trips = chosen as TripRecord[];
  const claimed = trips.filter((trip) => trip.status !== 'draft');
  if (claimed.length) throw new TripError(`${plural(claimed.length, 'trip')} chosen ${claimed.length === 1 ? 'is' : 'are'} already on a claim. Refresh and try again.`, 409);
  const expired = trips.filter((trip) => !withinClaimWindow(trip.tripDate, context.today, settings.rules));
  if (expired.length) throw new TripError(`Trips older than ${settings.rules.claimWindowDays} days can no longer be claimed (${expired.map((trip) => trip.tripDate).join(', ')}).`, 400);

  const sameVehicle = await vehicleTrips(context.organizationId, trips.map((trip) => trip.vehicleNumber));
  const priced = trips.map((trip) => ({ ...trip, ...priceAndFlag(trip, settings, { sameEmployee: mine, sameVehicle }) }));

  const routing = routingFields(settings.stages);
  const groups = new Map<string, TripRecord[]>();
  for (const trip of priced) {
    const key = `${routing.project ? trip.projectId ?? '' : ''}|${routing.department ? trip.departmentId ?? '' : ''}`;
    groups.set(key, [...(groups.get(key) ?? []), trip]);
  }

  const now = nowIso();
  const financialYear = financialYearOf(context.today);
  const plans = [...groups.values()].map((group) => {
    const projectId = routing.project ? group[0].projectId : null;
    const departmentId = routing.department ? group[0].departmentId : null;
    const totals = claimTotals(group.map((trip) => ({ ...trip, decision: null })));
    const stages = resolveClaimStages(settings, { employeeId: context.userId, projectId, departmentId, reportingAuthorityIds: authority.ids, amount: totals.claimedAmount }, nameOf);
    const dates = group.map((trip) => trip.tripDate).sort();
    return {
      ref: claimsCollection().doc(),
      trips: group.sort((a, b) => a.tripDate.localeCompare(b.tripDate)),
      claim: {
        organizationId: context.organizationId,
        financialYear,
        employeeId: context.userId,
        employeeName: context.userName,
        projectId,
        projectName: projectId ? projects.find((entry) => entry.id === projectId)?.name ?? null : null,
        departmentId,
        departmentName: departmentId ? departments.find((entry) => entry.id === departmentId)?.name ?? null : null,
        reportingAuthorityIds: authority.ids,
        tripIds: group.map((trip) => trip.id),
        periodFrom: dates[0],
        periodTo: dates[dates.length - 1],
        totals,
        status: stages[0].kind === 'payment' ? ('approved' as const) : ('pending' as const),
        stages,
        currentStageIndex: 0,
        currentAssigneeIds: stages[0].assigneeIds,
        stageEnteredAt: now,
        actedByIds: [context.userId],
        history: [historyEntry({ action: 'submitted', stageName: 'Submitted', byId: context.userId, byName: context.userName, at: now, remarks: input.remarks || undefined, amount: totals.claimedAmount })],
        payment: null,
        remarks: input.remarks,
        submittedAt: now,
        updatedAt: now,
      },
    };
  });

  const counterRef = db().collection(ET_COLLECTIONS.counters).doc(`${context.organizationId}_${financialYear}`);
  const created: TripClaim[] = [];
  await db().runTransaction(async (transaction) => {
    created.length = 0;
    const [counter, ...current] = await Promise.all([transaction.get(counterRef), ...trips.map((trip) => transaction.get(tripsCollection().doc(trip.id)))]);
    for (const snapshot of current) {
      const data = snapshot.data();
      if (!snapshot.exists || data?.employeeId !== context.userId || data?.status !== 'draft') {
        throw new TripError('One of the trips was changed or submitted meanwhile. Refresh and try again.', 409);
      }
    }
    let sequence = counter.exists ? Number(counter.data()?.value ?? 0) : 0;
    for (const plan of plans) {
      sequence += 1;
      const claimNumber = claimNumberFor(financialYear, sequence);
      const claim: TripClaim = { id: plan.ref.id, claimNumber, ...plan.claim };
      // `id` lives in the document name, not the document.
      const { id: _id, ...stored } = claim;
      transaction.set(plan.ref, stored);
      const tripStatus = claim.status === 'approved' ? 'approved' : 'submitted';
      for (const trip of plan.trips) {
        transaction.update(tripsCollection().doc(trip.id), {
          status: tripStatus,
          claimId: claim.id,
          claimNumber,
          decision: null,
          returnNote: null,
          ratePerKm: trip.ratePerKm,
          rateRevisionId: trip.rateRevisionId,
          distanceAmount: trip.distanceAmount,
          totalAmount: trip.totalAmount,
          flags: trip.flags,
          updatedAt: now,
        });
      }
      created.push(claim);
    }
    transaction.set(counterRef, { value: sequence, updatedAt: now }, { merge: true });
  });

  for (const claim of created) {
    const first = claim.stages[0];
    afterClaimChange(context, claim, { action: 'Submit Trip Claim', details: { trips: claim.totals.tripCount, distanceKm: claim.totals.distanceKm, amount: claim.totals.claimedAmount } }, [
      {
        userIds: first.assigneeIds,
        title: first.kind === 'payment' ? `Trip claim ${claim.claimNumber} is ready for payment` : `Trip claim ${claim.claimNumber} needs your approval`,
        body: `${claimSummary(claim)} — ${first.name}`,
      },
    ]);
  }
  return { claims: created.map((claim) => ({ id: claim.id, claimNumber: claim.claimNumber, amount: claim.totals.claimedAmount })) };
}

/* ── reading ───────────────────────────────────────────────────────────── */

/** May this person open the claim: the claimant, anyone on its workflow, or a wider grant. */
export function canViewClaim(context: TripContext, claim: TripClaim): boolean {
  if (claim.organizationId !== context.organizationId) return false;
  return (
    claim.employeeId === context.userId ||
    context.trip.viewAll ||
    context.trip.override ||
    claim.actedByIds.includes(context.userId) ||
    claim.stages.some((stage) => stage.assigneeIds.includes(context.userId))
  );
}

async function claimTrips(claim: TripClaim): Promise<TripRecord[]> {
  if (!claim.tripIds.length) return [];
  const snapshots = await db().getAll(...claim.tripIds.map((id) => tripsCollection().doc(id)));
  return snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => toTrip(snapshot.id, snapshot.data()!)).sort((a, b) => a.tripDate.localeCompare(b.tripDate));
}

export async function getClaim(context: TripContext, claimId: string) {
  const snapshot = await claimsCollection().doc(claimId).get();
  if (!snapshot.exists) throw new TripError('That claim was not found.', 404);
  const claim = toClaim(snapshot.id, snapshot.data()!);
  if (!canViewClaim(context, claim)) throw new TripError('You do not have access to this claim.', 403);
  // Trips sent back from this claim are no longer on it, but the claim's story includes them.
  const [trips, returnedSnapshot] = await Promise.all([claimTrips(claim), tripsCollection().where('previousClaims', 'array-contains', claim.claimNumber).get()]);
  const returnedTrips = returnedSnapshot.docs
    .map((doc) => toTrip(doc.id, doc.data()))
    .filter((trip) => trip.organizationId === claim.organizationId && !claim.tripIds.includes(trip.id));
  const abilities = claimAbilities(claim, { userId: context.userId, override: context.trip.override });
  return { claim, trips, returnedTrips, abilities };
}

export type ClaimScope = 'mine' | 'inbox' | 'processed' | 'active' | 'all';

export async function listClaims(context: TripContext, scope: ClaimScope, financialYear?: string): Promise<{ claims: TripClaim[] }> {
  let query: FirebaseFirestore.Query;
  switch (scope) {
    case 'mine':
      query = claimsCollection().where('employeeId', '==', context.userId);
      break;
    case 'inbox':
      query = claimsCollection().where('currentAssigneeIds', 'array-contains', context.userId);
      break;
    case 'processed':
      query = claimsCollection().where('actedByIds', 'array-contains', context.userId);
      break;
    case 'active':
      if (!context.trip.override && !context.trip.viewAll) throw new TripError('Seeing every claim in process needs Trip Claims · View All or Override Workflow.', 403);
      query = claimsCollection().where('status', 'in', [...ACTIVE_CLAIM_STATUSES]);
      break;
    case 'all':
      if (!context.trip.viewAll) throw new TripError('The claims register needs Driver Management · Trip Claims · View All.', 403);
      query = claimsCollection().where('financialYear', '==', financialYear || financialYearOf(context.today));
      break;
  }
  const snapshot = await query.get();
  let claims = snapshot.docs.map((doc) => toClaim(doc.id, doc.data())).filter((claim) => claim.organizationId === context.organizationId);
  if (scope === 'inbox') claims = claims.filter((claim) => ACTIVE_CLAIM_STATUSES.includes(claim.status) && claim.employeeId !== context.userId);
  // Your own submissions are not work you processed.
  if (scope === 'processed') claims = claims.filter((claim) => claim.employeeId !== context.userId);
  claims.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  return { claims };
}

/* ── actions ───────────────────────────────────────────────────────────── */

interface ActionResult {
  claim: TripClaim;
  notices: ClaimNotice[];
  audit: { action: string; details: Record<string, unknown> };
}

/** Back to the employee as drafts: off the claim, the reason attached, the claim remembered. */
const releaseTrip = (claimNumber: string, note: { remarks: string; byName: string; at: string } | null) => ({
  status: 'draft',
  claimId: null,
  claimNumber: null,
  decision: null,
  returnNote: note ? { ...note, claimNumber } : null,
  previousClaims: FieldValue.arrayUnion(claimNumber),
});

async function runClaimAction(
  context: TripContext,
  claimId: string,
  act: (input: { claim: TripClaim; trips: TripRecord[]; transaction: FirebaseFirestore.Transaction; now: string }) => ActionResult,
): Promise<TripClaim> {
  const ref = claimsCollection().doc(claimId);
  let result: ActionResult | null = null;
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new TripError('That claim was not found.', 404);
    const claim = toClaim(snapshot.id, snapshot.data()!);
    if (claim.organizationId !== context.organizationId) throw new TripError('That claim was not found.', 404);
    const tripSnapshots = claim.tripIds.length ? await transaction.getAll(...claim.tripIds.map((id) => tripsCollection().doc(id))) : [];
    const trips = tripSnapshots.filter((entry) => entry.exists).map((entry) => toTrip(entry.id, entry.data()!));
    result = act({ claim, trips, transaction, now: nowIso() });
    const { id: _id, ...stored } = result.claim;
    transaction.set(ref, stored);
  });
  const done = result as ActionResult | null;
  if (!done) throw new TripError('The claim could not be updated.', 500);
  afterClaimChange(context, done.claim, done.audit, done.notices);
  return done.claim;
}

function recordAction(claim: TripClaim, entry: ClaimHistoryEntry, changes: Partial<TripClaim>): TripClaim {
  return {
    ...claim,
    ...changes,
    actedByIds: [...new Set([...claim.actedByIds, entry.byId])],
    history: [...claim.history, historyEntry(entry)],
    updatedAt: entry.at,
  };
}

export async function actOnClaim(context: TripContext, claimId: string, body: unknown): Promise<{ claim: TripClaim }> {
  const input = claimActionSchema.parse(body);
  const claim = await runClaimAction(context, claimId, ({ claim, trips, transaction, now }) => {
    const abilities = claimAbilities(claim, { userId: context.userId, override: context.trip.override });
    const stage = claim.stages[claim.currentStageIndex];
    const who = { byId: context.userId, byName: context.userName, at: now };
    const tripRef = (id: string) => tripsCollection().doc(id);

    switch (input.action) {
      case 'withdraw': {
        if (!abilities.withdraw) throw new TripError('Only an untouched claim of your own can be withdrawn.', 403);
        for (const trip of trips) transaction.update(tripRef(trip.id), { ...releaseTrip(claim.claimNumber, null), updatedAt: now });
        const next = recordAction(claim, { action: 'withdrawn', stageName: stage?.name ?? '', ...who, remarks: input.remarks || undefined }, { status: 'withdrawn', currentAssigneeIds: [], tripIds: [] });
        return { claim: next, notices: [], audit: { action: 'Withdraw Trip Claim', details: {} } };
      }

      case 'return':
      case 'reject': {
        if (!abilities.decide && !abilities.pay) throw new TripError('This claim is not waiting for you.', 403);
        const reject = input.action === 'reject';
        for (const trip of trips) {
          if (trip.status === 'rejected') continue;
          if (reject) {
            transaction.update(tripRef(trip.id), {
              status: 'rejected',
              decision: { decision: 'reject', approvedKm: 0, approvedAmount: 0, remarks: input.remarks, stageName: stage.name, ...who },
              updatedAt: now,
            });
          } else {
            transaction.update(tripRef(trip.id), { ...releaseTrip(claim.claimNumber, { remarks: input.remarks, byName: context.userName, at: now }), updatedAt: now });
          }
        }
        const remaining = reject ? trips : trips.filter((trip) => trip.status === 'rejected');
        const next = recordAction(
          claim,
          { action: reject ? 'rejected' : 'returned', stageName: stage.name, ...who, remarks: input.remarks, override: abilities.viaOverride || undefined },
          { status: reject ? 'rejected' : 'returned', currentAssigneeIds: [], tripIds: remaining.map((trip) => trip.id), totals: reject ? { ...claim.totals, approvedKm: 0, approvedAmount: 0 } : claim.totals },
        );
        return {
          claim: next,
          notices: [
            {
              userIds: [claim.employeeId],
              type: 'workflow_complete',
              severity: 'WARNING',
              title: reject ? `Trip claim ${claim.claimNumber} was rejected` : `Trip claim ${claim.claimNumber} was sent back to you`,
              body: reject ? `${context.userName}: ${input.remarks}` : `${context.userName}: ${input.remarks} — the trips are back in My Trips to correct and submit again.`,
            },
          ],
          audit: { action: reject ? 'Reject Trip Claim' : 'Return Trip Claim', details: { stage: stage.name, remarks: input.remarks, override: abilities.viaOverride } },
        };
      }

      case 'approve': {
        if (!abilities.decide) throw new TripError('This claim is not waiting for your approval.', 403);
        const outcome = applyDecisions(trips, input.decisions, { stageName: stage.name, ...who });
        const decided = new Map(outcome.kept.map((entry) => [entry.tripId, entry.decision]));
        const nextIndex = claim.currentStageIndex + 1;
        const nextStage = claim.stages[nextIndex];
        if (!nextStage) throw new TripError('This claim has no stage after this one. Check Settings › Workflow.', 409);
        const toPayment = nextStage.kind === 'payment';

        for (const returned of outcome.returned) {
          transaction.update(tripRef(returned.tripId), { ...releaseTrip(claim.claimNumber, { remarks: returned.remarks, byName: context.userName, at: now }), updatedAt: now });
        }
        const kept = trips.filter((trip) => decided.has(trip.id));
        for (const trip of kept) {
          const decision = decided.get(trip.id)!;
          const status = decision.decision === 'reject' ? 'rejected' : toPayment ? 'approved' : 'submitted';
          if (decision !== trip.decision || status !== trip.status) transaction.update(tripRef(trip.id), { decision, status, updatedAt: now });
        }
        const totals = claimTotals(kept.map((trip) => ({ ...trip, decision: decided.get(trip.id)! })));
        const next = recordAction(
          claim,
          { action: 'approved', stageName: stage.name, ...who, remarks: input.remarks || undefined, amount: totals.approvedAmount, override: abilities.viaOverride || undefined, lineSummary: outcome.summary || undefined },
          {
            status: toPayment ? 'approved' : 'pending',
            currentStageIndex: nextIndex,
            currentAssigneeIds: nextStage.assigneeIds,
            stageEnteredAt: now,
            tripIds: kept.map((trip) => trip.id),
            totals,
          },
        );
        const notices: ClaimNotice[] = [
          {
            userIds: nextStage.assigneeIds,
            title: toPayment ? `Trip claim ${claim.claimNumber} is ready for payment` : `Trip claim ${claim.claimNumber} needs your approval`,
            body: `${claimSummary(next, totals.approvedAmount)} — ${nextStage.name}`,
          },
        ];
        if (toPayment || outcome.summary) {
          notices.push({
            userIds: [claim.employeeId],
            type: 'workflow_complete',
            title: toPayment ? `Trip claim ${claim.claimNumber} approved for ${formatINR(totals.approvedAmount)}` : `Trip claim ${claim.claimNumber} passed ${stage.name}`,
            body: outcome.summary ? `${context.userName} approved it with changes: ${outcome.summary}.` : `${context.userName} approved it. It is now with ${nextStage.name}.`,
          });
        }
        return { claim: next, notices, audit: { action: 'Approve Trip Claim', details: { stage: stage.name, approvedAmount: totals.approvedAmount, changes: outcome.summary, override: abilities.viaOverride } } };
      }

      case 'pay': {
        if (!abilities.pay) throw new TripError('This claim is not waiting for your payment.', 403);
        return payInTransaction(context, claim, trips, input.payment, transaction, now, abilities.viaOverride);
      }
    }
  });
  return { claim };
}

function payInTransaction(
  context: TripContext,
  claim: TripClaim,
  trips: TripRecord[],
  payment: { paidOn: string; mode: string; reference: string; remarks: string },
  transaction: FirebaseFirestore.Transaction,
  now: string,
  viaOverride: boolean,
): ActionResult {
  if (payment.paidOn > context.today) throw new TripError('The payment date cannot be in the future.');
  if (payment.paidOn < claim.submittedAt.slice(0, 10)) throw new TripError('The payment date is before the claim was submitted.');
  if (payment.mode !== 'Cash' && payment.mode !== 'Payroll' && !payment.reference) throw new TripError(`Enter the ${payment.mode} reference (UTR or cheque number).`);
  const stage = claim.stages[claim.currentStageIndex];
  const record: ClaimPayment = {
    paidOn: payment.paidOn,
    mode: payment.mode as ClaimPayment['mode'],
    reference: payment.reference,
    remarks: payment.remarks,
    amount: claim.totals.approvedAmount,
    byId: context.userId,
    byName: context.userName,
    at: now,
  };
  for (const trip of trips) {
    if (trip.status !== 'rejected') transaction.update(tripsCollection().doc(trip.id), { status: 'paid', updatedAt: now });
  }
  const next = recordAction(
    claim,
    { action: 'paid', stageName: stage?.name ?? 'Payment', byId: context.userId, byName: context.userName, at: now, amount: record.amount, remarks: [payment.mode, payment.reference, payment.remarks].filter(Boolean).join(' · '), override: viaOverride || undefined },
    { status: 'paid', currentAssigneeIds: [], payment: record },
  );
  return {
    claim: next,
    notices: [
      {
        userIds: [claim.employeeId],
        type: 'workflow_complete',
        title: `Trip claim ${claim.claimNumber} paid — ${formatINR(record.amount)}`,
        body: `Paid on ${record.paidOn} by ${record.mode}${record.reference ? ` (${record.reference})` : ''}.`,
      },
    ],
    audit: { action: 'Pay Trip Claim', details: { amount: record.amount, mode: record.mode, reference: record.reference, override: viaOverride } },
  };
}

/** Records one payment against several claims (a month's batch). Each claim stands alone: one refusal does not stop the rest. */
export async function payClaims(context: TripContext, body: unknown) {
  const input = bulkPaySchema.parse(body);
  const paid: { id: string; claimNumber: string; amount: number }[] = [];
  const failed: { id: string; claimNumber: string; error: string }[] = [];
  for (const claimId of [...new Set(input.claimIds)]) {
    try {
      const claim = await runClaimAction(context, claimId, ({ claim, trips, transaction, now }) => {
        const abilities = claimAbilities(claim, { userId: context.userId, override: context.trip.override });
        if (!abilities.pay) throw new TripError(`${claim.claimNumber} is not waiting for your payment.`, 403);
        return payInTransaction(context, claim, trips, input.payment, transaction, now, abilities.viaOverride);
      });
      paid.push({ id: claim.id, claimNumber: claim.claimNumber, amount: claim.totals.approvedAmount });
    } catch (error) {
      failed.push({ id: claimId, claimNumber: '', error: error instanceof Error ? error.message : 'Could not be paid.' });
    }
  }
  return { paid, failed };
}
