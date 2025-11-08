'use client';
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import {
  ArrowLeft,
  Landmark,
  TrendingUp,
  Percent,
  CalendarDays,
  List,
  Target,
  FilePen,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
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
  };
}

interface SettingsItemConfig {
  icon: LucideIcon;
  text: string;
  href: string;
  description: string;
  permissionAction?: string;
  permissionResource?: string;
}

function SettingsCard({ item }: SettingsCardProps) {
  const isDisabled = item.disabled || item.href === '#';

  const cardContent = (
    <Card
      className={cn(
        'flex flex-col h-full transition-all duration-300 ease-in-out bg-background rounded-xl border border-border/80',
        !isDisabled && 'hover:shadow-lg hover:border-primary/50 cursor-pointer',
        isDisabled && 'cursor-not-allowed opacity-60'
      )}
    >
      <CardHeader className="flex-col items-center text-center gap-4 space-y-0 p-4">
        <div className="bg-primary/10 p-3 rounded-lg">
          <item.icon className="w-8 h-8 text-primary" />
        </div>
        <div className="flex-1">
          <CardTitle className="text-base font-bold">{item.text}</CardTitle>
          <CardDescription className="text-xs mt-1">
            {item.description}
          </CardDescription>
        </div>
      </CardHeader>
    </Card>
  );

  if (isDisabled) {
    return <div className="h-full">{cardContent}</div>;
  }

  return (
    <Link href={item.href} className="no-underline h-full">
      {cardContent}
    </Link>
  );
}

const settingsItemsBase: SettingsItemConfig[] = [
  {
    icon: Landmark,
    text: 'Bank Configuration',
    href: '/bank-balance/accounts',
    description: 'Manage bank details, accounts, and other configurations.',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Accounts',
  },
  {
    icon: TrendingUp,
    text: 'DP Management',
    href: '/bank-balance/dp-management',
    description: 'Manage Drawing Power for different banks and accounts.',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.DP Management',
  },
  {
    icon: Target,
    text: 'Opening Utilization',
    href: '/bank-balance/opening-utilization',
    description: 'Set opening utilization for Cash Credit accounts.',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Opening Utilization',
  },
  {
    icon: List,
    text: 'Daily Utilization Log',
    href: '/bank-balance/daily-log',
    description: 'View daily balance/utilization logs.',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Daily Log',
  },
  {
    icon: Percent,
    text: 'Interest Rate',
    href: '/bank-balance/interest-rate',
    description: 'Set and track interest rate history per bank account.',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Interest Rate',
  },
  {
    icon: CalendarDays,
    text: 'Monthly Interest',
    href: '/bank-balance/monthly-interest',
    description: 'Enter projected and actual interest month-wise.',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Monthly Interest',
  },
  {
    icon: FilePen,
    text: 'Payment Entry Settings',
    href: '/bank-balance/settings/payment-entry',
    description: 'Customize payment entry form fields and options.',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Payment Entry Settings',
  },
];

export default function BankBalanceSettingsPage() {
  const { can, isLoading } = useAuthorization();

  const canViewPage = can('View Module', 'Bank Balance');

  const settingsItems = settingsItemsBase.map((item) => {
    const hasItemPermission =
      item.permissionAction && item.permissionResource
        ? can(item.permissionAction, item.permissionResource)
        : true;

    return {
      ...item,
      disabled: !hasItemPermission,
    };
  });

  if (isLoading) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Bank Settings</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to view this page.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/bank-balance">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Bank Settings</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {settingsItems.map((item) => (
          <SettingsCard
            key={item.text}
            item={{
              icon: item.icon,
              text: item.text,
              href: item.href,
              description: item.description,
              disabled: item.disabled,
            }}
          />
        ))}
      </div>
    </div>
  );
}
