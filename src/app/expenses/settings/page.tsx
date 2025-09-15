

'use client';

import Link from 'next/link';
import { ArrowLeft, Hash, Tags, Users, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';


interface ExpenseSettingCardProps {
  item: {
    icon: LucideIcon;
    title: string;
    description: string;
    href: string;
    disabled?: boolean;
  };
}

const settingsItemsBase = [
  { 
    icon: Hash, 
    title: 'Department-wise Serial Number', 
    description: 'Configure serial numbers for expense reports for each department.',
    href: '/expenses/settings/department-serial-no',
    permission: 'Edit Serial Nos'
  },
  { 
    icon: Tags, 
    title: 'Head of A/c Sub-Head of A/c', 
    description: 'Manage the chart of accounts for expenses.',
    href: '/expenses/settings/accounts',
    permission: 'Manage Accounts'
  },
  { 
    icon: Users, 
    title: 'User Role Configuration', 
    description: 'Assign users to specific roles within each department.',
    href: '#',
    permission: 'Edit User Rights'
  },
];


function ExpenseSettingCard({ item }: ExpenseSettingCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                (item.href === '#' || item.disabled) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="flex-row items-center gap-4 space-y-0 p-4">
                <div className="bg-primary/10 p-3 rounded-lg">
                <item.icon className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base font-bold">{item.title}</CardTitle>
                    <CardDescription className="text-xs">{item.description}</CardDescription>
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


export default function ExpensesSettingsPage() {
    const { can, isLoading } = useAuthorization();
    const canViewPage = can('View', 'Expenses.Settings');

    const settingsItems = settingsItemsBase.map(item => ({
        ...item,
        disabled: !can(item.permission, 'Expenses.Settings')
    }));

    if (isLoading) {
        return (
            <div className="w-full px-4 sm:px-6 lg:px-8">
                <Skeleton className="h-10 w-64 mb-6" />
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    <Skeleton className="h-28" />
                    <Skeleton className="h-28" />
                    <Skeleton className="h-28" />
                </div>
            </div>
        );
    }
    
    if (!canViewPage) {
        return (
             <div className="w-full px-4 sm:px-6 lg:px-8">
                <div className="mb-6 flex items-center gap-4">
                    <Link href="/expenses"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-2xl font-bold">Expenses Settings</h1>
                </div>
                 <Card>
                    <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view these settings.</CardDescription></CardHeader>
                    <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
                </Card>
            </div>
        )
    }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/expenses">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Expenses Settings</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {settingsItems.map((item) => (
          <ExpenseSettingCard key={item.title} item={item} />
        ))}
      </div>
    </div>
  );
}
