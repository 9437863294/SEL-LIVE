'use client';
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { CalendarDays, ChevronRight, FilePen, Landmark, List, Lock, Percent, Settings2, TrendingUp, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { BANK_PAGE, BankAccessDenied, BankBalanceBackground, BankPageSkeleton } from '@/components/bank-balance/page-kit';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';

interface SettingsItem {
  icon: LucideIcon;
  title: string;
  href: string;
  description: string;
  /** Icon chip colours. Literal classes so Tailwind emits them. */
  chip: string;
  allowed: boolean;
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
 * Setup — the configuration the rest of the module reads — comes first; the two recurring tasks
 * that also live here (the daily log and the monthly interest entry) follow under their own
 * heading, so the page no longer reads as seven unrelated tiles. Opening utilisation is no longer a
 * tile: Bank Accounts is the one place the opening figures are set.
 */
export default function BankBalanceSettingsPage() {
  const { can, isLoading } = useAuthorization();
  const canViewPage = can('View Module', 'Bank Balance');

  if (isLoading) return <BankPageSkeleton kpis={0} />;
  if (!canViewPage) return <BankAccessDenied title="Bank Settings" />;

  const setup: SettingsItem[] = [
    {
      icon: Landmark,
      title: 'Bank Accounts',
      href: '/bank-balance/accounts',
      description: 'Add and edit accounts, their type and status, and the opening balance or utilisation.',
      chip: 'bg-violet-50 text-violet-600 ring-violet-100',
      allowed: can('View', 'Bank Balance.Accounts'),
    },
    {
      icon: TrendingUp,
      title: 'DP Management',
      href: '/bank-balance/dp-management',
      description: 'Dated drawing power (DP) and temporary overdrawn (TOD) limits for Cash Credit accounts.',
      chip: 'bg-purple-50 text-purple-600 ring-purple-100',
      allowed: can('View', 'Bank Balance.DP Management'),
    },
    {
      icon: Percent,
      title: 'Interest Rates',
      href: '/bank-balance/interest-rate',
      description: 'Dated interest rate history for each Cash Credit account.',
      chip: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
      allowed: can('View', 'Bank Balance.Interest Rate'),
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
      icon: List,
      title: 'Daily Log',
      href: '/bank-balance/daily-log',
      description: 'Day-by-day opening, receipts, payments, transfers and closing for every account.',
      chip: 'bg-blue-50 text-blue-600 ring-blue-100',
      allowed: can('View', 'Bank Balance.Daily Log'),
    },
    {
      icon: CalendarDays,
      title: 'Monthly Interest',
      href: '/bank-balance/monthly-interest',
      description: 'Record the interest each bank actually charged, against the projected figure.',
      chip: 'bg-amber-50 text-amber-600 ring-amber-100',
      allowed: can('View', 'Bank Balance.Monthly Interest'),
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
        <section>
          <SectionHeader title="Setup" description="What the balances, limits and interest are calculated from." />
          {grid(setup)}
        </section>
        <section>
          <SectionHeader title="Daily & monthly" description="Recurring checks and entries." />
          {grid(recurring)}
        </section>
      </div>
    </>
  );
}
