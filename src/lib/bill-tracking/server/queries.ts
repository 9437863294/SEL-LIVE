import 'server-only';

/**
 * Read models for the Bill Tracking API: register pages, bill detail, dashboard and reports.
 *
 * Each loads the caller's in-scope bills for the selected FY once, on the server, and hands them to
 * the pure report engine. The response carries only what the screen shows — a page of rows plus
 * totals over the whole filtered set — so "436 bills | Net ₹12.95 Cr | Outstanding ₹7.85 Cr" is a
 * real query total, not the sum of the 25 rows on screen.
 */

import { billLedger, combinedLedger, financialYearOf, financialYearRange, isoWeekOf } from '../calculations.ts';
import { isEnabledForProject } from '../categories.ts';
import { sumBy } from '../money.ts';
import {
  ageingReport,
  billAgeingBucket,
  billAgeingDays,
  billTotals,
  collectionLines,
  dashboardKpis,
  deductionReport,
  exceptionItems,
  exceptionSummary,
  filterBills,
  financialYearWeeks,
  forecastItems,
  forecastWindows,
  groupBills,
  isOpen,
  monthlyFlow,
  monthlySummary,
  OUTSTANDING_CHIPS,
  paginate,
  retentionReport,
  sortBills,
  sumMonthlyRows,
  targetPerformance,
  commitmentMissed,
  BILL_SORT_KEYS,
  type BillFilters,
  type BillSortKey,
  type GroupDimension,
  type OutstandingChip,
  type ReportContext,
} from '../reports.ts';
import {
  AGEING_BASES,
  PAYMENT_STATUSES,
  TRANSACTION_TYPES,
  WORKFLOW_STATUSES,
  type AgeingBasis,
  type Bill,
  type BillActivity,
  type BillCollection,
  type BillComment,
  type BillDocument,
  type BillFollowUp,
  type BillTrackingConfig,
  type CollectionTarget,
  type RetentionRelease,
} from '../types.ts';
import { BtError, db, type BtContext } from './context';
import { BT_COLLECTIONS, loadBill, loadClients, loadConfig, loadGstSetup, loadProjects, loadScopedBills, loadScopedDocs, loadUsers } from './store';

/* ── filters from the URL ────────────────────────────────────────────────── */

const list = (params: URLSearchParams, key: string) =>
  params
    .getAll(key)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

const oneOf = <T extends string>(values: readonly T[], candidates: string[]): T[] => candidates.filter((value): value is T => (values as readonly string[]).includes(value));
const dateParam = (params: URLSearchParams, key: string) => {
  const value = params.get(key);
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
};
const numberParam = (params: URLSearchParams, key: string) => {
  const value = params.get(key);
  if (value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

export function parseFilters(params: URLSearchParams, today: string): BillFilters & { asOf: string } {
  const fy = params.get('fy');
  return {
    financialYear: fy === 'all' ? undefined : fy && /^\d{4}-\d{2}$/.test(fy) ? fy : financialYearOf(today),
    from: dateParam(params, 'from'),
    to: dateParam(params, 'to'),
    projectIds: list(params, 'project'),
    clientIds: list(params, 'client'),
    dgmOffices: list(params, 'dgm'),
    billTypeNames: list(params, 'billType'),
    categories: list(params, 'category'),
    transactionTypes: oneOf(TRANSACTION_TYPES, list(params, 'txn')),
    paymentStatuses: oneOf(PAYMENT_STATUSES, list(params, 'payment')),
    workflowStatuses: oneOf(WORKFLOW_STATUSES, list(params, 'workflow')),
    ageingBucket: params.get('ageing') || undefined,
    ageingBasis: oneOf(AGEING_BASES, list(params, 'basis'))[0],
    outstandingMin: numberParam(params, 'min'),
    outstandingMax: numberParam(params, 'max'),
    targetWeek: params.get('targetWeek') || undefined,
    ownerId: params.get('owner') || undefined,
    search: params.get('q')?.slice(0, 120) || undefined,
    outstandingOnly: params.get('open') === '1',
    chips: oneOf(OUTSTANDING_CHIPS, list(params, 'chip')) as OutstandingChip[],
    taxableOrAdvance: params.get('marker') || undefined,
    billIds: list(params, 'ids'),
    asOf: dateParam(params, 'asOf') ?? today,
  };
}

const reportContext = (config: BillTrackingConfig, asOf: string): ReportContext => ({ asOf, settings: config.settings });

interface Loaded {
  config: BillTrackingConfig;
  filters: ReturnType<typeof parseFilters>;
  context: ReportContext;
  all: Bill[];
  bills: Bill[];
}

/** Loads the FY's in-scope bills once and applies the URL filters. */
async function load(btContext: BtContext, params: URLSearchParams): Promise<Loaded> {
  const config = await loadConfig(btContext.organizationId);
  const filters = parseFilters(params, btContext.today);
  const all = await loadScopedBills(btContext, filters.financialYear);
  const context = reportContext(config, filters.asOf);
  return { config, filters, context, all, bills: filterBills(all, filters, context) };
}

/* ── lookups ─────────────────────────────────────────────────────────────── */

export async function lookups(context: BtContext) {
  const config = await loadConfig(context.organizationId);
  const [projects, clients, users, gstSetup] = await Promise.all([loadProjects(context, config.projectProfiles), loadClients(), loadUsers(), loadGstSetup()]);
  const resources = ['Dashboard', 'Bills', 'Collections', 'Retention', 'Follow-ups', 'Targets', 'Import', 'Reports', 'Settings'] as const;
  const actions = ['View', 'Add', 'Edit', 'Delete', 'Verify', 'Approve', 'Override Status', 'Edit After Approval', 'Cancel', 'Hold Unallocated', 'Manage', 'Import', 'Rollback', 'Export', 'Close Month'];
  const permissions: Record<string, string[]> = {};
  for (const resource of resources) permissions[resource] = actions.filter((action) => context.can(resource, action));
  return {
    config,
    projects,
    clients,
    users,
    gstSetup: { ...gstSetup, registrations: gstSetup.registrations.filter((registration) => registration.active) },
    dgmOffices: [...new Set(config.projectProfiles.map((profile) => profile.dgmOffice).filter((value): value is string => Boolean(value)))].sort(),
    permissions,
    allProjects: context.scope === null,
    today: context.today,
    currentFy: financialYearOf(context.today),
    user: { id: context.userId, name: context.userName },
  };
}

/* ── register ────────────────────────────────────────────────────────────── */

export interface BillRow extends Bill {
  ageingDays: number;
  ageingBucket: string;
  overdue: boolean;
  commitmentMissed: boolean;
}

const withAgeing = (bill: Bill, context: ReportContext, basis?: AgeingBasis): BillRow => ({
  ...bill,
  ageingDays: billAgeingDays(bill, context, basis),
  ageingBucket: isOpen(bill) ? billAgeingBucket(bill, context, basis).label : '',
  overdue: isOpen(bill) && Boolean(bill.dueDate) && (bill.dueDate as string) < context.asOf,
  commitmentMissed: commitmentMissed(bill, context.asOf),
});

/** Bulky arrays the register does not show are dropped from list responses. */
const slim = (row: BillRow): BillRow => ({ ...row, searchTokens: [], dueDateRevisions: undefined });

export async function listBills(context: BtContext, params: URLSearchParams) {
  context.require('Bills', 'View');
  const { bills, context: rc, filters } = await load(context, params);
  const sortKey = (BILL_SORT_KEYS as readonly string[]).includes(params.get('sort') ?? '') ? (params.get('sort') as BillSortKey) : 'billDate';
  const direction = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const sorted = sortBills(bills, sortKey, direction, rc);
  const all = params.get('all') === '1';
  const page = paginate(sorted, Number(params.get('page')) || 1, all ? 5000 : Number(params.get('pageSize')) || 25);
  return {
    ...page,
    rows: page.rows.map((bill) => slim(withAgeing(bill, rc, filters.ageingBasis))),
    totals: billTotals(bills),
    asOf: rc.asOf,
  };
}

/** Open bills for a receipt allocation picker: search across the FY-independent book. */
export async function openBillsForAllocation(context: BtContext, params: URLSearchParams) {
  context.require('Collections', 'Add');
  const config = await loadConfig(context.organizationId);
  const all = await loadScopedBills(context);
  const rc = reportContext(config, context.today);
  const filters: BillFilters = { search: params.get('q') || undefined, projectIds: list(params, 'project'), clientIds: list(params, 'client'), billIds: list(params, 'ids') };
  const bills = filterBills(all, filters, rc).filter((bill) => isOpen(bill) || filters.billIds?.includes(bill.id));
  return sortBills(bills, 'billDate', 'asc', rc)
    .slice(0, 200)
    .map((bill) => ({ id: bill.id, billSerialNumber: bill.billSerialNumber, gstInvoiceNumber: bill.gstInvoiceNumber, billDate: bill.billDate, projectId: bill.projectId, projectNameSnapshot: bill.projectNameSnapshot, clientNameSnapshot: bill.clientNameSnapshot, netReceivable: bill.netReceivable, totalReceived: bill.totalReceived, outstandingAmount: bill.outstandingAmount, paymentStatus: bill.paymentStatus, isRetentionBill: bill.isRetentionBill }));
}

/**
 * Invoices of one project that a credit or debit note can be raised against — any payment status
 * (fully paid invoices get credit notes too), never another note.
 */
export async function invoicesForNote(context: BtContext, params: URLSearchParams) {
  context.require('Bills', 'View');
  const projectId = params.get('project');
  if (!projectId) return [];
  context.requireProject(projectId);
  const snapshot = await db().collection(BT_COLLECTIONS.bills).where('organizationId', '==', context.organizationId).where('projectId', '==', projectId).where('isDeleted', '==', false).get();
  const search = params.get('q')?.trim().toLowerCase();
  return snapshot.docs
    .map((doc) => ({ ...(doc.data() as Bill), id: doc.id }))
    .filter((bill) => bill.transactionType !== 'credit_note' && bill.transactionType !== 'debit_note' && bill.id !== params.get('exclude'))
    .filter((bill) => !search || [bill.gstInvoiceNumber, bill.billSerialNumber, bill.description, bill.billTypeName].some((value) => value?.toLowerCase().includes(search)))
    .sort((a, b) => b.billDate.localeCompare(a.billDate))
    .slice(0, 200)
    .map((bill) => ({ id: bill.id, billSerialNumber: bill.billSerialNumber, gstInvoiceNumber: bill.gstInvoiceNumber, billDate: bill.billDate, description: bill.description, billTypeId: bill.billTypeId, billTypeName: bill.billTypeName, billCategory: bill.billCategory, taxableAmount: bill.taxableAmount, gstAmount: bill.gstAmount, gstType: bill.gstType, gstPercent: bill.gstPercent, cgstAmount: bill.cgstAmount, sgstAmount: bill.sgstAmount, igstAmount: bill.igstAmount, grossAmount: bill.grossAmount, netReceivable: bill.netReceivable }));
}

/* ── bill detail ─────────────────────────────────────────────────────────── */

export async function billDetail(context: BtContext, billId: string) {
  context.require('Bills', 'View');
  const bill = await loadBill(context, billId, { includeDeleted: true });
  const config = await loadConfig(context.organizationId);
  const rc = reportContext(config, context.today);
  const firestore = db();
  const byBill = (collection: string) => firestore.collection(collection).where('billId', '==', billId).get();
  const [collections, followUps, comments, documents, activity, retentionByBill, retentionReleases, notes] = await Promise.all([
    firestore.collection(BT_COLLECTIONS.collections).where('billIds', 'array-contains', billId).get(),
    byBill(BT_COLLECTIONS.followUps),
    byBill(BT_COLLECTIONS.comments),
    byBill(BT_COLLECTIONS.documents),
    byBill(BT_COLLECTIONS.activity),
    firestore.collection(BT_COLLECTIONS.retention).where('againstBillId', '==', billId).get(),
    firestore.collection(BT_COLLECTIONS.retention).where('retentionBillId', '==', billId).get(),
    firestore.collection(BT_COLLECTIONS.bills).where('againstBillId', '==', billId).get(),
  ]);
  const docs = <T>(snapshot: FirebaseFirestore.QuerySnapshot) => snapshot.docs.map((doc) => ({ ...(doc.data() as T), id: doc.id }));
  const releases = [...docs<RetentionRelease>(retentionByBill), ...docs<RetentionRelease>(retentionReleases)].filter((release, index, all) => all.findIndex((other) => other.id === release.id) === index);
  return {
    bill: withAgeing(bill, rc),
    ledger: billLedger(bill),
    collections: docs<BillCollection>(collections).sort((a, b) => b.receiptDate.localeCompare(a.receiptDate)),
    followUps: docs<BillFollowUp>(followUps).sort((a, b) => b.followUpDate.localeCompare(a.followUpDate) || b.createdAt.localeCompare(a.createdAt)),
    comments: docs<BillComment>(comments).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    documents: docs<BillDocument>(documents).filter((document) => !document.isDeleted).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
    activity: docs<BillActivity>(activity).sort((a, b) => b.at.localeCompare(a.at)),
    retention: releases.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)),
    // Credit / debit notes raised against this invoice (live ones only).
    notes: docs<Bill>(notes)
      .filter((note) => !note.isDeleted && (note as Bill & { organizationId?: string }).organizationId === context.organizationId)
      .sort((a, b) => a.billDate.localeCompare(b.billDate))
      .map((note) => ({ id: note.id, transactionType: note.transactionType, billSerialNumber: note.billSerialNumber, gstInvoiceNumber: note.gstInvoiceNumber, billDate: note.billDate, taxableAmount: note.taxableAmount, gstAmount: note.gstAmount, grossAmount: note.grossAmount, netReceivable: note.netReceivable })),
  };
}

/* ── collections register ────────────────────────────────────────────────── */

export async function listCollections(context: BtContext, params: URLSearchParams) {
  context.require('Collections', 'View');
  const filters = parseFilters(params, context.today);
  const docs = await loadScopedCollections(context);
  const status = params.get('status');
  const search = filters.search?.toLowerCase();
  const range = filters.financialYear ? financialYearRange(filters.financialYear) : null;
  const rows = docs
    .filter((entry) => entry.projectIds.some((id) => context.inScope(id)))
    .filter((entry) => !range || (entry.receiptDate >= range.from && entry.receiptDate <= range.to))
    .filter((entry) => !filters.from || entry.receiptDate >= filters.from)
    .filter((entry) => !filters.to || entry.receiptDate <= filters.to)
    .filter((entry) => !filters.projectIds?.length || entry.projectIds.some((id) => filters.projectIds?.includes(id)))
    .filter((entry) => !status || entry.status === status)
    .filter((entry) => !params.get('mode') || entry.paymentMode === params.get('mode'))
    .filter((entry) => !search || [entry.utrNumber, entry.bankReference, entry.remarks, entry.clientNameSnapshot, ...entry.allocations.flatMap((a) => [a.gstInvoiceNumber, a.billSerialNumber, a.projectNameSnapshot])].some((value) => value?.toLowerCase().includes(search)))
    .sort((a, b) => b.receiptDate.localeCompare(a.receiptDate) || b.createdAt.localeCompare(a.createdAt));
  const page = paginate(rows, Number(params.get('page')) || 1, params.get('all') === '1' ? 5000 : Number(params.get('pageSize')) || 25);
  const live = rows.filter((entry) => entry.status !== 'cancelled');
  return {
    ...page,
    totals: {
      count: live.length,
      amount: sumBy(live, (entry) => entry.amount),
      verified: sumBy(live.filter((entry) => entry.status === 'verified'), (entry) => entry.amount),
      draft: sumBy(live.filter((entry) => entry.status === 'draft'), (entry) => entry.amount),
      unallocated: sumBy(live, (entry) => entry.unallocatedAmount),
    },
  };
}

/** Receipts touching any in-scope project. `projectIds` is an array, so scope uses array-contains-any. */
async function loadScopedCollections(context: BtContext): Promise<(BillCollection & { projectIds: string[] })[]> {
  if (context.scope && context.scope.length === 0) return [];
  const base = db().collection(BT_COLLECTIONS.collections).where('organizationId', '==', context.organizationId);
  const groups: string[][] = [];
  if (context.scope) for (let index = 0; index < context.scope.length; index += 30) groups.push(context.scope.slice(index, index + 30));
  const snapshots = context.scope === null ? [await base.get()] : await Promise.all(groups.map((ids) => base.where('projectIds', 'array-contains-any', ids).get()));
  const seen = new Map<string, BillCollection & { projectIds: string[] }>();
  snapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => seen.set(doc.id, { ...(doc.data() as BillCollection & { projectIds: string[] }), id: doc.id })));
  return [...seen.values()];
}

/* ── dashboard ───────────────────────────────────────────────────────────── */

export async function dashboard(context: BtContext, params: URLSearchParams) {
  context.require('Dashboard', 'View');
  const { bills, context: rc, filters, config } = await load(context, params);
  const releases = (await loadScopedDocs<RetentionRelease>(BT_COLLECTIONS.retention, context)).filter((release) => release.status === 'active' && (!filters.projectIds?.length || filters.projectIds.includes(release.projectId)));
  const targets = await loadScopedTargets(context);
  const fy = filters.financialYear ?? financialYearOf(rc.asOf);
  const weeks = financialYearWeeks(fy).filter((week) => week <= isoWeekOf(rc.asOf)).slice(-12);
  const open = bills.filter(isOpen);
  const items = forecastItems(open);
  const exceptions = exceptionItems(bills, rc);
  return {
    asOf: rc.asOf,
    financialYear: fy,
    kpis: dashboardKpis(bills, releases, rc),
    monthly: monthlyFlow(bills, fy, rc),
    projects: groupBills(bills, 'project', rc, releases).slice(0, 12),
    clients: groupBills(bills, 'client', rc, releases).slice(0, 10),
    billTypes: groupBills(bills, 'category', rc),
    ageing: ageingReport(bills, rc),
    targets: targetPerformance(targets.filter((target) => !filters.projectIds?.length || !target.projectId || filters.projectIds.includes(target.projectId)), bills, weeks),
    forecast: forecastWindows(items, rc.asOf),
    oldest: sortBills(open, 'ageing', 'desc', rc).slice(0, 8).map((bill) => slim(withAgeing(bill, rc))),
    recentCollections: collectionLines(bills).slice(0, 8),
    expectedThisWeek: items.filter((item) => isoWeekOf(item.date) === isoWeekOf(rc.asOf)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10),
    missedCommitments: open.filter((bill) => commitmentMissed(bill, rc.asOf)).slice(0, 10).map((bill) => slim(withAgeing(bill, rc))),
    needsFollowUp: exceptions.filter((item) => item.kind === 'no_follow_up').slice(0, 10),
    exceptions: exceptionSummary(exceptions),
    retention: retentionReport(bills, releases, rc).totals,
    settings: { ageingBuckets: config.settings.ageingBuckets },
  };
}

async function loadScopedTargets(context: BtContext): Promise<CollectionTarget[]> {
  const snapshot = await db().collection(BT_COLLECTIONS.targets).where('organizationId', '==', context.organizationId).get();
  return snapshot.docs.map((doc) => ({ ...(doc.data() as CollectionTarget), id: doc.id })).filter((target) => (target.projectId ? context.inScope(target.projectId) : context.scope === null));
}

/* ── reports ─────────────────────────────────────────────────────────────── */

export const REPORT_KINDS = [
  'monthly',
  'pi',
  'project-wise',
  'client-wise',
  'bill-type',
  'dgm-office',
  'collections',
  'deductions',
  'retention',
  'ageing',
  'not-received',
  'site-wise',
  'exceptions',
  'forecast',
  'targets',
  'performance',
  'project-ledger',
  'client-ledger',
  'data-quality',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export async function report(context: BtContext, kind: ReportKind, params: URLSearchParams, permission: [Parameters<BtContext['require']>[0], string] = ['Reports', 'View']) {
  // The Retention and Targets pages reuse these reports under their own permission.
  context.require(permission[0], permission[1]);
  const { bills, context: rc, filters, config, all } = await load(context, params);
  const fy = filters.financialYear ?? financialYearOf(rc.asOf);
  const releases = async () => (await loadScopedDocs<RetentionRelease>(BT_COLLECTIONS.retention, context)).filter((release) => release.status === 'active' && (!filters.projectIds?.length || filters.projectIds.includes(release.projectId)));
  const dimension = (params.get('by') as GroupDimension | null) ?? 'project';
  const base = { kind, asOf: rc.asOf, financialYear: filters.financialYear ?? 'all' };

  switch (kind) {
    case 'monthly':
    case 'pi': {
      const subset = kind === 'pi' ? bills.filter((bill) => (bill.taxableOrAdvance ?? '').toUpperCase() === config.settings.piMarker.toUpperCase() || bill.transactionType === 'advance') : bills;
      const rows = monthlySummary(subset, fy, config.billCategories);
      return { ...base, financialYear: fy, rows, totals: sumMonthlyRows(rows), piMarker: config.settings.piMarker, billCount: subset.length };
    }
    case 'project-wise':
      return { ...base, rows: groupBills(bills, 'project', rc, await releases()), totals: billTotals(bills) };
    case 'client-wise':
      return { ...base, rows: groupBills(bills, 'client', rc, await releases()), totals: billTotals(bills) };
    case 'dgm-office':
      return { ...base, rows: groupBills(bills, 'dgmOffice', rc, await releases()), totals: billTotals(bills) };
    case 'bill-type':
      return { ...base, rows: groupBills(bills, params.get('by') === 'category' ? 'category' : 'billType', rc), totals: billTotals(bills) };
    case 'collections': {
      const from = filters.from ?? financialYearRange(fy)?.from;
      const to = filters.to ?? financialYearRange(fy)?.to;
      // Receipts are dated independently of their bills: use every in-scope bill, filtered by receipt date.
      const lines = collectionLines(filterBills(await loadScopedBills(context), { ...filters, financialYear: undefined, from: undefined, to: undefined }, rc), from, to);
      const byMonth = new Map<string, number>();
      lines.forEach((line) => byMonth.set(line.receiptDate.slice(0, 7), (byMonth.get(line.receiptDate.slice(0, 7)) ?? 0) + line.amount));
      return { ...base, from, to, rows: lines, total: sumBy(lines, (line) => line.amount), byMonth: [...byMonth.entries()].sort().map(([month, amount]) => ({ month, amount: Math.round(amount * 100) / 100 })) };
    }
    case 'deductions':
      return { ...base, dimension, ...deductionReport(bills, config.deductionTypes, dimension) };
    case 'retention':
      return { ...base, ...retentionReport(bills, await releases(), rc), releases: (await releases()).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)) };
    case 'ageing':
      return { ...base, ...ageingReport(filters.financialYear ? bills : bills, rc, { basis: filters.ageingBasis, dimension }) };
    case 'not-received': {
      const rows = sortBills(bills.filter(isOpen), 'billDate', 'asc', rc).map((bill) => slim(withAgeing(bill, rc, filters.ageingBasis)));
      return { ...base, rows, totals: billTotals(rows) };
    }
    case 'site-wise': {
      if (!filters.projectIds?.length) return { ...base, rows: [], totals: billTotals([]), deductionTypes: config.deductionTypes, needsProject: true };
      const rows = sortBills(bills, 'billDate', 'asc', rc).map((bill) => slim(withAgeing(bill, rc)));
      return { ...base, rows, totals: billTotals(rows), deductionTypes: config.deductionTypes };
    }
    case 'exceptions': {
      const items = exceptionItems(bills, rc);
      return { ...base, summary: exceptionSummary(items), rows: params.get('type') ? items.filter((item) => item.kind === params.get('type')) : items };
    }
    case 'forecast': {
      const items = forecastItems(bills.filter(isOpen)).sort((a, b) => a.date.localeCompare(b.date));
      return { ...base, windows: forecastWindows(items, rc.asOf), rows: items.filter((item) => item.date >= rc.asOf) };
    }
    case 'targets':
    case 'performance': {
      const targets = await loadScopedTargets(context);
      const weeks = financialYearWeeks(fy);
      const performance = targetPerformance(targets, all, weeks).filter((row) => row.target > 0 || row.actual > 0);
      const byDimension = kind === 'performance' ? performanceBy(all, targets, (params.get('by') as 'owner' | 'project' | 'dgmOffice' | null) ?? 'project', fy) : [];
      return { ...base, financialYear: fy, weeks: performance, targets: targets.filter((target) => target.financialYear === fy).sort((a, b) => b.week.localeCompare(a.week)), byDimension };
    }
    case 'project-ledger':
    case 'client-ledger': {
      const key = kind === 'project-ledger' ? params.get('project') : params.get('client');
      if (!key) return { ...base, lines: [], needsSelection: true };
      const subset = all.filter((bill) => (kind === 'project-ledger' ? bill.projectId === key : bill.clientId === key));
      return { ...base, lines: combinedLedger(subset), totals: billTotals(subset) };
    }
    case 'data-quality':
      return { ...base, ...dataQuality(all, config) };
  }
}

function performanceBy(bills: readonly Bill[], targets: readonly CollectionTarget[], dimension: 'owner' | 'project' | 'dgmOffice', fy: string) {
  const range = financialYearRange(fy);
  const lines = collectionLines(bills, range?.from, range?.to);
  const keyOfLine = (line: ReturnType<typeof collectionLines>[number]) => (dimension === 'owner' ? line.ownerId ?? '—' : dimension === 'project' ? line.projectId : line.dgmOffice ?? '—');
  const groups = new Map<string, { label: string; target: number; actual: number }>();
  const labelOf = (key: string) => {
    if (dimension === 'project') return bills.find((bill) => bill.projectId === key)?.projectNameSnapshot ?? key;
    if (dimension === 'owner') return bills.find((bill) => bill.collectionOwnerId === key)?.collectionOwnerName ?? (key === '—' ? 'Unassigned' : key);
    return key === '—' ? 'No DGM office' : key;
  };
  for (const line of lines) {
    const key = keyOfLine(line);
    const group = groups.get(key) ?? { label: labelOf(key), target: 0, actual: 0 };
    group.actual = Math.round((group.actual + line.amount) * 100) / 100;
    groups.set(key, group);
  }
  for (const target of targets.filter((entry) => entry.financialYear === fy)) {
    const key = dimension === 'owner' ? target.responsibleId ?? '—' : dimension === 'project' ? target.projectId ?? '—' : bills.find((bill) => bill.projectId === target.projectId)?.dgmOffice ?? '—';
    const group = groups.get(key) ?? { label: dimension === 'owner' ? target.responsibleName ?? 'Unassigned' : labelOf(key), target: 0, actual: 0 };
    group.target = Math.round((group.target + target.amount) * 100) / 100;
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group, achievement: group.target > 0 ? Math.round((group.actual / group.target) * 1000) / 10 : null })).sort((a, b) => b.actual - a.actual);
}

/** The post-migration clean-up list (Settings · Data Quality). */
function dataQuality(bills: readonly Bill[], config: BillTrackingConfig) {
  const knownTypes = new Set(config.billTypes.map((type) => type.id));
  const checks = [
    { key: 'missing_project', label: 'Missing project', test: (bill: Bill) => !bill.projectId },
    { key: 'unmapped_client', label: 'No client', test: (bill: Bill) => !bill.clientId },
    { key: 'missing_invoice', label: 'Missing GST invoice (GST charged)', test: (bill: Bill) => !bill.gstInvoiceNumber && bill.gstAmount !== 0 },
    { key: 'net_mismatch', label: 'Net mismatch (unresolved)', test: (bill: Bill) => Boolean(bill.netMismatch && !bill.netMismatch.resolvedAt) },
    { key: 'receipt_mismatch', label: 'Receipt differs from workbook', test: (bill: Bill) => bill.importedReceived !== undefined && Math.abs((bill.importedReceived ?? 0) - bill.totalReceived) > config.settings.tolerance },
    { key: 'missing_due_date', label: 'Missing due date', test: (bill: Bill) => !bill.dueDate },
    { key: 'unknown_bill_type', label: 'Sub category missing or deleted', test: (bill: Bill) => !bill.billTypeId || !knownTypes.has(bill.billTypeId) },
    {
      key: 'bill_type_not_in_project',
      label: 'Sub category not enabled for the bill’s project',
      test: (bill: Bill) => {
        const type = config.billTypes.find((entry) => entry.id === bill.billTypeId);
        return Boolean(type) && !isEnabledForProject(type as NonNullable<typeof type>, bill.projectId);
      },
    },
    { key: 'unknown_category', label: 'Main category missing or deleted', test: (bill: Bill) => !config.billCategories.some((category) => category.id === bill.billCategory) },
    { key: 'legacy_status_mismatch', label: 'Legacy status mismatch', test: (bill: Bill) => Boolean(bill.legacyStatus) && ((bill.legacyStatus?.toUpperCase() === 'RECEIVED' && bill.paymentStatus !== 'received') || (bill.legacyStatus?.toUpperCase() === 'NOT RECEIVED' && bill.paymentStatus !== 'not_received')) },
    { key: 'no_dgm_office', label: 'No DGM office on project', test: (bill: Bill) => !bill.dgmOffice },
    { key: 'credit_note_unlinked', label: 'Credit note not linked to an invoice', test: (bill: Bill) => bill.transactionType === 'credit_note' && !bill.againstBillId },
    { key: 'gst_not_split', label: 'GST not split into CGST / SGST / IGST', test: (bill: Bill) => bill.gstAmount !== 0 && !bill.gstType },
  ];
  const duplicates = new Map<string, Bill[]>();
  for (const bill of bills) {
    if (!bill.gstInvoiceNumber) continue;
    const key = `${bill.projectId}|${bill.gstInvoiceNumber.toLowerCase()}|${bill.billTypeName}`;
    duplicates.set(key, [...(duplicates.get(key) ?? []), bill]);
  }
  const duplicateIds = new Set([...duplicates.values()].filter((group) => group.length > 1).flat().map((bill) => bill.id));
  const results = checks.map((check) => {
    const hits = bills.filter(check.test);
    return { key: check.key, label: check.label, count: hits.length, billIds: hits.map((bill) => bill.id).slice(0, 500) };
  });
  results.push({ key: 'duplicate_bills', label: 'Possible duplicate bills', count: duplicateIds.size, billIds: [...duplicateIds].slice(0, 500) });
  return { checks: results, billCount: bills.length };
}

/* ── activity feed ───────────────────────────────────────────────────────── */

export async function activityFeed(context: BtContext, params: URLSearchParams) {
  context.require('Bills', 'View');
  const limit = Math.min(Number(params.get('limit')) || 50, 200);
  // Newest first from the index; over-fetch so entries outside the caller's scope can be dropped.
  const snapshot = await db().collection(BT_COLLECTIONS.activity).where('organizationId', '==', context.organizationId).orderBy('at', 'desc').limit(limit * 4).get();
  return snapshot.docs
    .map((doc) => ({ ...(doc.data() as BillActivity & { projectId?: string }), id: doc.id }))
    .filter((entry) => !entry.projectId || context.inScope(entry.projectId))
    .filter((entry) => !params.get('entity') || entry.entityType === params.get('entity'))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

export { BtError };
