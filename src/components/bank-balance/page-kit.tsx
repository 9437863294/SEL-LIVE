'use client';

/**
 * The pieces every Bank Balance page is built from, so the module reads as one product:
 *
 *  - `BankBalanceBackground` — the drifting-orb backdrop, one colour per page family.
 *  - `BANK_PAGE` — the page container every screen uses (padding matches the module sidebar).
 *  - `BankPageSkeleton`, `BankAccessDenied` — the loading and no-permission states.
 *  - `useBankData` — loads accounts (and optionally every transaction) once, with a refresh.
 *  - `BankDateRangeFilter` — quick presets plus a custom range, the one date filter.
 *  - `UtilisationBadge` — the one utilisation level badge (thresholds in bank-balance-ledger).
 *
 * The reference screen is DP Management: PageHeader, a KpiCard row, content in Cards / TableCard,
 * DataList for records that must read on a phone, forms in a Dialog using the hr-mobile-dialog
 * classes, and confirmations in an AlertDialog.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { CalendarIcon, ShieldAlert } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { DATE_RANGE_PRESET_OPTIONS, getDateRangeFromPreset, type DateRangePreset } from '@/lib/date-range-presets';
import { UTILISATION_LABEL, utilisationLevel, type UtilisationLevel } from '@/lib/bank-balance-ledger';
import type { BankAccount, BankExpense } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The container every Bank Balance page renders its content in. */
export const BANK_PAGE = 'relative w-full space-y-5 px-4 py-4 sm:px-6 lg:px-8';

export type BankTone = 'violet' | 'purple' | 'indigo' | 'blue' | 'sky' | 'teal' | 'emerald' | 'green' | 'amber' | 'rose' | 'red' | 'slate';

// Literal class strings (not built from the tone name) so Tailwind emits every one of them.
const TONES: Record<BankTone, { base: string; orbA: string; orbB: string; dot: string }> = {
  violet: { base: 'from-violet-50/70 via-background to-sky-50/50', orbA: 'bg-violet-300/15', orbB: 'bg-sky-300/12', dot: 'rgba(139,92,246,0.12)' },
  purple: { base: 'from-purple-50/60 via-background to-violet-50/40', orbA: 'bg-purple-300/15', orbB: 'bg-violet-300/12', dot: 'rgba(168,85,247,0.12)' },
  indigo: { base: 'from-indigo-50/60 via-background to-violet-50/40', orbA: 'bg-indigo-300/15', orbB: 'bg-violet-300/12', dot: 'rgba(99,102,241,0.12)' },
  blue: { base: 'from-blue-50/60 via-background to-indigo-50/40', orbA: 'bg-blue-300/15', orbB: 'bg-indigo-300/12', dot: 'rgba(59,130,246,0.12)' },
  sky: { base: 'from-sky-50/60 via-background to-cyan-50/40', orbA: 'bg-sky-300/15', orbB: 'bg-cyan-300/12', dot: 'rgba(14,165,233,0.12)' },
  teal: { base: 'from-teal-50/60 via-background to-emerald-50/40', orbA: 'bg-teal-300/15', orbB: 'bg-emerald-300/12', dot: 'rgba(20,184,166,0.12)' },
  emerald: { base: 'from-emerald-50/60 via-background to-teal-50/40', orbA: 'bg-emerald-300/15', orbB: 'bg-teal-300/12', dot: 'rgba(16,185,129,0.12)' },
  green: { base: 'from-green-50/60 via-background to-emerald-50/40', orbA: 'bg-green-300/15', orbB: 'bg-emerald-300/12', dot: 'rgba(34,197,94,0.12)' },
  amber: { base: 'from-amber-50/60 via-background to-orange-50/40', orbA: 'bg-amber-300/15', orbB: 'bg-orange-300/12', dot: 'rgba(245,158,11,0.12)' },
  rose: { base: 'from-rose-50/60 via-background to-pink-50/40', orbA: 'bg-rose-300/15', orbB: 'bg-pink-300/12', dot: 'rgba(244,63,94,0.12)' },
  red: { base: 'from-red-50/60 via-background to-rose-50/40', orbA: 'bg-red-300/15', orbB: 'bg-rose-300/12', dot: 'rgba(239,68,68,0.12)' },
  slate: { base: 'from-slate-50/70 via-background to-violet-50/30', orbA: 'bg-slate-300/15', orbB: 'bg-violet-300/10', dot: 'rgba(100,116,139,0.12)' },
};

export function BankBalanceBackground({ tone }: { tone: BankTone }) {
  const t = TONES[tone];
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className={cn('absolute inset-0 bg-gradient-to-br', t.base)} />
      <div className={cn('animate-bb-orb-1 absolute left-[-5%] top-[-10%] h-[40vw] w-[40vw] rounded-full blur-3xl', t.orbA)} />
      <div className={cn('animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] h-[45vw] w-[45vw] rounded-full blur-3xl', t.orbB)} />
      <div
        className="absolute inset-0 opacity-20"
        style={{ backgroundImage: `radial-gradient(circle, ${t.dot} 1px, transparent 1px)`, backgroundSize: '28px 28px' }}
      />
    </div>
  );
}

/** The loading state: header bar, a KPI row and a content block, sized like the real page. */
export function BankPageSkeleton({ kpis = 3, blocks = 1 }: { kpis?: number; blocks?: number }) {
  return (
    <div className={BANK_PAGE}>
      <Skeleton className="h-10 w-64 rounded-xl" />
      {kpis > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: kpis }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      )}
      {Array.from({ length: blocks }).map((_, i) => (
        <Skeleton key={i} className="h-80 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function BankAccessDenied({
  title,
  backHref = '/bank-balance',
  backLabel = 'Back to dashboard',
  what = 'this page',
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  what?: string;
}) {
  return (
    <div className={BANK_PAGE}>
      <PageHeader title={title} backHref={backHref} backLabel={backLabel} />
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You do not have permission to view {what}.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center p-8">
          <ShieldAlert className="h-14 w-14 text-destructive" />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Bank accounts, and every transaction when `transactions` is set, loaded once `enabled` turns
 * true (pass the page's view permission, so nothing is read without it).
 */
export function useBankData({ enabled, transactions = false }: { enabled: boolean; transactions?: boolean }) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [txns, setTxns] = useState<BankExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const [accountSnap, txnSnap] = await Promise.all([
          getDocs(collection(db, 'bankAccounts')),
          transactions ? getDocs(collection(db, 'bankExpenses')) : Promise.resolve(null),
        ]);
        setAccounts(
          accountSnap.docs
            .map((d) => ({ id: d.id, ...d.data() } as BankAccount))
            .sort((a, b) => (a.shortName || a.bankName || '').localeCompare(b.shortName || b.bankName || '')),
        );
        if (txnSnap) setTxns(txnSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankExpense)));
        setLoadedAt(new Date());
      } catch (error) {
        console.error('Error loading bank data:', error);
        toast({ title: 'Error', description: 'Failed to load bank data.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [transactions, toast],
  );

  useEffect(() => {
    if (enabled) void load();
    else setIsLoading(false);
  }, [enabled, load]);

  return { accounts, setAccounts, transactions: txns, isLoading, isRefreshing, loadedAt, refresh: () => load(true) };
}

/** The account's display name everywhere: short name, falling back to the bank name. */
export const accountLabel = (account: Pick<BankAccount, 'shortName' | 'bankName'> | undefined) =>
  (account?.shortName || account?.bankName || 'Unknown').trim();

export function BankDateRangeFilter({
  range,
  preset,
  onChange,
  presets = DATE_RANGE_PRESET_OPTIONS,
}: {
  range: DateRange | undefined;
  preset: DateRangePreset;
  onChange: (range: DateRange | undefined, preset: DateRangePreset) => void;
  presets?: typeof DATE_RANGE_PRESET_OPTIONS;
}) {
  return (
    <>
      <Select
        value={preset}
        onValueChange={(value) => {
          const next = value as DateRangePreset;
          onChange(next === 'custom' ? range : getDateRangeFromPreset(next), next);
        }}
      >
        <SelectTrigger className="sm:w-40">
          <SelectValue placeholder="Quick range" />
        </SelectTrigger>
        <SelectContent>
          {presets.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn('justify-start text-left font-normal sm:w-64', !range?.from && 'text-muted-foreground')}>
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
            <span className="truncate">
              {range?.from
                ? range.to
                  ? `${format(range.from, 'dd MMM yyyy')} – ${format(range.to, 'dd MMM yyyy')}`
                  : format(range.from, 'dd MMM yyyy')
                : 'Pick a date range'}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto max-w-[calc(100vw-1.5rem)] overflow-x-auto p-0" align="start">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={range?.from}
            selected={range}
            onSelect={(next) => onChange(next, 'custom')}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}

const LEVEL_TONE: Record<UtilisationLevel, StatusTone> = {
  critical: 'danger',
  high: 'warning',
  moderate: 'info',
  healthy: 'success',
};

/** Text colour for a utilisation percentage, on the same thresholds as the badge. */
export const UTILISATION_TEXT: Record<UtilisationLevel, string> = {
  critical: 'text-rose-600',
  high: 'text-amber-600',
  moderate: 'text-sky-600',
  healthy: 'text-emerald-600',
};

/** Bar colour for a utilisation percentage, on the same thresholds as the badge. */
export const UTILISATION_BAR: Record<UtilisationLevel, string> = {
  critical: 'bg-rose-500',
  high: 'bg-amber-500',
  moderate: 'bg-sky-500',
  healthy: 'bg-emerald-500',
};

export function UtilisationBadge({ percent, hasLimit = true }: { percent: number; hasLimit?: boolean }) {
  if (!hasLimit) return <StatusBadge tone="neutral">No limit</StatusBadge>;
  const level = utilisationLevel(percent);
  return (
    <StatusBadge tone={LEVEL_TONE[level]} dot>
      {UTILISATION_LABEL[level]}
    </StatusBadge>
  );
}
