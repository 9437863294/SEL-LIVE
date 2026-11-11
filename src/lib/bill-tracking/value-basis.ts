/**
 * Value basis: how an invoice's taxable relates to the value of the work, and what deductions taken
 * "% of Value" (retention, usually) are worked out on.
 *
 * Contracts bill a share of the work's value and take retention of the whole of it, or bill the whole
 * and take retention of a share — sometimes after a discount on the value. As the invoice reads:
 *
 *   Value of the work executed (100%)          A
 *   − Discount @ d% of A                        B
 *   = Value after the discount                  C = A × (100 − d)%
 *   − Held back @ (100 − t)% of C               D
 *   = Taxable billed now                        E = C × t%        ← the bill's taxable; GST on it
 *   Deductions "% of Value" are taken of        V = C × v%
 *
 * - t = 90, v = 100: the taxable is 90% of the value; retention on the 100% value (E ÷ 90%).
 * - t = 100, v = 90: the taxable is the whole value; retention against 90% of it.
 * - d = 0.35, t = 90, v = 100: a 0.35% discount first, then 90% billed; retention on the discounted 100%.
 *
 * Every figure is taken of the unrounded C and rounded to the paisa once, as the invoice sheets do.
 *
 * Rules (Settings → Deduction types) give the terms a new invoice starts with, by sub category: a
 * project's own rules first, then the default ones. The bill keeps its own copy (`Bill.valueBasis`),
 * editable on the form, so a later rule change never alters a saved bill. A head whose "% of" is Value
 * is taken of V; on a bill without a basis V is the taxable, so such a head reads as "% of Taxable".
 * Only invoices carry a basis. Pure: the server, the browser and the tests share it.
 */

import { roundMoney, toPaise } from './money.ts';
import type { BillTrackingConfig, BillTransactionType, BillTypeMaster, BillValueBasis, ProjectProfile, ValueBasisRule, ValueBasisTerms } from './types';

/** Terms that change nothing: no discount, the whole value billed, deductions of the whole of it. */
export const VALUE_BASIS_AS_IS: ValueBasisTerms = { discountPercent: 0, taxableShare: 100, valueShare: 100 };

/** Only invoices carry a value basis; notes, retention bills and advances are billed as they are. */
export const takesValueBasis = (transactionType: BillTransactionType | string): boolean => transactionType === 'invoice';

export const isAsIs = (terms: ValueBasisTerms): boolean => terms.discountPercent === 0 && terms.taxableShare === 100 && terms.valueShare === 100;

/** What is wrong with the terms, worded for the screen; null when they hold. */
export function termsProblem(terms: ValueBasisTerms): string | null {
  const finite = (value: number) => typeof value === 'number' && Number.isFinite(value);
  if (!finite(terms.discountPercent) || terms.discountPercent < 0 || terms.discountPercent >= 100) return 'The discount must be from 0 up to (not including) 100%.';
  if (!finite(terms.taxableShare) || terms.taxableShare <= 0 || terms.taxableShare > 100) return 'The share billed as taxable must be above 0 and at most 100%.';
  if (!finite(terms.valueShare) || terms.valueShare <= 0 || terms.valueShare > 100) return 'The share deductions are taken of must be above 0 and at most 100%.';
  return null;
}

/** The value after the discount, unrounded — every other figure is taken of it. */
const discounted = (basis: Pick<BillValueBasis, 'executedValue' | 'discountPercent'>) => (basis.executedValue * (100 - basis.discountPercent)) / 100;

/** The invoice's build-up, each figure to the paisa. */
export interface ValueFigures {
  /** A: the value of the work executed at 100%. */
  executedValue: number;
  /** B: the discount on it. */
  discount: number;
  /** C: the value after the discount. */
  discountedValue: number;
  /** D: the share of C not billed now. */
  heldBack: number;
  /** E: the taxable billed now. */
  taxable: number;
  /** V: what "% of Value" deductions are taken of. */
  valueBase: number;
}

export function valueFigures(basis: BillValueBasis): ValueFigures {
  const value = discounted(basis);
  return {
    executedValue: roundMoney(basis.executedValue),
    discount: roundMoney((basis.executedValue * basis.discountPercent) / 100),
    discountedValue: roundMoney(value),
    heldBack: roundMoney((value * (100 - basis.taxableShare)) / 100),
    taxable: roundMoney((value * basis.taxableShare) / 100),
    valueBase: roundMoney((value * basis.valueShare) / 100),
  };
}

/** The taxable the terms make of a value executed (E). */
export const taxableFromValue = (executedValue: number, terms: ValueBasisTerms): number => valueFigures({ ...terms, executedValue }).taxable;

/** The value executed a typed taxable stands for (A = E ÷ t% ÷ (100 − d)%), to the paisa. */
export const valueFromTaxable = (taxable: number, terms: ValueBasisTerms): number => roundMoney((taxable * 100 * 100) / terms.taxableShare / (100 - terms.discountPercent));

/** What a bill's "% of Value" heads are taken of: its basis's V, or the taxable without one. */
export const billValueBase = (bill: { taxableAmount: number; valueBasis?: BillValueBasis | null }): number => (bill.valueBasis ? valueFigures(bill.valueBasis).valueBase : roundMoney(bill.taxableAmount));

/**
 * The same for the client's certified taxable. Certified as raised, the bill's own V (so not a paisa
 * moves); certified for another taxable, in proportion — taxable ÷ t% × v%. Without a basis, the
 * certified taxable.
 */
export function certifiedValueBase(bill: { taxableAmount: number; valueBasis?: BillValueBasis | null }, certifiedTaxable: number): number {
  const basis = bill.valueBasis;
  if (!basis) return roundMoney(certifiedTaxable);
  if (toPaise(certifiedTaxable) === toPaise(bill.taxableAmount)) return billValueBase(bill);
  return roundMoney((certifiedTaxable * basis.valueShare) / basis.taxableShare);
}

/**
 * What is wrong with a bill's basis as it would be saved: its terms, a value executed, and a taxable
 * that is the share of the value it says (within ₹1, for rounding a typed taxable back to a value).
 */
export function valueBasisProblem(basis: BillValueBasis, taxable: number): string | null {
  const terms = termsProblem(basis);
  if (terms) return `Value basis: ${terms}`;
  if (!(Number.isFinite(basis.executedValue) && basis.executedValue > 0)) return 'Value basis: enter the value of the work executed (100%), above zero.';
  const expected = taxableFromValue(basis.executedValue, basis);
  if (Math.abs(toPaise(expected) - toPaise(taxable)) > 100) {
    return `The taxable (₹${roundMoney(taxable)}) is not ${basis.taxableShare}% of the value after the discount — the value basis makes it ₹${expected}. Correct the taxable or the value basis.`;
  }
  return null;
}

/** A bill's basis from a rule's terms and the value executed. */
export const basisFromRule = (rule: ValueBasisRule | ValueBasisTerms, executedValue: number): BillValueBasis => ({
  executedValue: roundMoney(executedValue),
  discountPercent: rule.discountPercent,
  taxableShare: rule.taxableShare,
  valueShare: rule.valueShare,
  ...('id' in rule ? { ruleId: rule.id, ruleName: rule.name || undefined } : {}),
});

type RuleSource = { settings: { valueBasisRules?: readonly ValueBasisRule[] }; projectProfiles: readonly ProjectProfile[] };

/** A project's own rules (none = it follows the default ones). */
export const projectBasisRules = (profiles: readonly ProjectProfile[], projectId: string | null | undefined): readonly ValueBasisRule[] =>
  (projectId ? profiles.find((profile) => profile.projectId === projectId)?.valueBasisRules : undefined) ?? [];

const applies = (rule: ValueBasisRule, billTypeId: string | null | undefined) => rule.active && (rule.billTypeIds.length === 0 || (billTypeId ? rule.billTypeIds.includes(billTypeId) : false));

/**
 * The rule a new invoice of this project and sub category starts with: among the project's own rules
 * first, then the default ones, the first active rule naming the sub category or naming none. `own`
 * says which list it came from. None for anything but an invoice.
 */
export function valueBasisRuleFor(config: RuleSource, projectId: string | null | undefined, billTypeId: string | null | undefined, transactionType: BillTransactionType | string): { rule: ValueBasisRule; own: boolean } | undefined {
  if (!takesValueBasis(transactionType)) return undefined;
  // A rule naming the sub category beats one for every sub category, within the same list.
  const pick = (rules: readonly ValueBasisRule[]) => rules.find((rule) => applies(rule, billTypeId) && rule.billTypeIds.length > 0) ?? rules.find((rule) => applies(rule, billTypeId));
  const own = pick(projectBasisRules(config.projectProfiles, projectId));
  if (own) return { rule: own, own: true };
  const general = pick(config.settings.valueBasisRules ?? []);
  return general ? { rule: general, own: false } : undefined;
}

const percent = (value: number) => Math.round(value * 10000) / 10000;

/** Rules as saved: names trimmed, ids once each, only sub categories still in the master, rates to 4 dp. */
export function normaliseValueBasisRules(rules: readonly ValueBasisRule[] | undefined, billTypes: readonly Pick<BillTypeMaster, 'id'>[]): ValueBasisRule[] {
  const seen = new Set<string>();
  const result: ValueBasisRule[] = [];
  for (const rule of rules ?? []) {
    if (!rule.id || seen.has(rule.id)) continue;
    seen.add(rule.id);
    result.push({
      id: rule.id,
      name: (rule.name ?? '').trim(),
      active: rule.active !== false,
      billTypeIds: [...new Set(rule.billTypeIds ?? [])].filter((id) => billTypes.some((type) => type.id === id)),
      discountPercent: percent(rule.discountPercent),
      taxableShare: percent(rule.taxableShare),
      valueShare: percent(rule.valueShare),
    });
  }
  return result;
}

/** The first rule that cannot be saved, worded for the screen. */
export function valueBasisRulesProblem(rules: readonly ValueBasisRule[], where = ''): string | null {
  for (const [index, rule] of rules.entries()) {
    const problem = termsProblem(rule);
    if (problem) return `${rule.name || `Value basis rule ${index + 1}`}${where}: ${problem}`;
  }
  return null;
}

/** "Taxable 90% of the value · “% of Value” deductions on 100%", with the discount first when there is one. */
export function describeTerms(terms: ValueBasisTerms): string {
  const parts = [
    terms.discountPercent ? `${percent(terms.discountPercent)}% discount` : null,
    `taxable ${percent(terms.taxableShare)}% of the value`,
    `“% of Value” deductions on ${percent(terms.valueShare)}%`,
  ].filter(Boolean);
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The sub categories a rule names, or "Every invoice". */
export const ruleScope = (rule: Pick<ValueBasisRule, 'billTypeIds'>, billTypes: readonly Pick<BillTypeMaster, 'id' | 'name'>[]): string =>
  rule.billTypeIds.length ? rule.billTypeIds.map((id) => billTypes.find((type) => type.id === id)?.name ?? 'a removed sub category').join(', ') : 'Every invoice';

/** The heads taken of the value — for the warning that a basis does nothing without one. */
export const valueHeads = <T extends { percentBase: string; active: boolean }>(types: readonly T[]): T[] => types.filter((type) => type.percentBase === 'value' && type.active);

/** Settings keeps the rules on `settings`; the type for code that reads them off the whole config. */
export type ValueBasisConfig = Pick<BillTrackingConfig, 'settings' | 'projectProfiles'>;
