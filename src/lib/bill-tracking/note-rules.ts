/**
 * Note rules (Settings → Note rules): deductions on a debit note taken of the invoice plus its notes.
 *
 * Some invoices bill part of the value and carry no retention — a SUPPLY-60% or SUPPLY-70% invoice —
 * and a debit note against the invoice bills the balance. On that note the client deducts the
 * retention for the whole: 20% and 10% of the invoice plus the note, not of the note alone.
 *
 *   ₹700 invoice + ₹300 debit note = ₹1,000   →  20% ₹200 + 10% ₹100 held on the note
 *   ₹600 invoice + ₹300 debit note =   ₹900   →  20% ₹180 + 10% ₹90
 *
 * A rule names the invoice sub categories it covers and the deduction heads taken that way. Any other
 * head on the note stays on the note's own value (TDS on the debit note), and one line can still be
 * taken of the note alone (`ownBase`). A rule also says whether such notes count in the invoice's
 * raised-vs-certified comparison. By default they do not: they bill the balance rather than correct
 * the invoice, which the client certifies at its own value.
 *
 * The base is the invoice plus every live note against it saved before this one and dated on or
 * before it, plus this note: taxable, or gross for a head taken on gross. A note saved later never
 * moves it, even one dated earlier, so editing this note's remarks leaves its deductions alone. Only
 * debit notes follow a rule: a credit note's deductions reverse its own value.
 *
 * A % line takes its rate of that base less what the invoice and the earlier notes already hold at the
 * same head and rate (`heldBefore`), so a second balance note holds only what is still due: ₹600, then
 * ₹200 and ₹100 notes, hold 30% of ₹800 = ₹240 and then ₹270 − ₹240 = ₹30 — ₹270 in all, as one ₹300 note.
 *
 * Retention on such a line counts at its own rate, 20% and 10%, never shared over the invoice's; a line
 * typed as an amount is read against the same base (`retention.ts`).
 *
 * When the client certifies such a note (Settings → Workflow), its certified lines take the same heads
 * of the same invoice and earlier notes plus the note as certified (`baseBesidesNote` + `withNoteFigures`).
 *
 * Pure: the server, the bill form, Settings and the tests share it.
 */

import { isNoteType } from './certification.ts';
import { sumMoney, toPaise } from './money.ts';
import { retentionLineRate, retentionSource, slabKey } from './retention.ts';
import type { Bill, BillCertification, BillDeduction, BillTransactionType, BillTypeMaster, DeductionTypeMaster, NoteRule } from './types';

/** The active rule a debit note against `invoice` follows, if any — chosen by the invoice's sub category. */
export function noteRuleFor(rules: readonly NoteRule[] | undefined, noteType: BillTransactionType, invoice: { billTypeId?: string } | null | undefined): NoteRule | undefined {
  const billTypeId = invoice?.billTypeId;
  if (noteType !== 'debit_note' || !billTypeId) return undefined;
  return rules?.find((rule) => rule.active && rule.billTypeIds.includes(billTypeId));
}

/** A bill's figures as the base reads them; its deduction lines, when given, say what it already holds. */
type Figures = Pick<Bill, 'taxableAmount' | 'gstAmount'> & { deductions?: readonly BillDeduction[] | null };

/**
 * A note against the invoice, as the base reads it; `createdAt` orders two notes of the same day. A
 * certified debit note holds its certified lines.
 */
export type GroupNote = Figures & Pick<Bill, 'id' | 'billDate' | 'transactionType'> & { isDeleted?: boolean; createdAt?: string; certification?: Pick<BillCertification, 'deductions' | 'taxableAmount' | 'grossAmount'> | null };

/** The note being saved: its figures as entered (it may be new, so no id or `createdAt` yet). */
export type SavingNote = Figures & { id?: string; billDate: string; createdAt?: string };

/** The invoice: once certified, its certified lines are the ones it holds (`retentionSource`). */
type InvoiceFigures = Figures & { billTypeId?: string; grossAmount?: number; certification?: Pick<BillCertification, 'deductions' | 'taxableAmount' | 'grossAmount'> | null };

export interface InvoiceBase {
  taxable: number;
  /** Taxable plus GST. */
  gross: number;
}

/**
 * The notes counted before `note`: live notes saved before it (every saved one, for a new note) and
 * dated on or before it. A note saved later never counts, even one dated earlier, so editing this note
 * again leaves its base where it was.
 */
function notesBefore(notes: readonly GroupNote[], note: SavingNote): GroupNote[] {
  return notes.filter(
    (other) =>
      !other.isDeleted &&
      isNoteType(other.transactionType) &&
      other.id !== note.id &&
      (!note.createdAt || (other.createdAt ?? '') < note.createdAt) &&
      other.billDate <= note.billDate,
  );
}

/** The invoice plus its notes up to `note` (`notesBefore`), plus `note` itself. */
export function invoiceWithNotes(invoice: Figures, notes: readonly GroupNote[], note: SavingNote): InvoiceBase {
  const all = [invoice, ...notesBefore(notes, note), note];
  const taxable = sumMoney(all.map((bill) => bill.taxableAmount));
  return { taxable, gross: sumMoney([taxable, ...all.map((bill) => bill.gstAmount)]) };
}

/**
 * What the invoice and the notes before this one already hold under the rule's heads, by slab
 * (`slabKey`: head and rate), before any GST on a line. A % line on the note is taken of the invoice
 * plus its notes less this, so a second balance note holds only what is still due — never the same
 * retention twice. Lines read as no rate (fixed amounts) hold nothing here.
 */
function heldBefore(invoice: InvoiceFigures, earlier: readonly GroupNote[], headIds: readonly string[], types: readonly DeductionTypeMaster[]): Record<string, number> {
  const held: Record<string, number> = {};
  const add = (bill: { deductions?: readonly BillDeduction[] | null; taxableAmount: number; grossAmount: number }) => {
    for (const line of bill.deductions ?? []) {
      if (!headIds.includes(line.deductionTypeId) || toPaise(line.amount) === 0) continue;
      const { rate } = retentionLineRate(line, bill, types.find((type) => type.id === line.deductionTypeId));
      if (rate === null) continue;
      const key = slabKey(line.deductionTypeId, rate);
      held[key] = sumMoney([held[key] ?? 0, line.baseAmount ?? line.amount]);
    }
  };
  const invoiceGross = invoice.grossAmount ?? sumMoney([invoice.taxableAmount, invoice.gstAmount]);
  add(retentionSource({ deductions: [...(invoice.deductions ?? [])], taxableAmount: invoice.taxableAmount, grossAmount: invoiceGross, certification: invoice.certification }));
  for (const note of earlier) add(retentionSource({ deductions: [...(note.deductions ?? [])], taxableAmount: note.taxableAmount, grossAmount: sumMoney([note.taxableAmount, note.gstAmount]), certification: note.certification }));
  return held;
}

/** A note's base under a rule, the note itself left out: the invoice plus the notes before it, and what they hold. */
export interface BaseBesidesNote extends InvoiceBase {
  deductionTypeIds: readonly string[];
  held: Record<string, number>;
}

/**
 * The invoice plus the notes before `note` (`notesBefore`), the heads taken of it, and what those
 * already hold at each of their rates (`types` reads the rates; without it nothing counts as held).
 * Add the note's own figures (`withNoteFigures`) — as raised, or as the client certified them.
 */
export function baseBesidesNote(invoice: InvoiceFigures, notes: readonly GroupNote[], note: SavingNote, headIds: readonly string[], types: readonly DeductionTypeMaster[] = []): BaseBesidesNote {
  const earlier = notesBefore(notes, note);
  const all = [invoice, ...earlier];
  const taxable = sumMoney(all.map((bill) => bill.taxableAmount));
  return { taxable, gross: sumMoney([taxable, ...all.map((bill) => bill.gstAmount)]), deductionTypeIds: headIds, held: types.length ? heldBefore(invoice, earlier, headIds, types) : {} };
}

/** The base with the note's own taxable and GST added. */
export const withNoteFigures = (besides: BaseBesidesNote, note: Pick<Bill, 'taxableAmount' | 'gstAmount'>): BaseBesidesNote => ({
  ...besides,
  taxable: sumMoney([besides.taxable, note.taxableAmount]),
  gross: sumMoney([besides.gross, note.taxableAmount, note.gstAmount]),
});

/**
 * The heads a debit note took under its rule, as saved: those of its lines taken of the invoice plus
 * its notes, or taken of the note alone by choice. Its certification takes the same heads that way,
 * whatever the rule says by then — the note was issued under it.
 */
export const ruleHeadsOf = (note: Pick<Bill, 'deductions'>): string[] => [...new Set((note.deductions ?? []).filter((line) => line.invoiceBase !== undefined || line.ownBase).map((line) => line.deductionTypeId))];

/**
 * What a note's deductions are taken of under a rule — the invoice plus its notes, the heads taken that
 * way, and what is already held at each of their rates (`types` reads the rates; without it nothing
 * counts as held) — or undefined when it is not a debit note, or no active rule covers its invoice.
 */
export function noteDeductionBase(
  rules: readonly NoteRule[] | undefined,
  note: SavingNote & { transactionType: BillTransactionType },
  invoice: InvoiceFigures | null | undefined,
  notes: readonly GroupNote[],
  types: readonly DeductionTypeMaster[] = [],
): (BaseBesidesNote & { rule: NoteRule }) | undefined {
  const rule = noteRuleFor(rules, note.transactionType, invoice);
  if (!rule || !invoice) return undefined;
  return { ...withNoteFigures(baseBesidesNote(invoice, notes, note, rule.deductionTypeIds, types), note), rule };
}

/** Rules as saved: names trimmed, each id once, and only sub categories and heads still in Settings. */
export function normaliseNoteRules(rules: readonly NoteRule[], billTypes: readonly Pick<BillTypeMaster, 'id'>[], deductionTypes: readonly Pick<DeductionTypeMaster, 'id'>[]): NoteRule[] {
  const known = (ids: readonly string[], list: readonly { id: string }[]) => [...new Set(ids)].filter((id) => list.some((entry) => entry.id === id));
  return rules.map((rule) => ({ ...rule, name: rule.name.trim(), billTypeIds: known(rule.billTypeIds, billTypes), deductionTypeIds: known(rule.deductionTypeIds, deductionTypes) }));
}

/**
 * What stops the rules being saved, or null. Each needs a name; an active one also a sub category and
 * a deduction (a switched-off rule may wait half-made, so deleting the sub category it named does not
 * block Settings). Two active rules may not cover the same sub category: a debit note follows one rule.
 */
export function noteRulesProblem(rules: readonly NoteRule[], billTypes: readonly Pick<BillTypeMaster, 'id' | 'name'>[]): string | null {
  for (const rule of rules) {
    const name = rule.name.trim();
    if (!name) return 'Give every note rule a name.';
    if (!rule.active) continue;
    if (!rule.billTypeIds.length) return `“${name}”: choose the invoice sub categories it covers, or switch the rule off.`;
    if (!rule.deductionTypeIds.length) return `“${name}”: choose the deductions taken of the invoice plus its notes, or switch the rule off.`;
  }
  const active = rules.filter((rule) => rule.active);
  for (const [index, rule] of active.entries()) {
    for (const other of active.slice(index + 1)) {
      const shared = rule.billTypeIds.find((id) => other.billTypeIds.includes(id));
      if (shared) return `${billTypes.find((type) => type.id === shared)?.name ?? 'A sub category'} is in both “${rule.name.trim()}” and “${other.name.trim()}”. A debit note follows one rule, so keep it in one of them.`;
    }
  }
  return null;
}
