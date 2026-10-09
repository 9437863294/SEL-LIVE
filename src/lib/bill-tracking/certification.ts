/**
 * Raised vs certified.
 *
 * SEL raises a bill; the client certifies it — sometimes for less (a lower measured quantity), often
 * with more deducted (a penalty, a different TDS base, extra retention). The finance team then raises
 * a credit note against the raised bill so that the books match what the client will actually pay.
 *
 * So three sets of figures are compared, line by line:
 *
 *   raised      the bill as issued (it stays the receivable — an issued invoice is never edited)
 *   notes       the credit / debit notes raised against it so far
 *   certified   what the client approved and deducts
 *
 * and `pending = certified − (raised + notes)` is what is still to be adjusted. When the taxable, the
 * GST and the net all match within the amount tolerance, the bill is "matched"; until then the pending
 * figures are exactly the note to raise, which `suggestedNote` spells out — taxable and GST to reverse
 * plus each deduction the client changed — for the bill form to pre-fill.
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
  totalDeduction: bill.totalDeduction,
  net: bill.netReceivable,
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
  raised: number;
  /** Credit / debit notes against the bill so far. */
  notes: number;
  /** `null` until the client has certified. */
  certified: number | null;
  /** The client's change: certified − raised. */
  difference: number | null;
  /** Still to adjust: certified − (raised + notes). */
  pending: number | null;
  matched: boolean;
}

export interface CertificationSummary {
  state: CertificationState;
  raisedNet: number;
  notesNet: number;
  notesCount: number;
  certifiedNet: number | null;
  /** Certified net − raised net: what the client's certification changed. */
  variance: number | null;
  /** Certified net − (raised net + notes): what a note still has to adjust. */
  pendingNet: number | null;
  /** The taxable + GST part of that — what the note's own invoice value must be. */
  pendingGross: number | null;
}

export interface SuggestedNoteDeduction {
  deductionTypeId: string;
  baseAmount: number;
  gstRate?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
}

/** The credit (or debit) note that makes raised + notes equal the certification. */
export interface SuggestedNote {
  transactionType: 'credit_note' | 'debit_note';
  taxableAmount: number;
  gstType?: GstType;
  gstPercent?: number;
  gstAmount: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  deductions: SuggestedNoteDeduction[];
  /** Net of the note as it will be computed (gross less its deductions). */
  netAmount: number;
  description: string;
}

export interface CertificationComparison {
  summary: CertificationSummary;
  lines: ComparisonLine[];
  suggestedNote: SuggestedNote | null;
}

const within = (amount: number | null, tolerance: number) => amount === null || Math.abs(toPaise(amount)) <= toPaise(Math.abs(tolerance));
const pendingOf = (certified: number | null, raised: number, notes: number) => (certified === null ? null : subtractMoney(certified, sumMoney([raised, notes])));

/** Just the state and headline figures — what the register needs per row. */
export function certificationSummary(bill: Bill, notes: readonly Bill[], tolerance: number): CertificationSummary {
  const live = notes.filter((note) => !note.isDeleted);
  const raised = raisedFigures(bill);
  const fromNotes = notesFigures(live);
  const certification = bill.certification;
  if (!certification) {
    return { state: 'not_certified', raisedNet: raised.net, notesNet: fromNotes.net, notesCount: live.length, certifiedNet: null, variance: null, pendingNet: null, pendingGross: null };
  }
  const certified = certifiedFigures(certification);
  const pendingTaxable = pendingOf(certified.taxableAmount, raised.taxableAmount, fromNotes.taxableAmount);
  const pendingGst = pendingOf(certified.gstAmount, raised.gstAmount, fromNotes.gstAmount);
  const pendingNet = pendingOf(certified.net, raised.net, fromNotes.net);
  const matched = within(pendingTaxable, tolerance) && within(pendingGst, tolerance) && within(pendingNet, tolerance);
  return {
    state: matched ? 'matched' : 'adjustment_pending',
    raisedNet: raised.net,
    notesNet: fromNotes.net,
    notesCount: live.length,
    certifiedNet: certified.net,
    variance: subtractMoney(certified.net, raised.net),
    pendingNet,
    pendingGross: pendingOf(certified.grossAmount, raised.grossAmount, fromNotes.grossAmount),
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
    const certifiedValue = certified ? pick(certified) : null;
    const pending = pendingOf(certifiedValue, pick(raised), pick(fromNotes));
    return {
      key,
      label,
      group,
      raised: pick(raised),
      notes: pick(fromNotes),
      certified: certifiedValue,
      difference: certifiedValue === null ? null : subtractMoney(certifiedValue, pick(raised)),
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
  for (const id of typeIds) {
    const amountIn = (map: Map<string, DeductionTotals>) => map.get(id)?.amount ?? 0;
    const certifiedValue = certified ? amountIn(certifiedByType) : null;
    const pending = pendingOf(certifiedValue, amountIn(raisedByType), amountIn(notesByType));
    lines.push({
      key: `deduction:${id}`,
      label: nameOf(id),
      group: 'deduction',
      raised: amountIn(raisedByType),
      notes: amountIn(notesByType),
      certified: certifiedValue,
      difference: certifiedValue === null ? null : subtractMoney(certifiedValue, amountIn(raisedByType)),
      pending,
      matched: within(pending, tolerance),
    });
  }
  lines.push(line('totalDeduction', 'Total deduction', 'total', (figures) => figures.totalDeduction));
  lines.push(line('net', 'Net receivable', 'total', (figures) => figures.net));

  return { summary, lines, suggestedNote: summary.state === 'adjustment_pending' && certified ? suggestNote(bill, raised, fromNotes, certified, { raisedByType, notesByType, certifiedByType }) : null };
}

function suggestNote(
  bill: Bill,
  raised: ComparableFigures,
  fromNotes: ComparableFigures,
  certified: ComparableFigures,
  maps: { raisedByType: Map<string, DeductionTotals>; notesByType: Map<string, DeductionTotals>; certifiedByType: Map<string, DeductionTotals> },
): SuggestedNote {
  const pending = (pick: (figures: ComparableFigures) => number) => subtractMoney(pick(certified), sumMoney([pick(raised), pick(fromNotes)]));
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

  const deductions: SuggestedNoteDeduction[] = [];
  const typeIds = [...new Set([...maps.raisedByType.keys(), ...maps.certifiedByType.keys(), ...maps.notesByType.keys()])];
  for (const id of typeIds) {
    const part = (key: keyof Pick<DeductionTotals, 'amount' | 'base' | 'cgst' | 'sgst' | 'igst'>) =>
      subtractMoney(maps.certifiedByType.get(id)?.[key] ?? 0, sumMoney([maps.raisedByType.get(id)?.[key] ?? 0, maps.notesByType.get(id)?.[key] ?? 0]));
    if (toPaise(part('amount')) === 0 && toPaise(part('base')) === 0) continue;
    const gstRate = maps.certifiedByType.get(id)?.gstRate ?? maps.raisedByType.get(id)?.gstRate;
    const entry: SuggestedNoteDeduction = { deductionTypeId: id, baseAmount: part('base') };
    if (gstRate) {
      entry.gstRate = gstRate;
      if (gstType === 'igst') entry.igstAmount = part('igst');
      else Object.assign(entry, { cgstAmount: part('cgst'), sgstAmount: part('sgst') });
    }
    deductions.push(entry);
  }

  const gross = sumMoney([taxableAmount, gstAmount]);
  const deductionTotal = sumBy(deductions, (entry) => sumMoney([entry.baseAmount, entry.cgstAmount ?? 0, entry.sgstAmount ?? 0, entry.igstAmount ?? 0]));
  const netAmount = subtractMoney(gross, deductionTotal);
  // The note's direction follows its invoice value; with none (only deductions changed), its net.
  const reduces = toPaise(gross) !== 0 ? gross < 0 : netAmount < 0;
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
    deductions,
    netAmount: roundMoney(netAmount),
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
  notesNet: number;
  pendingNet: number;
}

export function certificationTotals(summaries: readonly CertificationSummary[]): CertificationTotals {
  const certified = summaries.filter((summary) => summary.state !== 'not_certified');
  return {
    count: summaries.length,
    certified: certified.length,
    awaiting: summaries.length - certified.length,
    matched: summaries.filter((summary) => summary.state === 'matched').length,
    pending: summaries.filter((summary) => summary.state === 'adjustment_pending').length,
    raisedNet: sumBy(summaries, (summary) => summary.raisedNet),
    raisedNetCertified: sumBy(certified, (summary) => summary.raisedNet),
    certifiedNet: sumBy(certified, (summary) => summary.certifiedNet ?? 0),
    variance: sumBy(certified, (summary) => summary.variance ?? 0),
    notesNet: sumBy(certified, (summary) => summary.notesNet),
    pendingNet: sumBy(certified, (summary) => summary.pendingNet ?? 0),
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
