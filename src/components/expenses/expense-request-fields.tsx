'use client';

/**
 * The body of an expense request — one form, shown by New Request and by the department register's
 * Edit dialog, so the two cannot drift apart. Edit used to be a separate, older form: a free-text
 * party box that ignored "Restrict parties to existing names", fixed labels that ignored Field
 * Control, no net payable and no GST & TDS at all.
 *
 * It holds the 6-column grid (FORM_GRID) — department, project, party, sub-head and the head worked
 * out from it, amount and net payable, description and remarks — with labels, help text, visibility
 * and required-ness from Settings › Field Control, and under it whatever GST & TDS section the
 * caller passes. `ExpenseRequestTotals` is the amount / net payable line that sits beside Save.
 */

import { useState, type ReactNode } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import * as z from 'zod';
import { CalendarClock, Check, ChevronsUpDown, Hash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
  FORM_GRID as GRID,
  FORM_LABEL as LABEL,
  FORM_READ_ONLY as READ_ONLY,
} from '@/components/expenses/statutory-section';
import { requestAmountError, resolveFormField, type ExpensesModuleSettings } from '@/lib/expenses-settings';
import type { AccountHead, Project, SubAccountHead } from '@/lib/types';
import { cn } from '@/lib/utils';

type FieldKey = Parameters<typeof resolveFormField>[1];

/**
 * A picker in a narrow grid column. The trigger is a button, which centres its text, and the value
 * is clamped to a line rather than kept on one — so a long name like "TPNODL-BARMUNDA" wrapped at
 * its hyphen and showed a centred "TPNODL-…". Left-aligned and cut with an ellipsis instead.
 */
const PICKER = 'h-9 text-left text-sm [&>span]:truncate';

/** How two spellings of a party name are compared: case and spacing do not make a new party. */
export const partyKey = (name: unknown) => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The on-record spelling of a party name, or undefined when it is not on record. */
export const findRecordedParty = (name: string, recorded: readonly string[]): string | undefined => {
  const key = partyKey(name);
  return key ? recorded.find(candidate => partyKey(candidate) === key) : undefined;
};

/** What an edit can hold fixed: once money has gone out against the requisition, these belong to the payment. */
export type LockableExpenseField = 'projectId' | 'amount' | 'partyName';

export interface ExpenseFormRules {
  /** Shown but not editable, so not judged either — the user could not correct them. */
  locked?: readonly LockableExpenseField[];
  /**
   * Editing: the amount the request already carries. The amount must then stay above zero, and the
   * largest-amount rule judges only a new figure — a request raised before the limit was lowered can
   * still have its remarks corrected.
   */
  openedAmount?: number;
}

/**
 * Built from the module's field configuration rather than fixed, so making Remarks mandatory (or
 * Party optional) under Settings actually changes what the form will accept. Project, amount and
 * sub-head stay required whatever the configuration says — the record is meaningless without them,
 * which is why the settings screen will not let them be relaxed either.
 *
 * With "Restrict parties to existing names" on, a party must be one already on an expense request
 * or a requisition (`recordedParties`). Blank is still governed by the field's own required setting.
 * With a largest request amount set (Settings › Data Control), anything above it is refused.
 */
export const buildExpenseFormSchema = (
  settings: ExpensesModuleSettings,
  recordedParties: readonly string[] = [],
  { locked = [], openedAmount }: ExpenseFormRules = {},
) => {
  const isLocked = (key: string) => (locked as readonly string[]).includes(key);
  const text = (key: FieldKey) => {
    const field = resolveFormField(settings, key);
    return field.visible && field.required && !isLocked(key)
      ? z.string().min(1, `${field.label} is required.`)
      : z.string().optional();
  };

  return z
    .object({
      departmentId: z.string().min(1, 'Department is required.'),
      projectId: z.string().min(1, 'Project is required.'),
      amount: z.coerce.number().gte(0, 'Amount must be a non-negative number.'),
      headOfAccount: z.string().min(1, 'Head of Account is required.'),
      subHeadOfAccount: z.string().min(1, 'Sub-Head of Account is required.'),
      remarks: text('remarks'),
      description: text('description'),
      partyName: text('partyName'),
    })
    .superRefine((values, ctx) => {
      const amount = Number(values.amount) || 0;
      if (!isLocked('amount')) {
        if (openedAmount !== undefined && !(amount > 0)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: 'Enter an amount above zero.' });
        }
        const tooMuch = openedAmount !== undefined && amount === openedAmount ? undefined : requestAmountError(amount, settings.data);
        if (tooMuch) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: tooMuch });
      }
      if (!settings.data.restrictPartyToExisting || isLocked('partyName')) return;
      const name = values.partyName?.trim();
      if (name && !findRecordedParty(name, recordedParties)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['partyName'],
          message: `"${name}" is not a party on record. Choose one from the list — adding new parties is turned off in Expenses › Settings › Data Control.`,
        });
      }
    });
};

export type ExpenseFormValues = z.infer<ReturnType<typeof buildExpenseFormSchema>>;

const inrText = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n || 0);

export function ExpenseRequestFields({
  form,
  settings,
  projects,
  accountHeads,
  subAccountHeads,
  recordedParties,
  department,
  requestNo,
  timestamp,
  netPayable,
  withStatutory,
  locked = [],
  statutory,
}: {
  form: UseFormReturn<ExpenseFormValues>;
  settings: ExpensesModuleSettings;
  projects: readonly Project[];
  accountHeads: readonly AccountHead[];
  subAccountHeads: readonly SubAccountHead[];
  /** Party names already on an expense request or a requisition — what "existing" means for the party rule. */
  recordedParties: readonly string[];
  /** The department control: a picker on New Request, the request's own department when editing. */
  department: ReactNode;
  /** The header strip: the request number (or its preview) and when it was raised. */
  requestNo: string;
  timestamp: string;
  netPayable: number;
  /** GST & TDS are entered, so the amount is the value before GST. */
  withStatutory: boolean;
  locked?: readonly LockableExpenseField[];
  /** The GST & TDS section, under the fields. */
  statutory?: ReactNode;
}) {
  /** Labels, help text and required-ness come from Settings › Field Control. */
  const fieldFor = (key: FieldKey) => resolveFormField(settings, key);
  const isLocked = (key: LockableExpenseField) => locked.includes(key);

  const [partyPopoverOpen, setPartyPopoverOpen] = useState(false);
  const [partySearch, setPartySearch] = useState('');
  /** Names typed in with "Add" here — they reach the record only with the request that carries one. */
  const [addedParties, setAddedParties] = useState<string[]>([]);

  /** Settings › Data Control › "Restrict parties to existing names". */
  const restrictParty = settings.data.restrictPartyToExisting;
  const partyOptions = restrictParty ? recordedParties : [...new Set([...recordedParties, ...addedParties])].sort();

  const handleSubHeadChange = (subHeadName: string) => {
    const selectedSubHead = subAccountHeads.find(sh => sh.name === subHeadName);
    form.setValue('subHeadOfAccount', subHeadName);
    if (selectedSubHead) {
      const parentHead = accountHeads.find(h => h.id === selectedSubHead.headId);
      form.setValue('headOfAccount', parentHead ? parentHead.name : '');
    }
  };

  const headOfAccount = form.watch('headOfAccount');
  const headError = form.formState.errors.headOfAccount?.message;
  const optional = (key: FieldKey) =>
    !fieldFor(key).required && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>;
  /** The help text set under Settings › Field Control, if any. */
  const help = (key: FieldKey) => {
    const text = fieldFor(key).helpText;
    return text ? <FormDescription className="text-[11px]">{text}</FormDescription> : null;
  };

  return (
    // One card, one 6-column grid shared with the GST & TDS part below, so every column lines up:
    // row 1 — who and where it is booked · row 2 — how much and what for.
    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b bg-slate-50/70 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">Request details</h2>
          <p className="text-xs text-muted-foreground">Who is being paid, for what, and how much.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <Hash className="h-3.5 w-3.5 text-slate-400" />
            <span className={cn('font-medium text-slate-800', /\d/.test(requestNo) && 'font-mono')}>{requestNo}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
            {timestamp}
          </span>
        </div>
      </div>

      <CardContent className={cn(GRID, 'p-4 sm:p-5')}>
        {department}

        <FormField
          control={form.control}
          name="projectId"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className={LABEL}>{fieldFor('projectId').label}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value} disabled={isLocked('projectId')}>
                <FormControl>
                  <SelectTrigger className={PICKER}><SelectValue placeholder="Select project" /></SelectTrigger>
                </FormControl>
                <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}</SelectContent>
              </Select>
              {help('projectId')}
              <FormMessage className="text-[11px]" />
            </FormItem>
          )}
        />

        {fieldFor('partyName').visible && <FormField
          control={form.control}
          name="partyName"
          render={({ field }) => (
            <FormItem className="space-y-1.5 sm:col-span-2">
              <FormLabel className={LABEL}>{fieldFor('partyName').label}{optional('partyName')}</FormLabel>
              <Popover
                open={partyPopoverOpen}
                onOpenChange={open => {
                  // Opens on the name chosen so far, however the form came to hold it — a link, a
                  // reset after saving, or the request being edited.
                  if (open) setPartySearch(field.value ?? '');
                  setPartyPopoverOpen(open);
                }}
              >
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      role="combobox"
                      disabled={isLocked('partyName')}
                      className={cn('flex h-9 w-full justify-between px-3 font-normal text-sm', !field.value && 'text-muted-foreground')}
                    >
                      <span className="truncate">{field.value || (restrictParty ? 'Select a party on record' : 'Select or type a party')}</span>
                      <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" side="bottom" align="start">
                  <Command>
                    <CommandInput placeholder="Search party name..." value={partySearch} onValueChange={setPartySearch} />
                    <CommandList>
                      <CommandEmpty>{restrictParty ? 'No party on record matches.' : 'No party found.'}</CommandEmpty>
                      <CommandGroup>
                        {partyOptions.filter(p => p.toLowerCase().includes(partySearch.toLowerCase())).map(name => (
                          <CommandItem
                            value={name}
                            key={name}
                            onSelect={currentValue => {
                              field.onChange(currentValue);
                              form.setValue('partyName', currentValue);
                              setPartySearch(currentValue);
                              setPartyPopoverOpen(false);
                            }}
                          >
                            <Check className={cn('mr-2 h-4 w-4', name === field.value ? 'opacity-100' : 'opacity-0')} />
                            {name}
                          </CommandItem>
                        ))}
                        {!restrictParty && partySearch && !partyOptions.some(n => n.toLowerCase() === partySearch.toLowerCase()) && (
                          <CommandItem
                            value={partySearch}
                            onSelect={currentValue => {
                              field.onChange(currentValue);
                              form.setValue('partyName', currentValue);
                              setPartySearch(currentValue);
                              setAddedParties(prev => [...prev, currentValue]);
                              setPartyPopoverOpen(false);
                            }}
                          >
                            <Check className="mr-2 h-4 w-4 opacity-0" />
                            Add &quot;{partySearch}&quot;
                          </CommandItem>
                        )}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {restrictParty && <FormDescription className="text-[11px]">Only parties already on record can be chosen.</FormDescription>}
              {help('partyName')}
              <FormMessage className="text-[11px]" />
            </FormItem>
          )}
        />}

        <FormField
          control={form.control}
          name="subHeadOfAccount"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className={LABEL}>{fieldFor('subHeadOfAccount').label}</FormLabel>
              <Select onValueChange={handleSubHeadChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className={PICKER}><SelectValue placeholder="Select sub-head" /></SelectTrigger>
                </FormControl>
                <SelectContent>{subAccountHeads.map(sh => <SelectItem key={sh.id} value={sh.name}>{sh.name}</SelectItem>)}</SelectContent>
              </Select>
              {help('subHeadOfAccount')}
              <FormMessage className="text-[11px]" />
            </FormItem>
          )}
        />

        {/* The head is derived from the sub-head, so it is shown, not asked for. */}
        <div className="min-w-0 space-y-1.5">
          <p className={LABEL}>{fieldFor('headOfAccount').label}</p>
          <div className={cn(READ_ONLY, headOfAccount ? 'font-medium text-slate-800' : 'text-muted-foreground')}>
            <span className="truncate">{headOfAccount || 'Set by the sub-head'}</span>
          </div>
          {fieldFor('headOfAccount').helpText && <p className="text-[11px] text-muted-foreground">{fieldFor('headOfAccount').helpText}</p>}
          {headError && form.watch('subHeadOfAccount') && <p className="text-[11px] font-medium text-destructive">{headError}</p>}
        </div>

        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className={LABEL}>
                {fieldFor('amount').label}
                {withStatutory && <span className="ml-1 font-normal text-muted-foreground">(before GST)</span>}
              </FormLabel>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-9 pl-7 text-right text-sm font-semibold tabular-nums"
                    {...field}
                    disabled={isLocked('amount')}
                    value={field.value === 0 ? '' : field.value}
                  />
                </FormControl>
              </div>
              {help('amount')}
              <FormMessage className="text-[11px]" />
            </FormItem>
          )}
        />

        <div className="min-w-0 space-y-1.5">
          <p className={LABEL}>Net payable</p>
          <div className={cn(READ_ONLY, 'justify-end border-emerald-200 bg-emerald-50/70 font-semibold tabular-nums text-emerald-800')}>
            {inrText(netPayable)}
          </div>
        </div>

        {fieldFor('description').visible && <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem className="space-y-1.5 sm:col-span-2">
              <FormLabel className={LABEL}>{fieldFor('description').label}{optional('description')}</FormLabel>
              <FormControl>
                <Input {...field} placeholder="What the payment is for, e.g. Cement supply for Block A" className="h-9 text-sm" />
              </FormControl>
              {help('description')}
              <FormMessage className="text-[11px]" />
            </FormItem>
          )}
        />}

        {fieldFor('remarks').visible && <FormField
          control={form.control}
          name="remarks"
          render={({ field }) => (
            <FormItem className="space-y-1.5 sm:col-span-2">
              <FormLabel className={LABEL}>{fieldFor('remarks').label}{optional('remarks')}</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Anything else worth noting" className="h-9 text-sm" />
              </FormControl>
              {help('remarks')}
              <FormMessage className="text-[11px]" />
            </FormItem>
          )}
        />}
      </CardContent>

      {statutory && <div className="border-t bg-slate-50/50 p-4 sm:p-5">{statutory}</div>}
    </Card>
  );
}

/** The amount and, once GST & TDS are entered, the net payable — the line beside Save. */
export function ExpenseRequestTotals({
  amount,
  netPayable,
  withStatutory,
}: {
  amount: number;
  netPayable: number;
  withStatutory: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
      <span>
        <span className="text-muted-foreground">Amount </span>
        <span className="font-semibold tabular-nums">{inrText(amount)}</span>
      </span>
      {withStatutory && (
        <span>
          <span className="text-muted-foreground">Net payable </span>
          <span className="text-base font-bold tabular-nums text-emerald-700">{inrText(netPayable)}</span>
        </span>
      )}
    </div>
  );
}
