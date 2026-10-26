/**
 * Retention bifurcation: how much retention is held under each head *and rate*.
 *
 * One invoice often deducts retention twice — 10% (released on commissioning) and 30% (released on
 * erection) — sometimes under the same head, sometimes with a percentage typed by hand. Adding the
 * lines up by head hides that split, so every retention line is placed in a **slab**: its head plus
 * its rate.
 *
 *   - A line entered as a percentage counts under that percentage, exactly as typed (10, 30, 7.5…).
 *   - A line entered as an amount (and every line imported from the legacy workbook, which only
 *     carried amounts) is read against the bill's own base — taxable, or gross for a head taken on
 *     gross. ₹30,000 on a ₹1,00,000 taxable reads as 30%. A result within 0.05 of a half-percent
 *     snaps to it; anything else stays a *fixed amount* under its head rather than inventing a rate.
 *
 * Credit and debit notes are bills too: a note's retention line is read against the note's own base,
 * so a credit note reversing 30% retention lands in the 30% slab, negative. Every slab total
 * therefore adds up to exactly the retention the rest of the module reports.
 *
 * Releases can name the slab they release (`deductionTypeId` + `rate`) — recorded by hand, or carried
 * from a retention bill that says which retention it releases. Those reduce their slab's balance;
 * releases that name none stay at project level, shown as not tied to a rate.
 *
 * Pure: the API, the screens and the tests share it.
 */

import { isRetentionKind } from './calculations.ts';
import { subtractMoney, sumBy, sumMoney, toPaise } from './money.ts';
import type { Bill, BillDeduction, BillTransactionType, DeductionKind, DeductionTypeMaster, RetentionRelease } from './types';

/** How close an amount-based rate must be to a half-percent to be read as that rate. */
const SNAP_TOLERANCE = 0.05;

export interface LineRate {
  /** The percentage, or null for a fixed amount that does not read as a rate. */
  rate: number | null;
  /** `percent` = typed as a percentage; `amount` = worked out from a typed amount. */
  basis: 'percent' | 'amount';
}

const roundRate = (rate: number) => Math.round(rate * 10000) / 10000;

/** A rate for display: "30", "7.5", "12.25". */
export const formatRate = (rate: number): string => String(roundRate(rate));

/**
 * The rate a retention line was deducted at. `type` tells whether the head is taken on taxable
 * (the default) or gross, which is the base an amount is read against.
 */
export function retentionLineRate(line: Pick<BillDeduction, 'percentage' | 'amount' | 'baseAmount'>, bill: Pick<Bill, 'taxableAmount' | 'grossAmount'>, type?: Pick<DeductionTypeMaster, 'percentBase'>): LineRate {
  if (typeof line.percentage === 'number' && Number.isFinite(line.percentage)) return { rate: roundRate(line.percentage), basis: 'percent' };
  const base = type?.percentBase === 'gross' ? bill.grossAmount : bill.taxableAmount;
  if (!base || !Number.isFinite(base)) return { rate: null, basis: 'amount' };
  const implied = ((line.baseAmount ?? line.amount) / base) * 100;
  const half = Math.round(implied * 2) / 2;
  // Only a positive rate is a rate: a retention of the opposite sign to its bill is an adjustment.
  return half > 0 && Math.abs(implied - half) <= SNAP_TOLERANCE ? { rate: half, basis: 'amount' } : { rate: null, basis: 'amount' };
}

export interface RetentionSlab {
  /** `deductionTypeId|rate` — or `deductionTypeId|amount` for fixed amounts. */
  key: string;
  deductionTypeId: string;
  name: string;
  kind: DeductionKind;
  rate: number | null;
  /** "Retention Against Invoice @ 30%" / "Retention – Time Extension · fixed amount". */
  label: string;
  /** The head's place in the deduction master, for a stable column order. */
  sequence: number;
}

export const slabKey = (deductionTypeId: string, rate: number | null): string => `${deductionTypeId}|${rate === null ? 'amount' : formatRate(rate)}`;

function slabOf(deductionTypeId: string, name: string, kind: DeductionKind, rate: number | null, types: readonly DeductionTypeMaster[]): RetentionSlab {
  const type = types.find((entry) => entry.id === deductionTypeId);
  const headName = type?.name ?? name;
  return {
    key: slabKey(deductionTypeId, rate),
    deductionTypeId,
    name: headName,
    kind: type?.kind ?? kind,
    rate,
    label: rate === null ? `${headName} · fixed amount` : `${headName} @ ${formatRate(rate)}%`,
    sequence: type?.sequence ?? 999,
  };
}

/** Heads in master order; within a head, rates low to high; fixed amounts last. */
export const compareSlabs = (a: RetentionSlab, b: RetentionSlab): number =>
  a.sequence - b.sequence || a.name.localeCompare(b.name) || (a.rate === null ? 1 : 0) - (b.rate === null ? 1 : 0) || (a.rate ?? 0) - (b.rate ?? 0);

export interface BillSlab {
  slab: RetentionSlab;
  held: number;
  /** How the rate was known: every line typed as %, every line worked out from an amount, or both. */
  basis: 'percent' | 'amount' | 'mixed';
  lines: number;
}

/** One bill's retention, slab by slab (its own lines only — a note is a bill of its own). */
export function billRetentionSlabs(bill: Pick<Bill, 'deductions' | 'taxableAmount' | 'grossAmount'>, types: readonly DeductionTypeMaster[]): BillSlab[] {
  const slabs = new Map<string, BillSlab>();
  for (const line of bill.deductions ?? []) {
    if (!isRetentionKind(line.kind)) continue;
    const { rate, basis } = retentionLineRate(line, bill, types.find((type) => type.id === line.deductionTypeId));
    const slab = slabOf(line.deductionTypeId, line.deductionTypeName, line.kind, rate, types);
    const entry = slabs.get(slab.key) ?? { slab, held: 0, basis, lines: 0 };
    entry.held = sumMoney([entry.held, line.amount]);
    entry.basis = entry.basis === basis ? basis : 'mixed';
    entry.lines += 1;
    slabs.set(slab.key, entry);
  }
  return [...slabs.values()].sort((a, b) => compareSlabs(a.slab, b.slab));
}

/** The slab a release names, if it names one that exists among `slabs`. */
export function releaseSlabKey(release: Pick<RetentionRelease, 'deductionTypeId' | 'rate' | 'kind'>, slabs: readonly RetentionSlab[]): string | null {
  if (release.rate === undefined) return null;
  const rate = release.rate === null ? null : roundRate(release.rate);
  if (release.deductionTypeId) {
    const key = slabKey(release.deductionTypeId, rate);
    return slabs.some((slab) => slab.key === key) ? key : null;
  }
  // A release naming only a rate: the slab of that rate under a head of the release's kind.
  return slabs.find((slab) => slab.rate === rate && slab.kind === release.kind)?.key ?? null;
}

export interface SlabTotal {
  slab: RetentionSlab;
  bills: number;
  projects: number;
  held: number;
  released: number;
  balance: number;
}

export interface BifurcationBillRow {
  id: string;
  gstInvoiceNumber?: string;
  billSerialNumber?: string;
  billDate: string;
  projectId: string;
  projectName: string;
  transactionType: BillTransactionType;
  billTypeName: string;
  /** Held per slab key. */
  cells: Record<string, number>;
  held: number;
  /** True when some line's rate was worked out from an amount rather than typed. */
  fromAmounts: boolean;
}

export interface BifurcationProjectRow {
  projectId: string;
  projectName: string;
  /** Held per slab key. */
  cells: Record<string, number>;
  /** Released per slab key (releases that name their slab). */
  releasedCells: Record<string, number>;
  held: number;
  released: number;
  /** Released at project level without naming a slab. */
  unattributed: number;
  balance: number;
}

export interface RetentionBifurcation {
  /** Every slab present, in column order. */
  columns: RetentionSlab[];
  slabs: SlabTotal[];
  byProject: BifurcationProjectRow[];
  byBill: BifurcationBillRow[];
  totals: { held: number; released: number; unattributed: number; balance: number; cells: Record<string, number> };
}

const add = (cells: Record<string, number>, key: string, amount: number) => {
  cells[key] = sumMoney([cells[key] ?? 0, amount]);
};

/**
 * The bifurcation over a set of bills and the releases of the same scope: per slab, per project and
 * per bill. Deleted bills and cancelled releases are left out.
 */
export function retentionBifurcation(bills: readonly Bill[], releases: readonly RetentionRelease[], types: readonly DeductionTypeMaster[]): RetentionBifurcation {
  const columns = new Map<string, RetentionSlab>();
  const byBill: BifurcationBillRow[] = [];
  const projects = new Map<string, BifurcationProjectRow>();
  const project = (projectId: string, projectName: string) => {
    const existing = projects.get(projectId);
    if (existing) return existing;
    const row: BifurcationProjectRow = { projectId, projectName, cells: {}, releasedCells: {}, held: 0, released: 0, unattributed: 0, balance: 0 };
    projects.set(projectId, row);
    return row;
  };
  const billsPerSlab = new Map<string, Set<string>>();
  const projectsPerSlab = new Map<string, Set<string>>();

  for (const bill of bills) {
    if (bill.isDeleted) continue;
    const slabs = billRetentionSlabs(bill, types);
    if (!slabs.length) continue;
    const row: BifurcationBillRow = {
      id: bill.id,
      gstInvoiceNumber: bill.gstInvoiceNumber,
      billSerialNumber: bill.billSerialNumber,
      billDate: bill.billDate,
      projectId: bill.projectId,
      projectName: bill.projectNameSnapshot,
      transactionType: bill.transactionType,
      billTypeName: bill.billTypeName,
      cells: {},
      held: 0,
      fromAmounts: false,
    };
    const projectRow = project(bill.projectId, bill.projectNameSnapshot);
    for (const { slab, held, basis } of slabs) {
      columns.set(slab.key, slab);
      add(row.cells, slab.key, held);
      add(projectRow.cells, slab.key, held);
      row.held = sumMoney([row.held, held]);
      projectRow.held = sumMoney([projectRow.held, held]);
      if (basis !== 'percent') row.fromAmounts = true;
      billsPerSlab.set(slab.key, (billsPerSlab.get(slab.key) ?? new Set()).add(bill.id));
      projectsPerSlab.set(slab.key, (projectsPerSlab.get(slab.key) ?? new Set()).add(bill.projectId));
    }
    byBill.push(row);
  }

  const ordered = [...columns.values()].sort(compareSlabs);
  for (const release of releases) {
    if (release.status !== 'active') continue;
    const projectRow = project(release.projectId, release.projectNameSnapshot);
    const key = releaseSlabKey(release, ordered);
    projectRow.released = sumMoney([projectRow.released, release.amount]);
    if (key) add(projectRow.releasedCells, key, release.amount);
    else projectRow.unattributed = sumMoney([projectRow.unattributed, release.amount]);
  }
  for (const row of projects.values()) row.balance = subtractMoney(row.held, row.released);

  const projectRows = [...projects.values()].sort((a, b) => b.held - a.held || a.projectName.localeCompare(b.projectName));
  const slabs: SlabTotal[] = ordered.map((slab) => {
    const held = sumBy(projectRows, (row) => row.cells[slab.key] ?? 0);
    const released = sumBy(projectRows, (row) => row.releasedCells[slab.key] ?? 0);
    return { slab, bills: billsPerSlab.get(slab.key)?.size ?? 0, projects: projectsPerSlab.get(slab.key)?.size ?? 0, held, released, balance: subtractMoney(held, released) };
  });
  const cells: Record<string, number> = {};
  for (const total of slabs) cells[total.slab.key] = total.held;
  const held = sumBy(projectRows, (row) => row.held);
  const released = sumBy(projectRows, (row) => row.released);
  return {
    columns: ordered,
    slabs,
    byProject: projectRows,
    byBill: byBill.sort((a, b) => a.billDate.localeCompare(b.billDate) || (a.gstInvoiceNumber ?? '').localeCompare(b.gstInvoiceNumber ?? '')),
    totals: { held, released, unattributed: sumBy(projectRows, (row) => row.unattributed), balance: subtractMoney(held, released), cells },
  };
}

/** Whether a set of cells holds anything (for hiding empty slabs). */
export const hasAmount = (amount: number | undefined): boolean => toPaise(amount ?? 0) !== 0;
