'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarDays, ChevronRight, FilePen, Landmark, Lock, Percent, Settings2, TrendingUp, type LucideIcon } from 'lucide-react';
import { format, subMonths } from 'date-fns';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { BANK_PAGE, BankAccessDenied, BankBalanceBackground, BankPageSkeleton } from '@/components/bank-balance/page-kit';
import { DashboardDesignPicker } from '@/components/bank-balance/dashboard-design-picker';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import { getApplicableRate } from '@/lib/bank-balance-ledger';
import type { BankAccount } from '@/lib/types';
import { cn } from '@/lib/utils';

interface SettingsItem {
  icon: LucideIcon;
  title: string;
  href: string;
  description: string;
  /** Icon chip colours. Literal classes so Tailwind emits them. */
  chip: string;
  allowed: boolean;
  /** What on this page still needs doing — turns the hub into a to-do list. */
  attention?: string;
}

/** What the child pages would each report: the hub shows it before anything is opened. */
interface SetupHealth {
  missingOpening: number;
  noLimit: number;
  noRate: number;
  /** null when the figure could not be read (no permission on monthlyInterest). */
  lastMonthEntered: boolean | null;
  lastMonthLabel: string;
}

function SettingsCard({ item }: { item: SettingsItem }) {
  const body = (
    <Card
      className={cn(
        'group h-full border-white/60 bg-white/80 shadow-sm backdrop-blur-sm transition-all duration-200',
        item.allowed ? 'hover:-translate-y-0.5 hover:shadow-md' : 'cursor-not-allowed opacity-60'
      )}
    >
      <CardContent className="flex h-full items-start gap-3 p-4">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-4', item.chip)}>
          <item.icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800">{item.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
          {!item.allowed && (
            <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <Lock className="h-3 w-3" /> No access — ask an administrator
            </p>
          )}
          {item.allowed && item.attention && (
            <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              <AlertTriangle className="h-3 w-3 shrink-0" /> {item.attention}
            </p>
          )}
        </div>
        {item.allowed && <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
      </CardContent>
    </Card>
  );

  return item.allowed ? (
    <Link href={item.href} className="block h-full no-underline">
      {body}
    </Link>
  ) : (
    <div className="h-full" aria-disabled>
      {body}
    </div>
  );
}

/**
 * The Bank Balance settings hub.
 *
 * Setup — the configuration the rest of the module reads — comes first; the one recurring task
 * that also lives here (the monthly interest entry) follows under its own
 * heading, so the page no longer reads as seven unrelated tiles. Opening utilisation is no longer a
 * tile: Bank Accounts is the one place the opening figures are set.
 */
export default function BankBalanceSettingsPage() {
  const { can, isLoading } = useAuthorization();
  const canViewPage = can('View Module', 'Bank Balance');
  const [health, setHealth] = useState<SetupHealth | null>(null);

  // What still needs setting up, read once: a failure just leaves the cards without badges.
  useEffect(() => {
    if (isLoading || !canViewPage) return;
    let cancelled = false;
    (async () => {
      try {
        const accountsSnap = await getDocs(collection(db, 'bankAccounts'));
        const accounts = accountsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankAccount));
        const active = accounts.filter((account) => account.status === 'Active');
        const cc = active.filter((account) => account.accountType === 'Cash Credit');
        const today = new Date();
        const lastMonth = subMonths(today, 1);

        // Entered counts as "some account has a non-zero actual" — the Monthly Interest page saves
        // untouched accounts as 0.
        let lastMonthEntered: boolean | null = null;
        try {
          const interestSnap = await getDoc(doc(db, 'monthlyInterest', format(lastMonth, 'yyyy-MM')));
          const data = interestSnap.exists() ? (interestSnap.data() as Record<string, { actual?: number }>) : null;
          lastMonthEntered = cc.length === 0 ? true : !!data && cc.some((account) => (Number(data[account.id]?.actual) || 0) > 0);
        } catch {
          lastMonthEntered = null;
        }

        if (cancelled) return;
        setHealth({
          missingOpening: active.filter((account) => !account.openingDate).length,
          noLimit: cc.filter((account) => getApplicableCcLimit(account, today) <= 0).length,
          noRate: cc.filter((account) => getApplicableRate(account, today) <= 0).length,
          lastMonthEntered,
          lastMonthLabel: format(lastMonth, 'MMM yyyy'),
        });
      } catch (error) {
        console.error('Could not read the setup health figures:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoading, canViewPage]);

  if (isLoading) return <BankPageSkeleton kpis={0} />;
  if (!canViewPage) return <BankAccessDenied title="Bank Settings" />;

  const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;

  const setup: SettingsItem[] = [
    {
      icon: Landmark,
      title: 'Bank Accounts',
      href: '/bank-balance/accounts',
      description: 'Add and edit accounts, their type and status, and the opening balance or utilisation.',
      chip: 'bg-violet-50 text-violet-600 ring-violet-100',
      allowed: can('View', 'Bank Balance.Accounts'),
      attention: health?.missingOpening ? `${count(health.missingOpening, 'account')} without an opening date` : undefined,
    },
    {
      icon: TrendingUp,
      title: 'DP Management',
      href: '/bank-balance/dp-management',
      description: 'Dated drawing power (DP) and temporary overdrawn (TOD) limits for Cash Credit accounts.',
      chip: 'bg-purple-50 text-purple-600 ring-purple-100',
      allowed: can('View', 'Bank Balance.DP Management'),
      attention: health?.noLimit ? `${count(health.noLimit, 'CC account')} without a limit in force` : undefined,
    },
    {
      icon: Percent,
      title: 'Interest Rates',
      href: '/bank-balance/interest-rate',
      description: 'Dated interest rate history for each Cash Credit account.',
      chip: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
      allowed: can('View', 'Bank Balance.Interest Rate'),
      attention: health?.noRate ? `${count(health.noRate, 'CC account')} without a rate in force` : undefined,
    },
    {
      icon: FilePen,
      title: 'Payment Entry Settings',
      href: '/bank-balance/settings/payment-entry',
      description: 'Mandatory fields and payment methods on the payment entry form.',
      chip: 'bg-slate-100 text-slate-600 ring-slate-100',
      allowed: can('View', 'Bank Balance.Payment Entry Settings') || can('Add', 'Bank Balance.Expenses'),
    },
  ];

  const recurring: SettingsItem[] = [
    {
      icon: CalendarDays,
      title: 'Monthly Interest',
      href: '/bank-balance/monthly-interest',
      description: 'Record the interest each bank actually charged, against the projected figure.',
      chip: 'bg-amber-50 text-amber-600 ring-amber-100',
      allowed: can('View', 'Bank Balance.Monthly Interest'),
      attention: health?.lastMonthEntered === false ? `${health.lastMonthLabel} not entered yet` : undefined,
    },
  ];

  const grid = (items: SettingsItem[]) => (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
      {items.map((item) => (
        <SettingsCard key={item.href} item={item} />
      ))}
    </div>
  );

  return (
    <>
      <BankBalanceBackground tone="slate" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="Bank Settings"
          description="Configure accounts, limits, rates and the payment form."
          icon={Settings2}
          backHref="/bank-balance"
          backLabel="Back to dashboard"
        />
        <section id="dashboard-design" className="scroll-mt-20">
          <SectionHeader
            title="Dashboard design"
            description="How the Bank Balance dashboard is laid out, for everyone. Every design shows the same figures from the ledger."
          />
          {/* The module's settings right: the same one that edits the rest of bankBalanceSettings. */}
          <DashboardDesignPicker canEdit={can('Edit', 'Bank Balance.Payment Entry Settings')} />
        </section>
        <section>
          <SectionHeader title="Setup" description="What the balances, limits and interest are calculated from." />
          {grid(setup)}
        </section>
        <section>
          <SectionHeader title="Monthly" description="Recurring entries." />
          {grid(recurring)}
        </section>
      </div>
    </>
  );
}
