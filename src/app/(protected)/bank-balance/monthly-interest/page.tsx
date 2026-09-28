'use client';
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Coins, FileBarChart, History, Landmark, Loader2, ReceiptText, Save } from 'lucide-react';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { endOfMonth, format, parse, startOfDay, startOfMonth, subMonths } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import {
  BANK_PAGE,
  BankAccessDenied,
  BankBalanceBackground,
  BankPageSkeleton,
  useBankData,
} from '@/components/bank-balance/page-kit';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import {
  buildLedgers,
  compactInr,
  dailyInterest,
  dailyRows,
  formatInr,
  getApplicableRate,
  isCashCredit,
  parseDay,
} from '@/lib/bank-balance-ledger';
import type { MonthlyInterestData } from '@/lib/types';

/**
 * Storage (unchanged from the original page, so existing months keep working): one document per
 * month in `monthlyInterest`, id `yyyy-MM`, with a field per Cash Credit account id holding
 * `{ projected, actual }`. Saving writes every Cash Credit account with `setDoc(..., { merge: true })`,
 * so fields for accounts not on the page are left alone.
 */

type SavedMonth = { id: string; month: Date; projected: number; actual: number; diff: number | null; accounts: number };

const monthKeyOf = (day: Date) => format(day, 'yyyy-MM');
const monthFromKey = (key: string) => parse(key, 'yyyy-MM', new Date());
const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

/** Over the projection costs more than planned (rose); under it is a saving (emerald). */
const diffClass = (diff: number | null) =>
  diff === null || Math.abs(diff) < 0.005 ? 'text-muted-foreground' : diff > 0 ? 'text-rose-600' : 'text-emerald-600';

const signedInr = (value: number | null) =>
  value === null ? '—' : `${value > 0.005 ? '+' : value < -0.005 ? '−' : ''}${formatInr(Math.abs(value))}`;

/** An actual counts once it is a real, non-zero figure: blank entries have always been saved as 0. */
const parseActual = (value: string): number | null => {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

export default function MonthlyInterestPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const canView = can('View', 'Bank Balance.Monthly Interest');
  const canEdit = can('Edit', 'Bank Balance.Monthly Interest');
  const canViewReports = can('View', 'Bank Balance.Reports');

  const { accounts, transactions, isLoading, loadedAt } = useBankData({
    enabled: !authLoading && canView,
    transactions: true,
  });

  const [interestDocs, setInterestDocs] = useState<Record<string, MonthlyInterestData>>({});
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => monthKeyOf(new Date()));
  // Typed-in actuals for one month; anything not typed shows the stored figure.
  const [draft, setDraft] = useState<{ month: string; values: Record<string, string> } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const loadInterestDocs = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'monthlyInterest'));
      const next: Record<string, MonthlyInterestData> = {};
      snap.forEach((d) => {
        next[d.id] = d.data() as MonthlyInterestData;
      });
      setInterestDocs(next);
    } catch (error) {
      console.error('Error loading monthly interest:', error);
      toast({ title: 'Error', description: 'Failed to load monthly interest data.', variant: 'destructive' });
    } finally {
      setDocsLoaded(true);
    }
  }, [toast]);

  useEffect(() => {
    if (!authLoading && canView) void loadInterestDocs();
  }, [authLoading, canView, loadInterestDocs]);

  const today = useMemo(() => startOfDay(loadedAt ?? new Date()), [loadedAt]);

  const ccAccounts = useMemo(() => accounts.filter(isCashCredit), [accounts]);
  const ledgers = useMemo(() => buildLedgers(ccAccounts, transactions), [ccAccounts, transactions]);

  // Every month from the earliest Cash Credit opening date (24 months back when none has one) to
  // this month, plus any older month that already has saved figures. Newest first.
  const monthOptions = useMemo(() => {
    const openings = ccAccounts.map((acc) => parseDay(acc.openingDate)).filter((d): d is Date => !!d);
    const earliest = openings.length
      ? startOfMonth(new Date(Math.min(...openings.map((d) => d.getTime()))))
      : startOfMonth(subMonths(today, 23));
    const keys = new Set<string>();
    for (let m = startOfMonth(today); m >= earliest; m = subMonths(m, 1)) keys.add(monthKeyOf(m));
    for (const key of Object.keys(interestDocs)) if (/^\d{4}-\d{2}$/.test(key) && key <= monthKeyOf(today)) keys.add(key);
    return [...keys].sort((a, b) => b.localeCompare(a));
  }, [ccAccounts, interestDocs, today]);

  // Live projection for the selected month (to date for the current month), the same rule as the
  // Interest Report: each open day's closing utilisation × the rate in force that day ÷ 365.
  const projected = useMemo(() => {
    const out: Record<string, number> = {};
    const monthStart = monthFromKey(selectedMonth);
    const monthEnd = endOfMonth(monthStart);
    const last = monthEnd > today ? today : startOfDay(monthEnd);
    for (const acc of ccAccounts) {
      const ledger = ledgers.get(acc.id);
      let sum = 0;
      if (ledger && monthStart <= last) {
        for (const row of dailyRows(ledger, monthStart, last)) {
          if (row.open) sum += dailyInterest(row.closing, getApplicableRate(acc, row.day));
        }
      }
      out[acc.id] = sum;
    }
    return out;
  }, [ccAccounts, ledgers, selectedMonth, today]);

  const stored = interestDocs[selectedMonth];
  const actualText = (accountId: string) => {
    if (draft?.month === selectedMonth && accountId in draft.values) return draft.values[accountId];
    const value = Number(stored?.[accountId]?.actual);
    return Number.isFinite(value) && value !== 0 ? String(value) : '';
  };
  const isDirty =
    draft?.month === selectedMonth &&
    Object.entries(draft.values).some(([id, value]) => (parseActual(value) ?? 0) !== (Number(stored?.[id]?.actual) || 0));

  const entryTotals = ccAccounts.reduce(
    (acc, account) => {
      const actual = parseActual(actualText(account.id));
      acc.projected += projected[account.id] || 0;
      if (actual !== null) {
        acc.actual += actual;
        acc.diff += actual - (projected[account.id] || 0);
        acc.withActual += 1;
      }
      return acc;
    },
    { projected: 0, actual: 0, diff: 0, withActual: 0 },
  );

  const savedMonths = useMemo<SavedMonth[]>(() => {
    const existing = new Set(ccAccounts.map((acc) => acc.id));
    return Object.entries(interestDocs)
      .filter(([key]) => /^\d{4}-\d{2}$/.test(key))
      .map(([key, data]) => {
        let projectedSum = 0;
        let actualSum = 0;
        let diff: number | null = null;
        let count = 0;
        for (const [accountId, values] of Object.entries(data || {})) {
          if (!existing.has(accountId)) continue;
          count += 1;
          const p = Number(values?.projected) || 0;
          const a = Number(values?.actual) || 0;
          projectedSum += p;
          actualSum += a;
          if (a !== 0) diff = (diff ?? 0) + (a - p);
        }
        return { id: key, month: monthFromKey(key), projected: projectedSum, actual: actualSum, diff, accounts: count };
      })
      .filter((row) => row.accounts > 0)
      .sort((a, b) => b.id.localeCompare(a.id));
  }, [ccAccounts, interestDocs]);

  const setActual = (accountId: string, value: string) =>
    setDraft((prev) => ({
      month: selectedMonth,
      values: { ...(prev?.month === selectedMonth ? prev.values : {}), [accountId]: value },
    }));

  const handleSave = async () => {
    if (!canEdit) {
      toast({ title: 'Not allowed', description: 'You do not have permission to edit monthly interest.', variant: 'destructive' });
      return;
    }
    const invalid = ccAccounts.find((acc) => {
      const text = actualText(acc.id).trim();
      return text !== '' && (!Number.isFinite(Number(text)) || Number(text) < 0);
    });
    if (invalid) {
      toast({ title: 'Check the figures', description: 'Actual interest must be zero or a positive amount.', variant: 'destructive' });
      return;
    }

    // Every Cash Credit account, edited or not, so the month's projection is stored alongside.
    const data: MonthlyInterestData = {};
    for (const acc of ccAccounts) {
      data[acc.id] = { projected: round2(projected[acc.id] || 0), actual: parseActual(actualText(acc.id)) ?? 0 };
    }

    setIsSaving(true);
    try {
      await setDoc(doc(db, 'monthlyInterest', selectedMonth), data, { merge: true });
      setInterestDocs((prev) => ({ ...prev, [selectedMonth]: { ...(prev[selectedMonth] || {}), ...data } }));
      setDraft(null);
      toast({ title: 'Saved', description: `Interest for ${format(monthFromKey(selectedMonth), 'MMMM yyyy')} saved.` });
    } catch (error) {
      console.error('Error saving monthly interest:', error);
      toast({ title: 'Error', description: 'Could not save monthly interest data.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const selectMonth = (key: string) => {
    setSelectedMonth(key);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const savedColumns: Array<ListColumn<SavedMonth>> = [
    {
      header: 'Month',
      mobile: 'title',
      cell: (row) => (
        <span className="whitespace-nowrap font-medium">
          {format(row.month, 'MMMM yyyy')}
          {row.id === selectedMonth && (
            <Badge variant="progress" className="ml-2">
              Selected
            </Badge>
          )}
        </span>
      ),
    },
    {
      header: 'Projected',
      align: 'right',
      cell: (row) => <span className="whitespace-nowrap tabular-nums">{formatInr(row.projected)}</span>,
    },
    {
      header: 'Actual',
      align: 'right',
      cell: (row) => <span className="whitespace-nowrap font-semibold tabular-nums">{formatInr(row.actual)}</span>,
    },
    {
      header: 'Diff',
      align: 'right',
      mobile: 'aside',
      cell: (row) => <span className={cn('whitespace-nowrap tabular-nums', diffClass(row.diff))}>{signedInr(row.diff)}</span>,
    },
    {
      header: '',
      align: 'right',
      mobile: 'footer',
      cell: (row) => (
        <Button variant="outline" size="sm" className="h-8" onClick={() => selectMonth(row.id)}>
          {canEdit ? 'Edit' : 'View'}
        </Button>
      ),
    },
  ];

  if (authLoading || ((isLoading || !docsLoaded) && canView)) return <BankPageSkeleton kpis={3} blocks={2} />;

  if (!canView) {
    return <BankAccessDenied title="Monthly Interest" backHref="/bank-balance/settings" backLabel="Back to settings" />;
  }

  const selectedLabel = format(monthFromKey(selectedMonth), 'MMMM yyyy');
  const isCurrentMonth = selectedMonth === monthKeyOf(today);

  return (
    <>
      <BankBalanceBackground tone="amber" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="Monthly Interest"
          description="Record the interest the bank actually charged each month"
          icon={ReceiptText}
          backHref="/bank-balance/settings"
          backLabel="Back to settings"
          actions={
            canViewReports ? (
              <Button asChild variant="outline">
                <Link href="/bank-balance/reports/interest-accrual">
                  <FileBarChart className="mr-2 h-4 w-4" />
                  Interest report
                </Link>
              </Button>
            ) : undefined
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard
            label={`Projected · ${selectedLabel}`}
            value={formatInr(entryTotals.projected)}
            hint={isCurrentMonth ? 'Live, month to date' : 'Live from the ledger and rates'}
            icon={Coins}
            tone="amber"
            accent
          />
          <KpiCard
            label={`Actual · ${selectedLabel}`}
            value={entryTotals.withActual ? formatInr(entryTotals.actual) : '—'}
            hint={
              entryTotals.withActual
                ? `${entryTotals.withActual} of ${ccAccounts.length} account${ccAccounts.length === 1 ? '' : 's'} entered`
                : 'Not entered yet'
            }
            icon={ReceiptText}
            tone="orange"
            accent
          />
          <KpiCard
            label="Difference"
            value={entryTotals.withActual ? signedInr(entryTotals.diff) : '—'}
            hint={
              entryTotals.withActual
                ? `${entryTotals.diff > 0 ? 'Over' : 'Under'} projection by ${compactInr(Math.abs(entryTotals.diff))} (entered accounts)`
                : 'Actual minus projected'
            }
            icon={History}
            tone={entryTotals.withActual && entryTotals.diff > 0.005 ? 'rose' : 'emerald'}
            accent
          />
        </div>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 ring-4 ring-amber-100">
                  <CalendarDays className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <CardTitle className="break-words">Interest for {selectedLabel}</CardTitle>
                  <CardDescription className="mt-1">
                    Enter the interest each bank debited. Saving also stores the projected figure shown here
                    {isCurrentMonth ? ' (month to date)' : ''}.
                  </CardDescription>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="sm:w-48" aria-label="Month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((key) => (
                      <SelectItem key={key} value={key}>
                        {format(monthFromKey(key), 'MMMM yyyy')}
                        {interestDocs[key] ? ' · saved' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {canEdit && (
                  <Button className="shrink-0" onClick={() => void handleSave()} disabled={isSaving || ccAccounts.length === 0}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Month
                  </Button>
                )}
              </div>
            </div>
            {isDirty && (
              <p className="text-xs text-amber-700">You have unsaved changes for {selectedLabel}.</p>
            )}
          </CardHeader>

          <CardContent>
            {ccAccounts.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">No Cash Credit accounts configured.</p>
            ) : (
              <div className="rounded-lg border">
                <div className="hidden gap-4 border-b bg-muted/40 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-5">
                  <span className="sm:col-span-2">Account</span>
                  <span className="text-right">Projected</span>
                  <span className="text-right">Actual</span>
                  <span className="text-right">Diff</span>
                </div>
                <div className="divide-y">
                  {ccAccounts.map((acc) => {
                    const live = projected[acc.id] || 0;
                    const text = actualText(acc.id);
                    const actual = parseActual(text);
                    const diff = actual === null ? null : actual - live;
                    const storedProjected = stored?.[acc.id]?.projected;
                    const storedDiffers = typeof storedProjected === 'number' && Math.abs(storedProjected - live) >= 0.01;
                    return (
                      <div key={acc.id} className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-5 sm:items-center sm:gap-4">
                        <div className="flex min-w-0 items-start gap-3 sm:col-span-2">
                          <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          <div className="min-w-0">
                            <p className="break-words font-medium">{acc.bankName}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              {acc.shortName && <Badge variant="progress">{acc.shortName.trim()}</Badge>}
                              {acc.status === 'Inactive' && <Badge variant="neutral">Inactive</Badge>}
                              <span className="break-all">{acc.accountNumber}</span>
                            </p>
                          </div>
                        </div>
                        <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right">
                          <span className="text-xs text-muted-foreground sm:hidden">Projected</span>
                          <span className="text-right">
                            <span className="block font-medium tabular-nums">{formatInr(live)}</span>
                            {storedDiffers && (
                              <span className="block text-xs text-muted-foreground">saved {formatInr(storedProjected)}</span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 sm:block">
                          <Label htmlFor={`actual-${acc.id}`} className="text-xs font-normal text-muted-foreground sm:sr-only">
                            Actual
                          </Label>
                          <Input
                            id={`actual-${acc.id}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="0.01"
                            placeholder="0.00"
                            className="max-w-[12rem] text-right tabular-nums sm:max-w-none"
                            value={text}
                            onChange={(e) => setActual(acc.id, e.target.value)}
                            disabled={!canEdit || isSaving}
                          />
                        </div>
                        <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right">
                          <span className="text-xs text-muted-foreground sm:hidden">Diff</span>
                          <span className={cn('font-medium tabular-nums', diffClass(diff))}>{signedInr(diff)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-1 gap-2 border-t bg-muted/40 px-4 py-3 text-sm font-semibold sm:grid-cols-5 sm:gap-4">
                  <span className="sm:col-span-2">Total</span>
                  <span className="flex justify-between gap-3 tabular-nums sm:block sm:text-right">
                    <span className="font-normal text-muted-foreground sm:hidden">Projected</span>
                    {formatInr(entryTotals.projected)}
                  </span>
                  <span className="flex justify-between gap-3 tabular-nums sm:block sm:text-right">
                    <span className="font-normal text-muted-foreground sm:hidden">Actual</span>
                    {entryTotals.withActual ? formatInr(entryTotals.actual) : '—'}
                  </span>
                  <span
                    className={cn(
                      'flex justify-between gap-3 tabular-nums sm:block sm:text-right',
                      diffClass(entryTotals.withActual ? entryTotals.diff : null),
                    )}
                  >
                    <span className="font-normal text-muted-foreground sm:hidden">Diff</span>
                    {entryTotals.withActual ? signedInr(entryTotals.diff) : '—'}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div>
          <SectionHeader
            title="Saved months"
            description="Figures as stored when each month was saved. Diff counts only accounts with an actual entered."
            as="h2"
            className="mb-2"
            badge={savedMonths.length ? <Badge variant="neutral">{savedMonths.length}</Badge> : undefined}
          />
          <DataList
            rows={savedMonths}
            columns={savedColumns}
            dense
            maxHeightClassName="sm:max-h-[30rem]"
            empty={
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No months saved yet.
              </div>
            }
          />
        </div>
      </div>
    </>
  );
}
