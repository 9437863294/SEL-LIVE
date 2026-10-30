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
 * Where a requisition's *next* action is, which is how the pipeline reads: Pending waits at
 * receiving; Received, Verified and Needs Review at GST & TDS verification; Received for Payment and
 * Partially Paid at payment.
 *
 * This is deliberately narrower than what each stage page lists. `getStepConfig` in `[step]/page.tsx`
 * also shows a stage the statuses it has finished with — Receiving at Finance keeps Received and
 * Cancelled on their own tabs — so a stage page's total is not this count and must not be compared
 * to it. Both are position-based on the configured workflow, so a reordered workflow moves both.
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
  | 'this-quarter'
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
  { value: 'this-quarter', label: 'This quarter' },
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
    case 'this-quarter': {
      // Financial-year quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar. None crosses a calendar year.
      const [y, m] = todayKey.split('-').map(Number);
      return { from: `${y}-${pad2(m - (((m + 8) % 12) % 3))}-01`, to: todayKey };
    }
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

/* ── the overview: how long work waits, how it flows, what needs fixing ──────────────────────── */

/**
 * The days just before a period, to compare it with: for a month so far, the same days of the month
 * before ("1 – 30 Oct" against "1 – 30 Sep"), the whole of it for a whole month; otherwise as many
 * days again. Null for all time, which has nothing before it.
 */
export function previousRange(range: { from: string; to: string }): { from: string; to: string } | null {
  if (!range.from || !isKey(range.from) || !isKey(range.to)) return null;
  if (range.from !== range.to && range.from.endsWith('-01') && range.from.slice(0, 7) === range.to.slice(0, 7)) {
    const start = shiftMonth(range.from, -1);
    const end = monthEnd(start);
    if (range.to === monthEnd(range.from)) return { from: start, to: end };
    const sameDay = `${start.slice(0, 8)}${range.to.slice(8)}`;
    return { from: start, to: sameDay > end ? end : sameDay };
  }
  const length = daysBetween(range.from, range.to) + 1;
  return { from: shiftKey(range.from, -length), to: shiftKey(range.from, -1) };
}

/** How long an open requisition has waited since its reception date, in the overview's four bands. */
export const WAIT_BANDS = [
  { key: 'fresh', label: '0–15 d', minDays: 0, maxDays: 15 },
  { key: 'late', label: '16–60 d', minDays: 16, maxDays: 60 },
  { key: 'old', label: '61–180 d', minDays: 61, maxDays: 180 },
  { key: 'stale', label: '> 180 d', minDays: 181, maxDays: null },
] as const;
export type WaitBandKey = (typeof WAIT_BANDS)[number]['key'];

/** Past this many days an open requisition counts as overdue. No stage has an SLA of its own to read. */
export const OVERDUE_DAYS = 15;
/** Past this many days open work is backlog, and the overview says so before anything else. */
export const BACKLOG_DAYS = 180;

export interface BandFigure {
  key: WaitBandKey;
  label: string;
  count: number;
  balance: number;
}

export interface StageProfile {
  stage: OpenStage;
  count: number;
  balance: number;
  /** How the dated ones in this queue have waited. */
  bands: BandFigure[];
  medianDays: number | null;
  oldestDays: number | null;
  /** Waiting more than OVERDUE_DAYS. */
  overdue: number;
}

export interface WeekPoint {
  /** The Monday the week starts on. */
  start: string;
  /** Requisitions received that week, by reception date, cancelled ones left out. */
  received: number;
  /** Requisitions settled that week: Paid, with their last payment that week. */
  settled: number;
  /** Money paid out that week. */
  paid: number;
  /** Average days from reception to the last payment, of those settled that week. */
  cycleDays: number | null;
}

export interface QualityFigures {
  /** Open requisitions whose documents are marked Missing. */
  missingDocuments: number;
  /** Open requisitions whose documents are still Pending. */
  pendingDocuments: number;
  noProject: number;
  noDepartment: number;
  /** Open requisitions with no readable reception date — they age nowhere. */
  undated: number;
  netAboveGross: number;
  /** Requisitions (not cancelled) with the same party and amount as another within 7 days. */
  possibleDuplicates: number;
}

export interface OverviewFigures {
  stages: StageProfile[];
  /** Every dated open requisition, by how long it has waited. */
  bands: BandFigure[];
  overdue: { count: number; balance: number };
  /** Open more than BACKLOG_DAYS, and the queue that holds the most of it. */
  backlog: { count: number; balance: number; stage: OpenStage | null; stageCount: number };
  /** Settled in the period: Paid, with the last payment in it. */
  settled: { count: number; avgCycleDays: number | null };
  /** The latest payment up to today. */
  lastPaidKey: string | null;
  /** Still-due by project, largest first. */
  byProject: GroupFigure[];
  /** What was still owed at the end of each of the last 12 months (`lastMonths` order); the last is today. */
  backlogByMonth: number[];
  /** The last 12 weeks, oldest first, this one last. */
  weekly: WeekPoint[];
  quality: QualityFigures;
}

const medianOf = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const emptyBands = (): BandFigure[] => WAIT_BANDS.map((band) => ({ key: band.key, label: band.label, count: 0, balance: 0 }));

const bandOf = (age: number) => WAIT_BANDS.find((band) => age >= band.minDays && (band.maxDays === null || age <= band.maxDays)) ?? WAIT_BANDS[WAIT_BANDS.length - 1];

const addToBand = (bands: BandFigure[], key: WaitBandKey, balance: number) => {
  const band = bands.find((b) => b.key === key);
  if (!band) return;
  band.count += 1;
  band.balance = round2(band.balance + balance);
};

/**
 * The overview's figures beyond `buildDashboard`: each queue's wait profile, the backlog, how fast
 * work settles, the open amount month by month, the weekly flow and what needs fixing. Like
 * `buildDashboard` it reads the rows the filters allow; only "settled" reads the period.
 */
export function buildOverview(
  rows: readonly DashboardRow[],
  options: { todayKey: string; range: { from: string; to: string } },
): OverviewFigures {
  const { todayKey, range } = options;

  const months = lastMonths(todayKey, 12);
  const monthEnds = months.map((month) => {
    const end = monthEnd(`${month.key}-01`);
    return end > todayKey ? todayKey : end;
  });
  const backlogByMonth = months.map(() => 0);

  const thisWeek = weekStart(todayKey);
  const weekly: WeekPoint[] = Array.from({ length: 12 }, (_, index) => ({
    start: shiftKey(thisWeek, -7 * (11 - index)),
    received: 0,
    settled: 0,
    paid: 0,
    cycleDays: null,
  }));
  const weekIndex = new Map(weekly.map((week, index) => [week.start, index]));
  const weekCycles = weekly.map(() => ({ sum: 0, count: 0 }));

  const stages = new Map<OpenStage, StageProfile>(
    OPEN_STAGES.map((stage) => [stage, { stage, count: 0, balance: 0, bands: emptyBands(), medianDays: null, oldestDays: null, overdue: 0 }]),
  );
  const stageAges = new Map<OpenStage, number[]>(OPEN_STAGES.map((stage) => [stage, []]));
  const bands = emptyBands();
  const overdue = { count: 0, balance: 0 };
  const backlog = { count: 0, balance: 0 };
  const backlogByStage = new Map<OpenStage, number>();
  const settled = { count: 0, cycleSum: 0, cycled: 0 };
  let lastPaidKey: string | null = null;
  const projects = new Map<string, GroupFigure>();
  const quality: QualityFigures = {
    missingDocuments: 0,
    pendingDocuments: 0,
    noProject: 0,
    noDepartment: 0,
    undated: 0,
    netAboveGross: 0,
    possibleDuplicates: 0,
  };
  const sameBill = new Map<string, string[]>();

  for (const row of rows) {
    const stage = stageOfStatus(row.status);
    if (stage === 'cancelled') continue;
    const dated = isKey(row.dateKey);
    const age = dated ? Math.max(0, daysBetween(row.dateKey, todayKey)) : null;

    // Payments up to today, oldest first. Post-dated ones have not happened yet.
    const payments = row.paidEvents
      .filter((event) => isKey(event.dateKey) && event.amount > 0 && event.dateKey <= todayKey)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const lastPayment = payments.length ? payments[payments.length - 1].dateKey : null;
    if (lastPayment && (!lastPaidKey || lastPayment > lastPaidKey)) lastPaidKey = lastPayment;
    for (const payment of payments) {
      const week = weekIndex.get(weekStart(payment.dateKey));
      if (week !== undefined) weekly[week].paid = round2(weekly[week].paid + payment.amount);
    }

    if (dated) {
      const week = weekIndex.get(weekStart(row.dateKey));
      if (week !== undefined) weekly[week].received += 1;
      const party = row.partyName.trim().toLowerCase();
      if (party && row.net > 0) {
        const key = `${party}|${Math.round(row.net)}`;
        sameBill.set(key, [...(sameBill.get(key) ?? []), row.dateKey]);
      }
    }

    if (stage === 'paid' && lastPayment) {
      const cycle = dated ? Math.max(0, daysBetween(row.dateKey, lastPayment)) : null;
      const week = weekIndex.get(weekStart(lastPayment));
      if (week !== undefined) {
        weekly[week].settled += 1;
        if (cycle !== null) {
          weekCycles[week].sum += cycle;
          weekCycles[week].count += 1;
        }
      }
      if (within(lastPayment, range)) {
        settled.count += 1;
        if (cycle !== null) {
          settled.cycleSum += cycle;
          settled.cycled += 1;
        }
      }
    }

    // What was still owed at each month end: received by then, less what had been paid by then.
    // Today's figure is the requisition's own balance, so the last point is the open amount.
    if (dated) {
      months.forEach((_, index) => {
        const end = monthEnds[index];
        if (row.dateKey > end) return;
        let owed = row.balance;
        if (end < todayKey) {
          if (stage === 'paid' && lastPayment && lastPayment <= end) owed = 0;
          else owed = Math.max(0, row.net - payments.reduce((sum, payment) => (payment.dateKey <= end ? sum + payment.amount : sum), 0));
        }
        backlogByMonth[index] = round2(backlogByMonth[index] + owed);
      });
    } else {
      backlogByMonth[months.length - 1] = round2(backlogByMonth[months.length - 1] + row.balance);
    }

    if (stage === 'paid') continue;

    // Open from here on.
    const documents = row.documentStatus || 'Pending';
    if (documents === 'Missing') quality.missingDocuments += 1;
    else if (documents === 'Pending') quality.pendingDocuments += 1;
    if (!row.projectId) quality.noProject += 1;
    if (!row.departmentId) quality.noDepartment += 1;
    if (!dated) quality.undated += 1;
    if (row.gross > 0 && row.net > row.gross + 0.5) quality.netAboveGross += 1;

    const profile = stages.get(stage)!;
    profile.count += 1;
    profile.balance = round2(profile.balance + row.balance);
    addGroup(projects, row.projectId || '', row.balance, age);
    if (age === null) continue;

    stageAges.get(stage)!.push(age);
    if (profile.oldestDays === null || age > profile.oldestDays) profile.oldestDays = age;
    const band = bandOf(age).key;
    addToBand(profile.bands, band, row.balance);
    addToBand(bands, band, row.balance);
    if (age > OVERDUE_DAYS) {
      profile.overdue += 1;
      overdue.count += 1;
      overdue.balance = round2(overdue.balance + row.balance);
    }
    if (age > BACKLOG_DAYS) {
      backlog.count += 1;
      backlog.balance = round2(backlog.balance + row.balance);
      backlogByStage.set(stage, (backlogByStage.get(stage) ?? 0) + 1);
    }
  }

  for (const stage of OPEN_STAGES) stages.get(stage)!.medianDays = medianOf(stageAges.get(stage)!);
  weekly.forEach((week, index) => {
    week.cycleDays = weekCycles[index].count ? Math.round(weekCycles[index].sum / weekCycles[index].count) : null;
  });

  // Possible duplicates: the same party and amount received again within a week.
  for (const days of sameBill.values()) {
    if (days.length < 2) continue;
    const sorted = [...days].sort();
    const flagged = new Set<number>();
    for (let i = 1; i < sorted.length; i += 1) {
      if (daysBetween(sorted[i - 1], sorted[i]) <= 7) {
        flagged.add(i - 1);
        flagged.add(i);
      }
    }
    quality.possibleDuplicates += flagged.size;
  }

  let backlogStage: OpenStage | null = null;
  let backlogStageCount = 0;
  for (const [stage, count] of backlogByStage) {
    if (count > backlogStageCount) {
      backlogStage = stage;
      backlogStageCount = count;
    }
  }

  return {
    stages: OPEN_STAGES.map((stage) => stages.get(stage)!),
    bands,
    overdue,
    backlog: { ...backlog, stage: backlogStage, stageCount: backlogStageCount },
    settled: { count: settled.count, avgCycleDays: settled.cycled ? Math.round(settled.cycleSum / settled.cycled) : null },
    lastPaidKey,
    byProject: [...projects.values()].sort(byBalance),
    backlogByMonth,
    weekly,
    quality,
  };
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
