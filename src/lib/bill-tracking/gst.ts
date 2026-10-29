/**
 * GST on a bill, and the deduction formulas.
 *
 * GST split. A bill raised by one of SEL's registrations to a client in the same state carries
 * CGST + SGST (half the rate each); across state lines it carries IGST (the full rate). Which
 * registration raises the bill is decided by the same configurable chain the rest of the app uses
 * (`resolveAttribution` in gst-registrations.ts) — never a single hardcoded company state — and the
 * suggestion is only that: finance can change the type, the rate or any component amount.
 *
 * Deductions. A percentage deduction is taken of a configurable base — the taxable value or the
 * gross — less other deductions on the same bill: Income TDS defaults to
 * (Taxable − Mobilisation Advance) × rate. A GST-applicable deduction (the client recovering testing
 * or LC charges with GST) adds GST on its base. The server runs `computeDeductions` on every save,
 * so the stored amounts always follow the bill's own figures — except on a debit note under a note
 * rule, whose covered heads are taken of the invoice plus its notes (`note-rules.ts`).
 *
 * Pure — shared by the bill form, the API and `node --test`.
 */

import { gstTypeFor, resolveAttribution, type GstAttributionConfig, type GstAttributionMaps, type GstRegistration } from '../gst-registrations.ts';
import { checkGstin, type GstType } from '../statutory.ts';
import { roundMoney, subtractMoney, sumMoney, toPaise } from './money.ts';
import { slabKey } from './retention.ts';
import type { BillDeduction, DeductionTypeMaster } from './types';

const round2 = (value: number) => roundMoney(value);
const roundRupee = (value: number) => {
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  return Object.is(rounded, -0) ? 0 : rounded;
};

/* ── bill GST ────────────────────────────────────────────────────────────── */

export interface GstSplit {
  gstType: GstType;
  gstPercent: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  gstAmount: number;
}

/**
 * GST computed from the taxable value: CGST and SGST each at half the rate, or IGST at the full
 * rate. Components are taken to the paisa; a negative taxable value (credit note) gives negative GST.
 */
export function splitGst(taxable: number, gstType: GstType, rate: number): GstSplit {
  if (gstType === 'none' || !rate) {
    return { gstType, gstPercent: gstType === 'none' ? 0 : rate, cgstRate: 0, sgstRate: 0, igstRate: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, gstAmount: 0 };
  }
  if (gstType === 'igst') {
    const igstAmount = round2((taxable * rate) / 100);
    return { gstType, gstPercent: rate, cgstRate: 0, sgstRate: 0, igstRate: rate, cgstAmount: 0, sgstAmount: 0, igstAmount, gstAmount: igstAmount };
  }
  const half = rate / 2;
  const component = round2((taxable * half) / 100);
  return { gstType, gstPercent: rate, cgstRate: half, sgstRate: half, igstRate: 0, cgstAmount: component, sgstAmount: component, igstAmount: 0, gstAmount: sumMoney([component, component]) };
}

/** The bill's total GST from the components actually entered (they may differ from the computed ones). */
export function totalFromComponents(gstType: GstType, components: { cgstAmount?: number; sgstAmount?: number; igstAmount?: number }): number {
  if (gstType === 'none') return 0;
  if (gstType === 'igst') return round2(components.igstAmount ?? 0);
  return sumMoney([components.cgstAmount ?? 0, components.sgstAmount ?? 0]);
}

export interface GstSuggestion {
  registration?: GstRegistration;
  gstType: GstType;
  /** Why, in words, for the form. */
  reason: string;
}

export interface RegistrationSetup {
  registrations: GstRegistration[];
  attribution: GstAttributionConfig;
  maps: GstAttributionMaps;
}

/**
 * The registration that raises the bill (by the configured attribution chain, or the one chosen on
 * the bill) and the split that follows from it and the client's GSTIN.
 */
export function suggestGst(setup: RegistrationSetup | undefined, input: { projectId?: string; chosenRegistrationId?: string; clientGstin?: string }): GstSuggestion {
  const attribution = setup ? resolveAttribution({ gstRegistrationId: input.chosenRegistrationId, projectId: input.projectId }, setup.attribution, setup.maps, setup.registrations) : undefined;
  const registration = setup?.registrations.find((entry) => entry.id === attribution?.registrationId);
  const client = checkGstin(input.clientGstin);
  if (!registration) {
    return { gstType: 'cgst-sgst', reason: 'No SEL GST registration could be worked out — CGST + SGST assumed. Set it on the bill or in Expenses → GST registrations.' };
  }
  if (!client.valid || !client.stateCode) {
    return { registration, gstType: 'cgst-sgst', reason: `${attribution?.reason}: ${registration.label || registration.stateName}. The client has no valid GSTIN, so CGST + SGST is assumed.` };
  }
  const gstType = gstTypeFor(registration.stateCode, client.stateCode);
  return {
    registration,
    gstType,
    reason:
      gstType === 'igst'
        ? `${attribution?.reason}: ${registration.label || registration.stateName}; client is in ${client.stateName ?? client.stateCode} — inter-state, so IGST.`
        : `${attribution?.reason}: ${registration.label || registration.stateName}; client is in the same state — CGST + SGST.`,
  };
}

/* ── deductions ──────────────────────────────────────────────────────────── */

export interface DeductionLineInput {
  id: string;
  deductionTypeId: string;
  /** For a percentage line: % of the configured base. */
  percentage?: number;
  /** For a fixed line: the amount before any GST on it. */
  baseAmount?: number;
  /** A fixed line's total when it has no GST (legacy and imported lines carry only this). */
  amount?: number;
  gstRate?: number;
  /**
   * GST amounts typed to match what the client actually deducted. Given, they replace the computed
   * split for that component (a line on an IGST bill reads only `igstAmount`).
   */
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  /** Take this line of the note's own value although a note rule covers its head. */
  ownBase?: boolean;
  remarks?: string;
  deductionDate?: string;
}

/**
 * Base and GST from a GST-inclusive total — "the client recovered ₹118" — so the parts add up to
 * exactly the total typed: the base is total ÷ (1 + rate), the GST is the rest, and on a CGST + SGST
 * bill any odd paisa goes to SGST.
 */
export function splitInclusiveTotal(total: number, rate: number, billGstType: GstType | undefined): { baseAmount: number; cgstAmount?: number; sgstAmount?: number; igstAmount?: number } {
  const baseAmount = rate ? round2(total / (1 + rate / 100)) : round2(total);
  const gst = round2(total - baseAmount);
  if (!rate) return { baseAmount };
  if (billGstType === 'igst') return { baseAmount, igstAmount: gst };
  const cgstAmount = round2(gst / 2);
  return { baseAmount, cgstAmount, sgstAmount: round2(gst - cgstAmount) };
}

export interface DeductionContext {
  taxable: number;
  gross: number;
  roundToRupee: boolean;
  /**
   * The bill's GST type: GST on a deduction is split the same way — IGST on an IGST bill, otherwise
   * CGST + SGST at half the rate each.
   */
  gstType?: GstType;
  /**
   * A debit note under a note rule (`note-rules.ts`): the invoice plus its notes up to this one, and
   * the heads taken of it. A line of one of those heads, unless marked `ownBase`, is worked out on (or,
   * as an amount, read against) that instead of the note's own taxable or gross.
   */
  invoiceBase?: {
    taxable: number;
    gross: number;
    deductionTypeIds: readonly string[];
    /** What the invoice and earlier notes already hold, by `slabKey` (head|rate): taken off a % line. */
    held?: Readonly<Record<string, number>>;
  };
}

/** GST on a deduction's base, split like the bill's: IGST on an IGST bill, else CGST + SGST halves. */
export function deductionGst(base: number, rate: number, billGstType: GstType | undefined) {
  if (!rate) return { gstAmount: 0, cgstRate: 0, sgstRate: 0, igstRate: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0 };
  if (billGstType === 'igst') {
    const igstAmount = round2((base * rate) / 100);
    return { gstAmount: igstAmount, cgstRate: 0, sgstRate: 0, igstRate: rate, cgstAmount: 0, sgstAmount: 0, igstAmount };
  }
  const half = round2((base * rate) / 2 / 100);
  return { gstAmount: sumMoney([half, half]), cgstRate: rate / 2, sgstRate: rate / 2, igstRate: 0, cgstAmount: half, sgstAmount: half, igstAmount: 0 };
}

/** A typed amount to the paisa, or null when it was not typed. */
const typedPaise = (value: number | undefined) => (value === undefined ? null : toPaise(value));

/**
 * A saved deduction line as the bill form sends it back (`rowsFromDeductions` → `deductionInputs`):
 * head, % or amount, GST rate, GST typed to match the client, and the note-rule opt-out. Remarks and
 * the deduction date are left out — they change no figure.
 */
const savedLineInput = (line: BillDeduction) =>
  JSON.stringify([line.id, line.deductionTypeId, line.percentage ?? null, line.percentage === undefined ? toPaise(line.baseAmount ?? line.amount) : null, line.gstRate || 0, line.gstManual ? [typedPaise(line.cgstAmount), typedPaise(line.sgstAmount), typedPaise(line.igstAmount)] : null, Boolean(line.ownBase)]);
const sentLineInput = (line: DeductionLineInput) =>
  JSON.stringify([
    line.id,
    line.deductionTypeId,
    line.percentage ?? null,
    line.percentage === undefined ? toPaise(line.baseAmount ?? line.amount ?? 0) : null,
    line.gstRate || 0,
    line.cgstAmount !== undefined || line.sgstAmount !== undefined || line.igstAmount !== undefined ? [typedPaise(line.cgstAmount), typedPaise(line.sgstAmount), typedPaise(line.igstAmount)] : null,
    Boolean(line.ownBase),
  ]);

/** The figures a bill's deduction lines were worked out on. */
export interface LineFigures {
  transactionType: string;
  billDate: string;
  againstBillId?: string;
  gstType?: GstType;
  taxableAmount: number;
  gstAmount: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
}

/**
 * Whether an edit keeps a bill's issued deduction lines as stored: it sends them back unchanged
 * (remarks and dates aside) and changes none of the figures they were worked out on. A later Settings
 * change to a head's formula, or a note saved since under a note rule, then never alters an issued
 * bill on an unrelated edit. The server keeps the lines; the bill form previews them the same way.
 */
export function keepsIssuedLines(existing: LineFigures & { deductions?: readonly BillDeduction[] | null }, next: LineFigures, sent: readonly DeductionLineInput[]): boolean {
  const saved = existing.deductions ?? [];
  return (
    existing.transactionType === next.transactionType &&
    existing.billDate === next.billDate &&
    (existing.againstBillId ?? null) === (next.againstBillId ?? null) &&
    (existing.gstType ?? null) === (next.gstType ?? null) &&
    [
      [existing.taxableAmount, next.taxableAmount],
      [existing.gstAmount, next.gstAmount],
      [existing.cgstAmount ?? 0, next.cgstAmount ?? 0],
      [existing.sgstAmount ?? 0, next.sgstAmount ?? 0],
      [existing.igstAmount ?? 0, next.igstAmount ?? 0],
    ].every(([before, after]) => toPaise(before) === toPaise(after)) &&
    saved.length === sent.length &&
    saved.every((line, index) => savedLineInput(line) === sentLineInput(sent[index]))
  );
}

/** The base a percentage deduction is taken of: taxable or gross, less the configured deductions. */
export function deductionBase(type: Pick<DeductionTypeMaster, 'percentBase' | 'baseLessTypeIds'>, context: Pick<DeductionContext, 'taxable' | 'gross'>, lines: readonly Pick<BillDeduction, 'deductionTypeId' | 'baseAmount' | 'amount'>[]): number {
  const start = type.percentBase === 'gross' ? context.gross : context.taxable;
  const less = sumMoney(lines.filter((line) => type.baseLessTypeIds?.includes(line.deductionTypeId)).map((line) => line.baseAmount ?? line.amount));
  return round2(start - less);
}

/**
 * Every deduction line's amounts from the bill's own figures. Fixed lines first (their base is what
 * was entered), then percentage lines — repeatedly, so one percentage line may be based on another
 * (TDS on taxable less a percentage-based advance recovery). A circular reference stops changing
 * after a few passes instead of looping.
 */
export function computeDeductions(inputs: readonly DeductionLineInput[], types: readonly DeductionTypeMaster[], context: DeductionContext): BillDeduction[] {
  const typeOf = (id: string) => types.find((type) => type.id === id);
  // Under a note rule, a head it covers is taken of the invoice plus its notes, unless the line opts out.
  const invoiceBase = context.invoiceBase;
  const covered = (input: DeductionLineInput) => Boolean(invoiceBase?.deductionTypeIds.includes(input.deductionTypeId));
  const finish = (input: DeductionLineInput, base: number, calculationBase?: number, held = 0): BillDeduction => {
    const type = typeOf(input.deductionTypeId);
    const gstRate = type?.gstApplicable ? (input.gstRate ?? type.gstRate ?? 0) : 0;
    const computed = deductionGst(base, gstRate, context.gstType);
    const typed = context.gstType === 'igst' ? input.igstAmount !== undefined : input.cgstAmount !== undefined || input.sgstAmount !== undefined;
    // Typed amounts (matching the client's figures) win over the computed split, component by component.
    const split = !gstRate || !typed
      ? computed
      : context.gstType === 'igst'
        ? { ...computed, igstAmount: round2(input.igstAmount as number), gstAmount: round2(input.igstAmount as number) }
        : (() => {
            const cgstAmount = round2(input.cgstAmount ?? computed.cgstAmount);
            const sgstAmount = round2(input.sgstAmount ?? computed.sgstAmount);
            return { ...computed, cgstAmount, sgstAmount, gstAmount: sumMoney([cgstAmount, sgstAmount]) };
          })();
    const gstAmount = split.gstAmount;
    const line: BillDeduction = {
      id: input.id,
      deductionTypeId: input.deductionTypeId,
      deductionTypeName: type?.name ?? input.deductionTypeId,
      kind: type?.kind ?? 'other',
      amount: sumMoney([base, gstAmount]),
      remarks: input.remarks,
      deductionDate: input.deductionDate,
    };
    if (gstRate) {
      Object.assign(line, { baseAmount: base, gstRate, gstAmount });
      if (context.gstType === 'igst') Object.assign(line, { igstRate: split.igstRate, igstAmount: split.igstAmount });
      else Object.assign(line, { cgstRate: split.cgstRate, sgstRate: split.sgstRate, cgstAmount: split.cgstAmount, sgstAmount: split.sgstAmount });
      if (typed) Object.assign(line, { gstManual: true });
    }
    if (input.percentage !== undefined) Object.assign(line, { percentage: input.percentage, calculationBase });
    if (invoiceBase && covered(input)) Object.assign(line, input.ownBase ? { ownBase: true } : { invoiceBase: type?.percentBase === 'gross' ? invoiceBase.gross : invoiceBase.taxable });
    if (toPaise(held) !== 0) Object.assign(line, { heldBefore: held });
    return line;
  };

  const lines = new Map<string, BillDeduction>();
  for (const input of inputs) {
    if (input.percentage !== undefined) continue;
    lines.set(input.id, finish(input, round2(input.baseAmount ?? input.amount ?? 0)));
  }
  const percentLines = inputs.filter((input) => input.percentage !== undefined);
  for (let pass = 0; pass < Math.max(1, percentLines.length) + 1; pass += 1) {
    let changed = false;
    for (const input of percentLines) {
      const type = typeOf(input.deductionTypeId);
      const others = [...lines.values()].filter((line) => line.id !== input.id);
      const figures = invoiceBase && covered(input) && !input.ownBase ? invoiceBase : context;
      const calculationBase = type ? deductionBase(type, figures, others) : figures.taxable;
      const rate = input.percentage as number;
      const raw = (calculationBase * rate) / 100;
      const full = context.roundToRupee ? roundRupee(raw) : round2(raw);
      // Taken of the invoice plus its notes, a line holds what is still due at its rate: less what the
      // invoice and the earlier notes already hold there (never below nothing).
      const held = figures === invoiceBase && rate > 0 && rate <= 100 ? (invoiceBase?.held?.[slabKey(input.deductionTypeId, rate)] ?? 0) : 0;
      const base = held ? Math.max(0, subtractMoney(full, held)) : full;
      const next = finish(input, base, calculationBase, held);
      const previous = lines.get(input.id);
      if (!previous || previous.amount !== next.amount || previous.calculationBase !== next.calculationBase) changed = true;
      lines.set(input.id, next);
    }
    if (!changed) break;
  }
  return inputs.map((input) => lines.get(input.id) as BillDeduction);
}
