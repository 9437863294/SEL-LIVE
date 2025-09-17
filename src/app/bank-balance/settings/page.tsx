
'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Settings,
  Landmark,
  TrendingUp,
  Percent,
  CalendarDays,
  CreditCard,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SettingsCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

function SettingsCard({ item }: SettingsCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="flex-col items-center text-center gap-4 space-y-0 p-4">
                <div className="bg-primary/10 p-3 rounded-lg">
                <item.icon className="w-8 h-8 text-primary" />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base font-bold">{item.text}</CardTitle>
                    <CardDescription className="text-xs mt-1">{item.description}</CardDescription>
                </div>
            </CardHeader>
        </Card>
    )

    if (item.href === '#' || item.disabled) {
        return <div className="h-full">{cardContent}</div>;
    }
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    )
}

export default function BankBalanceSettingsPage() {
    
  const settingsItems = [
    { icon: Landmark, text: 'Bank Configuration', href: '/bank-balance/accounts', description: 'Manage bank details, accounts, and other configurations.' },
    { icon: TrendingUp, text: 'DP Management', href: '/bank-balance/dp-management', description: 'Manage Drawing Power for different banks and accounts.' },
    { icon: Percent, text: 'Interest Rate Management', href: '#', description: 'Set daily interest rates for each bank account.', disabled: true },
    { icon: CalendarDays, text: 'Monthly Interest', href: '#', description: 'Enter projected and actual monthly interest amounts.', disabled: true },
    { icon: CreditCard, text: 'Opening Utilization', href: '#', description: 'Enter and track opening utilization for active banks.', disabled: true },
  ];

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/bank-balance">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Bank Settings</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {settingsItems.map((item) => (
          <SettingsCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
