/**
 * The Daily Requisition dashboard's figures, worked out from the requisitions themselves.
 *
 * Pure (no imports) so it runs under plain node for tests. The page turns each Firestore entry into
 * a `DashboardRow` first — reading dates as local `YYYY-MM-DD` keys, and paid / still-due through
 * `paidOf` / `balanceOf` (src/lib/requisition-progress.ts) — so these figures always agree with the
 * reports and the Entry Sheet.
 */

/** Where a requisition is in the workflow, by its status. */
export type DashboardStage = 'receiving' | 'verification' | 'payment' | 'paid' | 'cancelled';

/** The open stages, in workflow order (the three queues on the module's stage pages). */
export const OPEN_STAGES = ['receiving', 'verification', 'payment'] as const;
export type OpenStage = (typeof OPEN_STAGES)[number];

/**
 * Mirrors the stage pages' queues (`STAGE_OPEN_STATUSES` on the old landing page and `getStepConfig`
 * in `[step]/page.tsx`): Pending waits at receiving; Received, Verified and Needs Review at GST & TDS
 * verification; Received for Payment and Partially Paid at payment.
 */
export function stageOfStatus(status: string | undefined | null): DashboardStage {
  switch ((status || 'Pending').trim()) {
    case 'Pending':
      return 'receiving';
    case 'Received':
    case 'Verified':
    case 'Needs Review':
      return 'verification';
    case 'Received for Payment':
    case 'Partially Paid':
      return 'payment';
    case 'Paid':
      return 'paid';
    case 'Cancelled':
      return 'cancelled';
    default:
      return 'receiving';
  }
}

/** Money paid against a requisition on a day (a voucher line, or a hand-marked payment). */
export interface PaidEvent {
  dateKey: string;
  amount: number;
}

export interface DashboardRow {
  id: string;
  receptionNo: string;
  /** The expense request it was received from, or blank. */
  depNo: string;
  partyName: string;
  description: string;
  departmentId: string;
  projectId: string;
  status: string;
  documentStatus: string;
  gross: number;
  net: number;
  /** paidOf(entry). */
  paid: number;
  /** balanceOf(entry). */
  balance: number;
  /** The reception date, `YYYY-MM-DD`; blank when unreadable. */
  dateKey: string;
  /** When it was keyed, epoch ms (0 when unknown) — orders "recent". */
  createdMs: number;
  paidEvents: PaidEvent[];
}

export type DashboardPeriod =
  | 'today'
  | 'this-week'
  | 'this-month'
  | 'last-month'
  | 'last-30'
  | 'last-90'
  | 'this-fy'
  | 'last-fy'
  | 'all'
  | 'custom';

export const DASHBOARD_PERIODS: ReadonlyArray<{ value: DashboardPeriod; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'this-week', label: 'This week' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-30', label: 'Last 30 days' },
  { value: 'last-90', label: 'Last 90 days' },
  { value: 'this-fy', label: 'This financial year' },
  { value: 'last-fy', label: 'Last financial year' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range…' },
];

/* ── dates as keys ──────────────────────────────────────────────────────────────────────────── */

const pad2 = (n: number) => String(n).padStart(2, '0');
const keyOfUtc = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const utcOfKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
};
const isKey = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(key);

/** Whole days from `fromKey` to `toKey` (negative when `toKey` is earlier). */
export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((utcOfKey(toKey) - utcOfKey(fromKey)) / 86_400_000);
}

export function shiftKey(key: string, days: number): string {
  return keyOfUtc(new Date(utcOfKey(key) + days * 86_400_000));
}

/** The Indian financial year (April – March) a day falls in, by its first day. */
export function financialYearStart(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** The last day of the month a day falls in. */
export function monthEnd(key: string): string {
  const [y, m] = key.split('-').map(Number);
  // Day 0 of the next month is the last day of this one.
  return `${y}-${pad2(m)}-${pad2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** The first day of the month `delta` months from the one `key` falls in. */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}-01`;
}

/** The Monday of the week a day falls in. */
export function weekStart(key: string): string {
  const day = new Date(utcOfKey(key)).getUTCDay();
  return shiftKey(key, -((day + 6) % 7));
}

/**
 * The days a period covers, both ends inclusive. `from` is blank for "All time", and `to` is the
 * period's own last day — for a closed period (last month, last financial year) that is before today.
 */
export function periodRange(
  period: DashboardPeriod,
  todayKey: string,
  custom?: { from: string; to: string },
): { from: string; to: string } {
  switch (period) {
    case 'today':
      return { from: todayKey, to: todayKey };
    case 'this-week':
      return { from: weekStart(todayKey), to: todayKey };
    case 'this-month':
      return { from: `${todayKey.slice(0, 7)}-01`, to: todayKey };
    case 'last-month': {
      const start = shiftMonth(todayKey, -1);
      return { from: start, to: monthEnd(start) };
    }
    case 'last-30':
      return { from: shiftKey(todayKey, -29), to: todayKey };
    case 'last-90':
      return { from: shiftKey(todayKey, -89), to: todayKey };
    case 'this-fy':
      return { from: financialYearStart(todayKey), to: todayKey };
    case 'last-fy': {
      const thisFy = financialYearStart(todayKey);
      return { from: shiftMonth(thisFy, -12), to: shiftKey(thisFy, -1) };
    }
    case 'custom': {
      // Either end may be left empty, and a back-to-front range is read the way round it makes sense.
      const from = custom?.from && isKey(custom.from) ? custom.from : '';
      const to = custom?.to && isKey(custom.to) ? custom.to : todayKey;
      return from && from > to ? { from: to, to: from } : { from, to };
    }
    default:
      return { from: '', to: todayKey };
  }
}

/** A period's days as a label: "1 – 30 Sep 2026", "Sep 2026", "All time". */
export function describePeriod(range: { from: string; to: string }): string {
  if (!range.from) return 'All time';
  const day = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return { y, m: MONTHS[m - 1], d };
  };
  const a = day(range.from);
  const b = day(range.to);
  if (range.from === range.to) return `${a.d} ${a.m} ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${a.d} – ${b.d} ${b.m} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`;
  return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
}

/* ── which requisitions count ───────────────────────────────────────────────────────────────── */

export interface DashboardFilters {
  /** A department id, or '' for every department. */
  departmentId: string;
  projectId: string;
  /** Matched against reception no, DEP no, party and description. */
  search: string;
  /** A document status, or '' for any. */
  documentStatus: string;
  /** Only requisitions whose gross or net reaches this; 0 for any. */
  minAmount: number;
  /** Only requisitions with money still due. */
  dueOnly: boolean;
}

export const NO_FILTERS: DashboardFilters = {
  departmentId: '',
  projectId: '',
  search: '',
  documentStatus: '',
  minAmount: 0,
  dueOnly: false,
};

/** How many filters are set, for the filter bar's count (the period is counted separately). */
export function activeFilterCount(filters: DashboardFilters): number {
  return (
    (filters.departmentId ? 1 : 0) +
    (filters.projectId ? 1 : 0) +
    (filters.documentStatus ? 1 : 0) +
    (filters.minAmount > 0 ? 1 : 0) +
    (filters.dueOnly ? 1 : 0)
  );
}

/**
 * The requisitions a filter set allows. The period is not applied here — it decides which days the
 * "received" and "paid out" figures cover, while open work is counted whenever it came in.
 */
export function filterRows(rows: readonly DashboardRow[], filters: DashboardFilters): DashboardRow[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.departmentId && row.departmentId !== filters.departmentId) return false;
    if (filters.projectId && row.projectId !== filters.projectId) return false;
    if (filters.documentStatus && (row.documentStatus || 'Pending') !== filters.documentStatus) return false;
    if (filters.minAmount > 0 && Math.max(row.gross, row.net) < filters.minAmount) return false;
    if (filters.dueOnly && !(row.balance > 0)) return false;
    if (needle) {
      const haystack = `${row.receptionNo} ${row.depNo} ${row.partyName} ${row.description}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

const within = (key: string, range: { from: string; to: string }) =>
  isKey(key) && (!range.from || key >= range.from) && key <= range.to;

/* ── the figures ────────────────────────────────────────────────────────────────────────────── */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface StageFigure {
  stage: OpenStage;
  count: number;
  /** What is still due on them. */
  balance: number;
  /** Days the oldest has waited since its reception date; null when none are dated. */
  oldestDays: number | null;
}

export interface AgeingBucket {
  label: string;
  /** Inclusive lower bound in days; the last bucket has no upper bound. */
  minDays: number;
  maxDays: number | null;
  count: number;
  balance: number;
}

export interface MonthPoint {
  /** `YYYY-MM`. */
  key: string;
  /** "Sep 26". */
  label: string;
  /** Net amount of requisitions received (by reception date) that month, cancelled ones left out. */
  received: number;
  receivedCount: number;
  /** Money paid out that month, up to today. */
  paid: number;
}

export interface GroupFigure {
  key: string;
  count: number;
  balance: number;
  oldestDays: number | null;
}

export interface DashboardFigures {
  open: { count: number; net: number; balance: number };
  stages: StageFigure[];
  /** Received in the period (by reception date), cancelled ones left out. */
  received: { count: number; gross: number; net: number };
  /** Paid out in the period (by payment date, up to today). */
  paidOut: { amount: number; requisitions: number };
  cancelled: { count: number };
  /** Open requisitions by how long they have waited since their reception date. */
  ageing: AgeingBucket[];
  monthly: MonthPoint[];
  /** Still-due by department, largest first. */
  byDepartment: GroupFigure[];
  /** Still-due by party, largest first. */
  byParty: GroupFigure[];
  /** Document status of every requisition not cancelled. */
  documents: Record<'Pending' | 'Uploaded' | 'Missing' | 'Not Required', number>;
  /** Paid out after today (post-dated cheques), left out of the monthly bars. */
  paidAhead: { amount: number; count: number };
  /** The days the period figures cover. */
  range: { from: string; to: string };
}

export const AGEING_BUCKETS: ReadonlyArray<Pick<AgeingBucket, 'label' | 'minDays' | 'maxDays'>> = [
  { label: '0–7 days', minDays: 0, maxDays: 7 },
  { label: '8–15 days', minDays: 8, maxDays: 15 },
  { label: '16–30 days', minDays: 16, maxDays: 30 },
  { label: '31–60 days', minDays: 31, maxDays: 60 },
  { label: '60+ days', minDays: 61, maxDays: null },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The `count` months ending with today's, oldest first. */
export function lastMonths(todayKey: string, count: number): Array<Pick<MonthPoint, 'key' | 'label'>> {
  const [y, m] = todayKey.split('-').map(Number);
  const out: Array<Pick<MonthPoint, 'key' | 'label'>> = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const index = y * 12 + (m - 1) - back;
    const year = Math.floor(index / 12);
    const month = index % 12;
    out.push({ key: `${year}-${pad2(month + 1)}`, label: `${MONTHS[month]} ${String(year).slice(2)}` });
  }
  return out;
}

function addGroup(map: Map<string, GroupFigure>, key: string, balance: number, age: number | null) {
  const group = map.get(key) ?? { key, count: 0, balance: 0, oldestDays: null };
  group.count += 1;
  group.balance = round2(group.balance + balance);
  if (age !== null && (group.oldestDays === null || age > group.oldestDays)) group.oldestDays = age;
  map.set(key, group);
}

const byBalance = (a: GroupFigure, b: GroupFigure) => b.balance - a.balance || b.count - a.count || a.key.localeCompare(b.key);

export function buildDashboard(
  rows: readonly DashboardRow[],
  options: { todayKey: string; period: DashboardPeriod; custom?: { from: string; to: string }; months?: number },
): DashboardFigures {
  const { todayKey } = options;
  const range = periodRange(options.period, todayKey, options.custom);
  const months = lastMonths(todayKey, options.months ?? 12);
  const monthIndex = new Map(months.map((month, index) => [month.key, index]));
  const monthly: MonthPoint[] = months.map((month) => ({ ...month, received: 0, receivedCount: 0, paid: 0 }));

  const stages = new Map<OpenStage, StageFigure>(
    OPEN_STAGES.map((stage) => [stage, { stage, count: 0, balance: 0, oldestDays: null }]),
  );
  const ageing: AgeingBucket[] = AGEING_BUCKETS.map((bucket) => ({ ...bucket, count: 0, balance: 0 }));
  const departments = new Map<string, GroupFigure>();
  const parties = new Map<string, GroupFigure>();
  const documents = { Pending: 0, Uploaded: 0, Missing: 0, 'Not Required': 0 };
  const paidRequisitions = new Set<string>();

  const figures: DashboardFigures = {
    open: { count: 0, net: 0, balance: 0 },
    stages: [],
    received: { count: 0, gross: 0, net: 0 },
    paidOut: { amount: 0, requisitions: 0 },
    cancelled: { count: 0 },
    ageing,
    monthly,
    byDepartment: [],
    byParty: [],
    documents,
    paidAhead: { amount: 0, count: 0 },
    range,
  };

  for (const row of rows) {
    const stage = stageOfStatus(row.status);
    const dated = isKey(row.dateKey);
    const age = dated ? Math.max(0, daysBetween(row.dateKey, todayKey)) : null;

    if (stage === 'cancelled') {
      if (within(row.dateKey, range)) figures.cancelled.count += 1;
      continue;
    }

    // Received: by reception date.
    if (within(row.dateKey, range)) {
      figures.received.count += 1;
      figures.received.gross = round2(figures.received.gross + row.gross);
      figures.received.net = round2(figures.received.net + row.net);
    }
    const receivedMonth = dated ? monthIndex.get(row.dateKey.slice(0, 7)) : undefined;
    if (receivedMonth !== undefined) {
      monthly[receivedMonth].received = round2(monthly[receivedMonth].received + row.net);
      monthly[receivedMonth].receivedCount += 1;
    }

    // Paid out: by payment date, never ahead of today.
    for (const event of row.paidEvents) {
      if (!isKey(event.dateKey) || !(event.amount > 0)) continue;
      if (event.dateKey > todayKey) {
        figures.paidAhead.amount = round2(figures.paidAhead.amount + event.amount);
        figures.paidAhead.count += 1;
        continue;
      }
      if (within(event.dateKey, range)) {
        figures.paidOut.amount = round2(figures.paidOut.amount + event.amount);
        paidRequisitions.add(row.id);
      }
      const paidMonth = monthIndex.get(event.dateKey.slice(0, 7));
      if (paidMonth !== undefined) monthly[paidMonth].paid = round2(monthly[paidMonth].paid + event.amount);
    }

    const docStatus = row.documentStatus as keyof typeof documents;
    if (docStatus in documents) documents[docStatus] += 1;
    else documents.Pending += 1;

    if (stage === 'paid') continue;

    // Open: everything still in a workflow queue.
    figures.open.count += 1;
    figures.open.net = round2(figures.open.net + row.net);
    figures.open.balance = round2(figures.open.balance + row.balance);

    const figure = stages.get(stage)!;
    figure.count += 1;
    figure.balance = round2(figure.balance + row.balance);
    if (age !== null && (figure.oldestDays === null || age > figure.oldestDays)) figure.oldestDays = age;

    if (age !== null) {
      const bucket = ageing.find((b) => age >= b.minDays && (b.maxDays === null || age <= b.maxDays));
      if (bucket) {
        bucket.count += 1;
        bucket.balance = round2(bucket.balance + row.balance);
      }
    }

    addGroup(departments, row.departmentId || '', row.balance, age);
    addGroup(parties, (row.partyName || '').trim() || '—', row.balance, age);
  }

  figures.stages = OPEN_STAGES.map((stage) => stages.get(stage)!);
  figures.paidOut.requisitions = paidRequisitions.size;
  figures.byDepartment = [...departments.values()].sort(byBalance);
  figures.byParty = [...parties.values()].sort(byBalance);
  return figures;
}

/** The first `limit` groups, the rest folded into one "Other" group (key `''` stays its own). */
export function topWithOther(groups: readonly GroupFigure[], limit: number, otherKey = '__other__'): GroupFigure[] {
  if (groups.length <= limit) return [...groups];
  const head = groups.slice(0, limit);
  const rest = groups.slice(limit);
  const other: GroupFigure = { key: otherKey, count: 0, balance: 0, oldestDays: null };
  for (const group of rest) {
    other.count += group.count;
    other.balance = round2(other.balance + group.balance);
    if (group.oldestDays !== null && (other.oldestDays === null || group.oldestDays > other.oldestDays)) other.oldestDays = group.oldestDays;
  }
  return [...head, other];
}
