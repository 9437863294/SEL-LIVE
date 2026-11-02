'use client';

/**
 * The bank-account picker the entry forms share (New Transfer, New Payment): the account with what
 * it has now and after the entry, opening a searchable list of every active account grouped by
 * type. Plus the gradient icon tile, the CC/CA tag and the inline message they use.
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, ChevronDown, Info, Landmark, Plus, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import heroStyles from '@/components/bank-balance/dashboard-designs/aurora.module.css';
import { accountLabel } from '@/components/bank-balance/page-kit';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import { compactInr, formatInr, isCashCredit } from '@/lib/bank-balance-ledger';
import type { BankAccount } from '@/lib/types';
import { cn } from '@/lib/utils';

export /** One gradient per account, by its place in the list; the account's name always goes with it. */
const TILE_COLOURS: Array<[string, string]> = [
  ['#60a5fa', '#1d4ed8'], ['#f9a8d4', '#9d174d'], ['#fcd34d', '#d97706'], ['#fda4af', '#be123c'],
  ['#93c5fd', '#1e40af'], ['#fde68a', '#b45309'], ['#86efac', '#15803d'], ['#c4b5fd', '#6d28d9'],
];

/** The gradient for the account at `index` in a list. */
export const tileColours = (index: number): [string, string] => TILE_COLOURS[Math.max(0, index) % TILE_COLOURS.length];

export function Tile({ colours, size = 40, children }: { colours: [string, string]; size?: number; children?: ReactNode }) {
  return (
    <span
      aria-hidden
      className={heroStyles.appIcon}
      style={{ '--a': colours[0], '--b': colours[1], width: size, height: size, borderRadius: size * 0.3 } as CSSProperties}
    >
      {children ?? <Landmark style={{ width: size * 0.48, height: size * 0.48 }} />}
    </span>
  );
}

export function TypeTag({ account }: { account: BankAccount }) {
  const cc = isCashCredit(account);
  return (
    <span
      className={cn(
        'ml-1.5 rounded-md px-1.5 py-px align-[1px] text-[10.5px] font-extrabold tracking-wide',
        cc ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
      )}
    >
      {cc ? 'CC' : 'CA'}
    </span>
  );
}

/**
 * A From or To account: the account with what it has now and after this batch, opening a
 * searchable list of every active account grouped by type.
 */
export function AccountPicker({
  label,
  accounts,
  value,
  onChange,
  otherId,
  availableOf,
  effectOf,
  colourOf,
  invalid,
}: {
  label: string;
  accounts: BankAccount[];
  value: string;
  onChange: (id: string) => void;
  /** The account on the other side, which cannot be picked here. */
  otherId: string;
  availableOf: (id: string) => number;
  effectOf: (id: string) => number;
  colourOf: (id: string) => [string, string];
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const account = accounts.find((a) => a.id === value);
  const needle = search.trim().toLowerCase();
  const matches = (a: BankAccount) => !needle || `${accountLabel(a)} ${a.bankName} ${a.branch ?? ''}`.toLowerCase().includes(needle);

  const now = account ? availableOf(account.id) : 0;
  const delta = account ? effectOf(account.id) : 0;
  const after = now + delta;
  const limit = account && isCashCredit(account) ? Math.max(0, getApplicableCcLimit(account, new Date())) : 0;
  const usedAfter = limit > 0 ? Math.min(100, Math.max(0, ((limit - after) / limit) * 100)) : 0;

  return (
    <div className="min-w-0">
      <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch('');
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex min-h-[104px] w-full flex-col rounded-2xl border bg-card p-3 text-left transition hover:border-indigo-200',
              open && 'border-violet-600 ring-[3px] ring-violet-600/15',
              invalid && !open && 'border-destructive',
              !account && 'items-center justify-center border-dashed font-semibold text-muted-foreground',
            )}
          >
            {account ? (
              <>
                <span className="flex w-full items-center gap-2.5">
                  <Tile colours={colourOf(account.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-bold leading-tight text-foreground">
                      {accountLabel(account)}
                      <TypeTag account={account} />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{account.bankName}</span>
                  </span>
                  <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                </span>
                <span className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{isCashCredit(account) ? 'Available limit' : 'Balance'}</span>
                  <b className={cn('tabular-nums', now < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground')}>{formatInr(now, 0)}</b>
                  {delta !== 0 && (
                    <>
                      <ArrowRight aria-hidden className="h-3 w-3" />
                      <b className={cn('tabular-nums', after < 0 ? 'text-rose-600 dark:text-rose-400' : delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                        {formatInr(after, 0)}
                      </b>
                    </>
                  )}
                </span>
                {limit > 0 && (
                  <span aria-hidden className="mt-2 block h-[5px] w-full overflow-hidden rounded bg-muted">
                    <span className="block h-full rounded bg-gradient-to-r from-violet-400 to-violet-600" style={{ width: `${usedAfter}%` }} />
                  </span>
                )}
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Plus aria-hidden className="h-4 w-4" />
                Choose account
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-1.5">
          <label className="relative mb-1 block">
            <span className="sr-only">Search accounts</span>
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search account…" className="h-9 pl-8" />
          </label>
          <div className="max-h-72 overflow-y-auto">
            {(['Cash Credit', 'Current Account'] as const).map((type) => {
              const group = accounts.filter((a) => a.accountType === type && matches(a));
              if (group.length === 0) return null;
              return (
                <div key={type}>
                  <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
                    {type === 'Cash Credit' ? 'Cash credit' : 'Current accounts'}
                  </p>
                  {group.map((a) => {
                    const disabled = a.id === otherId;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          onChange(a.id);
                          setOpen(false);
                          setSearch('');
                        }}
                        className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-40', a.id === value && 'bg-muted')}
                      >
                        <Tile colours={colourOf(a.id)} size={30} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold text-foreground">
                            {accountLabel(a)}
                            <TypeTag account={a} />
                          </span>
                          <span className="block truncate text-[11.5px] text-muted-foreground">{a.bankName}</span>
                        </span>
                        <span className="shrink-0 text-right text-xs font-bold tabular-nums text-foreground">
                          {compactInr(availableOf(a.id))}
                          <span className="block text-[11px] font-semibold text-muted-foreground">{isCashCredit(a) ? 'available limit' : 'balance'}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {accounts.every((a) => !matches(a)) && <p className="px-2.5 py-4 text-sm text-muted-foreground">No account matches “{search}”.</p>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function Message({ tone, children }: { tone: 'bad' | 'warn' | 'info'; children: ReactNode }) {
  const Icon = tone === 'bad' ? X : tone === 'warn' ? AlertTriangle : Info;
  return (
    <p
      className={cn(
        'mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px] font-semibold',
        tone === 'bad' && 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
        tone === 'warn' && 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
        tone === 'info' && 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
      )}
    >
      <Icon aria-hidden className="mt-px h-4 w-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
