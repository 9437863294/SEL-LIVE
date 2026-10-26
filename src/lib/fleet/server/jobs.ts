import 'server-only';

/**
 * The fleet's scheduled jobs, run by Cloud Scheduler through `GET /api/fleet/cron/[job]` (fail
 * closed on `CRON_SECRET`; times are IST — scripts/setup-cloud-scheduler.sh):
 *
 * - **approvals** (every 5 min) — escalate and expire waiting over-limit requests.
 * - **idle** (every 15 min) — a trip silent (no GPS fix; the start counts as one) for
 *   `idleRemindMinutes` reminds its driver, at most once an hour. A *running* trip silent for
 *   `idleAutoCloseMinutes`, or running longer than `maxTripHours`, is closed by the system and waits
 *   for review (`auto_closed`): the phone stopped tracking or the driver forgot to end it, and
 *   leaving it open would hold the vehicle's lock and keep counting. A *paused* trip is expected to
 *   be quiet, so it is only reminded, and closed at twice the silence (from the later of its last fix
 *   and the pause) — a pause is not meant to last overnight either.
 * - **midnight** (23:58) — open trips get their km so far split by day, so the next day's limit
 *   counts this evening's running on this evening. The end of the trip measures it all again.
 * - **daily-summary** (00:30) — yesterday's `fleetDailySummary/{vehicleId}_{dateKey}`.
 * - **service-due** (07:00) — vehicles within 300 km of their next service, or past it.
 * - **digest** (08:00) — yesterday in numbers, to the digest and escalation lists.
 * - **monthly-report** (06:00 on the 1st) — last month's payment report, emailed. Also accepted on
 *   the 2nd and 3rd, so a failed run can be repeated; a report that exists is never regenerated.
 *
 * Every job is safe to run twice: messages carry a dedupe key, and anything sent by email is
 * recorded in `fleetJobRuns` first (push dedupes itself; email does not).
 *
 * Vehicles are one register for the whole installation, so the per-organisation jobs (digest,
 * service due, monthly report) take the primary organisation's settings: the only fleet settings
 * document, else `default` (what access-control-server gives a user without one).
 */

import { addDays, istDateKey, minutesBetween, toMs } from '../dates.ts';
import { measureTrack } from '../geo.ts';
import { dayAllowance, kmUsedOn, tripKmOn } from '../limits.ts';
import { serviceDueInKm } from '../settings.ts';
import { FLEET_COLLECTIONS, OPEN_TRIP_STATUSES, formatKm, round1, round2, stripUndefined, type DailySummary, type FleetApproval, type FleetSettings, type FleetTrip } from '../types.ts';
import { tickApprovals } from './approvals';
import { db, SYSTEM_ACTOR } from './context';
import { fleetVehicles, loadFleetSettings } from './lookups';
import { sendFleetMessage } from './notify';
import { monthlyReportJob } from './reports';
import { isFleetTrip, runningTrips, settle, toTrip, tripsCol, tripsOnDays } from './trips';

/** Markers for work that must happen once (emails). Server-only, like every fleet collection. */
export const JOB_RUNS_COLLECTION = 'fleetJobRuns';

const DEFAULT_ORGANIZATION = 'default';

/** Claims a run key; false when it was already claimed (the work was done, or is being done). */
async function once(key: string, now: string): Promise<boolean> {
  const ref = db().collection(JOB_RUNS_COLLECTION).doc(key.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 300));
  return db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return false;
    transaction.set(ref, { key, at: now });
    return true;
  });
}

/** The organisation whose settings the installation-wide jobs use. */
export async function primaryOrganisation(): Promise<string> {
  const snapshot = await db().collection(FLEET_COLLECTIONS.settings).get();
  const ids = snapshot.docs.map((doc) => doc.id);
  if (ids.length === 1) return ids[0];
  return ids.includes(DEFAULT_ORGANIZATION) || !ids.length ? DEFAULT_ORGANIZATION : ids.sort()[0];
}

const systemContext = (organizationId: string, now: string) => ({ organizationId, now, userId: SYSTEM_ACTOR.id, userName: SYSTEM_ACTOR.name });

const settingsCache = () => {
  const loaded = new Map<string, Promise<FleetSettings>>();
  return (organizationId: string) => {
    const key = organizationId || DEFAULT_ORGANIZATION;
    if (!loaded.has(key)) loaded.set(key, loadFleetSettings(key));
    return loaded.get(key) as Promise<FleetSettings>;
  };
};

/* ── approvals ── */

export async function approvalsJob(now: string) {
  return tickApprovals(now);
}

/* ── idle ── */

export async function idleJob(now: string) {
  const trips = await runningTrips();
  const settingsFor = settingsCache();
  const hourBucket = Math.floor(toMs(now) / 3_600_000);
  let reminded = 0;
  let closed = 0;
  let failed = 0;
  for (const trip of trips) {
    const organizationId = trip.organizationId || DEFAULT_ORGANIZATION;
    const settings = await settingsFor(organizationId);
    const lastFix = trip.lastPointAt ?? trip.startedAt;
    const quietSince = trip.status === 'paused' && trip.pausedAt && toMs(trip.pausedAt) > toMs(lastFix) ? trip.pausedAt : lastFix;
    const silentMinutes = minutesBetween(quietSince, now);
    const runningMinutes = minutesBetween(trip.startedAt, now);
    try {
      if (trip.status === 'running' && runningMinutes >= settings.maxTripHours * 60) {
        await settle(systemContext(organizationId, now), trip.id, { reason: 'auto_max', autoClosed: true, endedAt: lastFix });
        closed += 1;
        continue;
      }
      const closeAfter = trip.status === 'paused' ? settings.idleAutoCloseMinutes * 2 : settings.idleAutoCloseMinutes;
      if (silentMinutes >= closeAfter) {
        await settle(systemContext(organizationId, now), trip.id, { reason: 'auto_idle', autoClosed: true, endedAt: lastFix });
        closed += 1;
        continue;
      }
    } catch (error) {
      // Ended or cancelled a moment ago by the driver: nothing to close.
      failed += 1;
      console.error(`[fleet cron idle] ${trip.id}`, error instanceof Error ? error.message : error);
      continue;
    }
    if (silentMinutes >= settings.idleRemindMinutes) {
      const paused = trip.status === 'paused';
      const delivered = await sendFleetMessage({
        userIds: [trip.driverUserId],
        title: paused ? `Your trip on ${trip.vehicleNumber} is still paused` : `No location from your trip on ${trip.vehicleNumber}`,
        body: paused
          ? `Paused for ${Math.round(silentMinutes)} min. Resume it, or end it if you have finished.`
          : `Nothing received for ${Math.round(silentMinutes)} min. Open the SEL Driver app; end the trip if you have finished. It closes for review after ${settings.idleAutoCloseMinutes} min without a fix.`,
        link: '/driver-management/fleet',
        severity: 'WARNING',
        type: 'record_assigned',
        itemId: trip.id,
        dedupeKey: `fleet-idle-${trip.id}-${hourBucket}`,
        organizationId,
      });
      if (delivered) reminded += 1;
    }
  }
  return { open: trips.length, reminded, closed, failed };
}

/* ── midnight ── */

async function trackOf(tripId: string) {
  const snapshot = await db().collection(FLEET_COLLECTIONS.points).where('tripId', '==', tripId).get();
  return snapshot.docs
    .map((doc) => doc.data() as Record<string, unknown>)
    .map((row) => ({
      lat: Number(row.lat),
      lng: Number(row.lng),
      accuracyMeters: Number.isFinite(Number(row.accuracyMeters)) ? Number(row.accuracyMeters) : undefined,
      speedKmph: Number.isFinite(Number(row.speedKmph)) ? Number(row.speedKmph) : undefined,
      recordedAtIso: String(row.recordedAtIso ?? ''),
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

export async function midnightJob(now: string) {
  const trips = await runningTrips();
  const settingsFor = settingsCache();
  let measured = 0;
  for (const trip of trips) {
    const settings = await settingsFor(trip.organizationId || DEFAULT_ORGANIZATION);
    const measure = measureTrack(await trackOf(trip.id), { gapMinutes: settings.gpsGapMinutes, startedAt: trip.startedAt });
    const ref = tripsCol().doc(trip.id);
    const written = await db().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists ? toTrip(snapshot.id, snapshot.data()!) : null;
      // Ended while it was being measured: the end's figures stand.
      if (!current || !OPEN_TRIP_STATUSES.includes(current.status)) return false;
      transaction.set(ref, { gpsDistanceKm: measure.gpsKm, totalDistanceKm: measure.gpsKm, gpsKmByDate: measure.kmByDate, kmByDate: measure.kmByDate, midnightMeasuredAt: now, updatedAt: now }, { merge: true });
      return true;
    });
    if (written) measured += 1;
  }
  return { open: trips.length, measured };
}

/* ── daily summary ── */

const kmOn = (trip: FleetTrip, dateKey: string) => tripKmOn(trip, dateKey);

export async function dailySummaryJob(now: string) {
  const day = addDays(istDateKey(now), -1);
  const organizationId = await primaryOrganisation();
  const settings = await loadFleetSettings(organizationId);
  const [vehicles, trips, approvalSnap, fuelSnap] = await Promise.all([
    fleetVehicles(settings),
    tripsOnDays([day, addDays(day, -1)]),
    db().collection(FLEET_COLLECTIONS.approvals).where('dateKey', '==', day).get(),
    db().collection(FLEET_COLLECTIONS.fuel).where('fuelDate', '==', day).get(),
  ]);
  const approvals = approvalSnap.docs.map((doc) => ({ ...(doc.data() as FleetApproval), id: doc.id }));
  const fuel = fuelSnap.docs.map((doc) => doc.data() as Record<string, unknown>);
  const live = trips.filter((trip) => trip.status !== 'cancelled' && (trip.dateKey === day || kmOn(trip, day) > 0));
  const vehicleIds = new Set([...live.map((trip) => trip.vehicleId), ...fuel.map((row) => String(row.vehicleId ?? ''))].filter(Boolean));

  const summaries: DailySummary[] = [];
  for (const vehicleId of vehicleIds) {
    const vehicle = vehicles.find((entry) => entry.id === vehicleId);
    const onVehicle = live.filter((trip) => trip.vehicleId === vehicleId);
    const started = onVehicle.filter((trip) => trip.dateKey === day);
    const fills = fuel.filter((row) => String(row.vehicleId ?? '') === vehicleId);
    const km = kmUsedOn(onVehicle, vehicleId, day);
    const limitKm = vehicle?.dailyKmLimit ?? settings.dailyKmLimitByCategory.car;
    const allowedKm = vehicle ? dayAllowance(vehicle, day, approvals).allowedKm : limitKm;
    summaries.push({
      id: `${vehicleId}_${day}`,
      organizationId: onVehicle[0]?.organizationId || organizationId,
      vehicleId,
      vehicleNumber: vehicle?.vehicleNumber ?? onVehicle[0]?.vehicleNumber ?? String(fills[0]?.vehicleNumber ?? vehicleId),
      dateKey: day,
      tripCount: started.length,
      km,
      limitKm,
      overLimitKm: round1(Math.max(0, km - allowedKm)),
      approvals: approvals.filter((approval) => approval.vehicleId === vehicleId && approval.status !== 'cancelled').length,
      emergencies: started.filter((trip) => trip.isEmergency).length,
      flaggedTrips: onVehicle.filter((trip) => trip.flagged).length,
      fuelLitres: round2(fills.reduce((sum, row) => sum + (Number(row.quantityLiters) || 0), 0)),
      fuelAmount: round2(fills.reduce((sum, row) => sum + (Number(row.totalAmount) || 0), 0)),
      updatedAt: now,
    });
  }
  for (let index = 0; index < summaries.length; index += 400) {
    const batch = db().batch();
    for (const summary of summaries.slice(index, index + 400)) batch.set(db().collection(FLEET_COLLECTIONS.dailySummary).doc(summary.id), stripUndefined(summary));
    await batch.commit();
  }
  return { dateKey: day, vehicles: summaries.length, km: round1(summaries.reduce((sum, row) => sum + row.km, 0)) };
}

/* ── digest ── */

export async function digestJob(now: string) {
  const today = istDateKey(now);
  const day = addDays(today, -1);
  const organizationId = await primaryOrganisation();
  const settings = await loadFleetSettings(organizationId);
  const recipients = [...new Set([...settings.digestUserIds, ...settings.escalationUserIds])];
  if (!recipients.length) return { dateKey: day, sent: false, reason: 'No digest or escalation recipients in Settings › Fleet.' };

  const [vehicles, trips, pendingApprovals, openTrips, openFuel] = await Promise.all([
    fleetVehicles(settings),
    tripsOnDays([day, addDays(day, -1)]),
    db().collection(FLEET_COLLECTIONS.approvals).where('status', '==', 'pending').get(),
    tripsCol().where('exceptionStatus', '==', 'open').get(),
    db().collection(FLEET_COLLECTIONS.fuel).where('exceptionStatus', '==', 'open').get(),
  ]);
  const live = trips.filter((trip) => trip.status !== 'cancelled');
  const yesterdayTrips = live.filter((trip) => trip.dateKey === day);
  const km = round1(live.reduce((sum, trip) => sum + kmOn(trip, day), 0));
  const overLimit = vehicles.filter((vehicle) => kmUsedOn(live, vehicle.id, day) > vehicle.dailyKmLimit + 0.5);
  const exceptionTrips = openTrips.docs.filter((doc) => isFleetTrip(doc.data())).map((doc) => toTrip(doc.id, doc.data()));
  const reviews = exceptionTrips.filter((trip) => trip.status === 'pending_review').length;
  const serviceDue = vehicles.filter((vehicle) => vehicle.active && (serviceDueInKm(vehicle) ?? Number.POSITIVE_INFINITY) <= 300).length;

  if (!(await once(`digest_${organizationId}_${day}`, now))) return { dateKey: day, sent: false, reason: 'Already sent.' };
  const lines = [
    `${yesterdayTrips.length} trip${yesterdayTrips.length === 1 ? '' : 's'}, ${formatKm(km)} run.`,
    overLimit.length ? `Over the daily limit: ${overLimit.map((vehicle) => vehicle.vehicleNumber).join(', ')}.` : 'No vehicle over its daily limit.',
    `${pendingApprovals.size} approval request${pendingApprovals.size === 1 ? '' : 's'} waiting, ${reviews} trip${reviews === 1 ? '' : 's'} waiting for review.`,
    `Open exceptions: ${exceptionTrips.length - reviews} trip, ${openFuel.size} fuel.`,
    serviceDue ? `${serviceDue} vehicle${serviceDue === 1 ? '' : 's'} due for service.` : '',
  ].filter(Boolean);
  const delivered = await sendFleetMessage({
    userIds: recipients,
    title: `Fleet yesterday (${day}): ${formatKm(km)}, ${yesterdayTrips.length} trips`,
    body: lines.join(' '),
    link: '/vehicle-management/fleet',
    channels: ['push', 'email'],
    type: 'record_assigned',
    dedupeKey: `fleet-digest-${organizationId}-${day}`,
    organizationId,
  });
  return { dateKey: day, sent: true, recipients: recipients.length, delivered, km, trips: yesterdayTrips.length, overLimit: overLimit.length, pendingApprovals: pendingApprovals.size, reviews, serviceDue };
}

/* ── service due ── */

export async function serviceDueJob(now: string) {
  const organizationId = await primaryOrganisation();
  const settings = await loadFleetSettings(organizationId);
  const vehicles = (await fleetVehicles(settings)).filter((vehicle) => vehicle.active);
  let notified = 0;
  let due = 0;
  for (const vehicle of vehicles) {
    const dueInKm = serviceDueInKm(vehicle);
    if (dueInKm === null || dueInKm > 300) continue;
    due += 1;
    const userIds = [...new Set([vehicle.approverUid, vehicle.backupApproverUid, ...settings.digestUserIds].filter((id): id is string => Boolean(id)))];
    if (!userIds.length) continue;
    // Once per service interval: the key changes when the next service is recorded.
    if (!(await once(`service_${vehicle.id}_${vehicle.lastServiceKm}`, now))) continue;
    await sendFleetMessage({
      userIds,
      title: dueInKm < 0 ? `${vehicle.vehicleNumber} is ${formatKm(-dueInKm)} past its service` : `${vehicle.vehicleNumber} is due for service in ${formatKm(dueInKm)}`,
      body: `Last serviced at ${formatKm(vehicle.lastServiceKm)}${vehicle.lastServiceDate ? ` on ${vehicle.lastServiceDate}` : ''}; the odometer reads ${formatKm(vehicle.currentOdometerKm)} (every ${formatKm(vehicle.serviceIntervalKm)}).`,
      link: '/vehicle-management/maintenance',
      channels: ['push', 'email'],
      severity: dueInKm < 0 ? 'WARNING' : 'INFO',
      type: 'record_assigned',
      itemId: vehicle.id,
      itemRef: vehicle.vehicleNumber,
      dedupeKey: `fleet-service-${vehicle.id}-${vehicle.lastServiceKm}`,
      organizationId,
    });
    notified += 1;
  }
  return { vehicles: vehicles.length, due, notified };
}

/* ── monthly report ── */

export async function monthlyReportCronJob(now: string) {
  const day = Number(istDateKey(now).slice(8, 10));
  if (day > 3) return { skipped: true, reason: 'Runs on the 1st (and the 2nd or 3rd as a retry).' };
  return monthlyReportJob(await primaryOrganisation(), now);
}

export const FLEET_JOBS = {
  approvals: approvalsJob,
  idle: idleJob,
  midnight: midnightJob,
  'daily-summary': dailySummaryJob,
  digest: digestJob,
  'service-due': serviceDueJob,
  'monthly-report': monthlyReportCronJob,
} satisfies Record<string, (now: string) => Promise<Record<string, unknown>>>;

