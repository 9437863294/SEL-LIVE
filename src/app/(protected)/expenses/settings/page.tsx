

'use client';

import Link from 'next/link';
import { ArrowLeft, Hash, Tags, Users, ShieldAlert, Settings2, SlidersHorizontal } from 'lucide-react';
import { ExpensesPageHeader } from '@/components/expenses/page-header';
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
    icon: SlidersHorizontal,
    title: 'Table & Field Configuration',
    description: 'Register column order and visibility, request form fields, and the module data rules.',
    href: '/expenses/settings/table-and-fields',
    // Viewing settings is enough to look; the page itself only lets the settings administrators
    // change anything, so this is not gated behind a permission nobody has been granted.
    permission: 'View'
  },
  {
    icon: Users,
    title: 'User Role Configuration',
    description: 'Configure module permissions and assign access through roles.',
    href: '/settings/role-management',
    permission: 'Edit User Rights'
  },
];


/** One tone per settings card, so the three are told apart by colour as well as by icon. */
const SETTING_TONES = [
    { tile: 'from-sky-500 to-blue-600', bar: 'from-sky-500 to-blue-500', ring: 'hover:border-sky-300' },
    { tile: 'from-teal-500 to-emerald-600', bar: 'from-teal-500 to-emerald-500', ring: 'hover:border-teal-300' },
    { tile: 'from-amber-500 to-orange-600', bar: 'from-amber-500 to-orange-500', ring: 'hover:border-amber-300' },
] as const;

function ExpenseSettingCard({ item, tone }: ExpenseSettingCardProps & { tone: (typeof SETTING_TONES)[number] }) {
    const isDisabled = item.href === '#' || item.disabled;
    const cardContent = (
         <Card
            className={cn(
                "relative flex flex-col h-full overflow-hidden rounded-xl border-white/70 bg-white/75 shadow-sm backdrop-blur-sm transition-all duration-300 ease-in-out",
                isDisabled ? 'cursor-not-allowed opacity-60' : cn('cursor-pointer hover:-translate-y-0.5 hover:shadow-lg', tone.ring)
            )}
            >
            {!isDisabled && <div className={cn('absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r', tone.bar)} />}
            <CardHeader className="flex-row items-center gap-4 space-y-0 p-4">
                <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm', tone.tile)}>
                <item.icon className="w-5 h-5 text-white" />
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
            <div className="w-full">
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
             <div className="w-full">
                <div className="mb-6 flex items-center gap-4">
                    <Link href="/expenses"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-xl font-bold">Expenses Settings</h1>
                </div>
                 <Card>
                    <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view these settings.</CardDescription></CardHeader>
                    <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
                </Card>
            </div>
        )
    }

  return (
    <div className="w-full space-y-5">
      <ExpensesPageHeader
        icon={Settings2}
        title="Expenses Settings"
        description="Numbering series, chart of accounts and access"
        accent="teal"
        backHref="/expenses"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
        {settingsItems.map((item, index) => (
          <ExpenseSettingCard key={item.title} item={item} tone={SETTING_TONES[index % SETTING_TONES.length]} />
        ))}
      </div>
    </div>
  );
}
