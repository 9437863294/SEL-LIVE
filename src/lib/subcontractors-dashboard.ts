/**
 * The figures behind a project's Subcontractors dashboard (Billing Recon › Subcontractors).
 *
 * Built from Subcontractors Management's own records for one project — the shared subcontractor
 * register, `projects/{id}/workOrders`, `bills` and `proformaBills` — and nothing of Billing Recon's
 * registers. What each figure means:
 *
 * - **Work order value** — the sum of the project's work orders, cancelled ones left out.
 * - **Billed (work value)** — regular bills' subtotal, before GST and deductions: the work billed,
 *   comparable with the work order value. Retention bills release money already billed and proforma
 *   bills are advances, so neither counts here.
 * - **Net payable** — what regular bills leave to pay after GST, retention, advance recovery and
 *   other deductions. Retention bills' net is "retention released".
 * - **Retention held** — retention on regular bills not yet claimed by a retention bill.
 * - **Advance outstanding** — proforma (advance) bills, less what regular bills have recovered of
 *   them (`advanceDeductions[].reference` is the proforma's id).
 * - Rejected bills count toward nothing but the status tally.
 *
 * Pure (no Firebase, no React) so the arithmetic is unit-tested.
 */

export type BillStatus = 'Pending' | 'In Progress' | 'Completed' | 'Rejected';
export type BillKind = 'Bill' | 'Retention' | 'Proforma';

export interface DashSubcontractor {
  id: string;
  legalName?: string;
  dbaName?: string;
  status?: string;
  gstNumber?: string;
  panNumber?: string;
  contacts?: ReadonlyArray<{ type?: string; name?: string; mobile?: string; email?: string }>;
}

export interface DashWorkOrder {
  id: string;
  workOrderNo?: string;
  subcontractorId?: string;
  subcontractorName?: string;
  totalAmount?: number;
  date?: string;
  status?: string;
  createdAt?: unknown;
}

export interface DashBill {
  id: string;
  billNo?: string;
  billDate?: string;
  workOrderId?: string;
  workOrderNo?: string;
  subcontractorId?: string;
  subcontractorName?: string;
  subtotal?: number;
  grossAmount?: number;
  retentionAmount?: number;
  advanceDeductions?: ReadonlyArray<{ reference?: string; amount?: number }>;
  netPayable?: number;
  status?: string;
  stage?: string;
  currentStepId?: string | null;
  deadline?: unknown;
  isRetentionBill?: boolean;
  retentionClaimed?: boolean;
  createdAt?: unknown;
}

export interface DashProforma {
  id: string;
  proformaNo?: string;
  date?: string;
  workOrderId?: string;
  workOrderNo?: string;
  subcontractorId?: string;
  subcontractorName?: string;
  payableAmount?: number;
  status?: string;
  stage?: string;
  currentStepId?: string | null;
  deadline?: unknown;
  createdAt?: unknown;
}

export interface SubcontractorRow {
  id: string;
  name: string;
  /** Register status (Active / Inactive); '' when the subcontractor is not in the register. */
  status: string;
  gstNumber: string;
  panNumber: string;
  /** The project contact (or the first one): "Name · mobile". */
  contact: string;
  inRegister: boolean;
  workOrders: number;
  workOrderValue: number;
  bills: number;
  billedValue: number;
  grossBilled: number;
  netPayable: number;
  retentionHeld: number;
  retentionReleased: number;
  advancePaid: number;
  advanceRecovered: number;
  advanceOutstanding: number;
  balanceToBill: number;
  /** Billed work value as a share of the work order value, 0–100+ (null without a work order). */
  billedPercent: number | null;
  openBills: number;
  openValue: number;
  lastBillDate: string | null;
}

export interface WorkOrderRow {
  id: string;
  workOrderNo: string;
  subcontractorId: string;
  subcontractorName: string;
  date: string;
  status: string;
  value: number;
  billedValue: number;
  bills: number;
  balance: number;
  billedPercent: number | null;
}

export interface OpenBillRow {
  id: string;
  kind: BillKind;
  number: string;
  subcontractorName: string;
  workOrderNo: string;
  stage: string;
  status: BillStatus;
  amount: number;
  date: string;
  ageDays: number | null;
  deadline: number | null;
  overdue: boolean;
  currentStepId: string | null;
}

export interface RecentBillRow {
  id: string;
  kind: BillKind;
  number: string;
  subcontractorName: string;
  date: string;
  status: BillStatus;
  stage: string;
  amount: number;
}

export interface MonthValue {
  /** yyyy-mm */
  month: string;
  /** Net payable of regular and retention bills dated that month. */
  billed: number;
  /** Proforma (advance) bills dated that month. */
  advance: number;
}

export interface SubcontractorsDashboard {
  totals: {
    subcontractors: number;
    activeSubcontractors: number;
    workOrders: number;
    workOrderValue: number;
    bills: number;
    billedValue: number;
    grossBilled: number;
    netPayable: number;
    retentionHeld: number;
    retentionReleased: number;
    advancePaid: number;
    advanceRecovered: number;
    advanceOutstanding: number;
    balanceToBill: number;
    billedPercent: number | null;
    openBills: number;
    openValue: number;
    overdue: number;
  };
  statusCounts: Record<BillStatus, number>;
  subcontractors: SubcontractorRow[];
  workOrders: WorkOrderRow[];
  open: OpenBillRow[];
  recent: RecentBillRow[];
  byMonth: MonthValue[];
}

const DAY = 86_400_000;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;
const text = (v: unknown): string => String(v ?? '').trim();

export function billStatus(value: unknown): BillStatus {
  return value === 'In Progress' || value === 'Completed' || value === 'Rejected' ? value : 'Pending';
}
const isOpen = (s: BillStatus) => s === 'Pending' || s === 'In Progress';

/** A `yyyy-mm-dd` (or ISO) date as local-midnight milliseconds; null when unreadable. */
export function dateMs(value: unknown): number | null {
  const s = text(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** A Firestore Timestamp, Date, `{ seconds }` or millisecond number as milliseconds. */
export function stampMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const v = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof v.toMillis === 'function') return v.toMillis();
  const seconds = v.seconds ?? v._seconds;
  return typeof seconds === 'number' ? seconds * 1000 : null;
}

/** The record's own date (bill date / proforma date), else when it was created. */
function recordMs(date: unknown, createdAt: unknown): number | null {
  return dateMs(date) ?? stampMs(createdAt);
}

const isoDay = (ms: number | null): string => {
  if (ms === null) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monthKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** The `count` calendar months ending with `now`'s, oldest first, as yyyy-mm. */
export function lastMonthKeys(now: number, count = 12): string[] {
  const d = new Date(now);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    keys.push(monthKey(m.getTime()));
  }
  return keys;
}

const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

function contactOf(s: DashSubcontractor | undefined): string {
  const contacts = s?.contacts ?? [];
  const c = contacts.find((x) => x.type === 'Project' && (x.name || x.mobile)) ?? contacts.find((x) => x.name || x.mobile);
  return c ? [text(c.name), text(c.mobile)].filter(Boolean).join(' · ') : '';
}

interface Acc {
  name: string;
  workOrders: number;
  workOrderValue: number;
  bills: number;
  billedValue: number;
  grossBilled: number;
  netPayable: number;
  retentionHeld: number;
  retentionReleased: number;
  advancePaid: number;
  advanceRecovered: number;
  openBills: number;
  openValue: number;
  lastBillMs: number | null;
}

const blank = (name: string): Acc => ({
  name,
  workOrders: 0,
  workOrderValue: 0,
  bills: 0,
  billedValue: 0,
  grossBilled: 0,
  netPayable: 0,
  retentionHeld: 0,
  retentionReleased: 0,
  advancePaid: 0,
  advanceRecovered: 0,
  openBills: 0,
  openValue: 0,
  lastBillMs: null,
});

export function buildSubcontractorsDashboard(input: {
  subcontractors: ReadonlyArray<DashSubcontractor>;
  workOrders: ReadonlyArray<DashWorkOrder>;
  bills: ReadonlyArray<DashBill>;
  proformas: ReadonlyArray<DashProforma>;
  now: number;
}): SubcontractorsDashboard {
  const { now } = input;
  const register = new Map(input.subcontractors.map((s) => [s.id, s]));
  const acc = new Map<string, Acc>();
  const touch = (id: string | undefined, fallbackName: string | undefined): Acc => {
    const key = text(id) || `name:${text(fallbackName) || 'Unknown'}`;
    let a = acc.get(key);
    if (!a) {
      const reg = register.get(text(id));
      a = blank(text(reg?.legalName) || text(reg?.dbaName) || text(fallbackName) || 'Unknown subcontractor');
      acc.set(key, a);
    }
    return a;
  };
  const keyOf = (id: string | undefined, fallbackName: string | undefined) => text(id) || `name:${text(fallbackName) || 'Unknown'}`;

  const statusCounts: Record<BillStatus, number> = { Pending: 0, 'In Progress': 0, Completed: 0, Rejected: 0 };
  const open: OpenBillRow[] = [];
  const recent: Array<RecentBillRow & { ms: number }> = [];
  const months = lastMonthKeys(now, 12);
  const byMonth = new Map(months.map((m) => [m, { month: m, billed: 0, advance: 0 }]));

  // ── work orders ──
  const woBilled = new Map<string, { value: number; bills: number }>();
  for (const wo of input.workOrders) {
    const a = touch(wo.subcontractorId, wo.subcontractorName);
    if (text(wo.status) === 'Cancelled') continue;
    a.workOrders += 1;
    a.workOrderValue += num(wo.totalAmount);
  }

  const openRow = (row: Omit<OpenBillRow, 'ageDays' | 'overdue' | 'deadline'> & { ms: number | null; deadlineRaw: unknown }): OpenBillRow => {
    const deadline = stampMs(row.deadlineRaw);
    const { ms, deadlineRaw: _raw, ...rest } = row;
    return {
      ...rest,
      ageDays: ms === null ? null : Math.max(0, Math.floor((now - ms) / DAY)),
      deadline,
      overdue: deadline !== null && deadline < now,
    };
  };

  // ── regular and retention bills ──
  for (const bill of input.bills) {
    const status = billStatus(bill.status);
    statusCounts[status] += 1;
    const kind: BillKind = bill.isRetentionBill ? 'Retention' : 'Bill';
    const a = touch(bill.subcontractorId, bill.subcontractorName);
    const ms = recordMs(bill.billDate, bill.createdAt);
    const net = num(bill.netPayable);
    recent.push({
      id: bill.id,
      kind,
      number: text(bill.billNo) || bill.id,
      subcontractorName: a.name,
      date: text(bill.billDate) || isoDay(ms),
      status,
      stage: text(bill.stage),
      amount: net,
      ms: ms ?? 0,
    });
    if (isOpen(status)) {
      open.push(
        openRow({
          id: bill.id,
          kind,
          number: text(bill.billNo) || bill.id,
          subcontractorName: a.name,
          workOrderNo: text(bill.workOrderNo),
          stage: text(bill.stage),
          status,
          amount: net,
          date: text(bill.billDate) || isoDay(ms),
          currentStepId: bill.currentStepId ?? null,
          ms,
          deadlineRaw: bill.deadline,
        }),
      );
    }
    if (status === 'Rejected') continue;
    if (isOpen(status)) {
      a.openBills += 1;
      a.openValue += net;
    }
    if (ms !== null) {
      const m = byMonth.get(monthKey(ms));
      if (m) m.billed += net;
    }
    if (kind === 'Retention') {
      a.retentionReleased += net;
      continue;
    }
    a.bills += 1;
    a.billedValue += num(bill.subtotal);
    a.grossBilled += num(bill.grossAmount);
    a.netPayable += net;
    if (!bill.retentionClaimed) a.retentionHeld += num(bill.retentionAmount);
    a.advanceRecovered += (bill.advanceDeductions ?? []).reduce((s, d) => s + num(d.amount), 0);
    if (ms !== null && (a.lastBillMs === null || ms > a.lastBillMs)) a.lastBillMs = ms;
    const woId = text(bill.workOrderId);
    if (woId) {
      const w = woBilled.get(woId) ?? { value: 0, bills: 0 };
      w.value += num(bill.subtotal);
      w.bills += 1;
      woBilled.set(woId, w);
    }
  }

  // ── proforma (advance) bills ──
  for (const pf of input.proformas) {
    const status = billStatus(pf.status);
    statusCounts[status] += 1;
    const a = touch(pf.subcontractorId, pf.subcontractorName);
    const ms = recordMs(pf.date, pf.createdAt);
    const amount = num(pf.payableAmount);
    recent.push({
      id: pf.id,
      kind: 'Proforma',
      number: text(pf.proformaNo) || pf.id,
      subcontractorName: a.name,
      date: text(pf.date) || isoDay(ms),
      status,
      stage: text(pf.stage),
      amount,
      ms: ms ?? 0,
    });
    if (isOpen(status)) {
      open.push(
        openRow({
          id: pf.id,
          kind: 'Proforma',
          number: text(pf.proformaNo) || pf.id,
          subcontractorName: a.name,
          workOrderNo: text(pf.workOrderNo),
          stage: text(pf.stage),
          status,
          amount,
          date: text(pf.date) || isoDay(ms),
          currentStepId: pf.currentStepId ?? null,
          ms,
          deadlineRaw: pf.deadline,
        }),
      );
    }
    if (status === 'Rejected') continue;
    if (isOpen(status)) {
      a.openBills += 1;
      a.openValue += amount;
    }
    a.advancePaid += amount;
    if (ms !== null) {
      const m = byMonth.get(monthKey(ms));
      if (m) m.advance += amount;
    }
  }

  // ── rows ──
  const subcontractors: SubcontractorRow[] = [...acc.entries()]
    .map(([key, a]) => {
      const reg = key.startsWith('name:') ? undefined : register.get(key);
      const advanceOutstanding = Math.max(0, a.advancePaid - a.advanceRecovered);
      return {
        id: key,
        name: a.name,
        status: text(reg?.status),
        gstNumber: text(reg?.gstNumber),
        panNumber: text(reg?.panNumber),
        contact: contactOf(reg),
        inRegister: Boolean(reg),
        workOrders: a.workOrders,
        workOrderValue: round2(a.workOrderValue),
        bills: a.bills,
        billedValue: round2(a.billedValue),
        grossBilled: round2(a.grossBilled),
        netPayable: round2(a.netPayable),
        retentionHeld: round2(a.retentionHeld),
        retentionReleased: round2(a.retentionReleased),
        advancePaid: round2(a.advancePaid),
        advanceRecovered: round2(a.advanceRecovered),
        advanceOutstanding: round2(advanceOutstanding),
        balanceToBill: round2(Math.max(0, a.workOrderValue - a.billedValue)),
        billedPercent: pct(a.billedValue, a.workOrderValue),
        openBills: a.openBills,
        openValue: round2(a.openValue),
        lastBillDate: a.lastBillMs === null ? null : isoDay(a.lastBillMs),
      };
    })
    .sort((x, y) => y.workOrderValue - x.workOrderValue || y.billedValue - x.billedValue || x.name.localeCompare(y.name));

  const workOrders: WorkOrderRow[] = input.workOrders
    .map((wo) => {
      const billed = woBilled.get(wo.id) ?? { value: 0, bills: 0 };
      const value = num(wo.totalAmount);
      const cancelled = text(wo.status) === 'Cancelled';
      return {
        id: wo.id,
        workOrderNo: text(wo.workOrderNo) || wo.id,
        subcontractorId: keyOf(wo.subcontractorId, wo.subcontractorName),
        subcontractorName: touch(wo.subcontractorId, wo.subcontractorName).name,
        date: text(wo.date) || isoDay(stampMs(wo.createdAt)),
        status: text(wo.status) || 'Active',
        value: round2(value),
        billedValue: round2(billed.value),
        bills: billed.bills,
        balance: cancelled ? 0 : round2(Math.max(0, value - billed.value)),
        billedPercent: pct(billed.value, value),
      };
    })
    .sort((x, y) => y.value - x.value || x.workOrderNo.localeCompare(y.workOrderNo));

  // Overdue first, then the longest waiting.
  open.sort((x, y) => Number(y.overdue) - Number(x.overdue) || (y.ageDays ?? -1) - (x.ageDays ?? -1));

  const sum = (f: (r: SubcontractorRow) => number) => round2(subcontractors.reduce((s, r) => s + f(r), 0));
  const workOrderValue = sum((r) => r.workOrderValue);
  const billedValue = sum((r) => r.billedValue);

  return {
    totals: {
      subcontractors: subcontractors.length,
      activeSubcontractors: subcontractors.filter((r) => r.workOrders > 0 && r.status !== 'Inactive').length,
      workOrders: subcontractors.reduce((s, r) => s + r.workOrders, 0),
      workOrderValue,
      bills: subcontractors.reduce((s, r) => s + r.bills, 0),
      billedValue,
      grossBilled: sum((r) => r.grossBilled),
      netPayable: sum((r) => r.netPayable),
      retentionHeld: sum((r) => r.retentionHeld),
      retentionReleased: sum((r) => r.retentionReleased),
      advancePaid: sum((r) => r.advancePaid),
      advanceRecovered: sum((r) => r.advanceRecovered),
      advanceOutstanding: sum((r) => r.advanceOutstanding),
      balanceToBill: sum((r) => r.balanceToBill),
      billedPercent: pct(billedValue, workOrderValue),
      openBills: open.length,
      openValue: round2(open.reduce((s, r) => s + r.amount, 0)),
      overdue: open.filter((r) => r.overdue).length,
    },
    statusCounts,
    subcontractors,
    workOrders,
    open,
    recent: recent
      .sort((x, y) => y.ms - x.ms)
      .slice(0, 8)
      .map(({ ms: _ms, ...row }) => row),
    byMonth: months.map((m) => {
      const v = byMonth.get(m)!;
      return { month: m, billed: round2(v.billed), advance: round2(v.advance) };
    }),
  };
}
