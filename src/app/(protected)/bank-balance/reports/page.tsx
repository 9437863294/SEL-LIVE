'use client';
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ArrowLeft, LineChart, Banknote, ShieldAlert, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

interface ReportItemConfig {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  permissionAction: string;
  permissionResource: string;
  colorScheme: {
    bg: string;
    iconBg: string;
    iconColor: string;
    border: string;
    tag: string;
  };
}

interface ReportCardProps {
  item: {
    icon: LucideIcon;
    title: string;
    description: string;
    href: string;
    disabled?: boolean;
    colorScheme: ReportItemConfig['colorScheme'];
  };
}

const reportItemsBase: ReportItemConfig[] = [
  {
    icon: LineChart,
    title: 'Cashflow Statement',
    description: 'Analyze the movement of cash inflow and outflow over a selected period.',
    href: '/bank-balance/reports/cashflow-statement',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Reports',
    colorScheme: {
      bg: 'from-emerald-500/10 to-teal-500/5',
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      border: 'border-emerald-200/60 dark:border-emerald-800/30 hover:border-emerald-400/60',
      tag: 'Cash Flow',
    },
  },
  {
    icon: Banknote,
    title: 'Bank Position Report',
    description: 'View a consolidated summary of balances across all bank accounts.',
    href: '/bank-balance/reports/bank-position',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Reports',
    colorScheme: {
      bg: 'from-blue-500/10 to-indigo-500/5',
      iconBg: 'bg-blue-100 dark:bg-blue-900/40',
      iconColor: 'text-blue-600 dark:text-blue-400',
      border: 'border-blue-200/60 dark:border-blue-800/30 hover:border-blue-400/60',
      tag: 'Position',
    },
  },
];

function ReportCard({ item }: ReportCardProps) {
  const isDisabled = item.disabled || item.href === '#';
  const { colorScheme } = item;

  const cardContent = (
    <Card
      className={cn(
        'group relative flex flex-col h-full overflow-hidden transition-all duration-300 ease-in-out rounded-xl border',
        colorScheme.border,
        !isDisabled && 'hover:shadow-2xl hover:-translate-y-1.5 cursor-pointer',
        isDisabled && 'cursor-not-allowed opacity-55 saturate-50',
      )}
    >
      {/* Gradient background */}
      <div className={cn('absolute inset-0 bg-gradient-to-br opacity-60', colorScheme.bg)} />

      <CardHeader className="relative items-center text-center gap-4 pb-3">
        <div className={cn(
          'rounded-2xl p-4 mt-2 transition-transform duration-300 shadow-sm',
          colorScheme.iconBg,
          !isDisabled && 'group-hover:scale-110',
        )}>
          <item.icon className={cn('w-9 h-9', colorScheme.iconColor)} />
        </div>
        <div>
          <CardTitle className="text-base font-bold">{item.title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="relative text-center pb-5">
        <CardDescription className="text-sm leading-relaxed">{item.description}</CardDescription>
        {!isDisabled && (
          <div className={cn(
            'mt-3 inline-flex items-center gap-1 text-xs font-medium transition-all duration-300',
            colorScheme.iconColor,
            'opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0',
          )}>
            View Report →
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (isDisabled) return <div className="h-full">{cardContent}</div>;
  return <Link href={item.href} className="no-underline h-full">{cardContent}</Link>;
}

export default function BankReportsPage() {
  const { can, isLoading } = useAuthorization();
  const canViewPage = can('View', 'Bank Balance.Reports');

  const reportItems = reportItemsBase.map((item) => ({
    ...item,
    disabled: !can(item.permissionAction, item.permissionResource),
  }));

  if (isLoading) {
    return (
      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6">
        <Skeleton className="h-10 w-48 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-xl">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Bank Reports</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view reports.</CardDescription>
          </CardHeader>
          <div className="flex justify-center p-8">
            <ShieldAlert className="h-14 w-14 text-destructive" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* ── Animated Background ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/60 via-background to-blue-50/50 dark:from-emerald-950/20 dark:via-background dark:to-blue-950/20" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-emerald-400/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-blue-400/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-15"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(16,185,129,0.12) 1px, transparent 1px)',
            backgroundSize: '30px 30px',
          }}
        />
      </div>

      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-5">
        {/* ── Header ── */}
        <div className="mb-8 flex items-center gap-3">
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-primary/10">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary/70" />
              <h1 className="text-xl font-bold tracking-tight">Bank Reports</h1>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Financial analytics and reporting</p>
          </div>
        </div>

        {/* ── Report Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-2xl">
          {reportItems.map((item, idx) => (
            <div
              key={item.title}
              className="animate-bb-card-in"
              style={{ animationDelay: `${idx * 80}ms`, animationFillMode: 'both' }}
            >
              <ReportCard item={item} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
