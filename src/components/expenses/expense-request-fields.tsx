'use client';

/**
 * The body of an expense request — one form, shown by New Request and by the department register's
 * Edit dialog, so the two cannot drift apart. Edit used to be a separate, older form: a free-text
 * party box that ignored "Restrict parties to existing names", fixed labels that ignored Field
 * Control, no net payable and no GST & TDS at all.
 *
 * Two rows, each on its own proportions on a wide card — who and where it is booked (department,
 * project, party, sub-head and the head worked out from it), then how much and what for (amount,
 * net payable, description, remarks) — with labels, help text, visibility and required-ness from
 * Settings › Field Control, and under them whatever bank details and GST & TDS sections the caller
 * passes. What is typed is kept in capital letters (`upperCaseTyped`). The look is
 * expense-form.module.css. `ExpenseRequestTotals` is the amount / net payable line beside Save.
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import * as z from 'zod';
import {
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  FileText,
  FolderKanban,
  Hash,
  ListTree,
  MessageSquare,
  PencilLine,
  Plus,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormControl, FormField } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
  FieldItem,
  FieldLabel,
  FieldNote,
  LabelBody,
  ShownField,
  accentStyle,
  columnTemplate,
  money,
  upperCaseTyped,
  xr,
} from '@/components/expenses/expense-form-ui';
import { requestAmountError, resolveFormField, type ExpensesModuleSettings } from '@/lib/expenses-settings';
import { amountInWords } from '@/lib/daily-requisition-print';
import type { AccountHead, Project, SubAccountHead } from '@/lib/types';
import { cn } from '@/lib/utils';

type FieldKey = Parameters<typeof resolveFormField>[1];

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

/** Each row's columns on a wide card, by share — the party and the description get the most room. */
const WHO_WEIGHTS = { department: 0.9, project: 1.3, party: 1.5, subHead: 1, head: 1.1 };
const WHAT_WEIGHTS = { amount: 1, net: 1, description: 1.6, remarks: 1.6 };

/** A party's tile colour, the same for a name every time it is shown. */
const PARTY_COLOURS = ['#7c3aed', '#0891b2', '#ea580c', '#047857', '#be123c', '#2563eb'];
const partyColour = (name: string) => {
  let hash = 0;
  for (const ch of partyKey(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PARTY_COLOURS[hash % PARTY_COLOURS.length];
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(word => /[A-Za-z0-9]/.test(word[0] ?? ''))
    .map(word => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

function PartyTile({ name }: { name: string }) {
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] text-[10px] font-extrabold text-white"
      style={{ background: partyColour(name) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/** What the amount box shows while it is not being typed in: 1,84,500 rather than 184500. */
const grouped = (n: number) => (n ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '');

/** Digits and one decimal point, from whatever was typed or pasted. */
const cleanAmount = (typed: string) => {
  const [whole, ...rest] = typed.replace(/[^0-9.]/g, '').split('.');
  return rest.length ? `${whole}.${rest.join('')}` : whole;
};

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
  bank,
  statutory,
}: {
  form: UseFormReturn<ExpenseFormValues>;
  settings: ExpensesModuleSettings;
  projects: readonly Project[];
  accountHeads: readonly AccountHead[];
  subAccountHeads: readonly SubAccountHead[];
  /** Party names already on an expense request or a requisition — what "existing" means for the party rule. */
  recordedParties: readonly string[];
  /**
   * The department control: a picker on New Request, the request's own department when editing.
   * Drawn with `FieldItem` / `ShownField` in the violet accent, so it matches the fields beside it.
   */
  department: ReactNode;
  /** The header strip: the request number (or its preview) and when it was raised. */
  requestNo: string;
  timestamp: string;
  netPayable: number;
  /** GST & TDS are entered, so the amount is the value before GST. */
  withStatutory: boolean;
  locked?: readonly LockableExpenseField[];
  /** The bank details section (where the payment goes), under the fields. */
  bank?: ReactNode;
  /** The GST & TDS section, under the fields. */
  statutory?: ReactNode;
}) {
  /** Labels, help text and required-ness come from Settings › Field Control. */
  const fieldFor = (key: FieldKey) => resolveFormField(settings, key);
  const isLocked = (key: LockableExpenseField) => locked.includes(key);
  /** The help text set under Settings › Field Control, if any. */
  const help = (key: FieldKey) => fieldFor(key).helpText || '';

  const [partyPopoverOpen, setPartyPopoverOpen] = useState(false);
  const [partySearch, setPartySearch] = useState('');
  /** Names typed in with "Add" here — they reach the record only with the request that carries one. */
  const [addedParties, setAddedParties] = useState<string[]>([]);
  /** The amount as typed, while the box has focus. */
  const [amountDraft, setAmountDraft] = useState<string | null>(null);

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

  const party = fieldFor('partyName');
  const description = fieldFor('description');
  const remarks = fieldFor('remarks');

  const whoColumns = columnTemplate([
    WHO_WEIGHTS.department,
    WHO_WEIGHTS.project,
    ...(party.visible ? [WHO_WEIGHTS.party] : []),
    WHO_WEIGHTS.subHead,
    WHO_WEIGHTS.head,
  ]);
  const whatColumns = columnTemplate([
    WHAT_WEIGHTS.amount,
    WHAT_WEIGHTS.net,
    ...(description.visible ? [WHAT_WEIGHTS.description] : []),
    ...(remarks.visible ? [WHAT_WEIGHTS.remarks] : []),
  ]);

  /** A real number (or its preview), rather than "Select a department first" or "Generating...". */
  const numbered = /\d/.test(requestNo);

  return (
    <section className={cn(xr.scope, xr.card)}>
      <header className={xr.head}>
        <span className={xr.headIcon} aria-hidden="true">
          <FileText />
        </span>
        <div className={xr.headText}>
          <h2 className={xr.headTitle}>Request details</h2>
          <p className={xr.headNote}>Who is being paid, for what, and how much.</p>
        </div>
        <div className={xr.headPills}>
          <span className={cn(xr.pill, numbered ? xr.pillRef : xr.pillPending)} title="Request number">
            <Hash aria-hidden="true" />
            {requestNo}
          </span>
          {timestamp && (
            <span className={cn(xr.pill, xr.pillDate)} title="Raised">
              <CalendarClock aria-hidden="true" />
              {timestamp}
            </span>
          )}
        </div>
      </header>

      <div className={xr.body}>
        {/* Who is being paid and where it is booked */}
        <div className={cn(xr.row, xr.rowWho)} style={{ '--xr-cols': whoColumns } as CSSProperties}>
          {department}

          <FormField
            control={form.control}
            name="projectId"
            render={({ field }) => (
              <FieldItem accent="teal">
                <FieldLabel icon={FolderKanban} required>{fieldFor('projectId').label}</FieldLabel>
                <Select onValueChange={field.onChange} value={field.value} disabled={isLocked('projectId')}>
                  <FormControl>
                    <SelectTrigger className={cn(xr.control, field.value && xr.set)}>
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}</SelectContent>
                </Select>
                <FieldNote>{help('projectId')}</FieldNote>
              </FieldItem>
            )}
          />

          {party.visible && <FormField
            control={form.control}
            name="partyName"
            render={({ field }) => {
              const onRecord = field.value ? findRecordedParty(field.value, recordedParties) : undefined;
              const matches = partyOptions.filter(p => p.toLowerCase().includes(partySearch.toLowerCase()));
              const canAdd = !restrictParty && !!partySearch.trim() && !partyOptions.some(n => n.toLowerCase() === partySearch.toLowerCase());
              // Kept in capitals, as the whole request is. Matching a party on record ignores case.
              const choose = (picked: string) => {
                const name = picked.toUpperCase();
                field.onChange(name);
                form.setValue('partyName', name);
                setPartySearch(name);
                setPartyPopoverOpen(false);
              };
              return (
                <FieldItem accent="blue">
                  <FieldLabel icon={UserRound} required={party.required} optional={!party.required}>{party.label}</FieldLabel>
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
                        {/* The trigger supplies aria-haspopup, aria-expanded and aria-controls. */}
                        <button
                          type="button"
                          disabled={isLocked('partyName')}
                          data-placeholder={field.value ? undefined : ''}
                          className={cn(xr.control, 'justify-between gap-2', field.value && xr.set)}
                        >
                          <span>{field.value || (restrictParty ? 'Select a party on record' : 'Select or type a party')}</span>
                          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
                        </button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[300px] rounded-2xl p-1" side="bottom" align="start">
                      <Command>
                        {/* Shown in capitals, as the name will be saved; the search itself ignores case. */}
                        <CommandInput placeholder="Search party name..." value={partySearch} onValueChange={setPartySearch} className="uppercase placeholder:normal-case" />
                        <CommandList className="max-h-72">
                          <CommandEmpty>{restrictParty ? 'No party on record matches.' : 'No party found.'}</CommandEmpty>
                          <CommandGroup>
                            {matches.map(name => (
                              <CommandItem value={name} key={name} onSelect={() => choose(name)} className="gap-2.5 rounded-[10px] px-2 py-1.5">
                                <PartyTile name={name} />
                                <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
                                {name === field.value && <Check className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />}
                              </CommandItem>
                            ))}
                            {canAdd && (
                              <CommandItem
                                value={partySearch}
                                onSelect={() => {
                                  setAddedParties(prev => [...prev, partySearch.trim().toUpperCase()]);
                                  choose(partySearch.trim());
                                }}
                                className="gap-2.5 rounded-[10px] px-2 py-1.5 font-bold text-blue-600 dark:text-blue-400"
                              >
                                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border border-dashed border-blue-300" aria-hidden="true">
                                  <Plus className="h-3.5 w-3.5" />
                                </span>
                                <span className="min-w-0 truncate">Add &ldquo;{partySearch.trim().toUpperCase()}&rdquo;</span>
                              </CommandItem>
                            )}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {field.value ? (
                    onRecord ? (
                      <FieldNote tone="ok">✓ Party on record</FieldNote>
                    ) : (
                      <FieldNote tone="accent">New party — added with this request</FieldNote>
                    )
                  ) : (
                    <FieldNote>{help('partyName') || (restrictParty ? 'Only parties already on record can be chosen.' : '')}</FieldNote>
                  )}
                </FieldItem>
              );
            }}
          />}

          <FormField
            control={form.control}
            name="subHeadOfAccount"
            render={({ field }) => (
              <FieldItem accent="amber">
                <FieldLabel icon={ListTree} required>{fieldFor('subHeadOfAccount').label}</FieldLabel>
                <Select onValueChange={handleSubHeadChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className={cn(xr.control, field.value && xr.set)}>
                      <SelectValue placeholder="Select sub-head" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>{subAccountHeads.map(sh => <SelectItem key={sh.id} value={sh.name}>{sh.name}</SelectItem>)}</SelectContent>
                </Select>
                <FieldNote>{help('subHeadOfAccount')}</FieldNote>
              </FieldItem>
            )}
          />

          {/* The head is derived from the sub-head, so it is shown, not asked for. */}
          <ShownField
            accent="emerald"
            icon={TrendingUp}
            label={fieldFor('headOfAccount').label}
            on={!!headOfAccount}
            note={
              headError && form.watch('subHeadOfAccount') ? (
                <span className={xr.subError}>{headError}</span>
              ) : (
                help('headOfAccount') || 'Automatic'
              )
            }
          >
            {headOfAccount ? (
              <>
                <CheckCircle2 aria-hidden="true" />
                <span title={headOfAccount}>{headOfAccount}</span>
              </>
            ) : (
              <span>Set by the sub-head</span>
            )}
          </ShownField>
        </div>

        {/* How much, and what for */}
        <div className={xr.row} style={{ '--xr-cols': whatColumns } as CSSProperties}>
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => {
              const amount = Number(field.value) || 0;
              // The draft is kept only while it still reads as the form's figure, so a reset or a
              // figure set from outside replaces it.
              const shown = amountDraft !== null && (Number(amountDraft) || 0) === amount ? amountDraft : grouped(amount);
              return (
                <FieldItem accent="pink">
                  <FieldLabel glyph="₹" required>
                    {fieldFor('amount').label}
                    {withStatutory && <em className={xr.opt}> (before GST)</em>}
                  </FieldLabel>
                  <div className={cn(xr.money, xr.moneyLarge)}>
                    <span className={xr.moneySign} aria-hidden="true">₹</span>
                    <FormControl>
                      <input
                        ref={field.ref}
                        name={field.name}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0.00"
                        disabled={isLocked('amount')}
                        className={cn(xr.control, amount > 0 && xr.set)}
                        value={shown}
                        onFocus={() => setAmountDraft(amount ? String(amount) : '')}
                        onChange={event => {
                          const typed = cleanAmount(event.target.value);
                          setAmountDraft(typed);
                          field.onChange(Number(typed) || 0);
                        }}
                        onBlur={() => {
                          setAmountDraft(null);
                          field.onBlur();
                        }}
                      />
                    </FormControl>
                  </div>
                  {help('amount') ? (
                    <FieldNote>{help('amount')}</FieldNote>
                  ) : (
                    <FieldNote tone="accent">{amount > 0 ? amountInWords(amount) : ''}</FieldNote>
                  )}
                </FieldItem>
              );
            }}
          />

          <div className={xr.field} style={accentStyle('green')}>
            <p className={xr.label}>
              <LabelBody icon={Check}>Net payable</LabelBody>
            </p>
            <div className={cn(xr.net, netPayable < 0 && xr.netNegative)}>
              <small>AUTO</small>
              <span>{money(netPayable)}</span>
            </div>
            <p className={xr.sub}>{withStatutory ? 'After GST, TDS & deductions' : 'Same as the amount — a plain bill'}</p>
          </div>

          {description.visible && <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FieldItem accent="indigo">
                <FieldLabel icon={PencilLine} required={description.required} optional={!description.required}>{description.label}</FieldLabel>
                <FormControl>
                  <input
                    {...field}
                    value={field.value ?? ''}
                    onChange={event => field.onChange(upperCaseTyped(event))}
                    placeholder="What the payment is for, e.g. Cement supply for Block A"
                    className={cn(xr.control, field.value && xr.set)}
                  />
                </FormControl>
                <FieldNote>{help('description')}</FieldNote>
              </FieldItem>
            )}
          />}

          {remarks.visible && <FormField
            control={form.control}
            name="remarks"
            render={({ field }) => (
              <FieldItem accent="slate">
                <FieldLabel icon={MessageSquare} required={remarks.required} optional={!remarks.required}>{remarks.label}</FieldLabel>
                <FormControl>
                  <input
                    {...field}
                    value={field.value ?? ''}
                    onChange={event => field.onChange(upperCaseTyped(event))}
                    placeholder="Anything else worth noting"
                    className={cn(xr.control, field.value && xr.set)}
                  />
                </FormControl>
                <FieldNote>{help('remarks')}</FieldNote>
              </FieldItem>
            )}
          />}
        </div>
      </div>

      {bank && <div className={xr.tax}>{bank}</div>}
      {statutory && <div className={xr.tax}>{statutory}</div>}
    </section>
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
        <span className="font-semibold tabular-nums">{money(amount)}</span>
      </span>
      {withStatutory && (
        <span>
          <span className="text-muted-foreground">Net payable </span>
          <span className="text-base font-bold tabular-nums text-emerald-700">{money(netPayable)}</span>
        </span>
      )}
    </div>
  );
}
