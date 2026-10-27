/**
 * Raised vs certified.
 *
 * SEL raises a bill; the client certifies it — sometimes for less (a lower measured quantity), often
 * with more deducted (a penalty, a different TDS base, extra retention). The two are settled
 * differently:
 *
 *   - **Deductions** need no document. Once certified, the client's certified deductions replace
 *     the raised ones in the bill's net, outstanding, reports and retention (`effectiveDeductions`
 *     in `calculations.ts`) — the client simply pays the invoice less what it deducted.
 *   - **The invoice value** — taxable and the GST on it — changes only through a credit / debit note
 *     against the bill (a GST document). The issued invoice itself is never edited.
 *
 * So three sets of figures are compared, line by line:
 *
 *   raised      the bill as issued
 *   notes       the credit / debit notes raised against it so far
 *   certified   what the client approved and deducts
 *
 * and `pending = certified − (raised + notes)` is what a note still has to adjust — for the taxable,
 * the GST components and the gross. When the taxable and the GST match within the amount tolerance,
 * the bill is "matched", whatever the deductions did; until then `suggestedNote` spells out the note
 * to raise — taxable and GST only — for the bill form to pre-fill.
 *
 * The deduction lines are shown raised vs certified for the record, but nothing is pending on them.
 * The net still to adjust is the gross still to adjust plus whatever the notes themselves deduct: a
 * deduction on a note comes on top of the certified ones, so it shows there even on a matched bill.
 *
 * Pure: the server, the browser and the test suite use the same arithmetic.
 */

import { roundMoney, subtractMoney, sumBy, sumMoney, toPaise } from './money.ts';
import type { Bill, BillCertification, BillDeduction, BillTransactionType, CertificationReceiptRule, CertificationState, DeductionKind, GstType } from './types';

export const isNoteType = (type: BillTransactionType): boolean => type === 'credit_note' || type === 'debit_note';

/** Invoices, retention bills, advances and adjustments are certified by the client; notes are SEL's own. */
export const canBeCertified = (bill: Pick<Bill, 'transactionType' | 'isDeleted'>): boolean => !bill.isDeleted && !isNoteType(bill.transactionType);

/** Types the "no payment before certification" rule can cover (notes are never certified). */
export const CERTIFIABLE_TYPES: readonly BillTransactionType[] = ['invoice', 'retention_bill', 'adjustment', 'advance'];

/**
 * Why a receipt cannot be allocated to this bill yet, or null if it can: the rule is on, covers the
 * bill's type, the bill is not exempt (migrated, or dated before the rule's start), and the client
 * has not certified it.
 */
export function receiptBlockReason(bill: Pick<Bill, 'transactionType' | 'source' | 'billDate' | 'certification' | 'gstInvoiceNumber' | 'billSerialNumber'>, rule: CertificationReceiptRule | undefined): string | null {
  if (!rule?.enabled || bill.certification) return null;
  if (!rule.transactionTypes.includes(bill.transactionType)) return null;
  if (rule.exemptImported && bill.source === 'excel_import') return null;
  if (rule.fromDate && bill.billDate < rule.fromDate) return null;
  const reference = bill.gstInvoiceNumber || bill.billSerialNumber || 'This bill';
  return `${reference} is not certified by the client yet — record the client's certification before receiving payment against it.`;
}

/** The parts of a bill, a note or a certification that are compared. */
export interface ComparableFigures {
  taxableAmount: number;
  gstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  grossAmount: number;
  deductions: readonly BillDeduction[];
  totalDeduction: number;
  net: number;
}

export const raisedFigures = (bill: Bill): ComparableFigures => ({
  taxableAmount: bill.taxableAmount,
  gstAmount: bill.gstAmount,
  cgstAmount: bill.cgstAmount ?? 0,
  sgstAmount: bill.sgstAmount ?? 0,
  igstAmount: bill.igstAmount ?? 0,
  grossAmount: bill.grossAmount,
  deductions: bill.deductions ?? [],
  // Once certified, `totalDeduction` / `netReceivable` are the certified deductions'; the raised ones
  // are stored beside them (a bill stored before they were still had the raised figures there).
  totalDeduction: bill.raisedTotalDeduction ?? bill.totalDeduction,
  net: bill.raisedNetReceivable ?? bill.netReceivable,
});

export const certifiedFigures = (certification: BillCertification): ComparableFigures => ({
  taxableAmount: certification.taxableAmount,
  gstAmount: certification.gstAmount,
  cgstAmount: certification.cgstAmount ?? 0,
  sgstAmount: certification.sgstAmount ?? 0,
  igstAmount: certification.igstAmount ?? 0,
  grossAmount: certification.grossAmount,
  deductions: certification.deductions ?? [],
  totalDeduction: certification.totalDeduction,
  net: certification.netAmount,
});

/** All live notes against one bill, added together (credit notes carry negative figures). */
export function notesFigures(notes: readonly Bill[]): ComparableFigures {
  const live = notes.filter((note) => !note.isDeleted);
  return {
    taxableAmount: sumBy(live, (note) => note.taxableAmount),
    gstAmount: sumBy(live, (note) => note.gstAmount),
    cgstAmount: sumBy(live, (note) => note.cgstAmount ?? 0),
    sgstAmount: sumBy(live, (note) => note.sgstAmount ?? 0),
    igstAmount: sumBy(live, (note) => note.igstAmount ?? 0),
    grossAmount: sumBy(live, (note) => note.grossAmount),
    deductions: live.flatMap((note) => note.deductions ?? []),
    totalDeduction: sumBy(live, (note) => note.totalDeduction),
    net: sumBy(live, (note) => note.netReceivable),
  };
}

interface DeductionTotals {
  name: string;
  kind: DeductionKind;
  amount: number;
  base: number;
  cgst: number;
  sgst: number;
  igst: number;
  gstRate?: number;
}

/** Deduction lines summed per deduction type: total, base (before GST) and each GST component. */
export function deductionsByType(lines: readonly BillDeduction[]): Map<string, DeductionTotals> {
  const totals = new Map<string, DeductionTotals>();
  for (const line of lines) {
    const entry = totals.get(line.deductionTypeId) ?? { name: line.deductionTypeName, kind: line.kind, amount: 0, base: 0, cgst: 0, sgst: 0, igst: 0 };
    entry.amount = sumMoney([entry.amount, line.amount]);
    entry.base = sumMoney([entry.base, line.baseAmount ?? line.amount]);
    entry.cgst = sumMoney([entry.cgst, line.cgstAmount ?? 0]);
    entry.sgst = sumMoney([entry.sgst, line.sgstAmount ?? 0]);
    entry.igst = sumMoney([entry.igst, line.igstAmount ?? 0]);
    if (line.gstRate) entry.gstRate = line.gstRate;
    totals.set(line.deductionTypeId, entry);
  }
  return totals;
}

export interface ComparisonLine {
  /** `taxable`, `cgst`, `sgst`, `igst`, `gst`, `gross`, `deduction:<typeId>`, `totalDeduction`, `net`. */
  key: string;
  label: string;
  group: 'amount' | 'deduction' | 'total';
  /**
   * How a difference on this line is settled: `note` — by a credit / debit note (the invoice value
   * and the net); `certification` — by the certification itself (deductions: the certified ones
   * apply), so `pending` is null and the line is always matched.
   */
  settledBy: 'note' | 'certification';
  raised: number;
  /** Credit / debit notes against the bill so far. */
  notes: number;
  /** `null` until the client has certified. */
  certified: number | null;
  /** The client's change: certified − raised. */
  difference: number | null;
  /**
   * Still to adjust by a note: certified − (raised + notes) — on the net line, the summary's
   * `pendingNet`, measured from what the bill is now paid (the certified deductions already
   * apply). Null when not certified, or settled by the certification.
   */
  pending: number | null;
  matched: boolean;
}

export interface CertificationSummary {
  state: CertificationState;
  /** The bill's net as raised (gross less the raised deductions). */
  raisedNet: number;
  notesNet: number;
  notesCount: number;
  certifiedNet: number | null;
  /** Certified net − raised net: what the client's certification changed. */
  variance: number | null;
  /** Certified − raised total deduction: applied by the certification itself, no note needed. */
  deductionChange: number | null;
  /**
   * Certified net − what the bill and its notes are now paid (raised gross + notes, less the
   * certified deductions and any the notes carry): `pendingGross`, plus whatever the notes deduct —
   * which no further note settles, so it can remain on a matched bill.
   */
  pendingNet: number | null;
  /** The taxable + GST still to adjust — what the note's own invoice value must be. */
  pendingGross: number | null;
}

/** The credit (or debit) note that makes the invoice value of raised + notes equal the certification. */
export interface SuggestedNote {
  transactionType: 'credit_note' | 'debit_note';
  taxableAmount: number;
  gstType?: GstType;
  gstPercent?: number;
  gstAmount: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  /**
   * Net of the note: its gross, since a note to match a certification carries no deductions (saved,
   * it is rounded to the rupee like any net when that setting is on).
   */
  netAmount: number;
  description: string;
}

export interface CertificationComparison {
  summary: CertificationSummary;
  lines: ComparisonLine[];
  suggestedNote: SuggestedNote | null;
}

const within = (amount: number | null, tolerance: number) => amount === null || Math.abs(toPaise(amount)) <= toPaise(Math.abs(tolerance));

/**
 * One figure still to adjust: certified − (raised + notes). Asked only of a certified bill, so a
 * figure the stored certification lacks reads as 0 — a large pending — never as nothing to adjust.
 */
const pendingFigure = (pick: (figures: ComparableFigures) => number, raised: ComparableFigures, notes: ComparableFigures, certified: ComparableFigures): number =>
  subtractMoney(pick(certified), sumMoney([pick(raised), pick(notes)]));

/** Just the state and headline figures — what the register needs per row. */
export function certificationSummary(bill: Bill, notes: readonly Bill[], tolerance: number): CertificationSummary {
  const live = notes.filter((note) => !note.isDeleted);
  const raised = raisedFigures(bill);
  const fromNotes = notesFigures(live);
  const certification = bill.certification;
  if (!certification) {
    return { state: 'not_certified', raisedNet: raised.net, notesNet: fromNotes.net, notesCount: live.length, certifiedNet: null, variance: null, deductionChange: null, pendingNet: null, pendingGross: null };
  }
  const certified = certifiedFigures(certification);
  const pending = (pick: (figures: ComparableFigures) => number) => pendingFigure(pick, raised, fromNotes, certified);
  const pendingTaxable = pending((figures) => figures.taxableAmount);
  const pendingGst = pending((figures) => figures.gstAmount);
  const pendingGross = pending((figures) => figures.grossAmount);
  // Only the invoice value needs a note: the certified deductions already apply to the bill, so a
  // bill whose taxable and GST match is matched however its deductions changed.
  const matched = within(pendingTaxable, tolerance) && within(pendingGst, tolerance);
  return {
    state: matched ? 'matched' : 'adjustment_pending',
    raisedNet: raised.net,
    notesNet: fromNotes.net,
    notesCount: live.length,
    certifiedNet: certified.net,
    variance: subtractMoney(certified.net, raised.net),
    deductionChange: subtractMoney(certified.totalDeduction, raised.totalDeduction),
    // The bill is paid its raised gross less the certified deductions, the notes their own net; so the
    // net still to adjust is the invoice value still to adjust, plus anything notes deduct besides.
    pendingNet: sumMoney([pendingGross, fromNotes.totalDeduction]),
    pendingGross,
  };
}

/** Every line, raised vs notes vs certified, plus the note still to raise. */
export function compareCertification(bill: Bill, notes: readonly Bill[], tolerance: number): CertificationComparison {
  const live = notes.filter((note) => !note.isDeleted);
  const summary = certificationSummary(bill, live, tolerance);
  const raised = raisedFigures(bill);
  const fromNotes = notesFigures(live);
  const certified = bill.certification ? certifiedFigures(bill.certification) : null;

  const line = (key: string, label: string, group: ComparisonLine['group'], pick: (figures: ComparableFigures) => number): ComparisonLine => {
    const pending = certified ? pendingFigure(pick, raised, fromNotes, certified) : null;
    return {
      key,
      label,
      group,
      settledBy: 'note',
      raised: pick(raised),
      notes: pick(fromNotes),
      certified: certified ? pick(certified) : null,
      difference: certified ? subtractMoney(pick(certified), pick(raised)) : null,
      pending,
      matched: within(pending, tolerance),
    };
  };

  // CGST / SGST / IGST lines compare like with like: only when the raised bill and the certification
  // are split the same way. An imported bill (one GST figure) certified as CGST + SGST compares on
  // the GST total alone.
  const certifiedType = bill.certification?.gstType;
  const gstType = bill.gstType && (!certifiedType || certifiedType === bill.gstType) ? bill.gstType : undefined;
  const lines: ComparisonLine[] = [line('taxable', 'Taxable', 'amount', (figures) => figures.taxableAmount)];
  if (gstType === 'cgst-sgst') {
    lines.push(line('cgst', `CGST${bill.cgstRate ? ` @ ${bill.cgstRate}%` : ''}`, 'amount', (figures) => figures.cgstAmount));
    lines.push(line('sgst', `SGST${bill.sgstRate ? ` @ ${bill.sgstRate}%` : ''}`, 'amount', (figures) => figures.sgstAmount));
  } else if (gstType === 'igst') {
    lines.push(line('igst', `IGST${bill.igstRate ? ` @ ${bill.igstRate}%` : ''}`, 'amount', (figures) => figures.igstAmount));
  }
  lines.push(line('gst', 'GST', 'amount', (figures) => figures.gstAmount));
  lines.push(line('gross', 'Gross', 'total', (figures) => figures.grossAmount));

  // Every deduction type that appears anywhere, in the order first met (raised, then certified, then notes).
  const raisedByType = deductionsByType(raised.deductions);
  const notesByType = deductionsByType(fromNotes.deductions);
  const certifiedByType = certified ? deductionsByType(certified.deductions) : new Map<string, DeductionTotals>();
  const typeIds = [...new Set([...raisedByType.keys(), ...certifiedByType.keys(), ...notesByType.keys()])];
  const nameOf = (id: string) => raisedByType.get(id)?.name ?? certifiedByType.get(id)?.name ?? notesByType.get(id)?.name ?? id;
  // Deductions are settled by the certification itself (its deductions apply), never by a note.
  const byCertification = (entry: Omit<ComparisonLine, 'settledBy' | 'pending' | 'matched'>): ComparisonLine => ({ ...entry, settledBy: 'certification', pending: null, matched: true });
  for (const id of typeIds) {
    const amountIn = (map: Map<string, DeductionTotals>) => map.get(id)?.amount ?? 0;
    const certifiedValue = certified ? amountIn(certifiedByType) : null;
    lines.push(
      byCertification({
        key: `deduction:${id}`,
        label: nameOf(id),
        group: 'deduction',
        raised: amountIn(raisedByType),
        notes: amountIn(notesByType),
        certified: certifiedValue,
        difference: certifiedValue === null ? null : subtractMoney(certifiedValue, amountIn(raisedByType)),
      }),
    );
  }
  lines.push({ ...line('totalDeduction', 'Total deduction', 'total', (figures) => figures.totalDeduction), settledBy: 'certification', pending: null, matched: true });
  const net = line('net', 'Net receivable', 'total', (figures) => figures.net);
  lines.push({ ...net, pending: summary.pendingNet, matched: within(summary.pendingNet, tolerance) });

  return { summary, lines, suggestedNote: summary.state === 'adjustment_pending' && certified ? suggestNote(bill, raised, fromNotes, certified) : null };
}

function suggestNote(bill: Bill, raised: ComparableFigures, fromNotes: ComparableFigures, certified: ComparableFigures): SuggestedNote {
  const pending = (pick: (figures: ComparableFigures) => number) => pendingFigure(pick, raised, fromNotes, certified);
  const taxableAmount = pending((figures) => figures.taxableAmount);
  const pendingGst = pending((figures) => figures.gstAmount);
  const raisedType = bill.gstType;
  const certifiedType = bill.certification?.gstType;
  let gstType: GstType | undefined;
  let cgstAmount: number | undefined;
  let sgstAmount: number | undefined;
  let igstAmount: number | undefined;
  if ((raisedType === 'cgst-sgst' || raisedType === 'igst') && (!certifiedType || certifiedType === raisedType)) {
    // Split the same way on both sides: reverse component by component.
    gstType = raisedType;
    if (raisedType === 'cgst-sgst') {
      cgstAmount = pending((figures) => figures.cgstAmount);
      sgstAmount = pending((figures) => figures.sgstAmount);
    } else {
      igstAmount = pending((figures) => figures.igstAmount);
    }
  } else {
    // Otherwise (an imported unsplit bill, or a different certified type) the GST still to adjust is
    // split the way the certification is.
    const type = certifiedType && certifiedType !== 'none' ? certifiedType : raisedType && raisedType !== 'none' ? raisedType : undefined;
    if (type === 'cgst-sgst') {
      gstType = type;
      cgstAmount = roundMoney(pendingGst / 2);
      sgstAmount = subtractMoney(pendingGst, cgstAmount);
    } else if (type === 'igst') {
      gstType = type;
      igstAmount = pendingGst;
    } else if (toPaise(pendingGst) === 0 && (raisedType === 'none' || certifiedType === 'none')) {
      gstType = 'none';
    }
  }
  const gstAmount = gstType === 'cgst-sgst' ? sumMoney([cgstAmount ?? 0, sgstAmount ?? 0]) : gstType === 'igst' ? (igstAmount ?? 0) : gstType === 'none' ? 0 : pendingGst;

  // No deduction lines: the certified deductions already apply to the invoice itself.
  const gross = sumMoney([taxableAmount, gstAmount]);
  // The type follows what the note does to the receivable — its gross — so a credit note's net is
  // never positive. Only a GST rate correction moves the taxable and the GST opposite ways; there the
  // gross decides, and a zero gross follows the taxable.
  const reduces = toPaise(gross) !== 0 ? gross < 0 : taxableAmount < 0;
  const reference = bill.certification?.reference ? ` ${bill.certification.reference}` : '';
  const invoice = bill.gstInvoiceNumber || bill.billSerialNumber || bill.id;
  return {
    transactionType: reduces ? 'credit_note' : 'debit_note',
    taxableAmount,
    gstType,
    gstPercent: bill.gstPercent ?? bill.certification?.gstPercent,
    gstAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    netAmount: roundMoney(gross),
    description: `To match client certification${reference} of ${bill.certification?.certifiedDate ?? ''} against invoice ${invoice}`.replace(/\s+/g, ' ').trim(),
  };
}

/* ── register totals ─────────────────────────────────────────────────────── */

export interface CertificationTotals {
  count: number;
  certified: number;
  awaiting: number;
  matched: number;
  pending: number;
  raisedNet: number;
  /** Raised net of the certified bills only — compared like for like with the certified net. */
  raisedNetCertified: number;
  certifiedNet: number;
  variance: number;
  /** The part of the variance the certified deductions apply by themselves (certified − raised deduction). */
  deductionChange: number;
  notesNet: number;
  pendingNet: number;
  /**
   * The invoice value (taxable + GST) still to adjust on the bills with a note pending: what the
   * credit / debit notes to raise add up to. A matched bill's leftover within the tolerance is no
   * note anyone will raise, so it is left out.
   */
  pendingGross: number;
}

export function certificationTotals(summaries: readonly CertificationSummary[]): CertificationTotals {
  const certified = summaries.filter((summary) => summary.state !== 'not_certified');
  const notePending = summaries.filter((summary) => summary.state === 'adjustment_pending');
  return {
    count: summaries.length,
    certified: certified.length,
    awaiting: summaries.length - certified.length,
    matched: summaries.filter((summary) => summary.state === 'matched').length,
    pending: notePending.length,
    raisedNet: sumBy(summaries, (summary) => summary.raisedNet),
    raisedNetCertified: sumBy(certified, (summary) => summary.raisedNet),
    certifiedNet: sumBy(certified, (summary) => summary.certifiedNet ?? 0),
    variance: sumBy(certified, (summary) => summary.variance ?? 0),
    deductionChange: sumBy(certified, (summary) => summary.deductionChange ?? 0),
    notesNet: sumBy(certified, (summary) => summary.notesNet),
    pendingNet: sumBy(certified, (summary) => summary.pendingNet ?? 0),
    pendingGross: sumBy(notePending, (summary) => summary.pendingGross ?? 0),
  };
}

/** Live notes grouped by the bill they are raised against. */
export function notesByInvoice(bills: readonly Bill[]): Map<string, Bill[]> {
  const map = new Map<string, Bill[]>();
  for (const bill of bills) {
    if (bill.isDeleted || !bill.againstBillId || !isNoteType(bill.transactionType)) continue;
    map.set(bill.againstBillId, [...(map.get(bill.againstBillId) ?? []), bill]);
  }
  return map;
}
