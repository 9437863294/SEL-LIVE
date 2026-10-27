import 'server-only';

/**
 * What every screen needs on arrival (`bootstrap`) and the Driver Management dashboard.
 *
 * The dashboard has three layers, each shown only to those it concerns: your own trips and claims
 * (everyone), what waits for you (anyone named on the workflow, or holding Override), and the
 * organisation's figures (Trip Claims · View All). Single-field queries only, so nothing here waits
 * on a composite index being created in production.
 */

import { sumMoney } from '../rates.ts';
import { claimRules, daysLeftToClaim } from '../trips.ts';
import { ET_COLLECTIONS, financialYearOf, type TripClaim, type TripRecord } from '../types.ts';
import { namedStageKinds, stageAge, stageAssignees } from '../workflow.ts';
import { db, type TripContext } from './context';
import { listClaims, toClaim } from './claims';
import { companyVehicles, departmentOptions, hasReportees, lastOdometerReadings, loadSettings, nameResolver, projectOptions, reportingAuthorityOf, vehicleTypeOptions } from './lookups';
import { listMyTrips, toTrip } from './trips';
import { activePurposes, loadFleetSettings } from '@/lib/fleet/server/lookups';
import { employeeProjectIdsOf } from '@/lib/employee-projects/server';

async function waitingForMe(context: TripContext): Promise<TripClaim[]> {
  return (await listClaims(context, 'inbox')).claims;
}

function inboxCounts(waiting: TripClaim[], now = new Date()) {
  const approvals = waiting.filter((claim) => claim.status === 'pending');
  const payments = waiting.filter((claim) => claim.status === 'approved');
  return {
    approvals: approvals.length,
    approvalsAmount: sumMoney(approvals.map((claim) => claim.totals.claimedAmount)),
    payments: payments.length,
    paymentsAmount: sumMoney(payments.map((claim) => claim.totals.approvedAmount)),
    overdue: waiting.filter((claim) => stageAge(claim, now).overdue).length,
  };
}

export async function bootstrap(context: TripContext) {
  const [settings, fleet, vehicles, projects, departments, vehicleTypes, odometer, waiting, authority, nameOf, myProjectIds, purposes] = await Promise.all([
    loadSettings(context.organizationId),
    loadFleetSettings(context.organizationId),
    companyVehicles(),
    projectOptions(),
    departmentOptions(),
    vehicleTypeOptions(),
    lastOdometerReadings(context.organizationId),
    waitingForMe(context),
    reportingAuthorityOf(context.userId),
    nameResolver(),
    employeeProjectIdsOf(context.userId),
    activePurposes(),
  ]);
  const named = namedStageKinds(settings, context.userId);
  // A reporting authority approves their people's claims without being named in Settings, so the
  // Approvals page is theirs too — including after their queue empties.
  const routesByReporting = settings.stages.some((stage) => stage.kind === 'approval' && stage.routing === 'reporting');
  if (routesByReporting && !named.approval) named.approval = await hasReportees(context.userId);
  // Who the employee's own claims go to first, to say so before they create one.
  const firstStage = settings.stages[0];
  const firstApprovers = stageAssignees(firstStage, { employeeId: context.userId, projectId: null, departmentId: null, reportingAuthorityIds: authority.ids });
  const hasException = firstStage.routes.some((route) => route.key === context.userId);
  const viaReportingLine = firstStage.routing === 'reporting' && !hasException && authority.ids.some((id) => firstApprovers.includes(id));
  return {
    user: { id: context.userId, name: context.userName },
    today: context.today,
    financialYear: financialYearOf(context.today),
    access: context.trip,
    named,
    inbox: inboxCounts(waiting),
    firstApproval: {
      stageName: firstStage.name,
      names: firstApprovers.map(nameOf),
      /** Set when the first stage follows the reporting line and found the employee's authority. */
      reportingSource: viaReportingLine ? authority.source : null,
      /** Routed by project or department: who it is depends on the trips chosen. */
      dependsOnTrips: firstStage.routing === 'project' || firstStage.routing === 'department',
    },
    settings: {
      rateRevisions: settings.rateRevisions,
      // The rules as My Trips applies them: with company-vehicle trips routed to fleet trips, the
      // form offers own vehicles only (the server refuses a new company trip either way).
      rules: claimRules(settings.rules, fleet.companyTripsInFleet),
      stages: settings.stages.map(({ id, name, kind, routing, minAmount, tatHours }) => ({ id, name, kind, routing, minAmount, tatHours })),
    },
    vehicleTypes,
    vehicles,
    projects,
    // The employee's own projects (greytHR project → Settings › Projects, linked on Employee ›
    // Category), listed first in the project picker — or only, when Settings › Fleet says so.
    projectScope: { mine: myProjectIds, onlyMine: fleet.employeeProjectsOnly },
    // The trip purposes of Settings › Fleet: an own-vehicle trip is started with the same list as a
    // company one (its purpose is stored as the name, with the reason when the purpose asks for one).
    purposes: purposes.map((purpose) => ({ id: purpose.id, name: purpose.name, requiresReason: purpose.requiresReason, requiresProject: purpose.requiresProject })),
    departments,
    odometer,
  };
}

/** "2026-10" for the month `offset` months before `today`'s. */
function monthKey(today: string, offset: number): string {
  const [year, month] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 - offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthlyTrend(trips: TripRecord[], today: string, months = 6) {
  const keys = Array.from({ length: months }, (_, index) => monthKey(today, months - 1 - index));
  return keys.map((month) => {
    const inMonth = trips.filter((trip) => trip.tripDate.startsWith(month) && trip.status !== 'rejected');
    return {
      month,
      trips: inMonth.length,
      km: Math.round(inMonth.reduce((total, trip) => total + trip.distanceKm, 0) * 10) / 10,
      amount: sumMoney(inMonth.map((trip) => (trip.decision ? trip.decision.approvedAmount : trip.totalAmount))),
    };
  });
}

const sumKm = (trips: TripRecord[]) => Math.round(trips.reduce((total, trip) => total + trip.distanceKm, 0) * 10) / 10;

const claimRow = (claim: TripClaim) => ({
  id: claim.id,
  claimNumber: claim.claimNumber,
  employeeName: claim.employeeName,
  status: claim.status,
  totals: claim.totals,
  submittedAt: claim.submittedAt,
  stageName: claim.stages[claim.currentStageIndex]?.name ?? '',
  waitingFor: claim.status === 'pending' || claim.status === 'approved' ? claim.stages[claim.currentStageIndex]?.assigneeNames ?? [] : [],
  overdue: stageAge(claim).overdue,
  paidOn: claim.payment?.paidOn ?? null,
});

export async function dashboard(context: TripContext) {
  const financialYear = financialYearOf(context.today);
  const month = context.today.slice(0, 7);
  const [settings, myTrips, myClaims, waiting] = await Promise.all([
    loadSettings(context.organizationId),
    listMyTrips(context),
    listClaims(context, 'mine').then((result) => result.claims),
    waitingForMe(context),
  ]);

  const drafts = myTrips.filter((trip) => trip.status === 'draft');
  const thisMonth = myTrips.filter((trip) => trip.tripDate.startsWith(month) && trip.status !== 'rejected');
  const expiringSoon = drafts.filter((trip) => {
    const left = daysLeftToClaim(trip.tripDate, context.today, settings.rules);
    return left !== null && left <= 7;
  });
  const pending = myClaims.filter((claim) => claim.status === 'pending');
  const approved = myClaims.filter((claim) => claim.status === 'approved');
  const paidThisYear = myClaims.filter((claim) => claim.status === 'paid' && claim.payment && financialYearOf(claim.payment.paidOn) === financialYear);

  const personal = {
    thisMonth: { trips: thisMonth.length, km: sumKm(thisMonth), amount: sumMoney(thisMonth.map((trip) => trip.totalAmount)) },
    unclaimed: { trips: drafts.length, km: sumKm(drafts), amount: sumMoney(drafts.map((trip) => trip.totalAmount)), expiringSoon: expiringSoon.length, sentBack: drafts.filter((trip) => trip.returnNote).length },
    inApproval: { claims: pending.length, amount: sumMoney(pending.map((claim) => claim.totals.claimedAmount)) },
    awaitingPayment: { claims: approved.length, amount: sumMoney(approved.map((claim) => claim.totals.approvedAmount)) },
    paidThisYear: { claims: paidThisYear.length, amount: sumMoney(paidThisYear.map((claim) => claim.payment?.amount ?? 0)) },
    ownership: {
      own: sumKm(myTrips.filter((trip) => trip.ownership === 'own' && trip.status !== 'rejected' && trip.tripDate >= monthKey(context.today, 5))),
      company: sumKm(myTrips.filter((trip) => trip.ownership === 'company' && trip.status !== 'rejected' && trip.tripDate >= monthKey(context.today, 5))),
    },
    trend: monthlyTrend(myTrips, context.today),
    recentClaims: myClaims.slice(0, 5).map(claimRow),
  };

  const named = namedStageKinds(settings, context.userId);
  const workflow =
    named.approval || named.payment || context.trip.override || waiting.length
      ? {
          ...inboxCounts(waiting),
          oldest: [...waiting].sort((a, b) => a.stageEnteredAt.localeCompare(b.stageEnteredAt)).slice(0, 5).map(claimRow),
        }
      : null;

  let organisation = null;
  if (context.trip.viewAll) {
    const from = `${monthKey(context.today, 5)}-01`;
    const [claimsSnapshot, tripsSnapshot] = await Promise.all([
      db().collection(ET_COLLECTIONS.claims).where('financialYear', '==', financialYear).get(),
      db().collection(ET_COLLECTIONS.trips).where('tripDate', '>=', from).get(),
    ]);
    const claims = claimsSnapshot.docs.map((doc) => toClaim(doc.id, doc.data())).filter((claim) => claim.organizationId === context.organizationId);
    const trips = tripsSnapshot.docs.map((doc) => toTrip(doc.id, doc.data())).filter((trip) => trip.organizationId === context.organizationId && trip.status !== 'rejected');
    const byStatus = (status: TripClaim['status']) => claims.filter((claim) => claim.status === status);
    const claimedTrips = trips.filter((trip) => trip.status !== 'draft');

    const tally = (key: (trip: TripRecord) => string) => {
      const map = new Map<string, { label: string; amount: number; km: number; trips: number }>();
      for (const trip of claimedTrips) {
        const label = key(trip);
        const entry = map.get(label) ?? { label, amount: 0, km: 0, trips: 0 };
        entry.amount = sumMoney([entry.amount, trip.decision ? trip.decision.approvedAmount : trip.totalAmount]);
        entry.km = Math.round((entry.km + trip.distanceKm) * 10) / 10;
        entry.trips += 1;
        map.set(label, entry);
      }
      return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, 6);
    };

    organisation = {
      financialYear,
      inApproval: { claims: byStatus('pending').length, amount: sumMoney(byStatus('pending').map((claim) => claim.totals.claimedAmount)) },
      awaitingPayment: { claims: byStatus('approved').length, amount: sumMoney(byStatus('approved').map((claim) => claim.totals.approvedAmount)) },
      paid: { claims: byStatus('paid').length, amount: sumMoney(byStatus('paid').map((claim) => claim.payment?.amount ?? 0)) },
      rejected: { claims: byStatus('rejected').length, amount: sumMoney(byStatus('rejected').map((claim) => claim.totals.claimedAmount)) },
      overdue: claims.filter((claim) => stageAge(claim).overdue).length,
      unclaimed: { trips: trips.filter((trip) => trip.status === 'draft').length, amount: sumMoney(trips.filter((trip) => trip.status === 'draft').map((trip) => trip.totalAmount)) },
      trend: monthlyTrend(claimedTrips, context.today),
      ownership: { own: sumKm(claimedTrips.filter((trip) => trip.ownership === 'own')), company: sumKm(claimedTrips.filter((trip) => trip.ownership === 'company')) },
      byProject: tally((trip) => trip.projectName || 'No project'),
      byEmployee: tally((trip) => trip.employeeName || 'Unknown'),
    };
  }

  return { today: context.today, financialYear, personal, workflow, organisation };
}
