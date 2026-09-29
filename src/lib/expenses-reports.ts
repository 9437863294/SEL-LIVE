/**
 * The Expenses report catalogue.
 *
 * Every report the module can answer, defined as data rather than as a page each: one entry per
 * report, each carrying its own builder that turns a filtered set of requests into columns, rows
 * and a footer total. The report centre renders whatever the catalogue lists, so adding a report
 * is adding an entry here — not another route, another table component and another export button
 * that formats currency slightly differently from the last one.
 *
 * Most reports read `expenseRequests` alone. The Payments reports also read what each request
 * became downstream — its Daily Requisition, and the Bank Balance vouchers that paid it — through
 * `requisition-progress.ts`, the one reading of a requisition all three modules share, so a stage
 * or a balance here never disagrees with the one Daily Requisition shows for the same request.
 *
 * The same catalogue serves a single department and the whole organisation. Scope is a filter
 * applied before the builder runs, not a different set of reports, so a department head and the
 * finance office are reading the same definitions of "total" and "share".
 *
 * Pure — no Firebase, no DOM — so every total here is unit-testable with `node --test`.
 */

import {
  requisitionHref,
  requisitionProgress,
  type ProgressRequisition,
  type ProgressStage,
  type RequisitionProgress,
} from './requisition-progress.ts';

/* ── shapes ──────────────────────────────────────────────────────────────── */

export type ExpenseReportGroup = 'Summary' | 'Breakdown' | 'Trend' | 'Control' | 'Payments' | 'Detail';

export const EXPENSE_REPORT_GROUPS: ExpenseReportGroup[] = [
  'Summary',
  'Breakdown',
  'Trend',
  'Control',
  'Payments',
  'Detail',
];

export type ExpenseReportColumnType = 'text' | 'number' | 'currency' | 'percent' | 'date' | 'month';

export interface ExpenseReportColumn {
  key: string;
  label: string;
  type?: ExpenseReportColumnType;
  /** Row key holding a link for this cell. On screen only — an export carries the text. */
  linkKey?: string;
  /** Row key holding a status tone; the cell is drawn as a badge in it. On screen only. */
  toneKey?: string;
}

export type ExpenseReportCell = string | number | null;
export type ExpenseReportRow = Record<string, ExpenseReportCell>;

export interface ExpenseReportStat {
  label: string;
  value: string;
}

export interface ExpenseReportResult {
  columns: ExpenseReportColumn[];
  rows: ExpenseReportRow[];
  /** Footer row, keyed like the columns. Absent where a total would be meaningless. */
  total?: ExpenseReportRow;
  /** Headline figures shown above the table. */
  stats: ExpenseReportStat[];
  /** Shown in place of the table when `rows` is empty. */
  emptyMessage: string;
}

/** A request with its project and department names already resolved. */
export interface EnrichedExpense {
  id: string;
  requestNo: string;
  departmentId: string;
  departmentName: string;
  projectId: string;
  projectName: string;
  amount: number;
  headOfAccount: string;
  subHeadOfAccount: string;
  partyName: string;
  description: string;
  remarks: string;
  receptionNo: string;
  receptionDate: string;
  generatedByUser: string;
  createdAt: string;
}

export interface ExpenseReportInput {
  expenses: readonly EnrichedExpense[];
  /** Stands in for "now" when ageing an unreceived request. Injected so tests are stable. */
  today?: Date;
  /** What counts as high value, in rupees. */
  highValueThreshold?: number;
  /**
   * The Daily Requisition each request became, keyed by request no — `requisitionsByRequestNo`
   * over `dailyRequisitions`. Absent when Daily Requisition could not be read: the Payments reports
   * then say so, rather than reporting every request as never received.
   */
  requisitions?: ReadonlyMap<string, ProgressRequisition>;
  /** Payment Status: which stages to list. Every stage when absent. */
  paymentStage?: PaymentStageFilter;
  /** Payment Status Summary: what one row totals. Department when absent. */
  paymentGroupBy?: PaymentSummaryGrouping;
}

export interface ExpenseReportDefinition {
  id: string;
  title: string;
  group: ExpenseReportGroup;
  description: string;
  build: (input: ExpenseReportInput) => ExpenseReportResult;
}

/* ── enrichment & filtering ──────────────────────────────────────────────── */

const UNKNOWN_PROJECT = 'Unknown Project';
const UNKNOWN_DEPARTMENT = 'Unknown Department';
const UNATTRIBUTED = '(not recorded)';

export interface ExpenseReportMasters {
  projects: readonly { id: string; projectName: string }[];
  departments: readonly { id: string; name: string }[];
}

/**
 * Resolves project and department names once, up front.
 *
 * `generatedByDepartment` is the name as it stood when the request was raised; the department id
 * is the durable link. Names are taken from the masters where the id resolves so a renamed
 * department does not split into two rows of a summary, and fall back to the recorded name when
 * the department has since been deleted — losing the row entirely would quietly change the total.
 */
export function enrichExpenses(
  expenses: readonly {
    id?: string;
    requestNo?: string;
    departmentId?: string;
    generatedByDepartment?: string;
    projectId?: string;
    amount?: number;
    headOfAccount?: string;
    subHeadOfAccount?: string;
    partyName?: string;
    description?: string;
    remarks?: string;
    receptionNo?: string;
    receptionDate?: string;
    generatedByUser?: string;
    createdAt?: string;
  }[],
  masters: ExpenseReportMasters,
): EnrichedExpense[] {
  const projectById = new Map(masters.projects.map(project => [project.id, project.projectName]));
  const departmentById = new Map(masters.departments.map(department => [department.id, department.name]));

  return expenses.map(expense => ({
    id: expense.id ?? '',
    requestNo: expense.requestNo ?? '',
    departmentId: expense.departmentId ?? '',
    departmentName:
      departmentById.get(expense.departmentId ?? '') || expense.generatedByDepartment || UNKNOWN_DEPARTMENT,
    projectId: expense.projectId ?? '',
    projectName: projectById.get(expense.projectId ?? '') || UNKNOWN_PROJECT,
    amount: Number.isFinite(expense.amount) ? Number(expense.amount) : 0,
    headOfAccount: expense.headOfAccount || UNATTRIBUTED,
    subHeadOfAccount: expense.subHeadOfAccount || UNATTRIBUTED,
    partyName: expense.partyName || UNATTRIBUTED,
    description: expense.description ?? '',
    remarks: expense.remarks ?? '',
    receptionNo: expense.receptionNo ?? '',
    receptionDate: expense.receptionDate ?? '',
    generatedByUser: expense.generatedByUser || UNATTRIBUTED,
    createdAt: expense.createdAt ?? '',
  }));
}

export interface ExpenseReportFilters {
  from?: Date;
  to?: Date;
  /** Document id, or 'all'. */
  departmentId?: string;
  projectId?: string;
  headOfAccount?: string;
  /** Matched against request no, party, description and remarks. */
  search?: string;
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

export function filterExpensesForReport(
  expenses: readonly EnrichedExpense[],
  filters: ExpenseReportFilters = {},
): EnrichedExpense[] {
  const from = filters.from ? startOfDay(filters.from) : null;
  // End of the chosen day, not its midnight — otherwise a request raised at 09:20 on the last day
  // of the range falls outside its own range.
  const to = filters.to ? endOfDay(filters.to) : null;
  const search = (filters.search ?? '').trim().toLowerCase();

  return expenses.filter(expense => {
    if (from && to) {
      const raised = new Date(expense.createdAt);
      if (Number.isNaN(raised.getTime()) || raised < from || raised > to) return false;
    }
    if (filters.departmentId && filters.departmentId !== 'all' && expense.departmentId !== filters.departmentId) {
      return false;
    }
    if (filters.projectId && filters.projectId !== 'all' && expense.projectId !== filters.projectId) return false;
    if (
      filters.headOfAccount &&
      filters.headOfAccount !== 'all' &&
      expense.headOfAccount !== filters.headOfAccount
    ) {
      return false;
    }
    if (search) {
      const haystack = [expense.requestNo, expense.partyName, expense.description, expense.remarks]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

/* ── small helpers ───────────────────────────────────────────────────────── */

const sum = (rows: readonly EnrichedExpense[]) => rows.reduce((running, row) => running + row.amount, 0);

/** `yyyy-MM` in local time, so a month bucket matches the month the user filed it in. */
export const monthKeyOf = (createdAt: string): string => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return 'Undated';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const dayKeyOf = (createdAt: string): string => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return 'Undated';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/** Whole days between a request being raised and `today`; 0 if the date will not parse. */
export const ageInDays = (createdAt: string, today: Date): number => {
  const raised = new Date(createdAt);
  if (Number.isNaN(raised.getTime())) return 0;
  return Math.max(0, Math.floor((startOfDay(today).getTime() - startOfDay(raised).getTime()) / 86400000));
};

const groupBy = <T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> => {
  const grouped = new Map<string, T[]>();
  rows.forEach(row => {
    const key = keyOf(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  });
  return grouped;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const inrFormatters = new Map<number, Intl.NumberFormat>();

/**
 * Rupees as every Expenses report, headline and pivot shows them — and as Bank Balance does: Indian
 * digit grouping, two decimals unless told otherwise. The module's one money formatter, so a figure
 * reads the same in the table, in the stat above it and in the workbook it is exported to.
 */
export function formatInr(value: number | null | undefined, decimals = 2): string {
  let formatter = inrFormatters.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    inrFormatters.set(decimals, formatter);
  }
  return formatter.format(Number(value) || 0);
}

const money = (value: number) => formatInr(value);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A date the way the module shows one: `dd MMM yyyy`. Takes the `yyyy-MM-dd` keys the reports
 * bucket by — read as written rather than through `Date`, so no time zone can move the day — or an
 * ISO timestamp, read in local time. Anything else ("Total", "Undated", "—") comes back as it was.
 */
export function formatReportDate(value: string): string {
  const text = String(value ?? '').trim();
  const key = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (key) {
    const month = MONTH_NAMES[Number(key[2]) - 1];
    return month ? `${key[3]} ${month} ${key[1]}` : text;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return `${String(date.getDate()).padStart(2, '0')} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
    }
  }
  return text;
}

/** A `yyyy-MM` month bucket as `MMM yyyy`; anything else comes back as it was. */
export function formatReportMonth(value: string): string {
  const text = String(value ?? '').trim();
  const key = /^(\d{4})-(\d{2})$/.exec(text);
  const month = key ? MONTH_NAMES[Number(key[2]) - 1] : undefined;
  return key && month ? `${month} ${key[1]}` : text;
}

const headlineStats = (rows: readonly EnrichedExpense[]): ExpenseReportStat[] => {
  const total = sum(rows);
  return [
    { label: 'Requests', value: rows.length.toLocaleString('en-IN') },
    { label: 'Total value', value: money(total) },
    { label: 'Average', value: rows.length ? money(total / rows.length) : '—' },
  ];
};

/**
 * The shape most of these reports share: group the requests, count them, total them, and show each
 * group's share of the whole. Written once because six near-identical builders is six chances for
 * one of them to compute "share" against a different denominator.
 */
function groupedSummary(
  rows: readonly EnrichedExpense[],
  options: {
    keyOf: (row: EnrichedExpense) => string;
    columns: ExpenseReportColumn[];
    /** Fills the leading label column(s) for a group. */
    labelsOf: (key: string, groupRows: EnrichedExpense[]) => ExpenseReportRow;
    emptyMessage: string;
    withAverage?: boolean;
  },
): ExpenseReportResult {
  const grandTotal = sum(rows);
  const grouped = groupBy(rows, options.keyOf);

  const built: ExpenseReportRow[] = Array.from(grouped.entries()).map(([key, groupRows]) => {
    const total = sum(groupRows);
    return {
      ...options.labelsOf(key, groupRows),
      requests: groupRows.length,
      total,
      ...(options.withAverage ? { average: groupRows.length ? total / groupRows.length : 0 } : {}),
      share: grandTotal ? (total / grandTotal) * 100 : 0,
    };
  });

  built.sort((a, b) => Number(b.total) - Number(a.total));

  const leadKey = options.columns[0].key;
  return {
    columns: options.columns,
    rows: built,
    total: {
      [leadKey]: 'Total',
      requests: rows.length,
      total: grandTotal,
      ...(options.withAverage ? { average: rows.length ? grandTotal / rows.length : 0 } : {}),
      share: grandTotal ? 100 : 0,
    },
    stats: headlineStats(rows),
    emptyMessage: options.emptyMessage,
  };
}

/** Row dimension down the side, a second dimension across the top, totals on both. */
function crossTab(
  rows: readonly EnrichedExpense[],
  options: {
    rowKeyOf: (row: EnrichedExpense) => string;
    columnKeyOf: (row: EnrichedExpense) => string;
    rowLabel: string;
    sortColumns?: (a: string, b: string) => number;
    /** A column's heading, when its key is not fit to show (a `yyyy-MM` month). */
    columnLabelOf?: (key: string) => string;
    emptyMessage: string;
  },
): ExpenseReportResult {
  const columnKeys = Array.from(new Set(rows.map(options.columnKeyOf))).sort(
    options.sortColumns ?? ((a, b) => a.localeCompare(b)),
  );
  const grouped = groupBy(rows, options.rowKeyOf);
  const labelOf = options.columnLabelOf ?? ((key: string) => key);

  const columns: ExpenseReportColumn[] = [
    { key: 'label', label: options.rowLabel, type: 'text' },
    ...columnKeys.map(key => ({ key: `col:${key}`, label: labelOf(key), type: 'currency' as const })),
    { key: 'total', label: 'Total', type: 'currency' },
  ];

  const built: ExpenseReportRow[] = Array.from(grouped.entries()).map(([label, groupRows]) => {
    const row: ExpenseReportRow = { label };
    columnKeys.forEach(key => {
      row[`col:${key}`] = sum(groupRows.filter(entry => options.columnKeyOf(entry) === key));
    });
    row.total = sum(groupRows);
    return row;
  });
  built.sort((a, b) => Number(b.total) - Number(a.total));

  const totalRow: ExpenseReportRow = { label: 'Total' };
  columnKeys.forEach(key => {
    totalRow[`col:${key}`] = sum(rows.filter(entry => options.columnKeyOf(entry) === key));
  });
  totalRow.total = sum(rows);

  return {
    columns,
    rows: built,
    total: totalRow,
    stats: [
      ...headlineStats(rows),
      { label: 'Columns', value: columnKeys.length.toLocaleString('en-IN') },
    ],
    emptyMessage: options.emptyMessage,
  };
}

/* ── payments: what each request became downstream ───────────────────────── */

/**
 * Every stage a request can stand at, in the order it moves through them, labelled by the shared
 * reading in `requisition-progress.ts` rather than in words of this module's own.
 */
export const PAYMENT_STAGES: readonly { stage: ProgressStage; label: string }[] = [
  undefined,
  'Pending',
  'Received',
  'Needs Review',
  'Verified',
  'Received for Payment',
  'Partially Paid',
  'Paid',
  'Cancelled',
].map(status => {
  const progress = requisitionProgress(status ? { status } : undefined);
  return { stage: progress.stage, label: progress.label };
});

const STAGE_RANK = new Map<ProgressStage, number>(PAYMENT_STAGES.map((entry, index) => [entry.stage, index]));

/** Payment Status lists every stage, everything not yet paid in full, or a single stage. */
export type PaymentStageFilter = 'all' | 'outstanding' | ProgressStage;

export const PAYMENT_STAGE_FILTERS: readonly { value: PaymentStageFilter; label: string }[] = [
  { value: 'all', label: 'All stages' },
  { value: 'outstanding', label: 'Not paid in full' },
  ...PAYMENT_STAGES.map(entry => ({ value: entry.stage, label: entry.label })),
];

export type PaymentSummaryGrouping = 'department' | 'project' | 'department-project';

export const PAYMENT_SUMMARY_GROUPINGS: readonly { value: PaymentSummaryGrouping; label: string }[] = [
  { value: 'department', label: 'By department' },
  { value: 'project', label: 'By project' },
  { value: 'department-project', label: 'By department & project' },
];

const PAYMENTS_UNAVAILABLE =
  'Daily Requisition could not be read, so where these requests stand is not known. Reload the page to try again.';

/**
 * Still waiting to be received in Daily Requisition.
 *
 * Where Daily Requisition has a record of the request, that record decides. A live requisition
 * means received, even when the request never had its reception number written back (a requisition
 * that was imported). A cancelled one means waiting again: cancelling now clears the request's
 * reception number, and reading the requisition also catches the requests cancelled before it did —
 * unless the request records some other reception. Where Daily Requisition has no record, or could
 * not be read, the request's own reception number decides, as it always has.
 */
export function isAwaitingReception(
  expense: Pick<EnrichedExpense, 'requestNo' | 'receptionNo'>,
  requisitions?: ReadonlyMap<string, ProgressRequisition>,
): boolean {
  const receptionNo = expense.receptionNo.trim();
  const requisition = requisitions?.get(expense.requestNo.trim());
  if (!requisition) return !receptionNo;
  if (requisition.status !== 'Cancelled') return false;
  // `requisitionsByRequestNo` prefers a live requisition, so a cancelled one here has no live successor.
  return !receptionNo || receptionNo === (requisition.receptionNo ?? '').trim();
}

interface PaymentLine {
  expense: EnrichedExpense;
  requisition: ProgressRequisition | undefined;
  progress: RequisitionProgress;
  /** Has a requisition that is not cancelled — something Daily Requisition holds payable. */
  live: boolean;
}

function paymentLinesOf(
  expenses: readonly EnrichedExpense[],
  requisitions: ReadonlyMap<string, ProgressRequisition>,
): PaymentLine[] {
  return expenses.map(expense => {
    const requisition = requisitions.get(expense.requestNo.trim());
    const progress = requisitionProgress(requisition);
    return { expense, requisition, progress, live: !!requisition && progress.stage !== 'cancelled' };
  });
}

/**
 * The money through the pipeline. "Received in DR" is what Daily Requisition holds payable — the
 * requisition's net, after deductions — which is what "paid" and "balance due" divide between them.
 * A request not received, or whose requisition was cancelled, counts towards "raised" alone.
 */
function paymentTotals(lines: readonly PaymentLine[]) {
  let raised = 0;
  let received = 0;
  let paid = 0;
  let balance = 0;
  let inRequisition = 0;
  for (const line of lines) {
    raised += line.expense.amount;
    paid += line.progress.paid;
    if (!line.live) continue;
    received += line.progress.net;
    balance += line.progress.balance;
    inRequisition += 1;
  }
  return {
    requests: lines.length,
    raised: round2(raised),
    received: round2(received),
    paid: round2(paid),
    balance: round2(balance),
    inRequisition,
  };
}

const paymentStats = (totals: ReturnType<typeof paymentTotals>): ExpenseReportStat[] => [
  { label: 'Requests', value: totals.requests.toLocaleString('en-IN') },
  { label: 'Raised', value: money(totals.raised) },
  { label: 'Received in DR', value: money(totals.received) },
  { label: 'Paid', value: money(totals.paid) },
  { label: 'Balance due', value: money(totals.balance) },
  { label: 'Not yet in DR', value: `${totals.requests - totals.inRequisition} of ${totals.requests}` },
];

/** The vouchers that paid a requisition, by number — or a note that it was paid outside Bank Balance. */
const vouchersOf = (requisition: ProgressRequisition | undefined): string => {
  const numbers = (requisition?.payments ?? []).map(payment => (payment.voucherNo || '').trim()).filter(Boolean);
  if (numbers.length) return Array.from(new Set(numbers)).join(', ');
  return requisition?.manualPaid ? 'Paid outside Bank Balance' : '';
};

const raisedMillis = (line: PaymentLine) => {
  const millis = Date.parse(line.expense.createdAt);
  return Number.isNaN(millis) ? 0 : millis;
};

/* ── the catalogue ───────────────────────────────────────────────────────── */

const SUMMARY_COLUMNS = (leadKey: string, leadLabel: string, withAverage = true): ExpenseReportColumn[] => [
  { key: leadKey, label: leadLabel, type: 'text' },
  { key: 'requests', label: 'Requests', type: 'number' },
  { key: 'total', label: 'Total', type: 'currency' },
  ...(withAverage ? [{ key: 'average', label: 'Average', type: 'currency' as const }] : []),
  { key: 'share', label: 'Share', type: 'percent' },
];

export const EXPENSE_REPORTS: ExpenseReportDefinition[] = [
  {
    id: 'department-summary',
    title: 'Department Summary',
    group: 'Summary',
    description: 'What each department has spent, how many requests it raised, and its share of the total.',
    build: ({ expenses }) =>
      groupedSummary(expenses, {
        keyOf: row => row.departmentName,
        columns: SUMMARY_COLUMNS('department', 'Department'),
        labelsOf: key => ({ department: key }),
        withAverage: true,
        emptyMessage: 'No requests in this selection.',
      }),
  },
  {
    id: 'project-summary',
    title: 'Project Summary',
    group: 'Summary',
    description: 'Spend per project across every department in scope.',
    build: ({ expenses }) =>
      groupedSummary(expenses, {
        keyOf: row => row.projectName,
        columns: SUMMARY_COLUMNS('project', 'Project'),
        labelsOf: key => ({ project: key }),
        withAverage: true,
        emptyMessage: 'No requests in this selection.',
      }),
  },
  {
    id: 'head-summary',
    title: 'Head of Account Summary',
    group: 'Breakdown',
    description: 'Spend rolled up to the head of account — the view the ledger is posted against.',
    build: ({ expenses }) =>
      groupedSummary(expenses, {
        keyOf: row => row.headOfAccount,
        columns: SUMMARY_COLUMNS('head', 'Head of A/c'),
        labelsOf: key => ({ head: key }),
        withAverage: true,
        emptyMessage: 'No requests in this selection.',
      }),
  },
  {
    id: 'subhead-summary',
    title: 'Sub-Head Breakdown',
    group: 'Breakdown',
    description: 'Every sub-head with its parent head, so a head total can be taken apart.',
    build: ({ expenses }) =>
      groupedSummary(expenses, {
        keyOf: row => `${row.headOfAccount}\u0000${row.subHeadOfAccount}`,
        columns: [
          { key: 'head', label: 'Head of A/c', type: 'text' },
          { key: 'subHead', label: 'Sub-Head of A/c', type: 'text' },
          { key: 'requests', label: 'Requests', type: 'number' },
          { key: 'total', label: 'Total', type: 'currency' },
          { key: 'share', label: 'Share', type: 'percent' },
        ],
        labelsOf: key => {
          const [head, subHead] = key.split('\u0000');
          return { head, subHead };
        },
        emptyMessage: 'No requests in this selection.',
      }),
  },
  {
    id: 'party-summary',
    title: 'Party Ledger Summary',
    group: 'Breakdown',
    description: 'Spend per party, with the first and last time each was paid.',
    build: ({ expenses }) => {
      const result = groupedSummary(expenses, {
        keyOf: row => row.partyName,
        columns: [
          { key: 'party', label: 'Party', type: 'text' },
          { key: 'requests', label: 'Requests', type: 'number' },
          { key: 'total', label: 'Total', type: 'currency' },
          { key: 'average', label: 'Average', type: 'currency' },
          { key: 'first', label: 'First', type: 'date' },
          { key: 'last', label: 'Last', type: 'date' },
          { key: 'share', label: 'Share', type: 'percent' },
        ],
        labelsOf: (key, groupRows) => {
          const days = groupRows.map(row => dayKeyOf(row.createdAt)).filter(day => day !== 'Undated').sort();
          return { party: key, first: days[0] ?? '—', last: days[days.length - 1] ?? '—' };
        },
        withAverage: true,
        emptyMessage: 'No requests in this selection.',
      });
      return {
        ...result,
        stats: [
          ...result.stats,
          { label: 'Parties', value: result.rows.length.toLocaleString('en-IN') },
        ],
      };
    },
  },
  {
    id: 'raised-by-summary',
    title: 'Raised By Summary',
    group: 'Breakdown',
    description: 'Who is raising the requests, how many, and for how much.',
    build: ({ expenses }) =>
      groupedSummary(expenses, {
        keyOf: row => row.generatedByUser,
        columns: SUMMARY_COLUMNS('user', 'Raised by'),
        labelsOf: key => ({ user: key }),
        withAverage: true,
        emptyMessage: 'No requests in this selection.',
      }),
  },
  {
    id: 'monthly-trend',
    title: 'Monthly Trend',
    group: 'Trend',
    description: 'Month by month, with the change on the previous month and a running total.',
    build: ({ expenses }) => {
      const grouped = groupBy(expenses, row => monthKeyOf(row.createdAt));
      const months = Array.from(grouped.keys()).sort();
      let running = 0;
      let previous: number | null = null;

      const rows: ExpenseReportRow[] = months.map(month => {
        const monthRows = grouped.get(month) ?? [];
        const total = sum(monthRows);
        running += total;
        // No previous month means no change to report — 0% would read as "flat", which is a
        // different and wrong claim.
        const change = previous === null || previous === 0 ? null : ((total - previous) / previous) * 100;
        previous = total;
        return { month, requests: monthRows.length, total, change, cumulative: running };
      });

      const busiest = rows.reduce<ExpenseReportRow | null>(
        (best, row) => (best === null || Number(row.total) > Number(best.total) ? row : best),
        null,
      );

      return {
        columns: [
          { key: 'month', label: 'Month', type: 'month' },
          { key: 'requests', label: 'Requests', type: 'number' },
          { key: 'total', label: 'Total', type: 'currency' },
          { key: 'change', label: 'Change', type: 'percent' },
          { key: 'cumulative', label: 'Cumulative', type: 'currency' },
        ],
        rows,
        total: { month: 'Total', requests: expenses.length, total: sum(expenses), change: null, cumulative: running },
        stats: [
          ...headlineStats(expenses),
          { label: 'Months', value: months.length.toLocaleString('en-IN') },
          {
            label: 'Peak month',
            value: busiest ? `${formatReportMonth(String(busiest.month))} · ${money(Number(busiest.total))}` : '—',
          },
        ],
        emptyMessage: 'No requests in this selection.',
      };
    },
  },
  {
    id: 'daily-summary',
    title: 'Day Book',
    group: 'Trend',
    description: 'One row per day on which anything was raised.',
    build: ({ expenses }) => {
      const grouped = groupBy(expenses, row => dayKeyOf(row.createdAt));
      const rows: ExpenseReportRow[] = Array.from(grouped.keys())
        .sort()
        .map(day => {
          const dayRows = grouped.get(day) ?? [];
          return { day, requests: dayRows.length, total: sum(dayRows) };
        });
      return {
        columns: [
          { key: 'day', label: 'Date', type: 'date' },
          { key: 'requests', label: 'Requests', type: 'number' },
          { key: 'total', label: 'Total', type: 'currency' },
        ],
        rows,
        total: { day: 'Total', requests: expenses.length, total: sum(expenses) },
        stats: [...headlineStats(expenses), { label: 'Active days', value: rows.length.toLocaleString('en-IN') }],
        emptyMessage: 'No requests in this selection.',
      };
    },
  },
  {
    id: 'department-month-matrix',
    title: 'Department × Month',
    group: 'Trend',
    description: 'Each department down the side, each month across the top.',
    build: ({ expenses }) =>
      crossTab(expenses, {
        rowKeyOf: row => row.departmentName,
        columnKeyOf: row => monthKeyOf(row.createdAt),
        columnLabelOf: formatReportMonth,
        rowLabel: 'Department',
        emptyMessage: 'No requests in this selection.',
      }),
  },
  {
    id: 'project-month-matrix',
    title: 'Project × Month',
    group: 'Trend',
    description: 'Each project down the side, each month across the top.',
    build: ({ expenses }) =>
      crossTab(expenses, {
        rowKeyOf: row => row.projectName,
        columnKeyOf: row => monthKeyOf(row.createdAt),
        columnLabelOf: formatReportMonth,
        rowLabel: 'Project',
        emptyMessage: 'No requests in this selection.',
      }),
  },
  {
    id: 'head-department-matrix',
    title: 'Head × Department',
    group: 'Trend',
    description: 'Which department is spending against which head of account.',
    build: ({ expenses }) =>
      crossTab(expenses, {
        rowKeyOf: row => row.headOfAccount,
        columnKeyOf: row => row.departmentName,
        rowLabel: 'Head of A/c',
        emptyMessage: 'No requests in this selection.',
      }),
  },
  {
    id: 'pending-reception',
    title: 'Pending Reception',
    group: 'Control',
    description:
      'Requests Daily Requisition does not yet hold — never received, or received and then cancelled — oldest first.',
    build: ({ expenses, today, requisitions }) => {
      const now = today ?? new Date();
      const pending = expenses.filter(row => isAwaitingReception(row, requisitions));
      const rows: ExpenseReportRow[] = pending
        .map(row => ({
          requestNo: row.requestNo,
          raised: dayKeyOf(row.createdAt),
          department: row.departmentName,
          project: row.projectName,
          party: row.partyName,
          amount: row.amount,
          age: ageInDays(row.createdAt, now),
        }))
        .sort((a, b) => Number(b.age) - Number(a.age));

      const oldest = rows.length ? Number(rows[0].age) : 0;
      return {
        columns: [
          { key: 'requestNo', label: 'Request No', type: 'text' },
          { key: 'raised', label: 'Raised', type: 'date' },
          { key: 'department', label: 'Department', type: 'text' },
          { key: 'project', label: 'Project', type: 'text' },
          { key: 'party', label: 'Party', type: 'text' },
          { key: 'amount', label: 'Amount', type: 'currency' },
          { key: 'age', label: 'Age (days)', type: 'number' },
        ],
        rows,
        total: { requestNo: 'Total', amount: sum(pending), age: null },
        stats: [
          { label: 'Pending', value: pending.length.toLocaleString('en-IN') },
          { label: 'Value pending', value: money(sum(pending)) },
          { label: 'Oldest', value: rows.length ? `${oldest} days` : '—' },
          {
            label: 'Received',
            value: `${expenses.length - pending.length} of ${expenses.length}`,
          },
        ],
        emptyMessage: 'Every request in this selection has been received.',
      };
    },
  },
  {
    id: 'reception-aging',
    title: 'Reception Ageing',
    group: 'Control',
    description: 'Unreceived requests bucketed by how long they have been waiting.',
    build: ({ expenses, today, requisitions }) => {
      const now = today ?? new Date();
      const pending = expenses.filter(row => isAwaitingReception(row, requisitions));
      const buckets: { label: string; test: (age: number) => boolean }[] = [
        { label: '0–7 days', test: age => age <= 7 },
        { label: '8–15 days', test: age => age > 7 && age <= 15 },
        { label: '16–30 days', test: age => age > 15 && age <= 30 },
        { label: '31–60 days', test: age => age > 30 && age <= 60 },
        { label: 'Over 60 days', test: age => age > 60 },
      ];
      const aged = pending.map(row => ({ row, age: ageInDays(row.createdAt, now) }));
      const grandTotal = sum(pending);

      // With nothing pending the five fixed buckets would render as five rows of zeros, which
      // reads as a report rather than as "there is nothing waiting". Let the empty message say it.
      const rows: ExpenseReportRow[] = !pending.length ? [] : buckets.map(bucket => {
        const inBucket = aged.filter(entry => bucket.test(entry.age));
        const total = inBucket.reduce((running, entry) => running + entry.row.amount, 0);
        return {
          bucket: bucket.label,
          requests: inBucket.length,
          total,
          share: grandTotal ? (total / grandTotal) * 100 : 0,
        };
      });

      return {
        columns: [
          { key: 'bucket', label: 'Age', type: 'text' },
          { key: 'requests', label: 'Requests', type: 'number' },
          { key: 'total', label: 'Value', type: 'currency' },
          { key: 'share', label: 'Share', type: 'percent' },
        ],
        rows,
        total: { bucket: 'Total', requests: pending.length, total: grandTotal, share: grandTotal ? 100 : 0 },
        stats: [
          { label: 'Pending', value: pending.length.toLocaleString('en-IN') },
          { label: 'Value pending', value: money(grandTotal) },
          {
            label: 'Over 30 days',
            value: aged.filter(entry => entry.age > 30).length.toLocaleString('en-IN'),
          },
        ],
        emptyMessage: 'Every request in this selection has been received.',
      };
    },
  },
  {
    id: 'high-value',
    title: 'High Value Requests',
    group: 'Control',
    description: 'Every request at or above the high-value threshold, largest first.',
    build: ({ expenses, highValueThreshold }) => {
      const threshold = highValueThreshold ?? 100000;
      const flagged = expenses.filter(row => row.amount >= threshold).sort((a, b) => b.amount - a.amount);
      const rows: ExpenseReportRow[] = flagged.map(row => ({
        requestNo: row.requestNo,
        raised: dayKeyOf(row.createdAt),
        department: row.departmentName,
        project: row.projectName,
        party: row.partyName,
        subHead: row.subHeadOfAccount,
        amount: row.amount,
      }));
      const flaggedTotal = sum(flagged);
      const grandTotal = sum(expenses);

      return {
        columns: [
          { key: 'requestNo', label: 'Request No', type: 'text' },
          { key: 'raised', label: 'Raised', type: 'date' },
          { key: 'department', label: 'Department', type: 'text' },
          { key: 'project', label: 'Project', type: 'text' },
          { key: 'party', label: 'Party', type: 'text' },
          { key: 'subHead', label: 'Sub-Head of A/c', type: 'text' },
          { key: 'amount', label: 'Amount', type: 'currency' },
        ],
        rows,
        total: { requestNo: 'Total', amount: flaggedTotal },
        stats: [
          { label: 'Threshold', value: money(threshold) },
          { label: 'Flagged', value: `${flagged.length} of ${expenses.length}` },
          { label: 'Flagged value', value: money(flaggedTotal) },
          {
            label: 'Share of spend',
            value: grandTotal ? `${((flaggedTotal / grandTotal) * 100).toFixed(1)}%` : '—',
          },
        ],
        emptyMessage: 'No request in this selection reaches the threshold.',
      };
    },
  },
  {
    id: 'duplicate-suspects',
    title: 'Possible Duplicates',
    group: 'Control',
    description:
      'Requests sharing a project, party, amount and date — the shape a double entry takes. Not proof of one.',
    build: ({ expenses }) => {
      const grouped = groupBy(
        expenses,
        row => [row.projectId, row.partyName.trim().toLowerCase(), row.amount.toFixed(2), dayKeyOf(row.createdAt)].join('|'),
      );
      const suspects = Array.from(grouped.values()).filter(group => group.length > 1);

      const rows: ExpenseReportRow[] = suspects
        .sort((a, b) => sum(b) - sum(a))
        .flatMap(group =>
          group.map((row, index) => ({
            group: index === 0 ? `${group.length} requests` : '',
            requestNo: row.requestNo,
            raised: dayKeyOf(row.createdAt),
            department: row.departmentName,
            project: row.projectName,
            party: row.partyName,
            amount: row.amount,
            description: row.description,
          })),
        );

      const duplicatedValue = suspects.reduce(
        // The first of each set is presumed genuine; only the repeats are the exposure.
        (running, group) => running + sum(group) - group[0].amount,
        0,
      );

      return {
        columns: [
          { key: 'group', label: 'Set', type: 'text' },
          { key: 'requestNo', label: 'Request No', type: 'text' },
          { key: 'raised', label: 'Raised', type: 'date' },
          { key: 'department', label: 'Department', type: 'text' },
          { key: 'project', label: 'Project', type: 'text' },
          { key: 'party', label: 'Party', type: 'text' },
          { key: 'amount', label: 'Amount', type: 'currency' },
          { key: 'description', label: 'Description', type: 'text' },
        ],
        rows,
        stats: [
          { label: 'Sets found', value: suspects.length.toLocaleString('en-IN') },
          { label: 'Requests involved', value: rows.length.toLocaleString('en-IN') },
          { label: 'Value of repeats', value: money(duplicatedValue) },
        ],
        emptyMessage: 'Nothing in this selection repeats a project, party, amount and date.',
      };
    },
  },
  {
    id: 'payment-status',
    title: 'Payment Status',
    group: 'Payments',
    description:
      'Where each request stands since it was raised — received in Daily Requisition, verified, paid in part or in full — with what has been paid and what is still due.',
    build: ({ expenses, requisitions, paymentStage }) => {
      const columns: ExpenseReportColumn[] = [
        { key: 'requestNo', label: 'Request No', type: 'text' },
        { key: 'raised', label: 'Raised', type: 'date' },
        { key: 'department', label: 'Department', type: 'text' },
        { key: 'project', label: 'Project', type: 'text' },
        { key: 'party', label: 'Party', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'currency' },
        { key: 'receptionNo', label: 'Reception No', type: 'text', linkKey: 'receptionHref' },
        { key: 'stage', label: 'Stage', type: 'text', toneKey: 'stageTone' },
        { key: 'net', label: 'Received in DR', type: 'currency' },
        { key: 'paid', label: 'Paid', type: 'currency' },
        { key: 'balance', label: 'Balance due', type: 'currency' },
        { key: 'vouchers', label: 'Vouchers', type: 'text' },
      ];
      if (!requisitions) return { columns, rows: [], stats: [], emptyMessage: PAYMENTS_UNAVAILABLE };

      const filter = paymentStage ?? 'all';
      const lines = paymentLinesOf(expenses, requisitions)
        .filter(line =>
          filter === 'all' || (filter === 'outstanding' ? line.progress.stage !== 'paid' : line.progress.stage === filter),
        )
        // Down the pipeline, and oldest first within a stage — the order requests get chased in.
        .sort(
          (a, b) =>
            (STAGE_RANK.get(a.progress.stage) ?? 0) - (STAGE_RANK.get(b.progress.stage) ?? 0) ||
            raisedMillis(a) - raisedMillis(b),
        );

      const rows: ExpenseReportRow[] = lines.map(line => {
        const receptionNo = (line.requisition?.receptionNo || line.expense.receptionNo).trim();
        return {
          requestNo: line.expense.requestNo,
          raised: dayKeyOf(line.expense.createdAt),
          department: line.expense.departmentName,
          project: line.expense.projectName,
          party: line.expense.partyName,
          amount: line.expense.amount,
          receptionNo: receptionNo || '—',
          receptionHref: line.requisition && receptionNo ? requisitionHref(receptionNo) : null,
          stage: line.progress.label,
          stageTone: line.progress.tone,
          // Nothing is payable on a request Daily Requisition does not hold: "—", not a 0 that
          // would read as settled.
          net: line.live ? line.progress.net : null,
          paid: line.live || line.progress.paid > 0 ? line.progress.paid : null,
          balance: line.live ? line.progress.balance : null,
          vouchers: vouchersOf(line.requisition),
        };
      });

      const totals = paymentTotals(lines);
      return {
        columns,
        rows,
        total: {
          requestNo: 'Total',
          amount: totals.raised,
          net: totals.received,
          paid: totals.paid,
          balance: totals.balance,
        },
        stats: paymentStats(totals),
        emptyMessage:
          filter === 'all'
            ? 'No requests in this selection.'
            : filter === 'outstanding'
              ? 'Every request in this selection has been paid in full.'
              : 'No request in this selection is at this stage.',
      };
    },
  },
  {
    id: 'payment-summary',
    title: 'Payment Status Summary',
    group: 'Payments',
    description:
      'Raised, received in Daily Requisition, paid and still due — by department, by project or both — with how many requests stand at each stage.',
    build: ({ expenses, requisitions, paymentGroupBy }) => {
      const grouping = paymentGroupBy ?? 'department';
      const labelColumns: ExpenseReportColumn[] = [
        ...(grouping === 'project' ? [] : [{ key: 'department', label: 'Department', type: 'text' as const }]),
        ...(grouping === 'department' ? [] : [{ key: 'project', label: 'Project', type: 'text' as const }]),
      ];
      const figureColumns: ExpenseReportColumn[] = [
        { key: 'requests', label: 'Requests', type: 'number' },
        { key: 'raised', label: 'Raised', type: 'currency' },
        { key: 'received', label: 'Received in DR', type: 'currency' },
        { key: 'paid', label: 'Paid', type: 'currency' },
        { key: 'balance', label: 'Balance due', type: 'currency' },
      ];
      if (!requisitions) {
        return { columns: [...labelColumns, ...figureColumns], rows: [], stats: [], emptyMessage: PAYMENTS_UNAVAILABLE };
      }

      const lines = paymentLinesOf(expenses, requisitions);
      // A count for each stage something in the selection stands at: nine columns, most of them
      // zeros, would bury the few that say anything.
      const stages = PAYMENT_STAGES.filter(entry => lines.some(line => line.progress.stage === entry.stage));
      const stageColumns: ExpenseReportColumn[] = stages.map(entry => ({
        key: `stage:${entry.stage}`,
        // "Paid" already heads the money column, and an export keys its cells by heading.
        label: entry.stage === 'paid' ? 'Paid in full' : entry.label,
        type: 'number' as const,
      }));

      const figuresOf = (group: readonly PaymentLine[]): ExpenseReportRow => {
        const totals = paymentTotals(group);
        const row: ExpenseReportRow = {
          requests: totals.requests,
          raised: totals.raised,
          received: totals.received,
          paid: totals.paid,
          balance: totals.balance,
        };
        stages.forEach(entry => {
          row[`stage:${entry.stage}`] = group.filter(line => line.progress.stage === entry.stage).length;
        });
        return row;
      };

      const grouped = groupBy(lines, line =>
        grouping === 'project'
          ? line.expense.projectName
          : grouping === 'department'
            ? line.expense.departmentName
            : `${line.expense.departmentName}\u0000${line.expense.projectName}`,
      );
      const rows: ExpenseReportRow[] = Array.from(grouped.values()).map(group => ({
        ...(grouping === 'project' ? {} : { department: group[0].expense.departmentName }),
        ...(grouping === 'department' ? {} : { project: group[0].expense.projectName }),
        ...figuresOf(group),
      }));
      rows.sort((a, b) => Number(b.raised) - Number(a.raised));

      return {
        columns: [...labelColumns, ...figureColumns, ...stageColumns],
        rows,
        total: { [labelColumns[0].key]: 'Total', ...figuresOf(lines) },
        stats: paymentStats(paymentTotals(lines)),
        emptyMessage: 'No requests in this selection.',
      };
    },
  },
  {
    id: 'expense-register',
    title: 'Expense Register',
    group: 'Detail',
    description: 'Every request in scope, one row each — the full detail behind the summaries.',
    build: ({ expenses }) => {
      const rows: ExpenseReportRow[] = [...expenses]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(row => ({
          requestNo: row.requestNo,
          raised: dayKeyOf(row.createdAt),
          department: row.departmentName,
          project: row.projectName,
          head: row.headOfAccount,
          subHead: row.subHeadOfAccount,
          party: row.partyName,
          description: row.description,
          remarks: row.remarks,
          raisedBy: row.generatedByUser,
          receptionNo: row.receptionNo || '—',
          receptionDate: row.receptionDate || '—',
          amount: row.amount,
        }));

      return {
        columns: [
          { key: 'requestNo', label: 'Request No', type: 'text' },
          { key: 'raised', label: 'Raised', type: 'date' },
          { key: 'department', label: 'Department', type: 'text' },
          { key: 'project', label: 'Project', type: 'text' },
          { key: 'head', label: 'Head of A/c', type: 'text' },
          { key: 'subHead', label: 'Sub-Head of A/c', type: 'text' },
          { key: 'party', label: 'Party', type: 'text' },
          { key: 'description', label: 'Description', type: 'text' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
          { key: 'raisedBy', label: 'Raised by', type: 'text' },
          { key: 'receptionNo', label: 'Reception No', type: 'text' },
          { key: 'receptionDate', label: 'Reception Date', type: 'date' },
          { key: 'amount', label: 'Amount', type: 'currency' },
        ],
        rows,
        total: { requestNo: 'Total', amount: sum(expenses) },
        stats: headlineStats(expenses),
        emptyMessage: 'No requests in this selection.',
      };
    },
  },
];

export const expenseReportById = (id: string): ExpenseReportDefinition | undefined =>
  EXPENSE_REPORTS.find(report => report.id === id);

/** Formats a cell for display and for export, so a figure reads the same in both. */
export function formatReportCell(value: ExpenseReportCell, type: ExpenseReportColumnType = 'text'): string {
  if (value === null || value === undefined || value === '') return type === 'text' ? '' : '—';
  if (type === 'currency') return money(Number(value));
  if (type === 'number') return Number(value).toLocaleString('en-IN');
  if (type === 'percent') return `${Number(value).toFixed(1)}%`;
  if (type === 'date') return formatReportDate(String(value));
  if (type === 'month') return formatReportMonth(String(value));
  return String(value);
}

/** Figures, as opposed to words and dates: set right-aligned, in tabular digits. */
export const isNumericReportColumn = (type: ExpenseReportColumnType | undefined): boolean =>
  type === 'number' || type === 'currency' || type === 'percent';
