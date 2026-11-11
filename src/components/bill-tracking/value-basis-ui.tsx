'use client';

/**
 * The value basis on screen (`value-basis.ts`): the rules on Settings → Deduction types, the panel on
 * the bill form, and the build-up both of them — and the bill page — show the way the invoice lays it
 * out: value of the work executed, discount, value after it, held back, taxable, and what "% of
 * Value" deductions (retention) are taken of.
 */

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Plus, Scale, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { formatINR } from '@/lib/bill-tracking/money';
import { VALUE_BASIS_AS_IS, describeTerms, termsProblem, valueFigures } from '@/lib/bill-tracking/value-basis';
import type { BillCategoryMaster, BillTypeMaster, ValueBasisRule, ValueBasisTerms } from '@/lib/bill-tracking/types';
import { cn } from '@/lib/utils';

import { Amount, FormField, InfoTip, RupeeInput } from './bt-ui';
import { SubCategoryPicker, listNames } from './note-rules-settings';

const percent = (value: number) => `${Math.round(value * 10000) / 10000}%`;
/** "Taxable 90%…" as it reads mid-sentence; a term in quotes keeps its capital. */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/* ── the build-up ────────────────────────────────────────────────────────── */

function BuildUpLine({ op, label, value, muted, strong }: { op?: '−' | '='; label: React.ReactNode; value: number; muted?: boolean; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1.5', strong && 'font-semibold text-slate-900', muted && 'text-slate-500')}>
      <dt className="flex min-w-0 items-baseline gap-1.5">
        <span className="w-3 shrink-0 text-center text-slate-400" aria-hidden="true">
          {op ?? ''}
        </span>
        <span className="min-w-0">{label}</span>
      </dt>
      <dd className="shrink-0 tabular-nums">
        <Amount value={value} />
      </dd>
    </div>
  );
}

/**
 * The invoice's build-up for these terms and value, ending in what "% of Value" deductions are taken
 * of. `taxable` / `valueBase` show a bill's stored figures (to the paisa as saved) in place of the
 * worked-out ones; `headNames` lists the heads taken of the value; `retentionExample` adds what 10%
 * would be.
 */
export function ValueBuildUp({
  terms,
  executedValue,
  taxable,
  valueBase,
  headNames,
  retentionExample,
  footer,
  className,
}: {
  terms: ValueBasisTerms;
  executedValue: number;
  taxable?: number;
  valueBase?: number;
  headNames?: readonly string[];
  retentionExample?: boolean;
  footer?: React.ReactNode;
  className?: string;
}) {
  const figures = valueFigures({ ...terms, executedValue });
  const held = Math.round((100 - terms.taxableShare) * 10000) / 10000;
  const base = valueBase ?? figures.valueBase;
  return (
    <dl className={cn('overflow-hidden rounded-lg border border-slate-200 bg-white text-sm text-slate-700', className)}>
      <div className="px-3 pt-1">
        <BuildUpLine label="Value of work executed" value={figures.executedValue} />
        {terms.discountPercent ? <BuildUpLine op="−" label={`Discount @ ${percent(terms.discountPercent)}`} value={figures.discount} muted /> : null}
        {terms.discountPercent ? <BuildUpLine op="=" label="Value after discount" value={figures.discountedValue} strong /> : null}
        {held > 0 ? <BuildUpLine op="−" label={`Held back @ ${percent(held)}`} value={figures.heldBack} muted /> : null}
        <div className="border-t border-slate-100">
          <BuildUpLine op="=" label={`Taxable billed · ${percent(terms.taxableShare)}`} value={taxable ?? figures.taxable} strong />
        </div>
      </div>
      <div className="border-t border-emerald-100 bg-emerald-50/70 px-3 py-2 text-emerald-950">
        <div className="flex items-baseline justify-between gap-3 font-semibold">
          <dt className="min-w-0">“% of Value” deductions on</dt>
          <dd className="shrink-0 tabular-nums">
            <Amount value={base} />
          </dd>
        </div>
        <p className="mt-0.5 text-xs text-emerald-900/80">
          {terms.valueShare < 100 ? `${percent(terms.valueShare)} of the value${terms.discountPercent ? ' after discount' : ''}` : terms.discountPercent ? 'The whole value after discount' : 'The whole value of work executed'}
        </p>
        {headNames?.length ? <p className="mt-0.5 text-xs text-emerald-900/80">{listNames(headNames, 4)}</p> : null}
        {retentionExample ? <p className="mt-0.5 text-xs text-emerald-900/80">10% retention would be {formatINR(base / 10)}</p> : null}
        {footer}
      </div>
    </dl>
  );
}

/* ── inputs ──────────────────────────────────────────────────────────────── */

/** A percentage box, "%" inside on the right; keeps what is typed while focused ("0." on its way to "0.35"). */
function PercentBox({ value, onChange, label, disabled, className }: { value: string | number; onChange: (value: string) => void; label: string; disabled?: boolean; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const stored = String(value ?? '');
  return (
    <div className={cn('relative', className)}>
      <Input
        aria-label={label}
        inputMode="decimal"
        disabled={disabled}
        value={draft ?? stored}
        onFocus={() => setDraft(stored)}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.value);
        }}
        className="h-9 bg-white pr-7 text-right tabular-nums"
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400" aria-hidden="true">
        %
      </span>
    </div>
  );
}

/** One term of a rule: what it is and what it is of on the left, its box on the right. */
function TermRow({ label, hint, children }: { label: string; hint: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="text-xs leading-snug text-slate-500">{hint}</p>
      </div>
      {children}
    </div>
  );
}

const typed = (value: string) => {
  const parsed = Number(value.replace(/[%\s,]/g, ''));
  return value.trim() === '' || !Number.isFinite(parsed) ? 0 : parsed;
};

/* ── Settings → Deduction types → Value basis ───────────────────────────── */

/** The patterns a rule starts from: the user's three invoice formats, and a blank one. */
const PATTERNS: { title: string; detail: string; name: string; terms: ValueBasisTerms }[] = [
  { title: '90% billed · retention on the full value', detail: 'Taxable 90% of the value; “% of Value” heads on 100% of it.', name: 'Taxable 90%, retention on 100%', terms: { discountPercent: 0, taxableShare: 90, valueShare: 100 } },
  { title: '100% billed · retention against 90%', detail: 'Taxable the whole value; “% of Value” heads on 90% of it.', name: 'Taxable 100%, retention on 90%', terms: { discountPercent: 0, taxableShare: 100, valueShare: 90 } },
  { title: 'Discount, then 90% billed', detail: 'Starts at 0.35% — change it to the contract’s discount. Retention after the discount.', name: 'Discount, then 90% billed', terms: { discountPercent: 0.35, taxableShare: 90, valueShare: 100 } },
];

const newRuleId = (taken: readonly ValueBasisRule[]) => {
  let id = '';
  do id = `vb-${Math.random().toString(36).slice(2, 9)}`;
  while (taken.some((rule) => rule.id === id));
  return id;
};

const EXAMPLE_VALUE = 1000000;

/**
 * The value basis rules of one scope — all projects, or one project's own (tried first). Each rule:
 * the sub categories it covers, its three terms, and the build-up of an example ₹10,00,000 beside
 * them, laid out as the invoice does.
 */
export function ValueBasisSettings({
  title,
  rules,
  onChange,
  billCategories,
  billTypes,
  valueHeadNames,
  onTakeRetentionOfValue,
  scopeNote,
  disabled,
}: {
  title: string;
  rules: readonly ValueBasisRule[];
  onChange: (rules: ValueBasisRule[]) => void;
  billCategories: readonly BillCategoryMaster[];
  /** The sub categories a rule can name (on a project, the ones enabled for it). */
  billTypes: readonly BillTypeMaster[];
  /** The heads taken "% of Value" in this scope. */
  valueHeadNames: readonly string[];
  /** Sets every retention head of this scope to "% of Value"; absent without the permission. */
  onTakeRetentionOfValue?: () => void;
  /** On a project: how its rules and the default ones combine. */
  scopeNote?: React.ReactNode;
  disabled?: boolean;
}) {
  const setRule = (id: string, patch: Partial<ValueBasisRule>) => onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  const add = (pattern?: (typeof PATTERNS)[number]) => onChange([...rules, { id: newRuleId(rules), name: pattern?.name ?? '', active: true, billTypeIds: [], ...(pattern?.terms ?? VALUE_BASIS_AS_IS) }]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700" aria-hidden="true">
            <Scale className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              {title}
              <InfoTip label="About the value basis">
                Value of work executed − discount = value after discount. The taxable is a share of it; heads whose “% of” is Value are taken of another share of it. A new invoice of the sub categories a rule names starts with its terms; the bill form shows the build-up and can change it for one bill. Saved bills keep their own copy.
              </InfoTip>
            </h3>
            <p className="max-w-3xl text-xs leading-relaxed text-slate-500">When the taxable is a share of the work’s value, or comes after a discount, and retention is taken of the value rather than the taxable.</p>
          </div>
        </div>
        {disabled ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" /> Add rule <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel className="text-xs text-slate-500">Start from</DropdownMenuLabel>
              {PATTERNS.map((pattern) => (
                <DropdownMenuItem key={pattern.title} className="flex-col items-start gap-0.5 py-2" onSelect={() => add(pattern)}>
                  <span className="text-sm font-medium text-slate-900">{pattern.title}</span>
                  <span className="text-xs text-slate-500">{pattern.detail}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-sm" onSelect={() => add()}>
                Blank rule
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {scopeNote ? <p className="px-1 text-xs text-slate-600">{scopeNote}</p> : null}

      {rules.length ? (
        valueHeadNames.length ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            <CheckCircle2 className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Taken of the value: <b>{listNames(valueHeadNames, 4)}</b>. Every other head stays on its own base.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <b>No deduction head is taken “% of Value” yet</b>, so these rules change no deduction. Set “% of” to Value for the retention heads above.
              </span>
            </span>
            {onTakeRetentionOfValue ? (
              <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-100" onClick={onTakeRetentionOfValue}>
                Take the retention heads of the value
              </Button>
            ) : null}
          </div>
        )
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
          <p className="text-sm font-medium text-slate-800">No value basis rule</p>
          <p className="text-xs text-slate-500">Every invoice’s taxable is its value.{disabled ? '' : ' Start from the pattern the contract uses:'}</p>
          {disabled ? null : (
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
              {PATTERNS.map((pattern) => (
                <button key={pattern.title} type="button" onClick={() => add(pattern)} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50">
                  <span className="block text-sm font-medium text-slate-900">{pattern.title}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-slate-500">{pattern.detail}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {rules.map((rule, index) => {
        const problem = termsProblem(rule);
        return (
          <section key={rule.id} className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', !rule.active && 'bg-slate-50')}>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-800" aria-hidden="true">
                {index + 1}
              </span>
              <Input aria-label="Rule name" className="h-9 min-w-0 flex-1 basis-56" placeholder={describeTerms(rule)} maxLength={80} disabled={disabled} value={rule.name} onChange={(event) => setRule(rule.id, { name: event.target.value })} />
              {/* On a phone the name takes the line; Active and Remove sit beneath it on the right. */}
              <div className="ml-auto flex items-center gap-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                  <Switch disabled={disabled} checked={rule.active} onCheckedChange={(active) => setRule(rule.id, { active })} aria-label={`Use ${rule.name || 'this rule'}`} />
                  Active
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-rose-700 hover:bg-rose-50"
                  disabled={disabled}
                  onClick={() => onChange(rules.filter((entry) => entry.id !== rule.id))}
                  aria-label={`Remove ${rule.name || 'this rule'}`}
                  title="Remove rule — bills already saved keep their value basis"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <div className="min-w-0 space-y-3">
                <FormField label="Applies to" info="The sub categories of the invoices this rule starts. None ticked: every invoice. A rule naming a sub category beats one for every invoice.">
                  <SubCategoryPicker value={rule.billTypeIds} onChange={(billTypeIds) => setRule(rule.id, { billTypeIds })} billCategories={billCategories} billTypes={billTypes} disabled={disabled} emptyLabel="Every invoice" />
                </FormField>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-3">
                  <TermRow label="Discount on the value" hint="Taken off the value of the work executed first. 0 for none.">
                    <PercentBox className="w-24 shrink-0" label="Discount %" disabled={disabled} value={rule.discountPercent} onChange={(value) => setRule(rule.id, { discountPercent: typed(value) })} />
                  </TermRow>
                  <TermRow label="Taxable billed" hint={`Of the value after discount${rule.taxableShare > 0 && rule.taxableShare < 100 ? ` — ${percent(100 - rule.taxableShare)} held back` : ''}.`}>
                    <PercentBox className="w-24 shrink-0" label="Taxable share %" disabled={disabled} value={rule.taxableShare} onChange={(value) => setRule(rule.id, { taxableShare: typed(value) })} />
                  </TermRow>
                  <TermRow label="“% of Value” deductions taken of" hint="Of the value after discount — 100 for the full value, 90 for retention against 90%.">
                    <PercentBox className="w-24 shrink-0" label="Deductions share %" disabled={disabled} value={rule.valueShare} onChange={(value) => setRule(rule.id, { valueShare: typed(value) })} />
                  </TermRow>
                </div>
                {problem ? <p className="text-xs font-medium text-rose-700">{problem}</p> : null}
              </div>
              <div className="min-w-0">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Example · {formatINR(EXAMPLE_VALUE)} of work</p>
                {problem ? (
                  <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-500">Correct the figures to see the example.</div>
                ) : (
                  <ValueBuildUp terms={rule} executedValue={EXAMPLE_VALUE} retentionExample />
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ── the bill form ───────────────────────────────────────────────────────── */

/** The value basis as the bill form holds it: on, and each figure as typed. */
export interface ValueBasisFields {
  basisOn: boolean;
  basisExecuted: string;
  basisDiscount: string;
  basisTaxableShare: string;
  basisValueShare: string;
  basisRuleId: string;
  basisRuleName: string;
  /** Which was typed last: the value executed (the taxable follows it) or the taxable (the value follows). */
  basisDriver: 'value' | 'taxable';
}

/**
 * The bill form's value basis: the value of the work executed and the three terms on the left, the
 * build-up on the right. Typing the value works out the taxable; typing the taxable (below) works out
 * the value. Closed, a line offers the rule that covers the bill, or one by hand.
 */
export function ValueBasisPanel({
  fields,
  onChange,
  onRemove,
  onApplyRule,
  onStart,
  terms,
  taxable,
  valueBase,
  problem,
  coveringRule,
  valueHeadNames,
}: {
  fields: ValueBasisFields;
  onChange: (patch: Partial<ValueBasisFields>) => void;
  onRemove: () => void;
  onApplyRule: () => void;
  onStart: () => void;
  terms: ValueBasisTerms;
  taxable: number;
  /** What "% of Value" heads are taken of — set only when the basis holds and changes something. */
  valueBase: number | undefined;
  problem: string | null;
  coveringRule: { rule: ValueBasisRule; own: boolean } | undefined;
  valueHeadNames: readonly string[];
}) {
  // "Rule “Supply 90%” of this project" — or "A value basis rule" when it has no name.
  const ruleLabel = (found: { rule: ValueBasisRule; own: boolean }) => `${found.rule.name ? `Rule “${found.rule.name}”` : 'A value basis rule'}${found.own ? ' of this project' : ''}`;
  if (!fields.basisOn) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2.5 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <span className="flex min-w-0 items-start gap-2">
          <Scale className="mt-px h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          {coveringRule ? (
            <span>
              {ruleLabel(coveringRule)} covers this bill ({lowerFirst(describeTerms(coveringRule.rule))}), but this bill has no value basis.
            </span>
          ) : (
            <span>Taxable billed at a share of the value, or after a discount, with retention taken of the value?</span>
          )}
        </span>
        <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={coveringRule ? onApplyRule : onStart}>
          {coveringRule ? 'Apply the rule' : 'Add a value basis'}
        </Button>
      </div>
    );
  }
  const asIs = !termsProblem(terms) && terms.discountPercent === 0 && terms.taxableShare === 100 && terms.valueShare === 100;
  // The rule covering the bill says something else now (a bill saved before the rule changed).
  const ruleDiffers =
    coveringRule &&
    (coveringRule.rule.id !== fields.basisRuleId || (['discountPercent', 'taxableShare', 'valueShare'] as const).some((key) => coveringRule.rule[key] !== terms[key]));
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700" aria-hidden="true">
            <Scale className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Value basis</p>
            <p className="truncate text-xs text-slate-500">{fields.basisRuleId ? `From rule ${fields.basisRuleName ? `“${fields.basisRuleName}”` : 'in Settings'}` : 'Set for this bill'}</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-slate-600" onClick={onRemove}>
          Remove
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0 space-y-3">
          <FormField label="Value of work executed (100%)" info="From the invoice’s Total — the taxable is worked out from it. Or type the taxable below, and this follows.">
            <RupeeInput aria-label="Value of work executed" value={fields.basisExecuted} onChange={(value) => onChange({ basisExecuted: value, basisDriver: 'value' })} />
          </FormField>
          <div className="grid grid-cols-3 gap-2">
            <FormField label="Discount">
              <PercentBox label="Discount %" value={fields.basisDiscount} onChange={(value) => onChange({ basisDiscount: value })} />
            </FormField>
            <FormField label="Taxable billed">
              <PercentBox label="Taxable share %" value={fields.basisTaxableShare} onChange={(value) => onChange({ basisTaxableShare: value })} />
            </FormField>
            <FormField label="% of Value on">
              <PercentBox label="Deductions share %" value={fields.basisValueShare} onChange={(value) => onChange({ basisValueShare: value })} />
            </FormField>
          </div>
          <p className="text-[11px] leading-snug text-slate-500">Shares are of the value after the discount: taxable billed, and what “% of Value” deductions are taken of.</p>
          {problem ? <p className="text-xs font-medium text-rose-700">{problem}</p> : null}
        </div>
        <div className="min-w-0">
          {valueBase !== undefined ? (
            <ValueBuildUp
              terms={terms}
              executedValue={typed(fields.basisExecuted)}
              taxable={taxable}
              valueBase={valueBase}
              headNames={valueHeadNames}
              footer={valueHeadNames.length ? null : <p className="mt-0.5 text-xs text-amber-800">No head of this project is taken “% of Value” — set it in Settings → Deduction types.</p>}
            />
          ) : (
            <div className="flex h-full min-h-24 items-center justify-center rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
              {asIs ? 'These terms change nothing — the taxable is the value. Change a share, or remove the basis.' : 'The build-up shows once the value of the work, or the taxable, is in.'}
            </div>
          )}
        </div>
      </div>
      {ruleDiffers && coveringRule ? (
        <div className="flex flex-col gap-2 border-t border-slate-100 px-3 py-2.5 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <span>
            {ruleLabel(coveringRule)} now covers this bill: {lowerFirst(describeTerms(coveringRule.rule))}.
          </span>
          <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={onApplyRule}>
            Use the rule’s terms
          </Button>
        </div>
      ) : null}
    </div>
  );
}
