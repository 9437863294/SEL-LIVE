/**
 * Retention bifurcation: how much retention is held under each head *and rate*.
 *
 * One invoice often deducts retention twice — 10% (released on commissioning) and 30% (released on
 * erection) — sometimes under the same head, sometimes with a percentage typed by hand. Adding the
 * lines up by head hides that split, so every retention line is placed in a **slab**: its head plus
 * its rate.
 *
 *   - A line entered as a percentage counts under that percentage, exactly as typed (10, 30, 7.5…).
 *     Only a real rate counts: a typed 0, a negative or anything over 100 is an adjustment, kept
 *     under its head as a *fixed amount*.
 *   - A line entered as an amount (and every line imported from the legacy workbook, which only
 *     carried amounts) is read against the bill's own base — taxable, or gross for a head taken on
 *     gross. ₹30,000 on a ₹1,00,000 taxable reads as 30%. A result within 0.05 of a half-percent
 *     snaps to it; anything else stays a *fixed amount* under its head rather than inventing a rate.
 *   - A line of ₹0 holds nothing and is left out.
 *
 * A credit or debit note adjusts its invoice's retention, so its lines land in the invoice's slabs:
 *
 *   - a line whose own reading is a slab the invoice holds under that head goes there — a note
 *     reversing just the 30% reads as 30%;
 *   - anything else — a note reversing 10% and 30% together (it reads as 40%), or one with no
 *     taxable of its own — is shared over the invoice's slabs of that head, in proportion to what
 *     each holds;
 *   - a note whose invoice holds nothing under that head, or is not found, is read on its own base.
 *
 * A debit note under a note rule (`note-rules.ts`) is different: it adds retention for the whole value
 * rather than adjusting the invoice's. A line taken of the invoice plus its notes (`invoiceBase`)
 * counts at its own rate — 20% of ₹600 + ₹300 is the 20% slab — and is never shared over the
 * invoice's; an amount is read against that base, so ₹180 on it reads as 20%, not 60% of the note.
 *
 * A certified bill holds what the client certified: its certified retention lines, read against the
 * certified taxable (`retentionSource`), since the certified deductions replace the raised ones. A
 * note against a certified invoice therefore lands in the slabs the invoice holds as certified.
 *
 * Every slab total therefore adds up to exactly the retention the rest of the module reports.
 *
 * Releases can name the slab they release (`deductionTypeId` + `rate`) — recorded by hand, or carried
 * from a retention bill that says which retention it releases. Those reduce their slab's balance,
 * even when no bill in view holds that slab (last year's invoice, say). Releases that name none stay
 * at project level, shown as not tied to a rate.
 *
 * Pure: the API, the screens and the tests share it.
 */

import { isRetentionKind } from './calculations.ts';
import { isNoteType } from './certification.ts';
import { fromPaise, subtractMoney, sumBy, sumMoney, toPaise } from './money.ts';
import type { Bill, BillCertification, BillDeduction, BillTransactionType, DeductionKind, DeductionTypeMaster, RetentionRelease } from './types';

/** How close an amount-based rate must be to a half-percent to be read as that rate. */
const SNAP_TOLERANCE = 0.05;

/** The name a slab carries when its head has since been removed from Settings. */
const REMOVED_HEAD = 'Retention head no longer in Settings';

/** How a line's slab was known: typed as a %, worked out from an amount, or taken from a note's invoice. */
export type LineBasis = 'percent' | 'amount' | 'invoice';

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
 * (the default) or gross, which is the base an amount is read against — or, on a debit note under a
 * note rule, the invoice plus its notes the line was taken of (`invoiceBase`).
 */
export function retentionLineRate(line: Pick<BillDeduction, 'percentage' | 'amount' | 'baseAmount' | 'invoiceBase'>, bill: Pick<Bill, 'taxableAmount' | 'grossAmount'>, type?: Pick<DeductionTypeMaster, 'percentBase'>): LineRate {
  if (typeof line.percentage === 'number' && Number.isFinite(line.percentage)) {
    // Counted as typed — but only a real rate: 0, a negative or over 100 is an adjustment, not a slab.
    const rate = roundRate(line.percentage);
    return { rate: isRate(rate) ? rate : null, basis: 'percent' };
  }
  const base = line.invoiceBase ?? (type?.percentBase === 'gross' ? bill.grossAmount : bill.taxableAmount);
  if (!base || !Number.isFinite(base)) return { rate: null, basis: 'amount' };
  const implied = ((line.baseAmount ?? line.amount) / base) * 100;
  const half = Math.round(implied * 2) / 2;
  // Only a positive rate is a rate: a retention of the opposite sign to its bill is an adjustment.
  return isRate(half) && Math.abs(implied - half) <= SNAP_TOLERANCE ? { rate: half, basis: 'amount' } : { rate: null, basis: 'amount' };
}

/** A rate a slab can carry — the same range a release's rate is validated against. */
const isRate = (rate: number) => rate > 0 && rate <= 100;

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
  /** How the rate was known — the one way every line shares, or `mixed`; `bases` lists each way. */
  basis: LineBasis | 'mixed';
  bases: LineBasis[];
  lines: number;
}

type SlabSource = Pick<Bill, 'deductions' | 'taxableAmount' | 'grossAmount'>;

/**
 * The retention a bill holds, as slabs read it: once the client has certified the bill, its certified
 * deductions — which replace the raised ones (`effectiveDeductions`) — read against the certified
 * taxable and gross they were worked out on; before that, the raised lines and figures.
 */
export const retentionSource = (bill: SlabSource & { certification?: Pick<BillCertification, 'deductions' | 'taxableAmount' | 'grossAmount'> | null }): SlabSource =>
  bill.certification ? { deductions: bill.certification.deductions ?? [], taxableAmount: bill.certification.taxableAmount, grossAmount: bill.certification.grossAmount } : { deductions: bill.deductions, taxableAmount: bill.taxableAmount, grossAmount: bill.grossAmount };

const BASIS_ORDER: readonly LineBasis[] = ['percent', 'amount', 'invoice'];

/** `amount` shared in proportion to `weights` (all positive), exact to the paisa: the remainder goes to the largest. */
function share(amount: number, weights: readonly number[]): number[] {
  const total = toPaise(amount);
  const paise = weights.map(toPaise);
  const sum = paise.reduce((a, b) => a + b, 0);
  const parts = paise.map((weight) => Math.trunc((total * weight) / sum));
  parts[paise.indexOf(Math.max(...paise))] += total - parts.reduce((a, b) => a + b, 0);
  return parts.map(fromPaise);
}

/**
 * One bill's retention, slab by slab. For a credit / debit note, pass the invoice it adjusts as
 * `invoice`: the note's lines then land in the invoice's slabs (see the header). Without it a note
 * is read on its own base. Pass both through `retentionSource`, so a certified bill reads as certified.
 */
export function billRetentionSlabs(bill: SlabSource, types: readonly DeductionTypeMaster[], invoice?: SlabSource | null): BillSlab[] {
  const invoiceSlabs = invoice ? billRetentionSlabs(invoice, types) : [];
  const slabs = new Map<string, BillSlab>();
  const put = (slab: RetentionSlab, amount: number, basis: LineBasis) => {
    const entry = slabs.get(slab.key) ?? { slab, held: 0, basis, bases: [], lines: 0 };
    entry.held = sumMoney([entry.held, amount]);
    if (!entry.bases.includes(basis)) entry.bases = BASIS_ORDER.filter((each) => each === basis || entry.bases.includes(each));
    entry.basis = entry.bases.length === 1 ? entry.bases[0] : 'mixed';
    entry.lines += 1;
    slabs.set(slab.key, entry);
  };
  for (const line of bill.deductions ?? []) {
    // A ₹0 line holds nothing: counting it would only add an empty slab and a bill that holds none.
    if (!isRetentionKind(line.kind) || toPaise(line.amount) === 0) continue;
    const { rate, basis } = retentionLineRate(line, bill, types.find((type) => type.id === line.deductionTypeId));
    const own = slabOf(line.deductionTypeId, line.deductionTypeName, line.kind, rate, types);
    const held = invoiceSlabs.filter((entry) => entry.slab.deductionTypeId === line.deductionTypeId && toPaise(entry.held) > 0);
    // A line taken of the invoice plus its notes (a note rule) adds retention at its own rate.
    if (line.invoiceBase !== undefined || !held.length || held.some((entry) => entry.slab.key === own.key)) {
      put(own, line.amount, basis);
      continue;
    }
    // The note's own reading is no slab its invoice holds (10% + 30% reversed together reads as 40%):
    // share it over the invoice's slabs of this head.
    share(line.amount, held.map((entry) => entry.held)).forEach((amount, index) => {
      if (toPaise(amount) !== 0) put(held[index].slab, amount, 'invoice');
    });
  }
  return [...slabs.values()].sort((a, b) => compareSlabs(a.slab, b.slab));
}

/**
 * An invoice's slab source with the lines its debit notes took of the invoice plus its notes (a note
 * rule) added: those notes hold retention for the whole value, so a credit note reversing it is read
 * against their rates. Such lines carry their own base (`invoiceBase`), so they read the same here.
 */
export const withRuleLines = (source: SlabSource, ruleLines: readonly BillDeduction[] | undefined): SlabSource =>
  ruleLines?.length ? { ...source, deductions: [...source.deductions, ...ruleLines] } : source;

/**
 * The slab a release names. With its head, that slab — whether or not any bill holds it. With only
 * a rate (and the release's kind), the matching slab among `slabs` — pass the slabs the release's
 * own project holds, so it is never booked to another project's rate.
 */
export function releaseSlabKey(release: Pick<RetentionRelease, 'deductionTypeId' | 'rate' | 'kind'>, slabs: readonly RetentionSlab[]): string | null {
  if (release.rate === undefined) return null;
  const rate = release.rate === null ? null : roundRate(release.rate);
  if (release.deductionTypeId) return slabKey(release.deductionTypeId, rate);
  return slabs.find((slab) => slab.rate === rate && slab.kind === release.kind)?.key ?? null;
}

/** The slab a release names by its head and rate, described from the deduction master; null when it names none. */
export function namedReleaseSlab(release: Pick<RetentionRelease, 'deductionTypeId' | 'rate' | 'kind'>, types: readonly DeductionTypeMaster[]): RetentionSlab | null {
  if (release.rate === undefined || !release.deductionTypeId) return null;
  return slabOf(release.deductionTypeId, REMOVED_HEAD, release.kind, release.rate === null ? null : roundRate(release.rate), types);
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
  /** True when some of a note's retention was shared over its invoice's slabs. */
  fromInvoice: boolean;
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
 * per bill. Deleted bills and cancelled releases are left out. `invoices` are bills a note in `bills`
 * may adjust that are not in `bills` themselves — an invoice outside the filters still decides
 * which slabs its note lands in.
 */
export function retentionBifurcation(bills: readonly Bill[], releases: readonly RetentionRelease[], types: readonly DeductionTypeMaster[], invoices: readonly Bill[] = []): RetentionBifurcation {
  const byId = new Map([...invoices, ...bills].map((bill) => [bill.id, bill]));
  // Retention a debit note adds under a note rule is held on the note, not its invoice; a credit note
  // reversing it must find those rates too, so the invoice's slabs are read with those lines added.
  const ruleLines = new Map<string, BillDeduction[]>();
  for (const bill of byId.values()) {
    if (bill.isDeleted || !bill.againstBillId || !isNoteType(bill.transactionType)) continue;
    const lines = (bill.deductions ?? []).filter((line) => line.invoiceBase !== undefined);
    if (lines.length) ruleLines.set(bill.againstBillId, [...(ruleLines.get(bill.againstBillId) ?? []), ...lines]);
  }
  const invoiceSource = (invoice: Bill) => withRuleLines(retentionSource(invoice), ruleLines.get(invoice.id));
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
    const invoice = bill.againstBillId && isNoteType(bill.transactionType) ? byId.get(bill.againstBillId) : undefined;
    const slabs = billRetentionSlabs(retentionSource(bill), types, invoice ? invoiceSource(invoice) : undefined);
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
      fromInvoice: false,
    };
    const projectRow = project(bill.projectId, bill.projectNameSnapshot);
    for (const { slab, held, bases } of slabs) {
      columns.set(slab.key, slab);
      add(row.cells, slab.key, held);
      add(projectRow.cells, slab.key, held);
      row.held = sumMoney([row.held, held]);
      projectRow.held = sumMoney([projectRow.held, held]);
      if (bases.includes('amount')) row.fromAmounts = true;
      if (bases.includes('invoice')) row.fromInvoice = true;
      billsPerSlab.set(slab.key, (billsPerSlab.get(slab.key) ?? new Set()).add(bill.id));
      projectsPerSlab.set(slab.key, (projectsPerSlab.get(slab.key) ?? new Set()).add(bill.projectId));
    }
    byBill.push(row);
  }

  for (const release of releases) {
    if (release.status !== 'active') continue;
    const projectRow = project(release.projectId, release.projectNameSnapshot);
    // A release naming its head counts in that slab even when no bill in view holds it (the slab is
    // added, holding nothing). One naming only a rate matches a slab its own project holds.
    const named = namedReleaseSlab(release, types);
    if (named && !columns.has(named.key)) columns.set(named.key, named);
    const key = named?.key ?? releaseSlabKey(release, Object.keys(projectRow.cells).flatMap((held) => columns.get(held) ?? []));
    projectRow.released = sumMoney([projectRow.released, release.amount]);
    if (key) add(projectRow.releasedCells, key, release.amount);
    else projectRow.unattributed = sumMoney([projectRow.unattributed, release.amount]);
  }
  for (const row of projects.values()) row.balance = subtractMoney(row.held, row.released);
  const ordered = [...columns.values()].sort(compareSlabs);

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
