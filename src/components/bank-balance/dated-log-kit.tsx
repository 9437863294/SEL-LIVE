'use client';

/**
 * The shared frame of the two dated-log setup pages — DP Management (limits) and Interest Rates —
 * so both read identically: a register of each account's entry in force today, a history register
 * filterable by account, one entry dialog (account, effective date, the figures, and a previous →
 * new → change comparison), and one delete confirmation.
 *
 * The pages supply only what differs: the figures and how they are summed and compared.
 */

import type { ReactNode } from 'react';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { accountLabel } from '@/components/bank-balance/page-kit';
import { dayKey, entryAppliesOn, formatDay } from '@/lib/bank-balance-ledger';
import type { BankAccount } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface DatedEntry {
  id: string;
  fromDate: string;
  toDate: string | null;
}

export type EntryState = 'current' | 'upcoming' | 'past';

export function entryState(entry: DatedEntry, today: Date): EntryState {
  if (entryAppliesOn(entry, today)) return 'current';
  return entry.fromDate > dayKey(today) ? 'upcoming' : 'past';
}

export type RegisterView = 'current' | 'upcoming' | 'all';

export interface RegisterRow<E extends DatedEntry> {
  id: string;
  account: BankAccount;
  /** Undefined for an account with nothing to show in this view ("No limit" / "No rate"). */
  entry?: E;
  state: EntryState | 'none';
  /** Against the account's previous (older) entry; null for its first. */
  change: number | null;
  /** The account's next scheduled entry, shown beside the one in force. */
  upcoming?: E;
}

/**
 * The single register both pages show: every account's entries in one list.
 *
 * - `current` — one row per account: the entry in force today, or a "none" row so an account
 *   with no limit/rate is never silently missing.
 * - `upcoming` — entries that start after today.
 * - `all` — the full history, plus a "none" row for accounts that have never had an entry.
 */
export function buildRegisterRows<E extends DatedEntry>(
  accounts: BankAccount[],
  logOf: (account: BankAccount) => E[],
  options: { view: RegisterView; accountId: string; today: Date; delta: (entry: E, previous: E) => number },
): Array<RegisterRow<E>> {
  const { view, accountId, today, delta } = options;
  const rows: Array<RegisterRow<E>> = [];
  for (const account of accounts) {
    if (accountId !== 'all' && account.id !== accountId) continue;
    const log = logOf(account); // newest first
    const upcoming = [...log].reverse().find((e) => entryState(e, today) === 'upcoming');
    const withChange = log.map((entry, index) => ({
      entry,
      state: entryState(entry, today),
      change: log[index + 1] ? delta(entry, log[index + 1]) : null,
    }));
    const none: RegisterRow<E> = { id: `${account.id}:none`, account, state: 'none', change: null, upcoming };
    if (view === 'current') {
      const inForce = withChange.find((item) => item.state === 'current');
      rows.push(inForce ? { id: `${account.id}:${inForce.entry.id}`, account, ...inForce, upcoming } : none);
    } else {
      const picked = view === 'upcoming' ? withChange.filter((item) => item.state === 'upcoming') : withChange;
      picked.forEach((item) => rows.push({ id: `${account.id}:${item.entry.id}`, account, ...item }));
      if (view === 'all' && log.length === 0) rows.push(none);
    }
  }
  const byAccount = (a: RegisterRow<E>, b: RegisterRow<E>) => accountLabel(a.account).localeCompare(accountLabel(b.account));
  return view === 'current'
    ? rows.sort(byAccount)
    : rows.sort((a, b) => (b.entry?.fromDate ?? '').localeCompare(a.entry?.fromDate ?? '') || byAccount(a, b));
}

export function RegisterViewFilter({ value, onChange }: { value: RegisterView; onChange: (value: RegisterView) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as RegisterView)}>
      <SelectTrigger className="sm:w-48" aria-label="Show">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="current">In force today</SelectItem>
        <SelectItem value="upcoming">Upcoming</SelectItem>
        <SelectItem value="all">All history</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** The register's status cell: in force, upcoming, ended on a date, or nothing recorded. */
export function RegisterStateBadge({ state, entry, noneLabel }: { state: EntryState | 'none'; entry?: DatedEntry; noneLabel: string }) {
  if (state === 'current') return <Badge variant="success">In force</Badge>;
  if (state === 'upcoming') return <Badge variant="info">Upcoming</Badge>;
  if (state === 'past') return <span className="whitespace-nowrap text-xs text-muted-foreground">Ended {formatDay(entry?.toDate)}</span>;
  return <Badge variant="warning">{noneLabel}</Badge>;
}

/** The account filter used in the register's toolbar. */
export function AccountFilter({
  accounts,
  value,
  onChange,
}: {
  accounts: BankAccount[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="sm:w-56" aria-label="Account">
        <SelectValue placeholder="All accounts" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All accounts</SelectItem>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {accountLabel(account)} — {account.bankName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface ComparisonRow {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
  /** Whether the change is good news (a higher limit) or bad (a higher rate). */
  tone?: 'good' | 'bad' | 'none';
}

/**
 * The entry dialog. `fields` renders the page's own inputs; the effective date and account are
 * common. `comparison` is the previous → new → change box, `notes` the plain-language effect.
 */
export function EntryDialog({
  open,
  onClose,
  formId,
  title,
  accounts,
  accountId,
  onAccountChange,
  lockAccount,
  fromDate,
  onFromDateChange,
  fields,
  comparison,
  notes,
  saving,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  formId: string;
  title: string;
  accounts: BankAccount[];
  accountId: string;
  onAccountChange: (id: string) => void;
  /** Opened from an account's row: the account is fixed. */
  lockAccount: boolean;
  fromDate: string;
  onFromDateChange: (value: string) => void;
  fields: ReactNode;
  comparison: ComparisonRow[];
  notes: ReactNode[];
  saving: boolean;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const account = accounts.find((a) => a.id === accountId);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <DialogContent className="hr-mobile-dialog gap-5 sm:max-w-lg">
        <DialogHeader className="hr-dialog-header pr-8">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{account ? `${account.bankName} · ${account.accountNumber}` : 'Choose the Cash Credit account.'}</DialogDescription>
        </DialogHeader>

        <form id={formId} onSubmit={onSubmit} className="hr-dialog-body space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-account`}>Account</Label>
              <Select value={accountId} onValueChange={onAccountChange} disabled={lockAccount}>
                <SelectTrigger id={`${formId}-account`}>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {accountLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-from`}>Effective from</Label>
              <Input id={`${formId}-from`} type="date" required value={fromDate} onChange={(e) => onFromDateChange(e.target.value)} />
            </div>
          </div>

          {fields}

          <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
            {comparison.map((row, index) => (
              <div key={index} className={cn('flex items-baseline justify-between gap-3', index === comparison.length - 1 && comparison.length > 2 && 'border-t pt-2')}>
                <span className="min-w-0 text-muted-foreground">{row.label}</span>
                <span
                  className={cn(
                    'shrink-0 tabular-nums',
                    row.strong ? 'text-lg font-bold text-violet-700' : 'font-medium',
                    row.tone === 'bad' && 'font-semibold text-rose-700',
                    row.tone === 'good' && 'font-semibold text-emerald-700',
                    row.tone === 'none' && 'text-muted-foreground'
                  )}
                >
                  {row.value}
                </span>
              </div>
            ))}
            {notes.length > 0 && (
              <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
                {notes.map((note, index) => (
                  <div key={index}>{note}</div>
                ))}
              </div>
            )}
          </div>
        </form>

        <DialogFooter className="hr-dialog-footer gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={saving || !accountId}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDeleteEntry({
  open,
  title,
  description,
  saving,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next && !saving) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={saving}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The comparison notes both pages show, worded for a limit or a rate. */
export function effectNotes({
  noun,
  fromDate,
  replaces,
  previous,
  next,
  dayBefore,
}: {
  noun: 'limit' | 'rate';
  fromDate: string;
  replaces: boolean;
  previous: boolean;
  next: DatedEntry | undefined;
  dayBefore: (iso: string) => string;
}): ReactNode[] {
  if (!fromDate) return [];
  const notes: ReactNode[] = [];
  if (replaces) notes.push(`A ${noun} already starts on ${formatDay(fromDate)}. Saving replaces it.`);
  if (previous && !replaces) notes.push(`The previous ${noun} will end on ${dayBefore(fromDate)}.`);
  if (next) {
    notes.push(
      <span className="text-amber-700">
        This is a past date: the entry applies until {dayBefore(next.fromDate)}, when the {noun} from {formatDay(next.fromDate)} takes over.
      </span>,
    );
  }
  return notes;
}
