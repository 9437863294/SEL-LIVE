

'use client';

import Link from 'next/link';
import { Hash, Tags, Users, ShieldAlert, Settings2, SlidersHorizontal } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthorization } from '@/hooks/useAuthorization';
import { canOpenAccessManagement, type PermissionChecker } from '@/lib/access-control';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';


interface ExpenseSettingCardProps {
  item: {
    icon: LucideIcon;
    title: string;
    description: string;
    href: string;
    disabled?: boolean;
  };
}

/** Each card says who it is for, as a predicate over `can`, so a card can follow its target page's own rule. */
const settingsItemsBase: Array<ExpenseSettingCardProps['item'] & { isEnabled: (can: PermissionChecker) => boolean }> = [
  {
    icon: Hash,
    title: 'Department-wise Serial Number',
    description: 'Configure serial numbers for expense reports for each department.',
    href: '/expenses/settings/department-serial-no',
    isEnabled: can => can('Edit Serial Nos', 'Expenses.Settings'),
  },
  {
    icon: Tags,
    title: 'Head of A/c Sub-Head of A/c',
    description: 'Manage the chart of accounts for expenses.',
    href: '/expenses/settings/accounts',
    isEnabled: can => can('Manage Accounts', 'Expenses.Settings'),
  },
  {
    icon: SlidersHorizontal,
    title: 'Table & Field Configuration',
    description: 'Register column order and visibility, request form fields, and the module data rules.',
    href: '/expenses/settings/table-and-fields',
    // Viewing settings is enough to look; the page itself only lets the settings administrators
    // change anything, so this is not gated behind a permission nobody has been granted.
    isEnabled: can => can('View', 'Expenses.Settings'),
  },
  {
    icon: Users,
    title: 'User Role Configuration',
    description: 'Configure module permissions and assign access through roles.',
    href: '/settings/access-management',
    // Expenses has no role screen of its own: this opens the app's Access Management, so it is
    // enabled for exactly the people that page admits (the same rule the main Settings page uses).
    // It used to ask for "Edit User Rights", which the Expenses permission tree does not define —
    // nobody could hold it, so the card was disabled for everyone, administrators included.
    isEnabled: canOpenAccessManagement,
  },
];


/** One tone per settings card, so the cards are told apart by colour as well as by icon. */
const SETTING_TONES = [
    { tile: 'from-sky-500 to-blue-600', bar: 'from-sky-500 to-blue-500', ring: 'hover:border-sky-300' },
    { tile: 'from-teal-500 to-emerald-600', bar: 'from-teal-500 to-emerald-500', ring: 'hover:border-teal-300' },
    { tile: 'from-amber-500 to-orange-600', bar: 'from-amber-500 to-orange-500', ring: 'hover:border-amber-300' },
    { tile: 'from-violet-500 to-purple-600', bar: 'from-violet-500 to-purple-500', ring: 'hover:border-violet-300' },
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

    const settingsItems = settingsItemsBase.map(({ isEnabled, ...item }) => ({
        ...item,
        disabled: !isEnabled(can),
    }));

    if (isLoading) {
        return (
            <div className="w-full">
                <Skeleton className="h-10 w-64 mb-6" />
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {settingsItemsBase.map(item => <Skeleton key={item.title} className="h-28" />)}
                </div>
            </div>
        );
    }
    
    if (!canViewPage) {
        return (
             <div className="w-full">
                <PageHeader icon={Settings2} title="Expenses Settings" backHref="/expenses" />
                 <Card>
                    <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view these settings.</CardDescription></CardHeader>
                    <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
                </Card>
            </div>
        )
    }

  return (
    <div className="w-full space-y-5">
      <PageHeader
        icon={Settings2}
        title="Expenses Settings"
        description="Numbering series, chart of accounts and access"
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
