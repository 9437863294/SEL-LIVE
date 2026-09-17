/**
 * The Expenses report catalogue.
 *
 * Every report the module can answer from `expenseRequests` alone, defined as data rather than as
 * a page each: one entry per report, each carrying its own builder that turns a filtered set of
 * requests into columns, rows and a footer total. The report centre renders whatever the catalogue
 * lists, so adding a report is adding an entry here — not another route, another table component
 * and another export button that formats currency slightly differently from the last one.
 *
 * The same catalogue serves a single department and the whole organisation. Scope is a filter
 * applied before the builder runs, not a different set of reports, so a department head and the
 * finance office are reading the same definitions of "total" and "share".
 *
 * Pure — no Firebase, no DOM — so every total here is unit-testable with `node --test`.
 */

/* ── shapes ──────────────────────────────────────────────────────────────── */

export type ExpenseReportGroup = 'Summary' | 'Breakdown' | 'Trend' | 'Control' | 'Detail';

export const EXPENSE_REPORT_GROUPS: ExpenseReportGroup[] = [
  'Summary',
  'Breakdown',
  'Trend',
  'Control',
  'Detail',
];

export type ExpenseReportColumnType = 'text' | 'number' | 'currency' | 'percent' | 'date';

export interface ExpenseReportColumn {
  key: string;
  label: string;
  type?: ExpenseReportColumnType;
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

const money = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

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
    emptyMessage: string;
  },
): ExpenseReportResult {
  const columnKeys = Array.from(new Set(rows.map(options.columnKeyOf))).sort(
    options.sortColumns ?? ((a, b) => a.localeCompare(b)),
  );
  const grouped = groupBy(rows, options.rowKeyOf);

  const columns: ExpenseReportColumn[] = [
    { key: 'label', label: options.rowLabel, type: 'text' },
    ...columnKeys.map(key => ({ key: `col:${key}`, label: key, type: 'currency' as const })),
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
        keyOf: row => `${row.headOfAccount} ${row.subHeadOfAccount}`,
        columns: [
          { key: 'head', label: 'Head of A/c', type: 'text' },
          { key: 'subHead', label: 'Sub-Head of A/c', type: 'text' },
          { key: 'requests', label: 'Requests', type: 'number' },
          { key: 'total', label: 'Total', type: 'currency' },
          { key: 'share', label: 'Share', type: 'percent' },
        ],
        labelsOf: key => {
          const [head, subHead] = key.split(' ');
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
          { key: 'month', label: 'Month', type: 'text' },
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
          { label: 'Peak month', value: busiest ? `${busiest.month} · ${money(Number(busiest.total))}` : '—' },
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
    description: 'Requests that have never been given a reception number, oldest first.',
    build: ({ expenses, today }) => {
      const now = today ?? new Date();
      const pending = expenses.filter(row => !row.receptionNo.trim());
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
    build: ({ expenses, today }) => {
      const now = today ?? new Date();
      const pending = expenses.filter(row => !row.receptionNo.trim());
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
          { key: 'receptionDate', label: 'Reception Date', type: 'text' },
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
  if (type === 'percent') {
    const numeric = Number(value);
    return `${numeric > 0 ? '' : ''}${numeric.toFixed(1)}%`;
  }
  return String(value);
}
