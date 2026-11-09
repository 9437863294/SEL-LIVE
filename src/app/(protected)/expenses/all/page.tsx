'use client';

/**
 * Consolidated Expenses — every department's requests in one register.
 *
 * The top of the page answers "where is the money going": the hero's figures, then by department
 * (pick one to filter), by head of A/c, and what in the register is worth a second look. Below it,
 * the register itself — searchable, filterable, sortable by any column, groupable by department,
 * project or stage, and exportable as it stands.
 *
 * Which columns show, and in what order, is module configuration (Expenses › Settings › Table &
 * Field Configuration), not a per-user toggle. Where a request has got to is read live from Daily
 * Requisition through src/lib/requisition-progress.ts, as every module does.
 */

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { format, formatDistanceStrict, startOfMonth, startOfWeek } from 'date-fns';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Building2,
  CopyCheck,
  Download,
  FileText,
  FlaskConical,
  HandCoins,
  Hourglass,
  Inbox,
  IndianRupee,
  Layers,
  List,
  MessageSquareWarning,
  Receipt,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  TrendingUp,
  UserRound,
  X,
} from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import type { DailyRequisitionEntry, Department, ExpenseRequest, Project } from '@/lib/types';
import {
  ExpenseDetailsDialog,
  PaidBalanceCell,
  RemarksCell,
  STAGE_FILTERS,
  formatExpenseTimestamp,
  formatReceptionDate,
  receptionOf,
  requisitionOf,
  stageFilterOf,
  withProgressColumns,
  type StageFilter,
} from '@/components/expenses/expense-details-dialog';
import {
  ByDepartmentCard,
  ByHeadCard,
  DEPARTMENT_ACCENTS,
  KpiTile,
  PALETTE,
  TONE_ACCENT,
  WorthALookCard,
  accentVars,
  cx,
  departmentCode,
  type AccentPair,
  type DepartmentShare,
  type RegisterFlag,
} from '@/components/expenses/consolidated-insights';
import { useExpensesSettings } from '@/components/expenses/use-expenses-settings';
import { applyColumnSettings } from '@/lib/expenses-settings';
import { formatInr } from '@/lib/bank-balance-ledger';
import {
  requisitionProgress,
  requisitionsByRequestNo,
  type ProgressStage,
  type ProgressTone,
  type RequisitionProgress,
} from '@/lib/requisition-progress';
import { cn } from '@/lib/utils';

/* ── the register's rows ───────────────────────────────────────────────────────────────────────── */

type StageGroup = Exclude<StageFilter, 'all'>;
type Period = 'week' | 'month' | 'all';
type GroupBy = 'none' | 'department' | 'project' | 'stage';

/** A request with everything the page reads about it worked out once. */
interface RegisterRow {
  expense: ExpenseRequest;
  amount: number;
  project: string;
  department: string;
  requisition: DailyRequisitionEntry | undefined;
  progress: RequisitionProgress;
  /** The stage as the Stage filter folds it. */
  stageGroup: StageGroup;
  createdMs: number;
  test: boolean;
}

const EMPTY_FILTERS = {
  requestNo: '',
  partyName: '',
  projectName: 'all',
  departmentName: 'all',
  stage: 'all' as StageFilter,
};

const DAY = 86_400_000;

/** Head and Sub-head, when both are shown, share one column: the sub-head over its head. */
const HEAD_PAIR = 'Head / Sub-head of A/c';
/** Columns that sort largest / newest first on the first click. */
const DESCENDING_FIRST = new Set(['Timestamp', 'Amount', 'Paid / Balance']);
const RIGHT_ALIGNED = new Set(['Amount', 'Paid / Balance']);

/** Workflow order, for sorting by Stage. */
const STAGE_ORDER: ProgressStage[] = [
  'not-received',
  'pending',
  'received',
  'needs-review',
  'verified',
  'awaiting-payment',
  'part-paid',
  'paid',
  'cancelled',
];

const STAGE_GROUP_TONE: Record<StageGroup, ProgressTone> = {
  'not-received': 'neutral',
  'in-workflow': 'info',
  'awaiting-payment': 'progress',
  'part-paid': 'warning',
  paid: 'success',
  cancelled: 'danger',
};

const STAGE_LABEL = new Map<string, string>(STAGE_FILTERS.map(option => [option.value, option.label]));

const collator = new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' });
const uniqueSorted = (values: string[]) => [...new Set(values)].sort(collator.compare);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sumOf = (rows: RegisterRow[]) => rows.reduce((total, row) => total + row.amount, 0);

const TEST_WORD = /\btest(ing)?\b/i;

/**
 * Rows someone raised to try the system out: a project or party with "test" in its name, or a
 * description that is just "test" / "testing". Only ever a hint — the page offers to hide them.
 */
function looksLikeTest(expense: ExpenseRequest, project: string): boolean {
  return (
    TEST_WORD.test(project) ||
    TEST_WORD.test(expense.partyName || '') ||
    /^\s*test(ing)?\s*$/i.test(expense.description || '')
  );
}

/**
 * Same party, same amount, raised within a month of each other — each set, largest first. Monthly
 * site funds of a fixed amount are a month apart, so they do not trip it.
 */
function possibleDuplicates(rows: RegisterRow[]): RegisterRow[][] {
  const byKey = new Map<string, RegisterRow[]>();
  for (const row of rows) {
    const party = (row.expense.partyName || '').trim().toLowerCase();
    if (!party || row.amount <= 0 || row.stageGroup === 'cancelled') continue;
    const key = `${party}|${row.amount.toFixed(2)}`;
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  const sets: RegisterRow[][] = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const byTime = [...list].sort((a, b) => a.createdMs - b.createdMs);
    const close = byTime.filter(
      (row, i) =>
        (i > 0 && row.createdMs - byTime[i - 1].createdMs < 28 * DAY) ||
        (i < byTime.length - 1 && byTime[i + 1].createdMs - row.createdMs < 28 * DAY),
    );
    if (close.length > 1) sets.push(close);
  }
  return sets.sort((a, b) => b[0].amount - a[0].amount);
}

/** One header list for the table: Head and Sub-head folded into one column when both are shown. */
function displayColumns(headers: string[]): string[] {
  if (!headers.includes('Head of A/c') || !headers.includes('Sub-Head of A/c')) return headers;
  const out: string[] = [];
  for (const header of headers) {
    if (header === 'Head of A/c' || header === 'Sub-Head of A/c') {
      if (!out.includes(HEAD_PAIR)) out.push(HEAD_PAIR);
    } else {
      out.push(header);
    }
  }
  return out;
}

function sortValue(column: string, row: RegisterRow): string | number {
  const e = row.expense;
  switch (column) {
    case 'Request No': return e.requestNo || '';
    case 'Timestamp': return row.createdMs;
    case 'Department': return row.department;
    case 'Project Name': return row.project;
    case 'Amount': return row.amount;
    case 'Head of A/c': return e.headOfAccount || '';
    case 'Sub-Head of A/c': return e.subHeadOfAccount || '';
    case HEAD_PAIR: return `${e.headOfAccount || ''} ${e.subHeadOfAccount || ''}`;
    case 'Remarks': return e.remarks || '';
    case 'Description': return e.description || '';
    case 'Name of the party': return e.partyName || '';
    case 'Reception No': return receptionOf(e, row.requisition).receptionNo;
    case 'Reception Date': return receptionOf(e, row.requisition).receptionDate;
    case 'Stage': return STAGE_ORDER.indexOf(row.progress.stage);
    case 'Paid / Balance': return row.progress.paid;
    default: return '';
  }
}

const compareValues = (a: string | number, b: string | number) =>
  typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));

/* ── export ────────────────────────────────────────────────────────────────────────────────────── */

/** A row's cells for one configured column; Paid / Balance exports as two numeric columns. */
function exportCells(column: string, row: RegisterRow, unavailable: boolean): Array<string | number> {
  const e = row.expense;
  switch (column) {
    case 'Request No': return [e.requestNo || ''];
    case 'Timestamp': return [e.createdAt ? formatExpenseTimestamp(e.createdAt) : ''];
    case 'Department': return [row.department];
    case 'Project Name': return [row.project];
    case 'Amount': return [row.amount];
    case 'Head of A/c': return [e.headOfAccount || ''];
    case 'Sub-Head of A/c': return [e.subHeadOfAccount || ''];
    case 'Remarks': return [e.remarks || ''];
    case 'Description': return [e.description || ''];
    case 'Name of the party': return [e.partyName || ''];
    case 'Reception No': return [receptionOf(e, row.requisition).receptionNo];
    case 'Reception Date': {
      const { receptionDate } = receptionOf(e, row.requisition);
      return [receptionDate ? formatReceptionDate(receptionDate) : ''];
    }
    case 'Stage': return [unavailable ? '' : row.progress.label];
    case 'Paid / Balance':
      return unavailable || !row.requisition ? ['', ''] : [row.progress.paid, row.progress.balance];
    default: return [''];
  }
}

/**
 * One CSV cell. Text that a spreadsheet would read as a formula (=, +, -, @) is prefixed with an
 * apostrophe — these are free-text fields anyone raising a request can type into.
 */
function csvCell(value: string | number): string {
  let text = typeof value === 'number' ? value.toFixed(2) : value;
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/* ── small cells ───────────────────────────────────────────────────────────────────────────────── */

function StageChip({ row, unavailable }: { row: RegisterRow; unavailable: boolean }) {
  if (unavailable) {
    return (
      <span className={cx.muted} title="Daily Requisition could not be loaded">
        —
      </span>
    );
  }
  const { requisition, progress } = row;
  return (
    <span
      className={cx.stageChip}
      style={accentVars(TONE_ACCENT[progress.tone])}
      title={
        requisition
          ? `${requisition.receptionNo || 'Requisition'} · ${requisition.status || 'Pending'}`
          : 'Not yet received in Daily Requisition'
      }
    >
      <i aria-hidden="true" />
      {progress.label}
    </span>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  hero,
}: {
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  hero?: boolean;
}) {
  return (
    <div className={cn(cx.seg, hero && cx.segHero)} role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className={cx.segBtn}
          aria-pressed={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ── the page ──────────────────────────────────────────────────────────────────────────────────── */

export default function AllExpensesPage() {
  const { toast } = useToast();
  const { loading: isAuthLoading } = useAuth();
  const { can } = useAuthorization();
  const { settings } = useExpensesSettings();

  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRequest[]>([]);
  const [requisitions, setRequisitions] = useState<DailyRequisitionEntry[]>([]);
  // "Could not read Daily Requisition" — progress is unknown, which must not read as "Not received".
  const [requisitionsUnavailable, setRequisitionsUnavailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [detailsExpense, setDetailsExpense] = useState<ExpenseRequest | null>(null);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [period, setPeriod] = useState<Period>('all');
  const [hideTests, setHideTests] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [sort, setSort] = useState<{ column: string; dir: 1 | -1 }>({ column: 'Timestamp', dir: -1 });
  const [now] = useState(() => new Date());

  const canViewPage = can('View All', 'Expenses.Expense Requests');
  const canConfigure = can('View', 'Expenses.Settings');

  const setFilter = <K extends keyof typeof EMPTY_FILTERS>(field: K, value: (typeof EMPTY_FILTERS)[K]) =>
    setFilters(prev => ({ ...prev, [field]: value }));

  useEffect(() => {
    // Nothing to fetch for someone who may not see the page; the render shows Access Denied.
    if (isAuthLoading || !canViewPage) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [projectsSnap, expensesSnap, deptsSnap, requisitionsSnap] = await Promise.all([
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'expenseRequests')),
          getDocs(collection(db, 'departments')),
          // Where each request has got to lives in Daily Requisition. Someone who cannot read it
          // still gets the register; only its progress goes blank.
          getDocs(collection(db, 'dailyRequisitions')).catch(error => {
            console.error('Could not read Daily Requisition:', error);
            return null;
          }),
        ]);
        setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
        setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));
        setExpenses(expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseRequest)));
        setRequisitions(
          requisitionsSnap
            ? requisitionsSnap.docs.map(doc => ({ ...(doc.data() as DailyRequisitionEntry), id: doc.id }))
            : [],
        );
        setRequisitionsUnavailable(!requisitionsSnap);
      } catch (error: unknown) {
        console.error('Error fetching data:', error);
        toast({ title: 'Error', description: 'Failed to fetch consolidated expenses.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchData();
  }, [toast, isAuthLoading, canViewPage]);

  /* ── rows ── */

  /** Each request's requisition, by Request No = Dep No — the link every module uses. */
  const requisitionByRequestNo = useMemo(() => requisitionsByRequestNo(requisitions), [requisitions]);
  const projectNameById = useMemo(() => new Map(projects.map(p => [p.id, p.projectName])), [projects]);
  const projectNameOf = (projectId: string) => projectNameById.get(projectId) || 'Unknown Project';

  const rows = useMemo<RegisterRow[]>(
    () =>
      expenses.map(expense => {
        const requisition = requisitionOf(requisitionByRequestNo, expense);
        const progress = requisitionProgress(requisition);
        const project = projectNameById.get(expense.projectId) || 'Unknown Project';
        return {
          expense,
          amount: Number(expense.amount) || 0,
          project,
          department: (expense.generatedByDepartment || '').trim() || 'Unassigned',
          requisition,
          progress,
          stageGroup: stageFilterOf(progress.stage),
          createdMs: expense.createdAt ? new Date(expense.createdAt).getTime() || 0 : 0,
          test: looksLikeTest(expense, project),
        };
      }),
    [expenses, requisitionByRequestNo, projectNameById],
  );

  /** Departments take colours in name order, so each keeps its own whatever is filtered. */
  const departmentAccent = useMemo(() => {
    const names = uniqueSorted([...departments.map(d => d.name), ...rows.map(r => r.department)]);
    return new Map(names.map((name, i) => [name, DEPARTMENT_ACCENTS[i % DEPARTMENT_ACCENTS.length]]));
  }, [departments, rows]);
  const accentOf = (department: string): AccentPair => departmentAccent.get(department) ?? PALETTE.slate;

  const projectOptions = useMemo(() => uniqueSorted(rows.map(r => r.project)), [rows]);
  const departmentOptions = useMemo(() => uniqueSorted(rows.map(r => r.department)), [rows]);

  const periodStart =
    period === 'week'
      ? startOfWeek(now, { weekStartsOn: 1 }).getTime()
      : period === 'month'
        ? startOfMonth(now).getTime()
        : 0;
  const periodLabel = period === 'week' ? 'This week' : period === 'month' ? format(now, 'MMMM') : 'All time';

  const filtered = useMemo(() => {
    const requestNo = filters.requestNo.trim().toLowerCase();
    const party = filters.partyName.trim().toLowerCase();
    return rows.filter(
      row =>
        (!requestNo || (row.expense.requestNo || '').toLowerCase().includes(requestNo)) &&
        (!party || (row.expense.partyName || '').toLowerCase().includes(party)) &&
        (filters.projectName === 'all' || row.project === filters.projectName) &&
        (filters.departmentName === 'all' || row.department === filters.departmentName) &&
        (requisitionsUnavailable || filters.stage === 'all' || row.stageGroup === filters.stage) &&
        (!hideTests || !row.test) &&
        (!periodStart || row.createdMs >= periodStart),
    );
  }, [rows, filters, hideTests, periodStart, requisitionsUnavailable]);

  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          compareValues(sortValue(sort.column, a), sortValue(sort.column, b)) * sort.dir || b.createdMs - a.createdMs,
      ),
    [filtered, sort],
  );

  /* ── figures, from the requests in view ── */

  const figures = useMemo(() => {
    const byDepartment = new Map<string, { amount: number; count: number }>();
    const byHead = new Map<string, number>();
    let total = 0;
    let largest = 0;
    let unpaidCount = 0;
    let unpaidAmount = 0;
    for (const row of filtered) {
      total += row.amount;
      largest = Math.max(largest, row.amount);
      const dept = byDepartment.get(row.department) ?? { amount: 0, count: 0 };
      dept.amount += row.amount;
      dept.count += 1;
      byDepartment.set(row.department, dept);
      const head = (row.expense.headOfAccount || '').trim() || 'No head of A/c';
      byHead.set(head, (byHead.get(head) ?? 0) + row.amount);
      if (row.stageGroup !== 'paid' && row.stageGroup !== 'cancelled') {
        unpaidCount += 1;
        // Once received, what is still due is the requisition's balance; before that, the request.
        unpaidAmount += row.requisition ? row.progress.balance : row.amount;
      }
    }
    const departmentShares: DepartmentShare[] = [...byDepartment.entries()]
      .map(([name, { amount, count }]) => ({
        name,
        code: departmentCode(name),
        accent: departmentAccent.get(name) ?? PALETTE.slate,
        amount,
        count,
      }))
      .sort((a, b) => b.amount - a.amount);
    const heads = [...byHead.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
    const SHOWN = 6;
    const headsShown =
      heads.length > SHOWN
        ? [
            ...heads.slice(0, SHOWN - 1),
            {
              name: `${heads.length - SHOWN + 1} other heads`,
              amount: heads.slice(SHOWN - 1).reduce((sum, h) => sum + h.amount, 0),
            },
          ]
        : heads;
    return { total, largest, unpaidCount, unpaidAmount, departmentShares, heads: headsShown };
  }, [filtered, departmentAccent]);

  /* ── worth a look, across the whole register ── */

  const flags = useMemo<RegisterFlag[]>(() => {
    const out: RegisterFlag[] = [];
    const tests = rows.filter(r => r.test);
    // Test entries are their own flag; they are left out of the rest.
    const real = rows.filter(r => !r.test);

    if (tests.length) {
      out.push({
        key: 'tests',
        accent: PALETTE.amber,
        icon: FlaskConical,
        title: `${tests.length} look${tests.length === 1 ? 's' : ''} like test entr${tests.length === 1 ? 'y' : 'ies'}`,
        detail: `${formatInr(sumOf(tests), 0)} — the project, party or description says "test"`,
        action: { label: hideTests ? 'Show them' : 'Hide them', onClick: () => setHideTests(value => !value) },
      });
    }

    if (!requisitionsUnavailable) {
      const cutoff = now.getTime() - 7 * DAY;
      const waiting = real.filter(r => r.stageGroup === 'not-received' && r.createdMs > 0 && r.createdMs < cutoff);
      if (waiting.length) {
        const oldest = Math.min(...waiting.map(r => r.createdMs));
        out.push({
          key: 'not-received',
          accent: PALETTE.cyan,
          icon: Inbox,
          title: `${plural(waiting.length, 'request')} not received by finance after a week`,
          detail: `${formatInr(sumOf(waiting), 0)} · oldest raised ${formatDistanceStrict(oldest, now)} ago`,
          action: {
            label: 'Show them',
            onClick: () => {
              setPeriod('all');
              setFilters(prev => ({ ...prev, stage: 'not-received' }));
            },
          },
        });
      }
    }

    const duplicates = possibleDuplicates(real);
    if (duplicates.length) {
      const [first] = duplicates;
      const party = (first[0].expense.partyName || '').trim();
      out.push({
        key: 'duplicates',
        accent: PALETTE.violet,
        icon: CopyCheck,
        title: duplicates.length === 1 ? 'Possible duplicate' : `${duplicates.length} possible duplicates`,
        detail: `${first.length} requests to ${party} for ${formatInr(first[0].amount)} within weeks of each other${
          duplicates.length > 1 ? `, and ${duplicates.length - 1} more like it` : ''
        }`,
        action: {
          label: 'Show',
          onClick: () => {
            setPeriod('all');
            setHideTests(false);
            setFilters({ ...EMPTY_FILTERS, partyName: party });
          },
        },
      });
    }

    if (!requisitionsUnavailable) {
      const review = real.filter(r => r.progress.stage === 'needs-review');
      if (review.length) {
        out.push({
          key: 'needs-review',
          accent: PALETTE.rose,
          icon: MessageSquareWarning,
          title: `${plural(review.length, 'request')} marked "Needs review"`,
          detail: `${formatInr(sumOf(review), 0)} · flagged in Daily Requisition`,
          action: { label: review.length === 1 ? 'Open it' : 'Open first', onClick: () => setDetailsExpense(review[0].expense) },
        });
      }
      const partPaid = real.filter(r => r.stageGroup === 'part-paid');
      if (partPaid.length) {
        out.push({
          key: 'part-paid',
          accent: PALETTE.emerald,
          icon: HandCoins,
          title: `${plural(partPaid.length, 'request')} part paid`,
          detail: `${formatInr(partPaid.reduce((sum, r) => sum + r.progress.balance, 0), 0)} balance still due`,
          action: {
            label: 'Show them',
            onClick: () => {
              setPeriod('all');
              setFilters(prev => ({ ...prev, stage: 'part-paid' }));
            },
          },
        });
      }
    }
    return out.slice(0, 4);
  }, [rows, hideTests, requisitionsUnavailable, now]);

  /* ── table layout ── */

  const visibleHeaders = useMemo(() => {
    const { order, visibility } = applyColumnSettings(settings.registers.all);
    return withProgressColumns(order, visibility);
  }, [settings]);
  const columns = useMemo(() => displayColumns(visibleHeaders), [visibleHeaders]);
  const maxAmount = Math.max(0, ...filtered.map(r => r.amount));

  const groups = useMemo(() => {
    if (groupBy === 'none') return null;
    const byKey = new Map<string, RegisterRow[]>();
    for (const row of sorted) {
      const key = groupBy === 'department' ? row.department : groupBy === 'project' ? row.project : row.stageGroup;
      const list = byKey.get(key);
      if (list) list.push(row);
      else byKey.set(key, [row]);
    }
    return [...byKey.entries()]
      .map(([key, list]) => ({
        key,
        label: groupBy === 'stage' ? STAGE_LABEL.get(key) ?? key : key,
        accent:
          groupBy === 'department'
            ? departmentAccent.get(key) ?? PALETTE.slate
            : groupBy === 'stage'
              ? TONE_ACCENT[STAGE_GROUP_TONE[key as StageGroup]]
              : PALETTE.teal,
        rows: list,
        total: sumOf(list),
      }))
      .sort((a, b) => b.total - a.total);
  }, [groupBy, sorted, departmentAccent]);

  const toggleSort = (column: string) =>
    setSort(prev =>
      prev.column === column
        ? { column, dir: prev.dir === 1 ? -1 : 1 }
        : { column, dir: DESCENDING_FIRST.has(column) ? -1 : 1 },
    );

  /* ── filters shown as pills ── */

  const pills: { key: string; label: string; accent: AccentPair; clear: () => void }[] = [];
  if (period !== 'all') pills.push({ key: 'period', label: periodLabel, accent: PALETTE.indigo, clear: () => setPeriod('all') });
  if (filters.requestNo) pills.push({ key: 'requestNo', label: `Request: ${filters.requestNo}`, accent: PALETTE.violet, clear: () => setFilter('requestNo', '') });
  if (filters.partyName) pills.push({ key: 'partyName', label: `Party: ${filters.partyName}`, accent: PALETTE.blue, clear: () => setFilter('partyName', '') });
  if (filters.projectName !== 'all') pills.push({ key: 'projectName', label: filters.projectName, accent: PALETTE.teal, clear: () => setFilter('projectName', 'all') });
  if (filters.departmentName !== 'all') pills.push({ key: 'departmentName', label: filters.departmentName, accent: accentOf(filters.departmentName), clear: () => setFilter('departmentName', 'all') });
  if (filters.stage !== 'all' && !requisitionsUnavailable) pills.push({ key: 'stage', label: STAGE_LABEL.get(filters.stage) ?? filters.stage, accent: PALETTE.amber, clear: () => setFilter('stage', 'all') });
  if (hideTests) pills.push({ key: 'hideTests', label: 'Test entries hidden', accent: PALETTE.slate, clear: () => setHideTests(false) });

  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setHideTests(false);
    setPeriod('all');
  };

  /* ── export ── */

  const exportCsv = () => {
    const header = visibleHeaders.flatMap(column => (column === 'Paid / Balance' ? ['Paid', 'Balance'] : [column]));
    const lines = [
      header.map(csvCell).join(','),
      ...sorted.map(row =>
        visibleHeaders.flatMap(column => exportCells(column, row, requisitionsUnavailable)).map(csvCell).join(','),
      ),
    ];
    const fileName = `consolidated-expenses-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    // The byte-order mark makes Excel read the file as UTF-8 (₹, names in other scripts).
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast({ title: 'Exported', description: `${plural(sorted.length, 'request')} saved to ${fileName}.` });
  };

  /* ── loading and access ── */

  if (isAuthLoading || (canViewPage && isLoading)) {
    return (
      <div className="w-full space-y-3.5">
        <Skeleton className="h-[184px] w-full rounded-[22px]" />
        <div className="grid gap-3.5 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-[18px]" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-[18px]" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full">
        <PageHeader icon={Layers} title="Consolidated Expenses" backHref="/expenses" />
        <Card className="border-destructive/30">
          <CardHeader className="pb-2 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this page.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  /* ── the register's rows ── */

  const renderCell = (column: string, row: RegisterRow) => {
    const e = row.expense;
    switch (column) {
      case 'Request No': {
        // "SEL/EXP/IT/2026-27/0004" reads as "IT/2026-27/0004" with the series prefix under it.
        const no = e.requestNo || '—';
        const parts = no.split('/');
        const [main, prefix] = parts.length > 3 ? [parts.slice(2).join('/'), parts.slice(0, 2).join('/')] : [no, ''];
        // The row as a whole opens the details; this button is the keyboard's way in, so the
        // row keeps its table semantics.
        return (
          <button
            type="button"
            className={cx.reqNo}
            onClick={() => setDetailsExpense(e)}
            aria-label={`View full details of expense request ${e.requestNo}`}
          >
            {main}
            {prefix && <small>{prefix}</small>}
          </button>
        );
      }
      case 'Timestamp': {
        if (!e.createdAt) return <span className={cx.muted}>—</span>;
        const [day, time] = formatExpenseTimestamp(e.createdAt).split(', ');
        return (
          <div className={cx.stacked}>
            <b>{day}</b>
            {time && <small>{time}</small>}
          </div>
        );
      }
      case 'Department':
        return (
          <span className={cx.dchip}>
            <i aria-hidden="true" />
            {row.department}
          </span>
        );
      case 'Project Name':
        return (
          <>
            <span className={cx.strong}>{row.project}</span>
            {row.test && (
              <span className={cx.testTag} title="Looks like a test entry">
                TEST?
              </span>
            )}
          </>
        );
      case 'Amount':
        return (
          <div className={cn(cx.amt, cx.num)}>
            {formatInr(row.amount)}
            <div className={cx.amtBar} aria-hidden="true">
              <i style={{ width: `${maxAmount > 0 ? (Math.max(0, row.amount) / maxAmount) * 100 : 0}%` }} />
            </div>
          </div>
        );
      case HEAD_PAIR:
        return (
          <div className={cx.stacked}>
            <b>{e.subHeadOfAccount || '—'}</b>
            <small>{e.headOfAccount || '—'}</small>
          </div>
        );
      case 'Head of A/c':
        return e.headOfAccount || <span className={cx.muted}>—</span>;
      case 'Sub-Head of A/c':
        return e.subHeadOfAccount || <span className={cx.muted}>—</span>;
      case 'Remarks':
        return <RemarksCell remarks={e.remarks} />;
      case 'Description':
        return (
          <span className={cx.desc} title={e.description}>
            {e.description || '—'}
          </span>
        );
      case 'Name of the party':
        return <span className={cx.strong}>{e.partyName || '—'}</span>;
      case 'Reception No':
        return receptionOf(e, row.requisition).receptionNo || <span className={cx.muted}>—</span>;
      case 'Reception Date':
        return formatReceptionDate(receptionOf(e, row.requisition).receptionDate);
      case 'Stage':
        return <StageChip row={row} unavailable={requisitionsUnavailable} />;
      case 'Paid / Balance':
        return <PaidBalanceCell requisition={row.requisition} unavailable={requisitionsUnavailable} />;
      default:
        return '';
    }
  };

  const renderRow = (row: RegisterRow) => (
    <tr
      key={row.expense.id}
      className={cx.row}
      style={{ '--dc': accentOf(row.department)[1] } as CSSProperties}
      onClick={() => setDetailsExpense(row.expense)}
    >
      {columns.map(column => (
        <td key={column} className={cn(RIGHT_ALIGNED.has(column) && cx.right)}>
          {renderCell(column, row)}
        </td>
      ))}
    </tr>
  );

  const amountIndex = columns.indexOf('Amount');
  const totalLabelIndex = amountIndex === 0 ? 1 : 0;
  const departmentsInView = figures.departmentShares;
  const sortNote =
    sort.column === 'Timestamp'
      ? sort.dir === -1
        ? 'Newest first'
        : 'Oldest first'
      : `Sorted by ${sort.column}, ${sort.dir === 1 ? 'ascending' : 'descending'}`;

  return (
    <div className={cx.scope}>
      {/* ── hero ── */}
      <section className={cx.hero}>
        <div className={cx.heroTop}>
          <div className={cx.heroTitleBlock}>
            <Link href="/expenses" className={cx.back} aria-label="Back to Expenses" title="Back">
              <ArrowLeft aria-hidden="true" />
            </Link>
            <span className={cx.logo} aria-hidden="true">
              <Layers />
            </span>
            <div className="min-w-0">
              <p className={cx.eyebrow}>Expenses · All departments</p>
              <h1 className={cx.title}>Consolidated Expenses</h1>
              <p className={cx.subtitle}>
                All departments combined · {plural(filtered.length, 'request')} · {formatInr(figures.total, 0)}
              </p>
            </div>
          </div>
          <div className={cx.heroActions}>
            <Segmented
              hero
              label="Period"
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'week', label: 'This week' },
                { value: 'month', label: format(now, 'MMMM') },
                { value: 'all', label: 'All' },
              ]}
            />
            <button type="button" className={cx.heroBtn} onClick={exportCsv} disabled={!sorted.length}>
              <Download aria-hidden="true" />
              Export
            </button>
            {canConfigure && (
              <Link
                href="/expenses/settings/field-control"
                className={cn(cx.heroBtn, cx.heroBtnSolid)}
                title="Which columns show, and in what order — Expenses › Settings"
              >
                <SlidersHorizontal aria-hidden="true" />
                Columns
              </Link>
            )}
          </div>
        </div>

        {/* Whole rupees up here; the rows carry the paise. */}
        <div className={cx.kpis}>
          <KpiTile
            icon={FileText}
            accent={PALETTE.blue}
            label="Total requests"
            value={filtered.length}
            note={filtered.length !== rows.length ? `of ${rows.length} in the register` : 'in the register'}
          />
          <KpiTile
            icon={IndianRupee}
            accent={PALETTE.emerald}
            label="Total amount"
            value={formatInr(figures.total, 0)}
            note={filtered.length ? `across ${plural(departmentsInView.length, 'department')}` : '—'}
          />
          <KpiTile
            icon={Building2}
            accent={PALETTE.violet}
            label="Departments"
            value={departmentsInView.length}
            note={departmentsInView.map(d => d.code).join(' · ') || '—'}
          />
          <KpiTile
            icon={TrendingUp}
            accent={PALETTE.amber}
            label="Avg per request"
            value={filtered.length ? formatInr(figures.total / filtered.length, 0) : '—'}
            note={filtered.length ? `largest ${formatInr(figures.largest, 0)}` : '—'}
          />
          <KpiTile
            icon={Hourglass}
            accent={PALETTE.rose}
            label="Not yet paid"
            value={requisitionsUnavailable ? '—' : figures.unpaidCount}
            note={
              requisitionsUnavailable
                ? 'Daily Requisition unavailable'
                : !filtered.length
                  ? '—'
                  : figures.unpaidCount
                    ? `${formatInr(figures.unpaidAmount, 0)} still to pay`
                    : 'all settled'
            }
          />
        </div>
      </section>

      {/* ── insights ── */}
      <div className={cx.insights}>
        <ByDepartmentCard
          items={departmentsInView}
          total={figures.total}
          selected={filters.departmentName}
          onSelect={name => setFilter('departmentName', filters.departmentName === name ? 'all' : name)}
        />
        <ByHeadCard items={figures.heads} />
        <WorthALookCard flags={flags} />
      </div>

      {/* ── register ── */}
      <section className={cx.card}>
        <div className={cx.cardHead}>
          <span className={cx.cardIcon} style={accentVars(PALETTE.blue)} aria-hidden="true">
            <List />
          </span>
          <div className={cx.cardTitleBlock}>
            <h2 className={cx.cardTitle}>
              Expense requests
              <span className={cx.countChip}>
                {sorted.length !== rows.length ? `${sorted.length} of ${rows.length}` : plural(rows.length, 'request')}
              </span>
            </h2>
            <p className={cx.cardNote}>{sortNote} · click a row for details</p>
          </div>
          <span className={cx.spacer} />
          <span className={cx.groupLabel}>Group by</span>
          <Segmented
            label="Group by"
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: 'none', label: 'None' },
              { value: 'department', label: 'Department' },
              { value: 'project', label: 'Project' },
              { value: 'stage', label: 'Stage', disabled: requisitionsUnavailable },
            ]}
          />
        </div>

        <div className={cx.filters}>
          <label className={cx.search} style={accentVars(PALETTE.violet)}>
            <Search aria-hidden="true" />
            <input
              value={filters.requestNo}
              onChange={event => setFilter('requestNo', event.target.value)}
              placeholder="Search request no…"
              aria-label="Search request no"
            />
          </label>
          <label className={cx.search} style={accentVars(PALETTE.blue)}>
            <UserRound aria-hidden="true" />
            <input
              value={filters.partyName}
              onChange={event => setFilter('partyName', event.target.value)}
              placeholder="Search party name…"
              aria-label="Search party name"
            />
          </label>
          <Select value={filters.projectName} onValueChange={value => setFilter('projectName', value)}>
            <SelectTrigger
              aria-label="Project"
              className={cn(cx.sel, filters.projectName !== 'all' && cx.selSet)}
              style={accentVars(PALETTE.teal)}
            >
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projectOptions.map(name => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.departmentName} onValueChange={value => setFilter('departmentName', value)}>
            <SelectTrigger
              aria-label="Department"
              className={cn(cx.sel, filters.departmentName !== 'all' && cx.selSet)}
              style={accentVars(PALETTE.violet)}
            >
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departmentOptions.map(name => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.stage}
            onValueChange={value => setFilter('stage', value as StageFilter)}
            disabled={requisitionsUnavailable}
          >
            <SelectTrigger
              aria-label="Stage"
              className={cn(cx.sel, filters.stage !== 'all' && cx.selSet)}
              style={accentVars(PALETTE.amber)}
            >
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              {STAGE_FILTERS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className={cx.spacer} />
          <label className={cx.check}>
            <input type="checkbox" checked={hideTests} onChange={event => setHideTests(event.target.checked)} />
            Hide test entries
          </label>
        </div>

        {pills.length > 0 && (
          <div className={cx.pills}>
            {pills.map(pill => (
              <span key={pill.key} className={cx.pill} style={accentVars(pill.accent)}>
                <span>{pill.label}</span>
                <button type="button" className={cx.pillX} onClick={pill.clear} aria-label={`Remove filter: ${pill.label}`}>
                  <X aria-hidden="true" />
                </button>
              </span>
            ))}
            <button type="button" className={cx.plainBtn} onClick={clearAll}>
              Clear all
            </button>
          </div>
        )}

        {requisitionsUnavailable && (
          <p className={cx.unavailable}>Stage and payments could not be loaded from Daily Requisition.</p>
        )}

        <div className={cx.tableBox}>
          <table className={cx.table}>
            <thead>
              <tr>
                {columns.map(column => {
                  const on = sort.column === column;
                  const SortIcon = on ? (sort.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
                  return (
                    <th
                      key={column}
                      scope="col"
                      className={cn(RIGHT_ALIGNED.has(column) && cx.right, on && cx.thOn)}
                      aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" className={cx.thBtn} onClick={() => toggleSort(column)}>
                        {column}
                        <SortIcon aria-hidden="true" />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr className={cx.emptyRow}>
                  <td colSpan={columns.length}>
                    <Receipt aria-hidden="true" />
                    <p>{rows.length ? 'No requests match these filters.' : 'No expense requests yet.'}</p>
                    {pills.length > 0 && (
                      <button type="button" className={cx.plainBtn} onClick={clearAll}>
                        Clear filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : groups ? (
                groups.map(group => (
                  <Fragment key={group.key}>
                    <tr className={cx.groupRow} style={{ '--dc': group.accent[1] } as CSSProperties}>
                      <td colSpan={columns.length}>
                        {group.label}
                        <small>
                          {plural(group.rows.length, 'request')} · {formatInr(group.total)}
                        </small>
                      </td>
                    </tr>
                    {group.rows.map(renderRow)}
                  </Fragment>
                ))
              ) : (
                sorted.map(renderRow)
              )}
            </tbody>
            {sorted.length > 0 && (
              <tfoot>
                <tr>
                  {columns.map((column, i) =>
                    i === amountIndex ? (
                      <td key={column} className={cn(cx.right, cx.num, cx.totalAmt)}>
                        {formatInr(figures.total)}
                      </td>
                    ) : i === totalLabelIndex ? (
                      <td key={column}>Total · {plural(sorted.length, 'request')}</td>
                    ) : (
                      <td key={column} />
                    ),
                  )}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className={cx.foot}>
          <span>
            Showing {sorted.length} of {rows.length} · {plural(visibleHeaders.length, 'column')}
          </span>
          <span className={cx.spacer} />
          <span>
            Columns follow Expenses › Settings
            {canConfigure && (
              <>
                {' · '}
                <Link href="/expenses/settings/field-control">Change</Link>
              </>
            )}
          </span>
        </div>
      </section>

      <ExpenseDetailsDialog
        expense={detailsExpense}
        projectName={detailsExpense ? projectNameOf(detailsExpense.projectId) : ''}
        requisition={detailsExpense ? requisitionOf(requisitionByRequestNo, detailsExpense) : undefined}
        requisitionsUnavailable={requisitionsUnavailable}
        open={!!detailsExpense}
        onOpenChange={open => { if (!open) setDetailsExpense(null); }}
      />
    </div>
  );
}
