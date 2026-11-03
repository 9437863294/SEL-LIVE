/**
 * The detail sections of Billing Recon's dashboard: ageing of open entries, this month / last month
 * / financial year figures, status breakdown, the scopes with the most certified value waiting to
 * be billed, exceptions across projects, and RA bills that need attention.
 *
 * Pure (no Firebase, no React) — tests/billing-recon-dashboard-detail.test.mjs. Dates are read as
 * plain dates in UTC, like `dashboard.ts`.
 */

import { entryValues, monthKey, toMillis, type DashboardEntry, type PendingEntry } from './dashboard.ts';
import type { Reconciliation, ReconciliationRow } from './reconciliation.ts';

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown) => (v == null ? '' : String(v).trim());
const isVoid = (status: unknown) => {
  const s = text(status).toLowerCase();
  return s === 'rejected' || s === 'cancelled' || s === 'canceled';
};

/* ── register filter ────────────────────────────────────────────────────────────────────────── */

export type RegisterFilter = 'all' | 'JMC' | 'MVAC';

/**
 * RA bills as seen through one register: only the lines certified in that register, the total
 * re-added from them, and bills left with no such line dropped. `'all'` returns the bills as they are.
 */
export function billsForRegister<T extends { items?: unknown; totalAmount?: unknown }>(bills: readonly T[], register: RegisterFilter): T[] {
  if (register === 'all') return [...bills];
  const out: T[] = [];
  for (const bill of bills) {
    const items = Array.isArray(bill.items) ? (bill.items as Array<{ source?: unknown; amount?: unknown }>) : [];
    const kept = items.filter((item) => item && item.source === register);
    if (!kept.length) continue;
    out.push({ ...bill, items: kept, totalAmount: round2(kept.reduce((s, item) => s + (Number(item.amount) || 0), 0)) });
  }
  return out;
}

/* ── ageing ─────────────────────────────────────────────────────────────────────────────────── */

export const AGE_BUCKETS = [
  { key: 'd0', label: '0–7 days', max: 7 },
  { key: 'd8', label: '8–15 days', max: 15 },
  { key: 'd16', label: '16–30 days', max: 30 },
  { key: 'd31', label: '31–60 days', max: 60 },
  { key: 'd61', label: 'Over 60 days', max: Number.POSITIVE_INFINITY },
] as const;

export interface AgeBucket {
  key: string;
  label: string;
  jmc: number;
  mvac: number;
  count: number;
  overdue: number;
  value: number;
}

/** Open entries grouped by how long ago they were raised. `undated` have no creation date. */
export function ageingBuckets(pending: readonly PendingEntry[]): { buckets: AgeBucket[]; undated: number } {
  const buckets: AgeBucket[] = AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, jmc: 0, mvac: 0, count: 0, overdue: 0, value: 0 }));
  let undated = 0;
  for (const p of pending) {
    if (p.ageDays === null) {
      undated += 1;
      continue;
    }
    const i = AGE_BUCKETS.findIndex((b) => p.ageDays! <= b.max);
    const b = buckets[i < 0 ? buckets.length - 1 : i];
    if (p.kind === 'JMC') b.jmc += 1;
    else b.mvac += 1;
    b.count += 1;
    if (p.overdue) b.overdue += 1;
    b.value += p.executedValue;
  }
  buckets.forEach((b) => (b.value = round2(b.value)));
  return { buckets, undated };
}

/* ── this month / last month / financial year ───────────────────────────────────────────────── */

export interface PeriodFigures {
  jmcRaised: number;
  mvacRaised: number;
  executed: number;
  certified: number;
  bills: number;
  billed: number;
}

export interface PeriodComparison {
  thisMonth: PeriodFigures;
  lastMonth: PeriodFigures;
  financialYear: PeriodFigures;
  /** e.g. "Nov 2026" */
  thisMonthLabel: string;
  lastMonthLabel: string;
  /** e.g. "FY 2026–27" */
  financialYearLabel: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The Indian financial year (1 April – 31 March) containing `ms`: its start year. */
export function financialYearStart(ms: number): number {
  const d = new Date(ms);
  return d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

export function financialYearLabel(startYear: number): string {
  return `FY ${startYear}–${String((startYear + 1) % 100).padStart(2, '0')}`;
}

const emptyFigures = (): PeriodFigures => ({ jmcRaised: 0, mvacRaised: 0, executed: 0, certified: 0, bills: 0, billed: 0 });

export interface PeriodInput {
  jmcEntries: readonly DashboardEntry[];
  mvacEntries: readonly DashboardEntry[];
  bills: ReadonlyArray<{ status?: unknown; totalAmount?: unknown; billDate?: unknown; createdAt?: unknown }>;
}

/**
 * JMC / MVAC raised and their executed / certified value, and RA bills raised and billed, in the
 * current month, the previous month and the financial year to date. An entry counts in the period
 * of its JMC / MVAC date (its creation date when it has none); a bill in that of its bill date.
 * Rejected / cancelled entries and cancelled bills count nowhere.
 */
export function periodComparison(projects: readonly PeriodInput[], now: number): PeriodComparison {
  const nowDate = new Date(now);
  const thisKey = monthKey(now);
  const last = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - 1, 1));
  const lastKey = monthKey(last.getTime());
  const fy = financialYearStart(now);

  const out = { thisMonth: emptyFigures(), lastMonth: emptyFigures(), financialYear: emptyFigures() };
  const add = (ms: number | null, apply: (f: PeriodFigures) => void) => {
    if (ms === null) return;
    const key = monthKey(ms);
    if (key === thisKey) apply(out.thisMonth);
    if (key === lastKey) apply(out.lastMonth);
    if (financialYearStart(ms) === fy && ms <= now + DAY) apply(out.financialYear);
  };

  for (const project of projects) {
    const walk = (entries: readonly DashboardEntry[], kind: 'JMC' | 'MVAC') => {
      for (const entry of entries) {
        if (isVoid(entry.status)) continue;
        const ms = toMillis(kind === 'JMC' ? entry.jmcDate : entry.mvacDate) ?? toMillis(entry.createdAt);
        const v = entryValues(entry);
        add(ms, (f) => {
          if (kind === 'JMC') f.jmcRaised += 1;
          else f.mvacRaised += 1;
          f.executed += v.executed;
          f.certified += v.certified;
        });
      }
    };
    walk(project.jmcEntries, 'JMC');
    walk(project.mvacEntries, 'MVAC');
    for (const bill of project.bills) {
      if (bill.status === 'Cancelled') continue;
      const amount = Number(bill.totalAmount) || 0;
      add(toMillis(bill.billDate) ?? toMillis(bill.createdAt), (f) => {
        f.bills += 1;
        f.billed += amount;
      });
    }
  }
  for (const f of Object.values(out)) {
    f.executed = round2(f.executed);
    f.certified = round2(f.certified);
    f.billed = round2(f.billed);
  }
  return {
    ...out,
    thisMonthLabel: `${MONTHS[nowDate.getUTCMonth()]} ${nowDate.getUTCFullYear()}`,
    lastMonthLabel: `${MONTHS[last.getUTCMonth()]} ${last.getUTCFullYear()}`,
    financialYearLabel: financialYearLabel(fy),
  };
}

/* ── status breakdown ───────────────────────────────────────────────────────────────────────── */

export interface StatusRow {
  status: string;
  jmc: number;
  mvac: number;
}

const STATUS_ORDER = ['Pending', 'In Progress', 'Needs Review', 'Completed', 'Certified', 'Rejected', 'Cancelled'];

/** Entries per status, JMC and MVAC side by side, in workflow order (unknown statuses last). */
export function statusBreakdown(projects: ReadonlyArray<Pick<PeriodInput, 'jmcEntries' | 'mvacEntries'>>): StatusRow[] {
  const rows = new Map<string, StatusRow>();
  const bump = (status: unknown, kind: 'jmc' | 'mvac') => {
    const s = text(status) || 'Pending';
    const row = rows.get(s) ?? { status: s, jmc: 0, mvac: 0 };
    row[kind] += 1;
    rows.set(s, row);
  };
  for (const p of projects) {
    p.jmcEntries.forEach((e) => bump(e.status, 'jmc'));
    p.mvacEntries.forEach((e) => bump(e.status, 'mvac'));
  }
  const rank = (s: string) => {
    const i = STATUS_ORDER.indexOf(s);
    return i < 0 ? STATUS_ORDER.length : i;
  };
  return [...rows.values()].sort((a, b) => rank(a.status) - rank(b.status) || a.status.localeCompare(b.status));
}

/* ── scopes waiting to be billed ────────────────────────────────────────────────────────────── */

export interface ScopeRow {
  id: string;
  projectId: string;
  projectName: string;
  scope1: string;
  scope2: string;
  items: number;
  boqValue: number;
  certifiedValue: number;
  billedValue: number;
  toCertifyValue: number;
  toBillValue: number;
}

/** BOQ scopes (scope 2 › scope 1) with the most certified value not yet billed, across projects. */
export function topScopes(
  projects: ReadonlyArray<{ projectId: string; projectName: string; rows: readonly ReconciliationRow[] }>,
  limit = 10,
): ScopeRow[] {
  const map = new Map<string, ScopeRow>();
  for (const p of projects) {
    for (const r of p.rows) {
      if (r.duplicateOf) continue;
      const id = `${p.projectId}|${r.scope2}|${r.scope1}`;
      const row =
        map.get(id) ??
        { id, projectId: p.projectId, projectName: p.projectName, scope1: r.scope1, scope2: r.scope2, items: 0, boqValue: 0, certifiedValue: 0, billedValue: 0, toCertifyValue: 0, toBillValue: 0 };
      row.items += 1;
      row.boqValue += r.boqAmount;
      row.certifiedValue += r.certifiedValue;
      row.billedValue += r.billedValue;
      row.toCertifyValue += r.toCertifyValue;
      row.toBillValue += r.toBillValue;
      map.set(id, row);
    }
  }
  return [...map.values()]
    .map((r) => ({ ...r, boqValue: round2(r.boqValue), certifiedValue: round2(r.certifiedValue), billedValue: round2(r.billedValue), toCertifyValue: round2(r.toCertifyValue), toBillValue: round2(r.toBillValue) }))
    .filter((r) => r.toBillValue > 0 || r.toCertifyValue > 0)
    .sort((a, b) => b.toBillValue - a.toBillValue || b.toCertifyValue - a.toCertifyValue)
    .slice(0, limit);
}

/* ── exceptions ─────────────────────────────────────────────────────────────────────────────── */

export type ExceptionKind = 'Over-executed' | 'Over-billed' | 'Duplicate SL No' | 'Unmatched line';

export interface ExceptionRow {
  id: string;
  projectId: string;
  projectName: string;
  kind: ExceptionKind;
  /** BOQ SL No, or the JMC / MVAC / bill number for an unmatched line. */
  reference: string;
  scope: string;
  description: string;
  /** The value of the excess (over-executed / over-billed) or of the unmatched line. */
  value: number;
}

export interface ExceptionSummary {
  rows: ExceptionRow[];
  counts: Record<ExceptionKind, number>;
}

/** Every reconciliation exception across projects, the largest values first. */
export function exceptionList(
  projects: ReadonlyArray<{ projectId: string; projectName: string; reconciliation: Reconciliation }>,
): ExceptionSummary {
  const rows: ExceptionRow[] = [];
  const counts: Record<ExceptionKind, number> = { 'Over-executed': 0, 'Over-billed': 0, 'Duplicate SL No': 0, 'Unmatched line': 0 };
  const scopeOf = (s1: string, s2: string) => [s2, s1].filter(Boolean).join(' › ');
  for (const p of projects) {
    for (const r of p.reconciliation.rows) {
      const base = { projectId: p.projectId, projectName: p.projectName, reference: r.boqSlNo || '—', scope: scopeOf(r.scope1, r.scope2), description: r.description };
      if (r.overExecuted) {
        counts['Over-executed'] += 1;
        rows.push({ ...base, id: `${p.projectId}|oe|${r.id}`, kind: 'Over-executed', value: round2(Math.max(0, r.executedQty - r.boqQty) * r.rate) });
      }
      if (r.overBilled) {
        counts['Over-billed'] += 1;
        rows.push({ ...base, id: `${p.projectId}|ob|${r.id}`, kind: 'Over-billed', value: round2(Math.max(0, r.billedQty - r.certifiedQty) * r.rate) });
      }
      if (r.duplicateOf) {
        counts['Duplicate SL No'] += 1;
        rows.push({ ...base, id: `${p.projectId}|dup|${r.id}`, kind: 'Duplicate SL No', value: 0 });
      }
    }
    for (const u of p.reconciliation.unmatched) {
      counts['Unmatched line'] += 1;
      rows.push({
        id: `${p.projectId}|un|${u.id}`,
        projectId: p.projectId,
        projectName: p.projectName,
        kind: 'Unmatched line',
        reference: `${u.source} ${u.docNo || '—'}${u.boqSlNo ? ` · SL ${u.boqSlNo}` : ''}`,
        scope: scopeOf(u.scope1, u.scope2),
        description: u.reason,
        value: round2(u.value),
      });
    }
  }
  rows.sort((a, b) => b.value - a.value || a.projectName.localeCompare(b.projectName));
  return { rows, counts };
}

/* ── RA bills ───────────────────────────────────────────────────────────────────────────────── */

export interface BillLikeForDashboard {
  id: string;
  billNo?: unknown;
  raSequence?: unknown;
  billDate?: unknown;
  status?: unknown;
  totalAmount?: unknown;
  billTrackingRef?: unknown;
  createdAt?: unknown;
}

export interface BillRow {
  id: string;
  projectId: string;
  projectName: string;
  billNo: string;
  raSequence: number | null;
  billDate: string;
  status: string;
  amount: number;
  billTrackingRef: string;
  createdAt: number | null;
  /** Why it needs attention, or '' when it doesn't. */
  issue: string;
}

/**
 * Every RA bill across projects, newest first, with what needs doing: a draft left more than
 * `draftDays` days, or a submitted bill not yet linked to its Bill Tracking bill.
 */
export function billRows(
  projects: ReadonlyArray<{ projectId: string; projectName: string; bills: readonly BillLikeForDashboard[] }>,
  now: number,
  draftDays = 7,
): BillRow[] {
  const rows: BillRow[] = [];
  for (const p of projects) {
    for (const b of p.bills) {
      const status = text(b.status) || 'Draft';
      const createdAt = toMillis(b.createdAt);
      const dated = toMillis(b.billDate) ?? createdAt;
      const ageDays = createdAt === null ? null : Math.floor((now - createdAt) / DAY);
      let issue = '';
      if (status === 'Draft' && ageDays !== null && ageDays > draftDays) issue = `Draft for ${ageDays} days`;
      else if (status === 'Submitted' && !text(b.billTrackingRef)) issue = 'Not linked to Bill Tracking';
      rows.push({
        id: `${p.projectId}|${b.id}`,
        projectId: p.projectId,
        projectName: p.projectName,
        billNo: text(b.billNo) || '—',
        raSequence: Number(b.raSequence) || null,
        billDate: text(b.billDate),
        status,
        amount: round2(Number(b.totalAmount) || 0),
        billTrackingRef: text(b.billTrackingRef),
        createdAt: dated,
        issue,
      });
    }
  }
  return rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}
