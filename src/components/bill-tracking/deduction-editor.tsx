'use client';

/**
 * The deduction lines editor, shared by the bill form and the client-certification form.
 *
 * A row is what the user types (strings, so "2." can be on its way to "2.5"); the figures shown are
 * computed from all rows together with `computeDeductions` — the same function the server runs — and
 * passed in as `lines`. A percentage row follows its configured base; typing an amount makes it fixed;
 * GST-applicable rows carry editable CGST + SGST (or IGST) parts and a total that can be typed to match
 * what the client actually recovered.
 */

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { splitInclusiveTotal, type DeductionLineInput } from '@/lib/bill-tracking/gst';
import { formatINR } from '@/lib/bill-tracking/money';
import type { BillDeduction, DeductionTypeMaster, GstType } from '@/lib/bill-tracking/types';
import { cn } from '@/lib/utils';

import { Amount } from './bt-ui';

export interface DeductionRow {
  id: string;
  deductionTypeId: string;
  /** Non-empty = a percentage line (the amount follows the base). */
  percentage: string;
  /** A fixed line's amount before GST. */
  baseAmount: string;
  /** GST % on the deduction (GST-applicable types only). */
  gstRate: string;
  /** GST amounts typed to match the client's figures; '' = calculated from the rate. */
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  remarks: string;
}

export const newRowId = () => `d${Math.random().toString(36).slice(2, 9)}`;

/** A typed amount as a number: commas, ₹ and spaces ignored; anything unreadable is 0. */
export const num = (value: string) => {
  const parsed = Number(String(value).replace(/[,₹\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
export const str = (value: number | undefined) => (value === undefined ? '' : String(value));

export const emptyDeductionRow = (): DeductionRow => ({ id: newRowId(), deductionTypeId: '', percentage: '', baseAmount: '', gstRate: '', cgstAmount: '', sgstAmount: '', igstAmount: '', remarks: '' });

/** Saved deduction lines back into editable rows. */
export function rowsFromDeductions(lines: readonly BillDeduction[], deductionTypes: readonly DeductionTypeMaster[]): DeductionRow[] {
  return lines.map((line) => {
    const type = deductionTypes.find((entry) => entry.id === line.deductionTypeId);
    return {
      id: line.id,
      deductionTypeId: line.deductionTypeId,
      percentage: str(line.percentage),
      baseAmount: String(line.baseAmount ?? line.amount),
      // A line saved without GST stays without it even if the type has since become GST-applicable.
      gstRate: line.gstRate !== undefined ? String(line.gstRate) : type?.gstApplicable ? '0' : '',
      cgstAmount: line.gstManual ? str(line.cgstAmount) : '',
      sgstAmount: line.gstManual ? str(line.sgstAmount) : '',
      igstAmount: line.gstManual ? str(line.igstAmount) : '',
      remarks: line.remarks ?? '',
    };
  });
}

/** Rows as the API takes them (and as `computeDeductions` previews them). */
export function deductionInputs(rows: readonly DeductionRow[]): DeductionLineInput[] {
  return rows
    .filter((line) => line.deductionTypeId)
    .map((line) => ({
      id: line.id,
      deductionTypeId: line.deductionTypeId,
      percentage: line.percentage !== '' ? num(line.percentage) : undefined,
      baseAmount: line.percentage === '' ? num(line.baseAmount) : undefined,
      gstRate: line.gstRate !== '' ? num(line.gstRate) : undefined,
      cgstAmount: line.cgstAmount !== '' ? num(line.cgstAmount) : undefined,
      sgstAmount: line.sgstAmount !== '' ? num(line.sgstAmount) : undefined,
      igstAmount: line.igstAmount !== '' ? num(line.igstAmount) : undefined,
      remarks: line.remarks,
    }));
}

/** One row changed: a new type takes its default % and GST rate; a new base, % or rate drops typed GST. */
export function patchDeductionRow(row: DeductionRow, patch: Partial<DeductionRow>, activeTypes: readonly DeductionTypeMaster[], defaultGstRate: number): DeductionRow {
  const next = { ...row, ...patch };
  if ('deductionTypeId' in patch) {
    const type = activeTypes.find((entry) => entry.id === next.deductionTypeId);
    next.percentage = type?.calculation === 'percentage' && type.defaultPercent !== undefined ? String(type.defaultPercent) : '';
    next.gstRate = type?.gstApplicable ? String(type.gstRate ?? defaultGstRate) : '';
  }
  // A new base, % or rate means GST should be recalculated — unless amounts come with the change
  // (typing a total sets the base and the GST together).
  const typedAmounts = 'cgstAmount' in patch || 'sgstAmount' in patch || 'igstAmount' in patch;
  if (!typedAmounts && ('deductionTypeId' in patch || 'baseAmount' in patch || 'percentage' in patch || 'gstRate' in patch)) {
    next.cgstAmount = '';
    next.sgstAmount = '';
    next.igstAmount = '';
  }
  return next;
}

export function DeductionEditor({
  rows,
  setRows,
  lines,
  activeTypes,
  deductionTypes,
  gstType,
  totalDeduction,
  defaultGstRate,
  emptyText = 'No deductions on this bill.',
  reference,
}: {
  rows: readonly DeductionRow[];
  setRows: (update: (rows: DeductionRow[]) => DeductionRow[]) => void;
  /** The computed lines for `rows` (by row id). */
  lines: readonly BillDeduction[];
  /** Types offered in the picker (active ones plus any already used). */
  activeTypes: readonly DeductionTypeMaster[];
  /** Every type, for naming the deductions a base is taken less of. */
  deductionTypes: readonly DeductionTypeMaster[];
  /** How GST on a deduction is split: IGST on an IGST bill, otherwise CGST + SGST. */
  gstType: GstType;
  totalDeduction: number;
  defaultGstRate: number;
  emptyText?: string;
  /** Shown under each row for comparison, by deduction type — e.g. what the raised bill deducted. */
  reference?: { label: string; byType: ReadonlyMap<string, number> };
}) {
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const update = (id: string, patch: Partial<DeductionRow>) => setRows((current) => current.map((row) => (row.id === id ? patchDeductionRow(row, patch, activeTypes, defaultGstRate) : row)));
  const anyGst = rows.some((row) => activeTypes.find((entry) => entry.id === row.deductionTypeId)?.gstApplicable);
  // Every row uses the same columns, so a GST row and a plain row line up under one header.
  const grid = !anyGst
    ? 'lg:grid-cols-[minmax(0,1.6fr)_88px_minmax(0,1fr)_minmax(0,1.4fr)_40px]'
    : gstType === 'igst'
      ? 'lg:grid-cols-[minmax(0,1.4fr)_72px_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1fr)_40px]'
      : 'lg:grid-cols-[minmax(0,1.3fr)_64px_minmax(0,0.9fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_40px]';

  if (rows.length === 0) return <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">{emptyText}</div>;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className={cn('hidden items-center gap-2 border-b border-slate-200 bg-slate-50 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 lg:grid', grid)}>
        <span className="pl-1">Deduction</span>
        <span className="text-right">%</span>
        <span className="text-right">{anyGst ? 'Base ₹' : 'Amount ₹'}</span>
        {anyGst ? (
          gstType === 'igst' ? (
            <span>IGST % · ₹</span>
          ) : (
            <>
              <span>CGST % · ₹</span>
              <span>SGST % · ₹</span>
            </>
          )
        ) : null}
        {anyGst ? <span className="text-right">Total ₹</span> : null}
        <span>Remarks</span>
        <span className="sr-only">Remove</span>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map((row) => {
          const type = activeTypes.find((entry) => entry.id === row.deductionTypeId);
          const computed = lineById.get(row.id);
          const percent = row.percentage !== '';
          const lessNames = (type?.baseLessTypeIds ?? []).map((id) => deductionTypes.find((entry) => entry.id === id)?.name).filter(Boolean);
          const gstApplicable = Boolean(type?.gstApplicable);
          const baseValue = computed ? (computed.baseAmount ?? computed.amount) : 0;
          const referenceAmount = row.deductionTypeId ? reference?.byType.get(row.deductionTypeId) : undefined;
          const explain = type && (percent || gstApplicable);
          return (
            <div key={row.id} className="space-y-1.5 p-2">
              <div className={cn('grid grid-cols-2 items-center gap-2', grid)}>
                <div className="col-span-2 lg:col-span-1">
                  <Select value={row.deductionTypeId} onValueChange={(value) => update(row.id, { deductionTypeId: value })}>
                    <SelectTrigger aria-label="Deduction type">
                      <SelectValue placeholder="Deduction type" />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      {activeTypes.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input aria-label="Percent" inputMode="decimal" placeholder="%" className="text-right tabular-nums" value={row.percentage} onChange={(event) => update(row.id, { percentage: event.target.value })} />
                <Input
                  aria-label={gstApplicable ? 'Deduction before GST' : 'Deduction amount'}
                  inputMode="decimal"
                  placeholder={gstApplicable ? 'Base ₹' : 'Amount ₹'}
                  value={percent ? String(baseValue) : row.baseAmount}
                  className={cn('text-right tabular-nums', percent && 'bg-slate-50')}
                  onChange={(event) => update(row.id, { baseAmount: event.target.value, percentage: '' })}
                />
                {gstApplicable ? (
                  <>
                    {gstType === 'igst' ? (
                      <GstPart label="IGST" rate={num(row.gstRate)} amount={computed?.igstAmount ?? 0} typed={row.igstAmount !== ''} onRate={(value) => update(row.id, { gstRate: value })} onAmount={(value) => update(row.id, { igstAmount: value })} />
                    ) : (
                      <>
                        {/* CGST and SGST rates are always equal: either rate box sets both. */}
                        <GstPart label="CGST" rate={num(row.gstRate) / 2} amount={computed?.cgstAmount ?? 0} typed={row.cgstAmount !== ''} onRate={(value) => update(row.id, { gstRate: value === '' ? '' : String(num(value) * 2) })} onAmount={(value) => update(row.id, { cgstAmount: value, sgstAmount: row.sgstAmount === '' ? String(computed?.sgstAmount ?? 0) : row.sgstAmount })} />
                        <GstPart label="SGST" rate={num(row.gstRate) / 2} amount={computed?.sgstAmount ?? 0} typed={row.sgstAmount !== ''} onRate={(value) => update(row.id, { gstRate: value === '' ? '' : String(num(value) * 2) })} onAmount={(value) => update(row.id, { sgstAmount: value, cgstAmount: row.cgstAmount === '' ? String(computed?.cgstAmount ?? 0) : row.cgstAmount })} />
                      </>
                    )}
                    <DraftInput
                      aria-label="Deduction total (incl. GST)"
                      title="Total incl. GST — type the amount the client recovered and the base and GST are worked out from it"
                      className="col-span-2 text-right font-semibold tabular-nums lg:col-span-1"
                      value={String(computed?.amount ?? 0)}
                      onValue={(value) => {
                        const parts = splitInclusiveTotal(num(value), num(row.gstRate), gstType);
                        update(row.id, {
                          percentage: '',
                          baseAmount: String(parts.baseAmount),
                          cgstAmount: parts.cgstAmount !== undefined ? String(parts.cgstAmount) : '',
                          sgstAmount: parts.sgstAmount !== undefined ? String(parts.sgstAmount) : '',
                          igstAmount: parts.igstAmount !== undefined ? String(parts.igstAmount) : '',
                        });
                      }}
                    />
                  </>
                ) : anyGst ? (
                  <>
                    {/* Keeps this row's columns under the same headings as the GST rows. */}
                    <div className={cn('hidden h-10 items-center justify-center rounded-md border border-dashed border-slate-200 text-xs text-slate-400 lg:flex', gstType !== 'igst' && 'lg:col-span-2')}>No GST on this deduction</div>
                    <div className="hidden h-10 items-center justify-end rounded-md bg-slate-50 px-3 text-sm font-semibold tabular-nums lg:flex">
                      <Amount value={computed?.amount ?? 0} signed />
                    </div>
                  </>
                ) : null}
                <div className="col-span-2 flex items-center gap-2 lg:contents">
                  <Input aria-label="Remarks" placeholder="Remarks" className="min-w-0 flex-1" value={row.remarks} onChange={(event) => update(row.id, { remarks: event.target.value })} />
                  <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label="Remove deduction" onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}>
                    <Trash2 className="h-4 w-4 text-rose-600" />
                  </Button>
                </div>
              </div>
              {explain || referenceAmount !== undefined ? (
                <p className="px-1 text-[11px] leading-snug text-slate-500">
                  {explain && percent ? `${row.percentage}% of ${formatINR(computed?.calculationBase ?? 0)} (${type.percentBase === 'gross' ? 'Gross' : 'Taxable'}${lessNames.length ? ` − ${lessNames.join(' − ')}` : ''}) = ${formatINR(baseValue)}` : null}
                  {explain && percent && gstApplicable ? ' · ' : null}
                  {explain && gstApplicable
                    ? gstType === 'igst'
                      ? `+ IGST ${num(row.gstRate)}% ${formatINR(computed?.igstAmount ?? 0)} = total ${formatINR(computed?.amount ?? 0)}`
                      : `+ CGST ${num(row.gstRate) / 2}% ${formatINR(computed?.cgstAmount ?? 0)} + SGST ${num(row.gstRate) / 2}% ${formatINR(computed?.sgstAmount ?? 0)} = total ${formatINR(computed?.amount ?? 0)}`
                    : null}
                  {explain && gstApplicable && (row.cgstAmount !== '' || row.sgstAmount !== '' || row.igstAmount !== '') ? (
                    <>
                      {' · GST typed to match the client. '}
                      <button type="button" className="font-medium text-emerald-700 hover:underline" onClick={() => update(row.id, { cgstAmount: '', sgstAmount: '', igstAmount: '' })}>
                        Recalculate
                      </button>
                    </>
                  ) : null}
                  {referenceAmount !== undefined && reference ? (
                    <span className={cn(explain && 'ml-1', computed && Math.round(computed.amount * 100) !== Math.round(referenceAmount * 100) ? 'font-medium text-amber-700' : undefined)}>
                      {explain ? '· ' : ''}
                      {reference.label} {formatINR(referenceAmount)}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <span className="font-medium text-slate-600">
          Total deduction · {rows.length} line{rows.length === 1 ? '' : 's'}
        </span>
        <Amount value={totalDeduction} className="font-semibold text-slate-900" signed />
      </div>
    </div>
  );
}

/**
 * A number box that shows exactly what is being typed ("2." on the way to "2.5") while focused, and
 * the derived value otherwise — so a box fed by a calculation can still be typed into.
 */
export function DraftInput({ value, onValue, className, ...rest }: { value: string; onValue: (value: string) => void; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      {...rest}
      inputMode="decimal"
      className={className}
      value={draft ?? value}
      onFocus={() => setDraft(value === '0' ? '' : value)}
      onChange={(event) => {
        setDraft(event.target.value);
        onValue(event.target.value);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/** One GST component of a deduction: its rate and amount, both editable — e.g. "CGST 9 % ₹9". */
export function GstPart({ label, rate, amount, typed, onRate, onAmount }: { label: string; rate: number; amount: number; typed: boolean; onRate: (value: string) => void; onAmount: (value: string) => void }) {
  const [rateDraft, setRateDraft] = useState<string | null>(null);
  const [amountDraft, setAmountDraft] = useState<string | null>(null);
  return (
    <div className={`flex h-10 items-center gap-1 rounded-md border px-1.5 text-sm ${typed ? 'border-amber-300 bg-amber-50' : 'border-input bg-slate-50'}`} title={typed ? `${label} typed to match the client` : `${label} on the deduction`}>
      <span className="text-[11px] font-semibold text-slate-500">{label}</span>
      <input
        aria-label={`${label} % on deduction`}
        inputMode="decimal"
        value={rateDraft ?? (rate ? String(rate) : '')}
        placeholder="0"
        onChange={(event) => {
          setRateDraft(event.target.value);
          onRate(event.target.value);
        }}
        onBlur={() => setRateDraft(null)}
        className="h-7 w-9 rounded border border-input bg-white px-1 text-right text-sm"
      />
      <span className="text-xs text-muted-foreground">%</span>
      <input
        aria-label={`${label} amount on deduction`}
        inputMode="decimal"
        value={amountDraft ?? String(amount)}
        onFocus={() => setAmountDraft(String(amount))}
        onChange={(event) => {
          setAmountDraft(event.target.value);
          onAmount(event.target.value);
        }}
        onBlur={() => setAmountDraft(null)}
        className="ml-auto h-7 min-w-0 flex-1 rounded border border-input bg-white px-1 text-right text-sm"
      />
    </div>
  );
}
