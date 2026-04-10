'use client';
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import {
  ArrowLeft, Landmark, TrendingUp, Percent, CalendarDays, List, Target, FilePen, ShieldAlert, Settings2,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

interface SettingsCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
    colorScheme: {
      bg: string;
      iconBg: string;
      iconColor: string;
      border: string;
      accent: string;
    };
  };
}

interface SettingsItemConfig {
  icon: LucideIcon;
  text: string;
  href: string;
  description: string;
  permissionAction?: string;
  permissionResource?: string;
  colorScheme: {
    bg: string;
    iconBg: string;
    iconColor: string;
    border: string;
    accent: string;
  };
}

const colorSchemes = [
  {
    bg: 'from-violet-500/8 to-purple-500/5',
    iconBg: 'bg-violet-100 dark:bg-violet-900/40',
    iconColor: 'text-violet-600 dark:text-violet-400',
    border: 'border-violet-200/60 dark:border-violet-800/30 hover:border-violet-400/60 dark:hover:border-violet-600/40',
    accent: 'group-hover:shadow-violet-100 dark:group-hover:shadow-violet-900/20',
  },
  {
    bg: 'from-sky-500/8 to-blue-500/5',
    iconBg: 'bg-sky-100 dark:bg-sky-900/40',
    iconColor: 'text-sky-600 dark:text-sky-400',
    border: 'border-sky-200/60 dark:border-sky-800/30 hover:border-sky-400/60 dark:hover:border-sky-600/40',
    accent: 'group-hover:shadow-sky-100 dark:group-hover:shadow-sky-900/20',
  },
  {
    bg: 'from-amber-500/8 to-orange-500/5',
    iconBg: 'bg-amber-100 dark:bg-amber-900/40',
    iconColor: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-200/60 dark:border-amber-800/30 hover:border-amber-400/60 dark:hover:border-amber-600/40',
    accent: 'group-hover:shadow-amber-100 dark:group-hover:shadow-amber-900/20',
  },
  {
    bg: 'from-blue-500/8 to-indigo-500/5',
    iconBg: 'bg-blue-100 dark:bg-blue-900/40',
    iconColor: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-200/60 dark:border-blue-800/30 hover:border-blue-400/60 dark:hover:border-blue-600/40',
    accent: 'group-hover:shadow-blue-100 dark:group-hover:shadow-blue-900/20',
  },
  {
    bg: 'from-indigo-500/8 to-violet-500/5',
    iconBg: 'bg-indigo-100 dark:bg-indigo-900/40',
    iconColor: 'text-indigo-600 dark:text-indigo-400',
    border: 'border-indigo-200/60 dark:border-indigo-800/30 hover:border-indigo-400/60 dark:hover:border-indigo-600/40',
    accent: 'group-hover:shadow-indigo-100 dark:group-hover:shadow-indigo-900/20',
  },
  {
    bg: 'from-teal-500/8 to-cyan-500/5',
    iconBg: 'bg-teal-100 dark:bg-teal-900/40',
    iconColor: 'text-teal-600 dark:text-teal-400',
    border: 'border-teal-200/60 dark:border-teal-800/30 hover:border-teal-400/60 dark:hover:border-teal-600/40',
    accent: 'group-hover:shadow-teal-100 dark:group-hover:shadow-teal-900/20',
  },
  {
    bg: 'from-rose-500/8 to-pink-500/5',
    iconBg: 'bg-rose-100 dark:bg-rose-900/40',
    iconColor: 'text-rose-600 dark:text-rose-400',
    border: 'border-rose-200/60 dark:border-rose-800/30 hover:border-rose-400/60 dark:hover:border-rose-600/40',
    accent: 'group-hover:shadow-rose-100 dark:group-hover:shadow-rose-900/20',
  },
];

function SettingsCard({ item }: SettingsCardProps) {
  const isDisabled = item.disabled || item.href === '#';
  const { colorScheme } = item;

  const cardContent = (
    <Card
      className={cn(
        'group relative flex flex-col h-full overflow-hidden transition-all duration-300 ease-in-out bg-gradient-to-br from-background to-background rounded-xl border',
        colorScheme.border,
        !isDisabled && `hover:shadow-xl ${colorScheme.accent} hover:-translate-y-1 cursor-pointer`,
        isDisabled && 'cursor-not-allowed opacity-55 saturate-50',
      )}
    >
      {/* Top accent line */}
      <div className={cn(
        'absolute top-0 left-0 right-0 h-0.5 transition-all duration-300',
        !isDisabled && 'group-hover:h-1',
        colorScheme.iconBg,
      )} style={{ background: `linear-gradient(to right, transparent, currentColor, transparent)` }} />
      {/* BG gradient */}
      <div className={cn('absolute inset-0 bg-gradient-to-br opacity-50', colorScheme.bg)} />

      <CardHeader className="relative flex-col items-center text-center gap-3 space-y-0 p-5">
        <div className={cn(
          'rounded-xl p-3 transition-transform duration-300',
          colorScheme.iconBg,
          !isDisabled && 'group-hover:scale-110',
        )}>
          <item.icon className={cn('w-7 h-7', colorScheme.iconColor)} />
        </div>
        <div className="flex-1">
          <CardTitle className="text-sm font-bold">{item.text}</CardTitle>
          <CardDescription className="text-xs mt-1.5 leading-relaxed">
            {item.description}
          </CardDescription>
        </div>
      </CardHeader>
    </Card>
  );

  if (isDisabled) return <div className="h-full">{cardContent}</div>;
  return <Link href={item.href} className="no-underline h-full">{cardContent}</Link>;
}

const settingsItemsBase: SettingsItemConfig[] = [
  {
    icon: Landmark,
    text: 'Bank Configuration',
    href: '/bank-balance/accounts',
    description: 'Manage bank details, accounts, and other configurations.',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Accounts',
    colorScheme: colorSchemes[0],
  },
  {
    icon: TrendingUp,
    text: 'DP Management',
    href: '/bank-balance/dp-management',
    description: 'Manage Drawing Power for different banks and accounts.',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.DP Management',
    colorScheme: colorSchemes[1],
  },
  {
    icon: Target,
    text: 'Opening Utilization',
    href: '/bank-balance/opening-utilization',
    description: 'Set opening utilization for Cash Credit accounts.',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Opening Utilization',
    colorScheme: colorSchemes[2],
  },
  {
    icon: List,
    text: 'Daily Utilization Log',
    href: '/bank-balance/daily-log',
    description: 'View daily balance/utilization logs.',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Daily Log',
    colorScheme: colorSchemes[3],
  },
  {
    icon: Percent,
    text: 'Interest Rate',
    href: '/bank-balance/interest-rate',
    description: 'Set and track interest rate history per bank account.',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Interest Rate',
    colorScheme: colorSchemes[4],
  },
  {
    icon: CalendarDays,
    text: 'Monthly Interest',
    href: '/bank-balance/monthly-interest',
    description: 'Enter projected and actual interest month-wise.',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Monthly Interest',
    colorScheme: colorSchemes[5],
  },
  {
    icon: FilePen,
    text: 'Payment Entry Settings',
    href: '/bank-balance/settings/payment-entry',
    description: 'Customize payment entry form fields and options.',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Payment Entry Settings',
    colorScheme: colorSchemes[6],
  },
];

export default function BankBalanceSettingsPage() {
  const { can, isLoading } = useAuthorization();
  const canViewPage = can('View Module', 'Bank Balance');

  const settingsItems = settingsItemsBase.map((item) => {
    const hasItemPermission = (() => {
      if (!item.permissionAction || !item.permissionResource) return true;
      if (item.permissionResource === 'Bank Balance.Payment Entry Settings') {
        return (
          can(item.permissionAction, item.permissionResource) ||
          can('Add', 'Bank Balance.Expenses')
        );
      }
      return can(item.permissionAction, item.permissionResource);
    })();
    return { ...item, disabled: !hasItemPermission };
  });

  if (isLoading) {
    return (
      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6">
        <Skeleton className="h-10 w-48 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Bank Settings</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this page.</CardDescription>
          </CardHeader>
          <div className="flex justify-center p-8 flex-col items-center gap-3">
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
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50/80 via-background to-violet-50/50 dark:from-slate-950/40 dark:via-background dark:to-violet-950/20" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-violet-400/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-sky-400/12 blur-3xl" />
        <div className="animate-bb-orb-3 absolute top-[45%] left-[35%] w-[25vw] h-[25vw] rounded-full bg-indigo-300/10 blur-2xl" />
        <div className="absolute inset-0 opacity-25 dark:opacity-15"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(139,92,246,0.12) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
      </div>

      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-5">
        {/* ── Header ── */}
        <div className="mb-6 flex items-center gap-3">
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-primary/10">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary/70" />
              <h1 className="text-xl font-bold tracking-tight">Bank Settings</h1>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Configure accounts, rates, and system preferences</p>
          </div>
        </div>

        {/* ── Settings Grid ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {settingsItems.map((item, idx) => (
            <div
              key={item.text}
              className="animate-bb-card-in h-full"
              style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }}
            >
              <SettingsCard
                item={{
                  icon: item.icon,
                  text: item.text,
                  href: item.href,
                  description: item.description,
                  disabled: item.disabled,
                  colorScheme: item.colorScheme,
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
