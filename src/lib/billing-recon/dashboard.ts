/**
 * The figures behind Billing Recon's dashboards, computed from a project's JMC entries, MVAC
 * entries and RA bills. Pure (no Firebase, no React) — tests/billing-recon-dashboard.test.mjs.
 *
 * Values are quantity × rate from the entry lines themselves, so the dashboards need no BOQ read:
 *   executed  = Σ executedQty × rate (falling back to the line's stored `totalAmount`)
 *   certified = Σ certifiedQty × rate
 *   billed    = Σ totalAmount of RA bills that count (not cancelled)
 * Rejected and Cancelled entries count toward nothing.
 */

import type { RaBill } from './types';

export type EntryKind = 'JMC' | 'MVAC';

/** The entry fields read here — both JMC and MVAC documents have them. */
export interface DashboardEntry {
  id: string;
  jmcNo?: unknown;
  mvacNo?: unknown;
  jmcDate?: unknown;
  mvacDate?: unknown;
  woNo?: unknown;
  status?: unknown;
  stage?: unknown;
  deadline?: unknown;
  createdAt?: unknown;
  items?: unknown;
}

export interface ValueTotals {
  executed: number;
  certified: number;
  billed: number;
  /** Executed but not yet certified. */
  awaitingCertification: number;
  /** Certified but not yet on a bill. */
  certifiedUnbilled: number;
}

export interface PendingEntry {
  kind: EntryKind;
  id: string;
  number: string;
  stage: string;
  status: string;
  woNo: string;
  /** Milliseconds since epoch, or null when the entry has none. */
  deadline: number | null;
  createdAt: number | null;
  overdue: boolean;
  /** Days since it was raised (whole days, ≥ 0), or null. */
  ageDays: number | null;
  executedValue: number;
}

export interface StageCount {
  stage: string;
  jmc: number;
  mvac: number;
  overdue: number;
}

export interface MonthPoint {
  /** yyyy-mm */
  month: string;
  executed: number;
  certified: number;
  billed: number;
}

export interface ProjectSummary {
  values: ValueTotals;
  counts: { jmc: number; mvac: number; bills: number; draftBills: number };
  pending: PendingEntry[];
  overdueCount: number;
  byStage: StageCount[];
  byMonth: MonthPoint[];
  /** Status → number of entries (JMC and MVAC together). */
  statusCounts: Record<string, number>;
  /** Latest activity in milliseconds (entry raised or bill created), or null. */
  lastActivity: number | null;
}

const CLOSED = new Set(['completed', 'certified', 'rejected', 'cancelled']);
const VOID = new Set(['rejected', 'cancelled']);

const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());

/** Milliseconds from a Firestore Timestamp, `{ seconds }`, Date, ISO / yyyy-mm-dd string or number. */
export function toMillis(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'object') {
    const v = value as { toMillis?: () => number; seconds?: unknown; _seconds?: unknown };
    if (typeof v.toMillis === 'function') return v.toMillis();
    const seconds = typeof v.seconds === 'number' ? v.seconds : typeof v._seconds === 'number' ? v._seconds : null;
    return seconds === null ? null : seconds * 1000;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // dd-mm-yyyy / dd/mm/yyyy, which Date.parse misreads or rejects.
    const dmy = /^(\d{1,2})(?:-|\/|\.)(\d{1,2})(?:-|\/|\.)(\d{4})$/.exec(trimmed);
    if (dmy) {
      const t = Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
      return Number.isNaN(t) ? null : t;
    }
    const t = Date.parse(trimmed);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** yyyy-mm of a millisecond timestamp, in UTC (entry dates are stored as plain dates). */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Executed and certified value of one entry's lines. */
export function entryValues(entry: Pick<DashboardEntry, 'items'>): { executed: number; certified: number } {
  let executed = 0;
  let certified = 0;
  if (!Array.isArray(entry.items)) return { executed, certified };
  for (const raw of entry.items) {
    if (!raw || typeof raw !== 'object') continue;
    const line = raw as Record<string, unknown>;
    const rate = num(line.rate);
    const exec = num(line.executedQty);
    executed += rate ? exec * rate : num(line.totalAmount);
    certified += num(line.certifiedQty) * rate;
  }
  return { executed, certified };
}

function addMonth(map: Map<string, MonthPoint>, ms: number | null, field: 'executed' | 'certified' | 'billed', amount: number) {
  if (ms === null || !amount) return;
  const key = monthKey(ms);
  const point = map.get(key) ?? { month: key, executed: 0, certified: 0, billed: 0 };
  point[field] += amount;
  map.set(key, point);
}

/** Last `count` months ending at `now`'s month, oldest first, filled with zeros where empty. */
export function lastMonths(points: MonthPoint[], now: number, count = 12): MonthPoint[] {
  const byKey = new Map(points.map((p) => [p.month, p]));
  const end = new Date(now);
  const out: MonthPoint[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    const key = monthKey(d.getTime());
    const p = byKey.get(key);
    out.push(p ? { ...p, executed: round2(p.executed), certified: round2(p.certified), billed: round2(p.billed) } : { month: key, executed: 0, certified: 0, billed: 0 });
  }
  return out;
}

export function summarizeProject(
  input: { jmcEntries: DashboardEntry[]; mvacEntries: DashboardEntry[]; bills: Array<Pick<RaBill, 'status' | 'totalAmount' | 'billDate' | 'createdAt'>> },
  now: number,
): ProjectSummary {
  const values = { executed: 0, certified: 0, billed: 0 };
  const pending: PendingEntry[] = [];
  const stages = new Map<string, StageCount>();
  const months = new Map<string, MonthPoint>();
  const statusCounts: Record<string, number> = {};
  let lastActivity: number | null = null;
  const touch = (ms: number | null) => {
    if (ms !== null && (lastActivity === null || ms > lastActivity)) lastActivity = ms;
  };

  const walk = (entries: DashboardEntry[], kind: EntryKind) => {
    for (const entry of entries) {
      const status = text(entry.status) || 'Pending';
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      const lower = status.toLowerCase();
      const created = toMillis(entry.createdAt);
      const dated = toMillis(kind === 'JMC' ? entry.jmcDate : entry.mvacDate) ?? created;
      touch(created);
      if (VOID.has(lower)) continue;

      const v = entryValues(entry);
      values.executed += v.executed;
      values.certified += v.certified;
      addMonth(months, dated, 'executed', v.executed);
      addMonth(months, dated, 'certified', v.certified);

      if (CLOSED.has(lower)) continue;
      const deadline = toMillis(entry.deadline);
      const overdue = deadline !== null && deadline < now;
      const stage = text(entry.stage) || status;
      pending.push({
        kind,
        id: entry.id,
        number: text(kind === 'JMC' ? entry.jmcNo : entry.mvacNo) || '—',
        stage,
        status,
        woNo: text(entry.woNo),
        deadline,
        createdAt: created,
        overdue,
        ageDays: created === null ? null : Math.max(0, Math.floor((now - created) / 86_400_000)),
        executedValue: round2(v.executed),
      });
      const s = stages.get(stage) ?? { stage, jmc: 0, mvac: 0, overdue: 0 };
      if (kind === 'JMC') s.jmc += 1;
      else s.mvac += 1;
      if (overdue) s.overdue += 1;
      stages.set(stage, s);
    }
  };
  walk(input.jmcEntries, 'JMC');
  walk(input.mvacEntries, 'MVAC');

  let draftBills = 0;
  let countedBills = 0;
  for (const bill of input.bills) {
    const created = toMillis(bill.createdAt);
    touch(created);
    if (bill.status === 'Cancelled') continue;
    countedBills += 1;
    if (bill.status === 'Draft') draftBills += 1;
    const amount = num(bill.totalAmount);
    values.billed += amount;
    addMonth(months, toMillis(bill.billDate) ?? created, 'billed', amount);
  }

  pending.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.deadline ?? Infinity) - (b.deadline ?? Infinity) || (b.ageDays ?? 0) - (a.ageDays ?? 0));

  return {
    values: {
      executed: round2(values.executed),
      certified: round2(values.certified),
      billed: round2(values.billed),
      awaitingCertification: round2(Math.max(0, values.executed - values.certified)),
      certifiedUnbilled: round2(Math.max(0, values.certified - values.billed)),
    },
    counts: { jmc: input.jmcEntries.length, mvac: input.mvacEntries.length, bills: countedBills, draftBills },
    pending,
    overdueCount: pending.filter((p) => p.overdue).length,
    byStage: [...stages.values()].sort((a, b) => b.jmc + b.mvac - (a.jmc + a.mvac) || a.stage.localeCompare(b.stage)),
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    statusCounts,
    lastActivity,
  };
}

/** Adds several projects' summaries together (the all-projects dashboard). */
export function combineSummaries(summaries: ProjectSummary[]): Omit<ProjectSummary, 'pending'> & { pendingCount: number } {
  const values: ValueTotals = { executed: 0, certified: 0, billed: 0, awaitingCertification: 0, certifiedUnbilled: 0 };
  const counts = { jmc: 0, mvac: 0, bills: 0, draftBills: 0 };
  const stages = new Map<string, StageCount>();
  const months = new Map<string, MonthPoint>();
  const statusCounts: Record<string, number> = {};
  let overdueCount = 0;
  let pendingCount = 0;
  let lastActivity: number | null = null;
  for (const s of summaries) {
    (Object.keys(values) as (keyof ValueTotals)[]).forEach((k) => (values[k] += s.values[k]));
    (Object.keys(counts) as (keyof typeof counts)[]).forEach((k) => (counts[k] += s.counts[k]));
    for (const st of s.byStage) {
      const t = stages.get(st.stage) ?? { stage: st.stage, jmc: 0, mvac: 0, overdue: 0 };
      t.jmc += st.jmc;
      t.mvac += st.mvac;
      t.overdue += st.overdue;
      stages.set(st.stage, t);
    }
    for (const m of s.byMonth) {
      const t = months.get(m.month) ?? { month: m.month, executed: 0, certified: 0, billed: 0 };
      t.executed += m.executed;
      t.certified += m.certified;
      t.billed += m.billed;
      months.set(m.month, t);
    }
    for (const [k, n] of Object.entries(s.statusCounts)) statusCounts[k] = (statusCounts[k] ?? 0) + n;
    overdueCount += s.overdueCount;
    pendingCount += s.pending.length;
    if (s.lastActivity !== null && (lastActivity === null || s.lastActivity > lastActivity)) lastActivity = s.lastActivity;
  }
  (Object.keys(values) as (keyof ValueTotals)[]).forEach((k) => (values[k] = round2(values[k])));
  return {
    values,
    counts,
    overdueCount,
    pendingCount,
    byStage: [...stages.values()].sort((a, b) => b.jmc + b.mvac - (a.jmc + a.mvac) || a.stage.localeCompare(b.stage)),
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    statusCounts,
    lastActivity,
  };
}

/** a ÷ b as a whole percentage, 0 when b is 0. */
export function percent(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}
