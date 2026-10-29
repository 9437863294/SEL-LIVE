'use client';

/**
 * Settings → Note rules: which debit notes take which deductions of the invoice plus its notes.
 *
 * A SUPPLY-60% or SUPPLY-70% invoice carries no retention; the debit note against it bills the
 * balance, and the client deducts the retention for the whole on that note — 20% and 10% of the
 * invoice plus the note (₹600 + ₹300 holds ₹180 + ₹90). A rule names the invoice sub categories it
 * covers, the deductions taken that way, and whether such notes count in the invoice's certification
 * check. The rules themselves are in `note-rules.ts`; the server applies the same checks on save.
 */

import { useId, useState } from 'react';
import { ChevronDown, ListChecks, Percent, Plus, Tags, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { isRetentionKind } from '@/lib/bill-tracking/calculations';
import { normaliseNoteRules, noteRulesProblem } from '@/lib/bill-tracking/note-rules';
import type { BillCategoryMaster, BillTypeMaster, DeductionTypeMaster, NoteRule } from '@/lib/bill-tracking/types';
import { cn } from '@/lib/utils';

import { FormField, InfoTip } from './bt-ui';

/** A fresh id for a rule added here. */
const newRuleId = (taken: readonly NoteRule[]) => {
  let id = '';
  do id = `nr-${Math.random().toString(36).slice(2, 9)}`;
  while (taken.some((rule) => rule.id === id));
  return id;
};

/** "A, B and C" — or "A, B +3" once it gets long. */
export const listNames = (names: readonly string[], max = 3) =>
  names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');

export function NoteRulesSettings({
  rules,
  onChange,
  billCategories,
  billTypes,
  deductionTypes,
  disabled,
}: {
  rules: readonly NoteRule[];
  onChange: (rules: NoteRule[]) => void;
  billCategories: readonly BillCategoryMaster[];
  billTypes: readonly BillTypeMaster[];
  deductionTypes: readonly DeductionTypeMaster[];
  disabled?: boolean;
}) {
  const problem = rules.length ? noteRulesProblem(normaliseNoteRules(rules, billTypes, deductionTypes), billTypes) : null;
  const setRule = (id: string, patch: Partial<NoteRule>) => onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  // A new rule starts with the retention heads in use — what a balance debit note usually holds.
  const addRule = () =>
    onChange([
      ...rules,
      {
        id: newRuleId(rules),
        name: rules.length ? `Note rule ${rules.length + 1}` : 'Retention on the balance debit note',
        active: true,
        billTypeIds: [],
        deductionTypeIds: deductionTypes.filter((type) => type.active && isRetentionKind(type.kind)).map((type) => type.id),
        countInCertification: false,
      },
    ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700" aria-hidden="true">
            <Percent className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">Note rules</h3>
            <p className="max-w-3xl text-xs leading-relaxed text-slate-500">
              When an invoice bills part of the value (SUPPLY-60%, SUPPLY-70%) and a debit note bills the balance, the client deducts the retention for the whole on the note. A rule takes the deductions you choose of the invoice plus its notes, not of the note alone: a ₹600 invoice and a ₹300 debit note hold 20% of ₹900 = ₹180 and 10% = ₹90. Every other deduction stays on the note’s own value.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={disabled} onClick={addRule}>
          <Plus className="h-4 w-4" /> Add rule
        </Button>
      </div>

      {problem ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{problem}</p> : null}

      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No note rules: a percentage on a debit note is taken of the note’s own value.
        </div>
      ) : null}

      {rules.map((rule, index) => (
        <section key={rule.id} className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', !rule.active && 'bg-slate-50')}>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-800" aria-hidden="true">
              {index + 1}
            </span>
            <Input aria-label="Rule name" className="h-9 min-w-0 flex-1 basis-56" placeholder="e.g. Retention on the balance debit note" maxLength={80} disabled={disabled} value={rule.name} onChange={(event) => setRule(rule.id, { name: event.target.value })} />
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <Switch disabled={disabled} checked={rule.active} onCheckedChange={(value) => setRule(rule.id, { active: value })} aria-label={`Use ${rule.name || 'this rule'}`} />
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
              title="Remove rule — notes already saved keep their deductions"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
            <FormField label="Debit notes against invoices of" info="The sub category of the invoice the debit note is raised against — SUPPLY-60%, SUPPLY-70%… A sub category can be in one active rule only.">
              <SubCategoryPicker value={rule.billTypeIds} onChange={(billTypeIds) => setRule(rule.id, { billTypeIds })} billCategories={billCategories} billTypes={billTypes} disabled={disabled} />
            </FormField>
            <FormField label="Taken of the invoice plus its notes" info="These deductions on the debit note are taken of the invoice plus its notes up to the note — taxable, or gross for a head taken on gross. A typed amount is read against the same base for its retention rate. One line can still be taken of the note alone, on the note.">
              <HeadPicker value={rule.deductionTypeIds} onChange={(deductionTypeIds) => setRule(rule.id, { deductionTypeIds })} deductionTypes={deductionTypes} disabled={disabled} />
            </FormField>
            <div className="lg:col-span-2">
              <ToggleRow
                label="Count these notes in the invoice’s certification check"
                hint="Off: the client certifies the invoice at its own value, and the debit note bills the balance — so the note is left out of raised vs certified, and no credit note is asked for because of it. On: the note counts there like any other."
                checked={rule.countInCertification}
                onChange={(countInCertification) => setRule(rule.id, { countInCertification })}
                disabled={disabled}
              />
            </div>
          </div>
        </section>
      ))}
      {rules.length ? <p className="text-xs text-muted-foreground">A rule applies when a debit note is saved. Notes saved before it keep their deductions until they are next edited.</p> : null}
    </div>
  );
}

/** A setting that is on or off, in a bordered row: its name and (i), the switch on the right. */
function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={cn('flex items-center justify-between gap-3 rounded-lg border p-3', disabled && 'opacity-60')}>
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-slate-800">
        <label htmlFor={id} className="cursor-pointer">
          {label}
        </label>
        <InfoTip label={`About “${label}”`}>{hint}</InfoTip>
      </span>
      <Switch id={id} disabled={disabled} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** Pick sub categories by main category: search, tick, and the chosen ones named on the button. */
function SubCategoryPicker({ value, onChange, billCategories, billTypes, disabled }: { value: string[]; onChange: (ids: string[]) => void; billCategories: readonly BillCategoryMaster[]; billTypes: readonly BillTypeMaster[]; disabled?: boolean }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const chosen = value.flatMap((id) => billTypes.find((type) => type.id === id)?.name ?? []);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((entry) => entry !== id) : [...value, id]);
  // The same name can be two sub categories, each enabled for its own projects: say which is which.
  const scope = (type: BillTypeMaster) => (type.projectIds.length ? `${type.projectIds.length} project${type.projectIds.length === 1 ? '' : 's'}` : 'all projects');
  const groups = [...billCategories]
    .sort((a, b) => a.sequence - b.sequence)
    .map((category) => ({ category, types: billTypes.filter((type) => type.categoryId === category.id && (!needle || type.name.toLowerCase().includes(needle))).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((group) => group.types.length);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className={cn('h-10 w-full justify-between gap-2 font-normal', !chosen.length && 'text-muted-foreground')}>
          <span className="flex min-w-0 items-center gap-2">
            <Tags className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="truncate text-left">{chosen.length ? listNames(chosen) : 'Choose sub categories'}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Input className="h-8" placeholder="Find a sub category" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="mt-2 max-h-72 overflow-y-auto">
          {groups.map(({ category, types }) => (
            <div key={category.id} className="pb-1">
              <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{category.name}</p>
              <ul>
                {types.map((type) => (
                  <li key={type.id}>
                    <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                      <Checkbox checked={value.includes(type.id)} onCheckedChange={() => toggle(type.id)} />
                      <span className="min-w-0 flex-1 truncate">{type.name}</span>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {type.active ? '' : 'inactive · '}
                        {scope(type)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {groups.length === 0 ? <p className="px-2 py-3 text-center text-xs text-slate-500">No sub category matches.</p> : null}
        </div>
        {value.length ? (
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 px-2 pt-2 text-xs text-slate-500">
            <span>{value.length} chosen</span>
            <button type="button" className="font-medium text-rose-700 hover:underline" onClick={() => onChange([])}>
              Clear
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Pick deduction heads by ticking them; the chosen ones show on the button. */
function HeadPicker({ value, onChange, deductionTypes, disabled }: { value: string[]; onChange: (ids: string[]) => void; deductionTypes: readonly DeductionTypeMaster[]; disabled?: boolean }) {
  const chosen = value.flatMap((id) => deductionTypes.find((type) => type.id === id) ?? []);
  // Active heads, and any inactive one a rule still names.
  const offered = deductionTypes.filter((type) => type.active || value.includes(type.id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((entry) => entry !== id) : [...value, id]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className={cn('h-auto min-h-10 w-full justify-between gap-2 py-1.5 font-normal', !chosen.length && 'text-muted-foreground')}>
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            <ListChecks className="mr-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            {chosen.length
              ? chosen.map((type) => (
                  <span key={type.id} className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-800">
                    {type.name}
                  </span>
                ))
              : 'Choose deductions'}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Deduction types</p>
        <ul className="max-h-72 overflow-y-auto">
          {offered.map((type) => (
            <li key={type.id}>
              <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                <Checkbox checked={value.includes(type.id)} onCheckedChange={() => toggle(type.id)} />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{type.name}</span>
                  <span className="block text-[11px] text-slate-500">
                    % of {type.percentBase === 'gross' ? 'gross' : 'taxable'}
                    {isRetentionKind(type.kind) ? ' · retention' : ''}
                    {type.active ? '' : ' · inactive'}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
