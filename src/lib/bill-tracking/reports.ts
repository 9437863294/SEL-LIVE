/**
 * Report engine for Bill Tracking.
 *
 * Every dashboard figure, register total and report row is computed here from bills (with their
 * embedded deduction lines and receipt references), retention releases, follow-ups and targets. The
 * API routes load the caller's in-scope records with the Admin SDK and call these functions, so
 * the browser receives finished figures — it never sums a ledger itself, and two screens can never
 * disagree about what "outstanding" means.
 *
 * The legacy workbook's report sheets were Google Sheets QUERY formulas over the `Bill Tracking`
 * sheet. Their logic is reproduced from the formulas themselves (see `monthlySummary`), not
 * re-imagined, with the dimension the formulas hard-coded (bill-type name lists) replaced by the
 * configurable bill-type master.
 *
 * Pure: no Firestore, no React. Dates are `yyyy-MM-dd` keys and `asOf` is always explicit, so a
 * report "as on 31-Mar-2026" is a parameter, not a different code path.
 */

import {
  addDays,
  ageingBucketOf,
  ageingDays,
  collectionPercent,
  countedCollections,
  daysBetween,
  financialYearMonths,
  isoWeekOf,
  isoWeekRange,
  monthKeyOf,
  monthRange,
  outstandingAsOf,
  parseDateKey,
  toDateKey,
} from './calculations.ts';
import { roundMoney, subtractMoney, sumBy, sumMoney, toPaise } from './money.ts';
import { certificationSummary } from './certification.ts';
import type {
  AgeingBasis,
  AgeingBucketConfig,
  Bill,
  BillCategory,
  BillCategoryMaster,
  BillFollowUp,
  BillPaymentStatus,
  BillTrackingSettings,
  BillTransactionType,
  BillWorkflowStatus,
  CollectionTarget,
  DeductionKind,
  DeductionTypeMaster,
  RetentionRelease,
  RetentionStatus,
  SummaryColumn,
} from './types';
import { summaryColumnOf } from './categories.ts';

/* ── filters ─────────────────────────────────────────────────────────────── */

export const OUTSTANDING_CHIPS = [
  'not_received',
  'partially_received',
  'overdue',
  'gt30',
  'gt60',
  'gt90',
  'gt180',
  'gt365',
  'commitment_missed',
] as const;
export type OutstandingChip = (typeof OUTSTANDING_CHIPS)[number];

export interface BillFilters {
  financialYear?: string;
  from?: string;
  to?: string;
  projectIds?: string[];
  clientIds?: string[];
  dgmOffices?: string[];
  billTypeNames?: string[];
  categories?: BillCategory[];
  transactionTypes?: BillTransactionType[];
  paymentStatuses?: BillPaymentStatus[];
  workflowStatuses?: BillWorkflowStatus[];
  ageingBucket?: string;
  outstandingMin?: number;
  outstandingMax?: number;
  targetWeek?: string;
  ownerId?: string;
  search?: string;
  /** Only bills with something left to collect. */
  outstandingOnly?: boolean;
  chips?: OutstandingChip[];
  /** Legacy `TAXABLE / ADVANCE` marker filter (the PI report). */
  taxableOrAdvance?: string;
  /** Bill ids — a drill-down from a reconciliation or exception. */
  billIds?: string[];
  asOf?: string;
  ageingBasis?: AgeingBasis;
}

export interface ReportContext {
  asOf: string;
  settings: Pick<BillTrackingSettings, 'tolerance' | 'ageingBuckets' | 'defaultAgeingBasis' | 'noFollowUpDays' | 'oldOutstandingDays' | 'highValueThreshold'>;
}

const includesOrAll = <T>(list: readonly T[] | undefined, value: T | undefined) =>
  !list?.length || (value !== undefined && list.includes(value));

/** Bills whose outstanding counts — settled, adjusted and cancelled bills owe nothing. */
export const isOpen = (bill: Bill): boolean =>
  !bill.isDeleted && bill.paymentStatus !== 'received' && bill.paymentStatus !== 'adjusted' && bill.paymentStatus !== 'cancelled' && toPaise(bill.outstandingAmount) !== 0;

export const billAgeingDays = (bill: Bill, context: ReportContext, basis?: AgeingBasis): number =>
  ageingDays(bill, basis ?? context.settings.defaultAgeingBasis, context.asOf);

export const billAgeingBucket = (bill: Bill, context: ReportContext, basis?: AgeingBasis): AgeingBucketConfig =>
  ageingBucketOf(billAgeingDays(bill, context, basis), context.settings.ageingBuckets);

export const isOverdue = (bill: Bill, asOf: string): boolean => isOpen(bill) && Boolean(bill.dueDate) && (bill.dueDate as string) < asOf;

export const commitmentMissed = (bill: Bill, asOf: string): boolean =>
  isOpen(bill) && Boolean(bill.nextCommitmentDate) && (bill.nextCommitmentDate as string) < asOf;

const matchesChip = (bill: Bill, chip: OutstandingChip, context: ReportContext): boolean => {
  const days = billAgeingDays(bill, context);
  switch (chip) {
    case 'not_received':
      return bill.paymentStatus === 'not_received';
    case 'partially_received':
      return bill.paymentStatus === 'partially_received';
    case 'overdue':
      return isOverdue(bill, context.asOf);
    case 'gt30':
      return days > 30;
    case 'gt60':
      return days > 60;
    case 'gt90':
      return days > 90;
    case 'gt180':
      return days > 180;
    case 'gt365':
      return days > 365;
    case 'commitment_missed':
      return commitmentMissed(bill, context.asOf);
  }
};

export function filterBills(bills: readonly Bill[], filters: BillFilters, context: ReportContext): Bill[] {
  const search = filters.search?.trim().toLowerCase();
  const searchNumber = search ? Number(search.replace(/[₹,\s]/g, '')) : NaN;
  return bills.filter((bill) => {
    if (bill.isDeleted) return false;
    if (filters.billIds?.length && !filters.billIds.includes(bill.id)) return false;
    if (filters.financialYear && bill.financialYear !== filters.financialYear) return false;
    if (filters.from && bill.billDate < filters.from) return false;
    if (filters.to && bill.billDate > filters.to) return false;
    if (!includesOrAll(filters.projectIds, bill.projectId)) return false;
    if (!includesOrAll(filters.clientIds, bill.clientId)) return false;
    if (!includesOrAll(filters.dgmOffices, bill.dgmOffice)) return false;
    if (!includesOrAll(filters.billTypeNames, bill.billTypeName)) return false;
    if (!includesOrAll(filters.categories, bill.billCategory)) return false;
    if (!includesOrAll(filters.transactionTypes, bill.transactionType)) return false;
    if (!includesOrAll(filters.paymentStatuses, bill.paymentStatus)) return false;
    if (!includesOrAll(filters.workflowStatuses, bill.workflowStatus)) return false;
    if (filters.targetWeek && bill.targetWeek !== filters.targetWeek) return false;
    if (filters.ownerId && bill.collectionOwnerId !== filters.ownerId) return false;
    if (filters.taxableOrAdvance && (bill.taxableOrAdvance ?? '').toUpperCase() !== filters.taxableOrAdvance.toUpperCase()) return false;
    if (filters.outstandingOnly && !isOpen(bill)) return false;
    if (filters.outstandingMin !== undefined && bill.outstandingAmount < filters.outstandingMin) return false;
    if (filters.outstandingMax !== undefined && bill.outstandingAmount > filters.outstandingMax) return false;
    if (filters.ageingBucket && (!isOpen(bill) || billAgeingBucket(bill, context, filters.ageingBasis).label !== filters.ageingBucket)) return false;
    if (filters.chips?.length && !filters.chips.every((chip) => matchesChip(bill, chip, context))) return false;
    if (search) {
      const tokenHit = bill.searchTokens?.some((token) => token.includes(search));
      const amountHit =
        Number.isFinite(searchNumber) &&
        searchNumber !== 0 &&
        [bill.taxableAmount, bill.grossAmount, bill.netReceivable, bill.outstandingAmount].some((value) => toPaise(value) === toPaise(searchNumber));
      const utrHit = bill.collections?.some((entry) => entry.utrNumber?.toLowerCase().includes(search));
      if (!tokenHit && !amountHit && !utrHit) return false;
    }
    return true;
  });
}

/** Tokens for the register's search box, written onto every bill. */
export function buildSearchTokens(bill: Pick<Bill, 'billSerialNumber' | 'gstInvoiceNumber' | 'projectNameSnapshot' | 'clientNameSnapshot' | 'description' | 'billTypeName' | 'dgmOffice'>): string[] {
  const values = [bill.billSerialNumber, bill.gstInvoiceNumber, bill.projectNameSnapshot, bill.clientNameSnapshot, bill.description, bill.billTypeName, bill.dgmOffice];
  return [...new Set(values.filter(Boolean).map((value) => String(value).toLowerCase().trim()))];
}

/* ── sorting & paging ────────────────────────────────────────────────────── */

export const BILL_SORT_KEYS = ['billDate', 'serialNumber', 'billSerialNumber', 'gstInvoiceNumber', 'projectNameSnapshot', 'netReceivable', 'outstandingAmount', 'totalReceived', 'taxableAmount', 'ageing', 'updatedAt'] as const;
export type BillSortKey = (typeof BILL_SORT_KEYS)[number];

export function sortBills(bills: readonly Bill[], key: BillSortKey, direction: 'asc' | 'desc', context: ReportContext): Bill[] {
  const factor = direction === 'asc' ? 1 : -1;
  const value = (bill: Bill): string | number => {
    if (key === 'ageing') return billAgeingDays(bill, context);
    const raw = bill[key as keyof Bill];
    if (typeof raw === 'number') return raw;
    return String(raw ?? '');
  };
  return [...bills].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en-IN', { numeric: true });
    return order * factor || b.billDate.localeCompare(a.billDate);
  });
}

export function paginate<T>(rows: readonly T[], page: number, pageSize: number): { rows: T[]; page: number; pageSize: number; total: number; pages: number } {
  const size = Math.min(Math.max(pageSize, 1), 500);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(page, 1), pages);
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pageSize: size, total: rows.length, pages };
}

/* ── totals ──────────────────────────────────────────────────────────────── */

export interface BillTotals {
  count: number;
  taxable: number;
  gst: number;
  gross: number;
  deduction: number;
  statutory: number;
  retention: number;
  net: number;
  received: number;
  outstanding: number;
  collectionPercent: number | null;
}

export function billTotals(bills: readonly Bill[]): BillTotals {
  const net = sumBy(bills, (bill) => bill.netReceivable);
  const received = sumBy(bills, (bill) => bill.totalReceived);
  return {
    count: bills.length,
    taxable: sumBy(bills, (bill) => bill.taxableAmount),
    gst: sumBy(bills, (bill) => bill.gstAmount),
    gross: sumBy(bills, (bill) => bill.grossAmount),
    deduction: sumBy(bills, (bill) => bill.totalDeduction),
    statutory: sumBy(bills, (bill) => bill.statutoryDeduction),
    retention: sumBy(bills, (bill) => bill.retentionDeducted),
    net,
    received,
    outstanding: sumBy(bills.filter(isOpen), (bill) => bill.outstandingAmount),
    collectionPercent: collectionPercent(received, net),
  };
}

/* ── grouping ────────────────────────────────────────────────────────────── */

export interface GroupRow extends BillTotals {
  key: string;
  label: string;
  retentionReleased: number;
  retentionBalance: number;
  oldestOutstandingDate?: string;
  oldestOutstandingDays?: number;
  lastReceiptDate?: string;
  /** Amount-weighted average days from bill date to receipt, over verified receipts. */
  averageCollectionDays: number | null;
  overdue: number;
  pendingCommitment: number;
  dgmOffice?: string;
  clientName?: string;
}

export type GroupDimension = 'project' | 'client' | 'billType' | 'category' | 'dgmOffice' | 'month' | 'financialYear' | 'transactionType' | 'owner';

const dimensionOf = (bill: Bill, dimension: GroupDimension): { key: string; label: string } => {
  switch (dimension) {
    case 'project':
      return { key: bill.projectId, label: bill.projectNameSnapshot };
    case 'client':
      return { key: bill.clientId || '—', label: bill.clientNameSnapshot || 'No client' };
    case 'billType':
      return { key: bill.billTypeName || '—', label: bill.billTypeName || 'Unclassified' };
    case 'category':
      return { key: bill.billCategory, label: bill.billCategoryName ?? bill.billCategory };
    case 'dgmOffice':
      return { key: bill.dgmOffice || '—', label: bill.dgmOffice || 'No DGM office' };
    case 'month':
      return { key: monthKeyOf(bill.billDate), label: monthKeyOf(bill.billDate) };
    case 'financialYear':
      return { key: bill.financialYear, label: bill.financialYear };
    case 'transactionType':
      return { key: bill.transactionType, label: bill.transactionType };
    case 'owner':
      return { key: bill.collectionOwnerId || '—', label: bill.collectionOwnerName || 'Unassigned' };
  }
};

export function averageCollectionDays(bills: readonly Bill[]): number | null {
  let weighted = 0;
  let weight = 0;
  for (const bill of bills) {
    for (const entry of countedCollections(bill.collections ?? [])) {
      const days = daysBetween(bill.billDate, entry.receiptDate);
      if (days === null || entry.amount <= 0) continue;
      weighted += days * entry.amount;
      weight += entry.amount;
    }
  }
  return weight > 0 ? Math.round(weighted / weight) : null;
}

export function groupBills(
  bills: readonly Bill[],
  dimension: GroupDimension,
  context: ReportContext,
  releases: readonly RetentionRelease[] = [],
): GroupRow[] {
  const groups = new Map<string, { label: string; bills: Bill[] }>();
  for (const bill of bills) {
    const { key, label } = dimensionOf(bill, dimension);
    const group = groups.get(key) ?? { label, bills: [] };
    group.bills.push(bill);
    groups.set(key, group);
  }
  const releasedByProject = new Map<string, number>();
  for (const release of releases) {
    if (release.status !== 'active') continue;
    releasedByProject.set(release.projectId, sumMoney([releasedByProject.get(release.projectId) ?? 0, release.amount]));
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const totals = billTotals(group.bills);
      const open = group.bills.filter(isOpen);
      const oldest = open.map((bill) => bill.billDate).sort()[0];
      const projectIds = new Set(group.bills.map((bill) => bill.projectId));
      // Releases are recorded per project; they attribute cleanly only to project-shaped groups.
      const released = dimension === 'project' ? (releasedByProject.get(key) ?? 0) : dimension === 'client' || dimension === 'dgmOffice' ? sumMoney([...projectIds].map((id) => releasedByProject.get(id) ?? 0)) : 0;
      return {
        key,
        label: group.label,
        ...totals,
        retentionReleased: released,
        retentionBalance: subtractMoney(totals.retention, released),
        oldestOutstandingDate: oldest,
        oldestOutstandingDays: oldest ? (daysBetween(oldest, context.asOf) ?? undefined) : undefined,
        lastReceiptDate: group.bills.map((bill) => bill.lastReceiptDate).filter(Boolean).sort().at(-1),
        averageCollectionDays: averageCollectionDays(group.bills),
        overdue: sumBy(group.bills.filter((bill) => isOverdue(bill, context.asOf)), (bill) => bill.outstandingAmount),
        pendingCommitment: sumBy(open.filter((bill) => bill.nextCommitmentDate && bill.nextCommitmentDate >= context.asOf), (bill) => bill.nextCommitmentAmount ?? 0),
        dgmOffice: group.bills[0]?.dgmOffice,
        clientName: group.bills[0]?.clientNameSnapshot,
      } satisfies GroupRow;
    })
    .sort((a, b) => b.outstanding - a.outstanding || b.net - a.net);
}

/* ── ageing ──────────────────────────────────────────────────────────────── */

export interface AgeingCell {
  label: string;
  amount: number;
  count: number;
}

export interface AgeingRow {
  key: string;
  label: string;
  buckets: AgeingCell[];
  total: number;
  count: number;
}

export interface AgeingReport {
  asOf: string;
  basis: AgeingBasis;
  buckets: AgeingBucketConfig[];
  rows: AgeingRow[];
  totals: AgeingCell[];
  grandTotal: number;
  count: number;
}

/**
 * Outstanding by ageing bucket, as on any date: a bill counts if it was raised by `asOf`, and only
 * receipts dated by `asOf` reduce it (`outstandingAsOf`). Replaces the legacy "Ageing of Bills"
 * sheet, which used DAYS360 from the bill date to today; this uses calendar days from the chosen
 * basis date, and adds the 365+ bucket the sheet lacked.
 */
export function ageingReport(
  bills: readonly Bill[],
  context: ReportContext,
  options: { basis?: AgeingBasis; dimension?: GroupDimension } = {},
): AgeingReport {
  const basis = options.basis ?? context.settings.defaultAgeingBasis;
  const buckets = [...context.settings.ageingBuckets].sort((a, b) => a.from - b.from);
  const dimension = options.dimension ?? 'project';
  const rows = new Map<string, AgeingRow>();
  const totals = buckets.map((bucket) => ({ label: bucket.label, amount: 0, count: 0 }));

  for (const bill of bills) {
    const position = outstandingAsOf(bill, context.asOf, context.settings.tolerance);
    if (!position.included || toPaise(position.outstanding) === 0) continue;
    const bucket = ageingBucketOf(ageingDays(bill, basis, context.asOf), buckets);
    const { key, label } = dimensionOf(bill, dimension);
    const row = rows.get(key) ?? { key, label, buckets: buckets.map((b) => ({ label: b.label, amount: 0, count: 0 })), total: 0, count: 0 };
    const cell = row.buckets.find((entry) => entry.label === bucket.label) as AgeingCell;
    cell.amount = sumMoney([cell.amount, position.outstanding]);
    cell.count += 1;
    row.total = sumMoney([row.total, position.outstanding]);
    row.count += 1;
    rows.set(key, row);
    const total = totals.find((entry) => entry.label === bucket.label) as AgeingCell;
    total.amount = sumMoney([total.amount, position.outstanding]);
    total.count += 1;
  }

  const sorted = [...rows.values()].sort((a, b) => b.total - a.total);
  return {
    asOf: context.asOf,
    basis,
    buckets,
    rows: sorted,
    totals,
    grandTotal: sumBy(sorted, (row) => row.total),
    count: sorted.reduce((count, row) => count + row.count, 0),
  };
}

/* ── month-wise summary (the legacy "Month wise summary report") ──────────── */

export interface MonthlySummaryRow {
  month: string;
  from: string;
  to: string;
  taxableSupply: number;
  taxableErection: number;
  taxableCivil: number;
  taxableFi: number;
  taxableOther: number;
  retentionRaised: number;
  totalTaxable: number;
  gst: number;
  /** GST split; legacy bills imported with a single GST figure are counted in `gstUnsplit`. */
  cgst: number;
  sgst: number;
  igst: number;
  gstUnsplit: number;
  totalInclGst: number;
  statutoryDeduction: number;
  retentionCpbg: number;
  retentionReleasedByClient: number;
  retentionInvoice: number;
  retentionTimeExtension: number;
  mobilizationAdvance: number;
  mobilizationInterest: number;
  net: number;
  netReceived: number;
  difference: number;
  collectionInMonth: number;
  billCount: number;
}

const kindSum = (bill: Bill, kinds: readonly DeductionKind[]) => sumBy((bill.deductions ?? []).filter((line) => kinds.includes(line.kind)), (line) => line.amount);

/**
 * One row per month of the FY, reproducing the legacy summary's QUERY formulas column by column:
 *
 *   Taxable Supply/Erection/Civil/F&I   SUM(Taxable) by bill-type category, by bill date
 *   Retention Amount Raised             SUM(Net) of retention bills, by bill date
 *   Statutory Deduction                 SUM(Cess + Income TDS + CGST TDS + SGST TDS)
 *   Retention Against CPBG              SUM(Retention CPBG)
 *   Retention Released by Client        SUM(Received) on retention bills, by bill date
 *   Mob. Adv / Interest                 SUM(Mob Adv) / SUM(Int. on Mob)
 *   Net Amount / Net Amount Receipt     SUM(Net) / SUM(Received), by bill date
 *   Difference                          Net − Receipt
 *   Collection in this Month            SUM(Received) by *receipt* date
 *
 * The legacy sheet's taxable columns name bill types explicitly and two of them (SUPPLY-20%,
 * SUPPLY-10%) appear in both the Supply and the Retention lists; here each bill's main category
 * names the column (Settings → Bill categories), so every bill lands in exactly one taxable column. "Retention withheld against
 * invoice" is the retention-against-invoice deduction (the legacy column summed retention-bill
 * shortfalls under that heading, which double counts with "Difference").
 */
export function monthlySummary(bills: readonly Bill[], financialYear: string, categories: readonly Pick<BillCategoryMaster, 'id' | 'summaryColumn'>[] = []): MonthlySummaryRow[] {
  const columnOf = (bill: Bill) => summaryColumnOf(bill.billCategory, categories);
  const months = financialYearMonths(financialYear);
  return months.map((month) => {
    const { from, to } = monthRange(month);
    const inMonth = bills.filter((bill) => !bill.isDeleted && bill.billDate >= from && bill.billDate <= to);
    const regular = inMonth.filter((bill) => !bill.isRetentionBill);
    const retentionBills = inMonth.filter((bill) => bill.isRetentionBill);
    const taxableOf = (column: SummaryColumn) => sumBy(regular.filter((bill) => columnOf(bill) === column), (bill) => bill.taxableAmount);
    const totalTaxable = sumBy(inMonth, (bill) => bill.taxableAmount);
    const gst = sumBy(inMonth, (bill) => bill.gstAmount);
    const net = sumBy(inMonth, (bill) => bill.netReceivable);
    const netReceived = sumBy(inMonth, (bill) => bill.totalReceived);
    const collectionInMonth = sumMoney(
      bills
        .filter((bill) => !bill.isDeleted)
        .flatMap((bill) => countedCollections(bill.collections ?? []).filter((entry) => entry.receiptDate >= from && entry.receiptDate <= to).map((entry) => entry.amount)),
    );
    return {
      month,
      from,
      to,
      taxableSupply: taxableOf('supply'),
      taxableErection: taxableOf('erection'),
      taxableCivil: taxableOf('civil'),
      taxableFi: taxableOf('fi'),
      taxableOther: taxableOf('other'),
      retentionRaised: sumBy(retentionBills, (bill) => bill.netReceivable),
      totalTaxable,
      gst,
      cgst: sumBy(inMonth, (bill) => bill.cgstAmount ?? 0),
      sgst: sumBy(inMonth, (bill) => bill.sgstAmount ?? 0),
      igst: sumBy(inMonth, (bill) => bill.igstAmount ?? 0),
      gstUnsplit: sumBy(inMonth.filter((bill) => !bill.gstType), (bill) => bill.gstAmount),
      totalInclGst: sumMoney([totalTaxable, gst]),
      statutoryDeduction: sumBy(inMonth, (bill) => kindSum(bill, ['statutory'])),
      retentionCpbg: sumBy(inMonth, (bill) => kindSum(bill, ['retention_cpbg'])),
      retentionReleasedByClient: sumBy(retentionBills, (bill) => bill.totalReceived),
      retentionInvoice: sumBy(inMonth, (bill) => kindSum(bill, ['retention_invoice'])),
      retentionTimeExtension: sumBy(inMonth, (bill) => kindSum(bill, ['retention_time_extension'])),
      mobilizationAdvance: sumBy(inMonth, (bill) => kindSum(bill, ['mobilization_advance'])),
      mobilizationInterest: sumBy(inMonth, (bill) => kindSum(bill, ['mobilization_interest'])),
      net,
      netReceived,
      difference: subtractMoney(net, netReceived),
      collectionInMonth,
      billCount: inMonth.length,
    };
  });
}

export function sumMonthlyRows(rows: readonly MonthlySummaryRow[]): Omit<MonthlySummaryRow, 'month' | 'from' | 'to'> {
  const keys = Object.keys(rows[0] ?? {}).filter((key) => !['month', 'from', 'to'].includes(key)) as (keyof Omit<MonthlySummaryRow, 'month' | 'from' | 'to'>)[];
  const total = {} as Omit<MonthlySummaryRow, 'month' | 'from' | 'to'>;
  for (const key of keys) total[key] = key === 'billCount' ? rows.reduce((count, row) => count + row.billCount, 0) : sumBy(rows, (row) => row[key]);
  return total;
}

/* ── deductions ──────────────────────────────────────────────────────────── */

export interface DeductionReportRow {
  key: string;
  label: string;
  byType: Record<string, number>;
  total: number;
}

export function deductionReport(bills: readonly Bill[], types: readonly DeductionTypeMaster[], dimension: GroupDimension): { types: { id: string; name: string }[]; rows: DeductionReportRow[]; totals: Record<string, number>; grandTotal: number } {
  const columns = [...types].sort((a, b) => a.sequence - b.sequence).map((type) => ({ id: type.id, name: type.name }));
  const rows = new Map<string, DeductionReportRow>();
  const totals: Record<string, number> = Object.fromEntries(columns.map((column) => [column.id, 0]));
  for (const bill of bills) {
    if (bill.isDeleted) continue;
    const { key, label } = dimensionOf(bill, dimension);
    const row = rows.get(key) ?? { key, label, byType: Object.fromEntries(columns.map((column) => [column.id, 0])), total: 0 };
    for (const line of bill.deductions ?? []) {
      const id = columns.some((column) => column.id === line.deductionTypeId) ? line.deductionTypeId : (columns.find((column) => column.name === line.deductionTypeName)?.id ?? line.deductionTypeId);
      row.byType[id] = sumMoney([row.byType[id] ?? 0, line.amount]);
      totals[id] = sumMoney([totals[id] ?? 0, line.amount]);
      row.total = sumMoney([row.total, line.amount]);
    }
    rows.set(key, row);
  }
  const sorted = [...rows.values()].filter((row) => toPaise(row.total) !== 0 || Object.values(row.byType).some((value) => toPaise(value) !== 0)).sort((a, b) => b.total - a.total);
  return { types: columns, rows: sorted, totals, grandTotal: sumBy(sorted, (row) => row.total) };
}

/* ── retention ───────────────────────────────────────────────────────────── */

export interface RetentionRow {
  projectId: string;
  projectName: string;
  clientName?: string;
  cpbg: number;
  invoice: number;
  timeExtension: number;
  other: number;
  deducted: number;
  released: number;
  balance: number;
  expectedReleaseDate?: string;
  status: RetentionStatus;
  billCount: number;
}

export function retentionStatusOf(deducted: number, released: number, options: { disputed?: boolean; expectedReleaseDate?: string; asOf: string; tolerance: number }): RetentionStatus {
  if (options.disputed) return 'disputed';
  const balance = subtractMoney(deducted, released);
  if (toPaise(balance) <= toPaise(options.tolerance)) return 'fully_released';
  if (options.expectedReleaseDate && options.expectedReleaseDate < options.asOf) return 'overdue';
  return toPaise(released) > 0 ? 'partially_released' : 'held';
}

export function retentionReport(bills: readonly Bill[], releases: readonly RetentionRelease[], context: ReportContext): { rows: RetentionRow[]; totals: { deducted: number; released: number; balance: number; dueThisMonth: number; overdue: number } } {
  const byProject = new Map<string, RetentionRow & { disputed: boolean }>();
  for (const bill of bills) {
    if (bill.isDeleted || toPaise(bill.retentionDeducted) === 0) continue;
    const row = byProject.get(bill.projectId) ?? {
      projectId: bill.projectId,
      projectName: bill.projectNameSnapshot,
      clientName: bill.clientNameSnapshot,
      cpbg: 0,
      invoice: 0,
      timeExtension: 0,
      other: 0,
      deducted: 0,
      released: 0,
      balance: 0,
      status: 'held' as RetentionStatus,
      billCount: 0,
      disputed: false,
    };
    row.cpbg = sumMoney([row.cpbg, kindSum(bill, ['retention_cpbg'])]);
    row.invoice = sumMoney([row.invoice, kindSum(bill, ['retention_invoice'])]);
    row.timeExtension = sumMoney([row.timeExtension, kindSum(bill, ['retention_time_extension'])]);
    row.other = sumMoney([row.other, kindSum(bill, ['retention_other'])]);
    row.deducted = sumMoney([row.deducted, bill.retentionDeducted]);
    row.billCount += 1;
    row.disputed = row.disputed || Boolean(bill.retentionDisputed);
    if (bill.retentionExpectedReleaseDate && (!row.expectedReleaseDate || bill.retentionExpectedReleaseDate < row.expectedReleaseDate)) {
      row.expectedReleaseDate = bill.retentionExpectedReleaseDate;
    }
    byProject.set(bill.projectId, row);
  }
  for (const release of releases) {
    if (release.status !== 'active') continue;
    const row = byProject.get(release.projectId);
    if (row) row.released = sumMoney([row.released, release.amount]);
    else {
      byProject.set(release.projectId, {
        projectId: release.projectId,
        projectName: release.projectNameSnapshot,
        cpbg: 0,
        invoice: 0,
        timeExtension: 0,
        other: 0,
        deducted: 0,
        released: release.amount,
        balance: 0,
        status: 'fully_released',
        billCount: 0,
        disputed: false,
      });
    }
  }
  const { from, to } = monthRange(monthKeyOf(context.asOf));
  const rows = [...byProject.values()].map(({ disputed, ...row }) => {
    const balance = subtractMoney(row.deducted, row.released);
    return {
      ...row,
      balance,
      status: retentionStatusOf(row.deducted, row.released, { disputed, expectedReleaseDate: row.expectedReleaseDate, asOf: context.asOf, tolerance: context.settings.tolerance }),
    };
  });
  return {
    rows: rows.sort((a, b) => b.balance - a.balance),
    totals: {
      deducted: sumBy(rows, (row) => row.deducted),
      released: sumBy(rows, (row) => row.released),
      balance: sumBy(rows, (row) => row.balance),
      dueThisMonth: sumBy(rows.filter((row) => row.expectedReleaseDate && row.expectedReleaseDate >= from && row.expectedReleaseDate <= to && row.balance > 0), (row) => row.balance),
      overdue: sumBy(rows.filter((row) => row.status === 'overdue'), (row) => row.balance),
    },
  };
}

/* ── collections over time, targets, forecast ────────────────────────────── */

export interface CollectionLine {
  billId: string;
  projectId: string;
  projectName: string;
  billSerialNumber?: string;
  gstInvoiceNumber?: string;
  collectionId: string;
  receiptDate: string;
  amount: number;
  utrNumber?: string;
  paymentMode?: string;
  ownerId?: string;
  dgmOffice?: string;
}

/** Every verified receipt allocation against the given bills, in a date window. */
export function collectionLines(bills: readonly Bill[], from?: string, to?: string): CollectionLine[] {
  return bills
    .filter((bill) => !bill.isDeleted)
    .flatMap((bill) =>
      countedCollections(bill.collections ?? [])
        .filter((entry) => (!from || entry.receiptDate >= from) && (!to || entry.receiptDate <= to))
        .map((entry) => ({
          billId: bill.id,
          projectId: bill.projectId,
          projectName: bill.projectNameSnapshot,
          billSerialNumber: bill.billSerialNumber,
          gstInvoiceNumber: bill.gstInvoiceNumber,
          collectionId: entry.collectionId,
          receiptDate: entry.receiptDate,
          amount: entry.amount,
          utrNumber: entry.utrNumber,
          paymentMode: entry.paymentMode,
          ownerId: bill.collectionOwnerId,
          dgmOffice: bill.dgmOffice,
        })),
    )
    .sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));
}

export interface MonthlyFlowPoint {
  month: string;
  billing: number;
  collection: number;
  /** Outstanding at the end of the month (or as on `asOf` for the current month). */
  outstanding: number;
}

/** Billing vs collection vs outstanding per FY month — the dashboard's main chart. */
export function monthlyFlow(bills: readonly Bill[], financialYear: string, context: ReportContext): MonthlyFlowPoint[] {
  return financialYearMonths(financialYear).map((month) => {
    const { from, to } = monthRange(month);
    const pointDate = to > context.asOf ? context.asOf : to;
    const future = from > context.asOf;
    return {
      month,
      billing: sumBy(bills.filter((bill) => !bill.isDeleted && bill.billDate >= from && bill.billDate <= to), (bill) => bill.netReceivable),
      collection: sumBy(collectionLines(bills, from, to), (line) => line.amount),
      outstanding: future ? 0 : sumBy(bills, (bill) => outstandingAsOf(bill, pointDate, context.settings.tolerance).outstanding),
    };
  });
}

export interface TargetPerformanceRow {
  week: string;
  from: string;
  to: string;
  target: number;
  actual: number;
  achievement: number | null;
}

/** Target vs actual per ISO week. Actual = verified receipts dated in the week, against in-scope bills. */
export function targetPerformance(targets: readonly CollectionTarget[], bills: readonly Bill[], weeks: readonly string[]): TargetPerformanceRow[] {
  return weeks.map((week) => {
    const range = isoWeekRange(week) ?? { from: '', to: '' };
    const target = sumBy(targets.filter((entry) => entry.week === week), (entry) => entry.amount);
    const actual = sumBy(collectionLines(bills, range.from, range.to), (line) => line.amount);
    return { week, ...range, target, actual, achievement: toPaise(target) === 0 ? null : Math.round((actual / target) * 1000) / 10 };
  });
}

/** The ISO weeks that overlap an FY, in order. */
export function financialYearWeeks(financialYear: string): string[] {
  const months = financialYearMonths(financialYear);
  if (!months.length) return [];
  const start = `${months[0]}-01`;
  const end = monthRange(months[months.length - 1]).to;
  const weeks: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 7)) {
    const week = isoWeekOf(day);
    if (!weeks.includes(week)) weeks.push(week);
  }
  const last = isoWeekOf(end);
  if (!weeks.includes(last)) weeks.push(last);
  return weeks;
}

export type ForecastSource = 'commitment' | 'expected_date' | 'due_date' | 'target';

export interface ForecastItem {
  billId: string;
  projectName: string;
  billSerialNumber?: string;
  gstInvoiceNumber?: string;
  date: string;
  amount: number;
  source: ForecastSource;
  ownerName?: string;
}

export interface ForecastWindow {
  key: 'next7' | 'thisWeek' | 'nextWeek' | 'thisMonth' | 'nextMonth';
  label: string;
  from: string;
  to: string;
  amount: number;
  count: number;
  bySource: Record<ForecastSource, number>;
}

/**
 * Expected collections, from recorded facts only: a bill's pending client commitment if it has one,
 * else its expected payment date, else its due date — each capped at what is still outstanding, and
 * each bill counted once. Nothing is extrapolated or estimated.
 */
export function forecastItems(bills: readonly Bill[]): ForecastItem[] {
  return bills.filter(isOpen).flatMap((bill) => {
    const candidates: [ForecastSource, string | undefined, number | undefined][] = [
      ['commitment', bill.nextCommitmentDate, bill.nextCommitmentAmount],
      ['expected_date', bill.expectedPaymentDate, undefined],
      ['due_date', bill.dueDate, undefined],
    ];
    const chosen = candidates.find(([, date]) => Boolean(date));
    if (!chosen) return [];
    const [source, date, amount] = chosen;
    const capped = amount !== undefined ? Math.min(amount, Math.max(bill.outstandingAmount, 0)) : bill.outstandingAmount;
    if (toPaise(capped) <= 0) return [];
    return [{ billId: bill.id, projectName: bill.projectNameSnapshot, billSerialNumber: bill.billSerialNumber, gstInvoiceNumber: bill.gstInvoiceNumber, date: date as string, amount: roundMoney(capped), source, ownerName: bill.collectionOwnerName }];
  });
}

export function forecastWindows(items: readonly ForecastItem[], asOf: string): ForecastWindow[] {
  const thisWeek = isoWeekRange(isoWeekOf(asOf)) as { from: string; to: string };
  const nextWeek = isoWeekRange(isoWeekOf(addDays(thisWeek.to, 1))) as { from: string; to: string };
  const thisMonth = monthRange(monthKeyOf(asOf));
  const nextMonth = monthRange(monthKeyOf(addDays(thisMonth.to, 1)));
  const windows: Omit<ForecastWindow, 'amount' | 'count' | 'bySource'>[] = [
    { key: 'next7', label: 'Next 7 days', from: asOf, to: addDays(asOf, 6) },
    { key: 'thisWeek', label: 'This week', ...thisWeek },
    { key: 'nextWeek', label: 'Next week', ...nextWeek },
    { key: 'thisMonth', label: 'This month', ...thisMonth },
    { key: 'nextMonth', label: 'Next month', ...nextMonth },
  ];
  return windows.map((window) => {
    const inWindow = items.filter((item) => item.date >= window.from && item.date <= window.to);
    const bySource = { commitment: 0, expected_date: 0, due_date: 0, target: 0 } as Record<ForecastSource, number>;
    for (const item of inWindow) bySource[item.source] = sumMoney([bySource[item.source], item.amount]);
    return { ...window, amount: sumBy(inWindow, (item) => item.amount), count: inWindow.length, bySource };
  });
}

/* ── exceptions ──────────────────────────────────────────────────────────── */

export const EXCEPTION_KINDS = [
  'net_mismatch',
  'over_received',
  'missing_invoice',
  'old_outstanding',
  'commitment_missed',
  'no_follow_up',
  'unverified_receipt',
  'legacy_status_mismatch',
  'retention_overdue',
  'missing_due_date',
  'high_value_unpaid',
  'certification_note_pending',
] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export const EXCEPTION_LABELS: Record<ExceptionKind, string> = {
  net_mismatch: 'Net amount mismatch',
  over_received: 'Over received',
  missing_invoice: 'Missing GST invoice',
  old_outstanding: 'Old outstanding',
  commitment_missed: 'Commitment missed',
  no_follow_up: 'No recent follow-up',
  unverified_receipt: 'Unverified receipt',
  legacy_status_mismatch: 'Legacy status mismatch',
  retention_overdue: 'Retention overdue',
  missing_due_date: 'Missing due date',
  high_value_unpaid: 'High-value bill unpaid',
  certification_note_pending: 'Certified — credit note pending',
};

export interface ExceptionItem {
  kind: ExceptionKind;
  billId: string;
  projectName: string;
  billSerialNumber?: string;
  gstInvoiceNumber?: string;
  amount: number;
  detail: string;
}

/**
 * What management should look at, instead of reading every bill. Each rule is a fact about the
 * record, never an estimate: a mismatch the import recorded, a receipt still in draft, a commitment
 * date that has passed, and so on.
 */
export function exceptionItems(bills: readonly Bill[], context: ReportContext, notesByBill?: ReadonlyMap<string, readonly Bill[]>): ExceptionItem[] {
  const items: ExceptionItem[] = [];
  const { asOf, settings } = context;
  const base = (bill: Bill) => ({ billId: bill.id, projectName: bill.projectNameSnapshot, billSerialNumber: bill.billSerialNumber, gstInvoiceNumber: bill.gstInvoiceNumber });
  for (const bill of bills) {
    if (bill.isDeleted) continue;
    const open = isOpen(bill);
    if (bill.netMismatch && !bill.netMismatch.resolvedAt) {
      items.push({ kind: 'net_mismatch', ...base(bill), amount: subtractMoney(bill.netMismatch.imported, bill.netMismatch.calculated), detail: `Imported ${bill.netMismatch.imported} vs calculated ${bill.netMismatch.calculated}` });
    }
    if (bill.paymentStatus === 'over_received') {
      items.push({ kind: 'over_received', ...base(bill), amount: -bill.shortfallSurplus, detail: `Received ${bill.totalReceived} against net ${bill.netReceivable}` });
    }
    if (!bill.gstInvoiceNumber && toPaise(bill.gstAmount) !== 0) {
      items.push({ kind: 'missing_invoice', ...base(bill), amount: bill.grossAmount, detail: 'GST charged without a GST invoice number' });
    }
    if (open) {
      const days = billAgeingDays(bill, context);
      if (days > settings.oldOutstandingDays) items.push({ kind: 'old_outstanding', ...base(bill), amount: bill.outstandingAmount, detail: `${days} days outstanding` });
      if (commitmentMissed(bill, asOf)) items.push({ kind: 'commitment_missed', ...base(bill), amount: bill.nextCommitmentAmount ?? bill.outstandingAmount, detail: `Committed for ${bill.nextCommitmentDate}` });
      const lastTouch = bill.lastFollowUpDate ?? bill.billDate;
      const quiet = daysBetween(lastTouch, asOf) ?? 0;
      if (quiet > settings.noFollowUpDays) items.push({ kind: 'no_follow_up', ...base(bill), amount: bill.outstandingAmount, detail: bill.lastFollowUpDate ? `Last follow-up ${quiet} days ago` : `No follow-up in ${quiet} days since billing` });
      if (!bill.dueDate) items.push({ kind: 'missing_due_date', ...base(bill), amount: bill.outstandingAmount, detail: 'No due date recorded' });
      if (bill.netReceivable >= settings.highValueThreshold && bill.paymentStatus === 'not_received') {
        items.push({ kind: 'high_value_unpaid', ...base(bill), amount: bill.outstandingAmount, detail: `Net ${bill.netReceivable}, nothing received` });
      }
    }
    const drafts = (bill.collections ?? []).filter((entry) => entry.status === 'draft');
    if (drafts.length) items.push({ kind: 'unverified_receipt', ...base(bill), amount: sumBy(drafts, (entry) => entry.amount), detail: `${drafts.length} receipt(s) awaiting verification` });
    if (bill.legacyStatus) {
      const legacy = bill.legacyStatus.trim().toUpperCase();
      const mismatch = (legacy === 'RECEIVED' && bill.paymentStatus !== 'received') || (legacy === 'NOT RECEIVED' && bill.paymentStatus !== 'not_received');
      if (mismatch) items.push({ kind: 'legacy_status_mismatch', ...base(bill), amount: bill.shortfallSurplus, detail: `Workbook said ${bill.legacyStatus}; now ${bill.paymentStatus.replace(/_/g, ' ')}` });
    }
    // Needs the notes against each bill, which live outside the FY slice — given only when loaded.
    if (notesByBill && bill.certification) {
      const summary = certificationSummary(bill, notesByBill.get(bill.id) ?? [], settings.tolerance);
      if (summary.state === 'adjustment_pending') {
        items.push({ kind: 'certification_note_pending', ...base(bill), amount: summary.pendingNet ?? 0, detail: `Certified net ${summary.certifiedNet} vs raised ${summary.raisedNet}${summary.notesCount ? ` and ${summary.notesCount} note(s)` : ''}` });
      }
    }
    if (bill.retentionExpectedReleaseDate && bill.retentionExpectedReleaseDate < asOf && toPaise(bill.retentionDeducted) > 0) {
      items.push({ kind: 'retention_overdue', ...base(bill), amount: bill.retentionDeducted, detail: `Release expected ${bill.retentionExpectedReleaseDate}` });
    }
  }
  return items;
}

export function exceptionSummary(items: readonly ExceptionItem[]): { kind: ExceptionKind; label: string; count: number; amount: number }[] {
  return EXCEPTION_KINDS.map((kind) => {
    const matching = items.filter((item) => item.kind === kind);
    return { kind, label: EXCEPTION_LABELS[kind], count: matching.length, amount: sumBy(matching, (item) => item.amount) };
  }).filter((entry) => entry.count > 0);
}

/* ── follow-ups & commitments ────────────────────────────────────────────── */

/** Commitment status on a date: a pending commitment whose date has passed unmet is missed. */
export function effectiveCommitmentStatus(followUp: BillFollowUp, asOf: string): NonNullable<BillFollowUp['commitment']>['status'] | undefined {
  const commitment = followUp.commitment;
  if (!commitment) return undefined;
  if ((commitment.status === 'pending' || commitment.status === 'partially_fulfilled') && commitment.date < asOf) return 'missed';
  return commitment.status;
}

/**
 * The rollups a bill carries for its follow-ups: latest follow-up date, the next follow-up due,
 * and the next open commitment. Recomputed whenever a follow-up is written.
 */
export function followUpRollup(followUps: readonly BillFollowUp[], asOf: string): Pick<Bill, 'lastFollowUpDate' | 'nextFollowUpDate' | 'nextCommitmentDate' | 'nextCommitmentAmount'> {
  const sorted = [...followUps].sort((a, b) => a.followUpDate.localeCompare(b.followUpDate) || a.createdAt.localeCompare(b.createdAt));
  const latest = sorted.at(-1);
  const openCommitments = sorted
    .filter((entry) => entry.commitment && (entry.commitment.status === 'pending' || entry.commitment.status === 'partially_fulfilled'))
    .map((entry) => entry.commitment as NonNullable<BillFollowUp['commitment']>)
    .sort((a, b) => a.date.localeCompare(b.date));
  // The earliest open commitment, even if already past — that is what makes it "missed".
  const next = openCommitments[0];
  return {
    lastFollowUpDate: latest?.followUpDate,
    nextFollowUpDate: latest?.nextFollowUpDate && latest.status === 'open' ? latest.nextFollowUpDate : undefined,
    nextCommitmentDate: next?.date,
    nextCommitmentAmount: next ? subtractMoney(next.amount, next.fulfilledAmount ?? 0) : undefined,
  };
}

/* ── dashboard ───────────────────────────────────────────────────────────── */

export interface DashboardKpis extends BillTotals {
  retentionReleased: number;
  retentionBalance: number;
  overdue: number;
  promisedThisWeek: number;
  missedCommitments: number;
  collectionThisMonth: number;
}

export function dashboardKpis(bills: readonly Bill[], releases: readonly RetentionRelease[], context: ReportContext): DashboardKpis {
  const totals = billTotals(bills);
  const released = sumBy(releases.filter((release) => release.status === 'active'), (release) => release.amount);
  const week = isoWeekRange(isoWeekOf(context.asOf)) as { from: string; to: string };
  const month = monthRange(monthKeyOf(context.asOf));
  const open = bills.filter(isOpen);
  return {
    ...totals,
    retentionReleased: released,
    retentionBalance: subtractMoney(totals.retention, released),
    overdue: sumBy(open.filter((bill) => isOverdue(bill, context.asOf)), (bill) => bill.outstandingAmount),
    promisedThisWeek: sumBy(open.filter((bill) => bill.nextCommitmentDate && bill.nextCommitmentDate >= week.from && bill.nextCommitmentDate <= week.to), (bill) => bill.nextCommitmentAmount ?? 0),
    missedCommitments: open.filter((bill) => commitmentMissed(bill, context.asOf)).length,
    collectionThisMonth: sumBy(collectionLines(bills, month.from, month.to), (line) => line.amount),
  };
}

/** Today as a key — reports default their `asOf` to it. */
export const defaultAsOf = (now: Date = new Date()): string => toDateKey(now);

export const isValidDateKey = (value: unknown): value is string => typeof value === 'string' && parseDateKey(value) !== null;
