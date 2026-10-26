import 'server-only';

/**
 * The monthly payment report (Phase 3): generated on the 1st for the month before (and on demand,
 * for a month or a custom period), stored with its Excel, PDF and JSON files, emailed to the
 * recipients in Settings › Fleet, and approved for payment by Fleet Reports · Approve for Payment.
 *
 * Approving locks the report and marks every trip it paid `reportedIn`, so no later report pays a
 * trip twice; a trip settled after its month was approved is carried into the next report. A custom
 * period is a preview: it is never approved and marks nothing.
 */

import { getCompanyProfile } from '@/lib/company-profile-server';
import { getFirebaseAdminBucket } from '@/lib/firebase-admin';
import { istMonthKey, monthRange, previousMonthKey } from '../dates.ts';
import { fuelRowFrom } from '../fuel.ts';
import { reportPdf, reportTitle, reportWorkbook } from '../report-files.ts';
import { buildPaymentReport } from '../reports.ts';
import { generateReportSchema } from '../schemas.ts';
import { FLEET_COLLECTIONS, FLEET_STORAGE_PREFIX, formatINR, stripUndefined, type PaymentReport } from '../types.ts';
import { db, FleetError, type FleetContext } from './context';
import { afterAudit, emailReport } from './notify';
import { fleetProjects, fleetVehicles, loadFleetSettings } from './lookups';
import { isFleetTrip, toTrip, tripsCol } from './trips';

const reportsCol = () => db().collection(FLEET_COLLECTIONS.reports);

/** Rows kept on the document (the files always carry every row). */
const MAX_ROWS_ON_DOC = 2000;

interface Actor {
  id: string | null;
  name: string;
  organizationId: string;
  now: string;
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function companyName(): Promise<string> {
  try {
    const profile = await getCompanyProfile();
    return profile.legalName || 'SEL';
  } catch {
    return 'SEL';
  }
}

export async function generateReport(actor: Actor, input: { monthKey?: string; from?: string; to?: string; email: boolean }): Promise<{ report: PaymentReport }> {
  const monthKey = input.monthKey ?? null;
  const range = monthKey ? monthRange(monthKey) : { from: input.from as string, to: input.to as string };
  const id = monthKey ?? `custom_${range.from}_${range.to}`;
  const ref = reportsCol().doc(id);
  const existing = await ref.get();
  if (existing.exists && existing.data()?.status === 'approved') throw new FleetError(`The ${monthKey} report is approved for payment and locked.`, 409);

  const settings = await loadFleetSettings(actor.organizationId);
  const [tripSnap, fuelSnap, vehicles, projects, name] = await Promise.all([
    tripsCol().where('reportedIn', '==', null).get(),
    db().collection(FLEET_COLLECTIONS.fuel).where('fuelDate', '>=', range.from).get(),
    fleetVehicles(settings),
    fleetProjects(),
    companyName(),
  ]);
  const trips = tripSnap.docs.filter((doc) => isFleetTrip(doc.data())).map((doc) => toTrip(doc.id, doc.data()));
  const fuel = fuelSnap.docs.map((doc) => fuelRowFrom(doc.id, doc.data())).filter((row) => row.fuelDate <= range.to);
  const months = monthKey ? 1 : Math.max(1, Math.round((Date.parse(range.to) - Date.parse(range.from)) / (30.44 * 86_400_000)));
  const built = buildPaymentReport({ from: range.from, to: range.to, trips, fuel, vehicles, projects, months });

  const version = Number(existing.data()?.version ?? 0) + 1;
  const report: PaymentReport = {
    id,
    organizationId: actor.organizationId,
    monthKey,
    from: range.from,
    to: range.to,
    status: 'draft',
    ...built,
    files: { xlsx: null, pdf: null, json: null },
    generatedAt: actor.now,
    generatedById: actor.id,
    generatedByName: actor.name,
    approvedAt: null,
    approvedById: null,
    approvedByName: '',
    emailedTo: [],
    version,
  };

  const base = `${FLEET_STORAGE_PREFIX}/reports/${id}/v${version}`;
  const [xlsx, pdf] = await Promise.all([reportWorkbook(report), reportPdf(report, name)]);
  const json = Buffer.from(JSON.stringify(report, null, 1));
  const bucket = getFirebaseAdminBucket();
  await Promise.all([
    bucket.file(`${base}.xlsx`).save(xlsx, { contentType: XLSX_TYPE, resumable: false }),
    bucket.file(`${base}.pdf`).save(pdf, { contentType: 'application/pdf', resumable: false }),
    bucket.file(`${base}.json`).save(json, { contentType: 'application/json', resumable: false }),
  ]);
  report.files = { xlsx: `${base}.xlsx`, pdf: `${base}.pdf`, json: `${base}.json` };

  if (input.email && settings.reportEmails.length) {
    const sent = await emailReport(
      settings.reportEmails,
      reportTitle(report),
      `${reportTitle(report)} (draft, version ${version}).\n\nTrips paid: ${report.totals.trips}, billable km: ${report.totals.km}, payable: ${formatINR(report.totals.payable)}.\nHeld for review: ${report.totals.heldTrips} trip(s). Driver reimbursements: ${formatINR(report.totals.reimbursements)}.\n\nApprove it for payment in Vehicle Management › Payment Reports.`,
      [
        { filename: `${id}.xlsx`, content: xlsx, contentType: XLSX_TYPE },
        { filename: `${id}.pdf`, content: pdf, contentType: 'application/pdf' },
      ],
    );
    if (sent) report.emailedTo = settings.reportEmails;
  }

  const stored = {
    ...report,
    reportA: report.reportA.slice(0, MAX_ROWS_ON_DOC),
    reportB: report.reportB.slice(0, MAX_ROWS_ON_DOC),
    reportC: report.reportC.slice(0, MAX_ROWS_ON_DOC),
    reportD: report.reportD.slice(0, MAX_ROWS_ON_DOC),
  };
  await ref.set(stripUndefined(stored));
  return { report: stored };
}

export async function generateReportFor(context: FleetContext, body: unknown) {
  if (!context.fleet.reportsGenerate) throw new FleetError('You need Fleet Reports · Generate.', 403);
  const input = generateReportSchema.parse(body);
  if (input.monthKey && input.monthKey > istMonthKey(context.now)) throw new FleetError('That month has not started yet.', 400);
  const result = await generateReport({ id: context.userId, name: context.userName, organizationId: context.organizationId, now: context.now }, input);
  afterAudit(context, 'Generate Fleet Payment Report', { after: { id: result.report.id, version: result.report.version, totals: result.report.totals } }, result.report.id);
  return result;
}

/** The 1st of the month, 06:00: last month's report, emailed. */
export async function monthlyReportJob(organizationId: string, now: string) {
  const monthKey = previousMonthKey(istMonthKey(now));
  const existing = await reportsCol().doc(monthKey).get();
  if (existing.exists) return { monthKey, skipped: true };
  const { report } = await generateReport({ id: null, name: 'Scheduled', organizationId, now }, { monthKey, email: true });
  return { monthKey, skipped: false, totals: report.totals };
}

export async function approveReport(context: FleetContext, reportId: string): Promise<{ report: PaymentReport }> {
  if (!context.fleet.reportsApprove) throw new FleetError('You need Fleet Reports · Approve for Payment.', 403);
  const ref = reportsCol().doc(reportId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new FleetError('That report was not found.', 404);
  const report = snapshot.data() as PaymentReport;
  if (!report.monthKey) throw new FleetError('A custom-period report is a preview and cannot be approved. Generate the month.', 400);
  if (report.status === 'approved') return { report };

  // Mark the trips first (in batches); re-running after a failure skips those already marked.
  const ids = report.tripIds ?? [];
  for (let index = 0; index < ids.length; index += 400) {
    const chunk = ids.slice(index, index + 400);
    const refs = chunk.map((id) => tripsCol().doc(id));
    const snaps = await db().getAll(...refs);
    const batch = db().batch();
    let writes = 0;
    snaps.forEach((trip, position) => {
      if (trip.exists && !trip.data()?.reportedIn) {
        batch.set(refs[position], { reportedIn: report.monthKey, reportedAt: context.now }, { merge: true });
        writes += 1;
      }
    });
    if (writes) await batch.commit();
  }
  const approved: PaymentReport = { ...report, status: 'approved', approvedAt: context.now, approvedById: context.userId, approvedByName: context.userName };
  await ref.set(stripUndefined(approved));
  afterAudit(context, 'Approve Fleet Payment Report', { before: { status: report.status }, after: { status: 'approved', trips: ids.length, payable: report.totals.payable } }, reportId);
  return { report: approved };
}

export async function listReports(context: FleetContext): Promise<PaymentReport[]> {
  if (!context.fleet.reportsView) throw new FleetError('You need Fleet Reports · View.', 403);
  const snapshot = await reportsCol().get();
  return snapshot.docs
    .map((doc) => doc.data() as PaymentReport)
    .map((report) => ({ ...report, reportA: [], reportB: [], reportC: [], reportD: [] }))
    .sort((a, b) => b.to.localeCompare(a.to) || b.generatedAt.localeCompare(a.generatedAt));
}

export async function getReport(context: FleetContext, reportId: string): Promise<PaymentReport> {
  if (!context.fleet.reportsView) throw new FleetError('You need Fleet Reports · View.', 403);
  const snapshot = await reportsCol().doc(reportId).get();
  if (!snapshot.exists) throw new FleetError('That report was not found.', 404);
  return snapshot.data() as PaymentReport;
}

export async function reportFile(context: FleetContext, reportId: string, kind: string): Promise<Response> {
  const report = await getReport(context, reportId);
  const path = kind === 'xlsx' ? report.files.xlsx : kind === 'pdf' ? report.files.pdf : kind === 'json' ? report.files.json : null;
  if (!path) throw new FleetError('That file is not available.', 404);
  const [bytes] = await getFirebaseAdminBucket().file(path).download();
  const type = kind === 'xlsx' ? XLSX_TYPE : kind === 'pdf' ? 'application/pdf' : 'application/json';
  return new Response(new Uint8Array(bytes), { headers: { 'content-type': type, 'content-disposition': `attachment; filename="fleet-payment-${report.id}.${kind}"`, 'cache-control': 'private, no-store' } });
}
