'use client';

import Link from 'next/link';
import { Database, Hash, ScrollText, Settings2, ShieldAlert, SlidersHorizontal, Tags, Users } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthorization } from '@/hooks/useAuthorization';
import { canOpenAccessManagement, type PermissionChecker } from '@/lib/access-control';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';

/** One tone per settings card, so the cards are told apart by colour as well as by icon. */
const SETTING_TONES = {
  sky: { tile: 'from-sky-500 to-blue-600', bar: 'from-sky-500 to-blue-500', ring: 'hover:border-sky-300' },
  teal: { tile: 'from-teal-500 to-emerald-600', bar: 'from-teal-500 to-emerald-500', ring: 'hover:border-teal-300' },
  amber: { tile: 'from-amber-500 to-orange-600', bar: 'from-amber-500 to-orange-500', ring: 'hover:border-amber-300' },
  indigo: { tile: 'from-indigo-500 to-blue-600', bar: 'from-indigo-500 to-blue-500', ring: 'hover:border-indigo-300' },
  violet: { tile: 'from-violet-500 to-purple-600', bar: 'from-violet-500 to-purple-500', ring: 'hover:border-violet-300' },
  slate: { tile: 'from-slate-500 to-slate-700', bar: 'from-slate-500 to-slate-400', ring: 'hover:border-slate-300' },
} as const;

type Tone = (typeof SETTING_TONES)[keyof typeof SETTING_TONES];

interface SettingItem {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  tone: Tone;
  /** Who the card is for, as a predicate over `can`, so a card follows its target page's own rule. */
  isEnabled: (can: PermissionChecker) => boolean;
}

/**
 * The same rule the Field Control and Data Control pages apply (see settings-control-kit): View on
 * the section or on Settings to look, and the rights that administered the old combined page still
 * count until roles grant the new sections.
 */
const canSeeControl = (section: string) => (can: PermissionChecker) =>
  can('View', `Expenses.${section}`) ||
  can('Edit', `Expenses.${section}`) ||
  can('View', 'Expenses.Settings') ||
  can('Manage Accounts', 'Expenses.Settings') ||
  can('Edit Serial Nos', 'Expenses.Settings');

const SECTIONS: { id: string; title: string; description: string; items: SettingItem[] }[] = [
  {
    id: 'masters',
    title: 'Masters',
    description: 'Numbering and the chart of accounts every request is booked against.',
    items: [
      {
        icon: Hash,
        title: 'Department-wise Serial Number',
        description: 'Configure serial numbers for expense requests in each department.',
        href: '/expenses/settings/department-serial-no',
        tone: SETTING_TONES.sky,
        isEnabled: can => can('Edit Serial Nos', 'Expenses.Settings'),
      },
      {
        icon: Tags,
        title: 'Head of A/c Sub-Head of A/c',
        description: 'Manage the chart of accounts for expenses.',
        href: '/expenses/settings/accounts',
        tone: SETTING_TONES.teal,
        isEnabled: can => can('Manage Accounts', 'Expenses.Settings'),
      },
    ],
  },
  {
    id: 'controls',
    title: 'Controls',
    description: 'What the forms ask for, what the registers show, and the rules the module enforces.',
    items: [
      {
        icon: SlidersHorizontal,
        title: 'Field Control',
        description: 'Request form fields — label, help text, required, shown — and register column order and visibility.',
        href: '/expenses/settings/field-control',
        tone: SETTING_TONES.amber,
        isEnabled: canSeeControl('Field Control'),
      },
      {
        icon: Database,
        title: 'Data Control',
        description: 'Register defaults, editing after reception, entry rules for new requests, and import behaviour.',
        href: '/expenses/settings/data-control',
        tone: SETTING_TONES.indigo,
        isEnabled: canSeeControl('Data Control'),
      },
    ],
  },
  {
    id: 'access',
    title: 'Access',
    description: 'Who can do what, and a record of what they did.',
    items: [
      {
        icon: Users,
        title: 'User Role Configuration',
        description: 'Configure module permissions and assign access through roles.',
        href: '/settings/access-management',
        tone: SETTING_TONES.violet,
        // Expenses has no role screen of its own: this opens the app's Access Management, so it is
        // enabled for exactly the people that page admits (the same rule the main Settings page uses).
        isEnabled: canOpenAccessManagement,
      },
      {
        icon: ScrollText,
        title: 'Audit Log',
        description: 'Every change made in Expenses — who, when, and what changed.',
        href: '/expenses/audit-log',
        tone: SETTING_TONES.slate,
        isEnabled: can => can('View', 'Expenses.Audit Log') || can('View', 'Settings.Audit Logs'),
      },
    ],
  },
];

function ExpenseSettingCard({ item, disabled }: { item: SettingItem; disabled: boolean }) {
  const Icon = item.icon;
  const cardContent = (
    <Card
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-xl border-white/70 bg-white/75 shadow-sm backdrop-blur-sm transition-all duration-300 ease-in-out',
        disabled ? 'cursor-not-allowed opacity-60' : cn('cursor-pointer hover:-translate-y-0.5 hover:shadow-lg', item.tone.ring),
      )}
    >
      {!disabled && <div className={cn('absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r', item.tone.bar)} />}
      <CardHeader className="flex-row items-center gap-4 space-y-0 p-4">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm', item.tone.tile)}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle className="text-sm font-bold">{item.title}</CardTitle>
          <CardDescription className="text-xs">{item.description}</CardDescription>
        </div>
      </CardHeader>
    </Card>
  );

  if (disabled) return <div className="h-full">{cardContent}</div>;
  return (
    <Link href={item.href} className="h-full no-underline">
      {cardContent}
    </Link>
  );
}

export default function ExpensesSettingsPage() {
  const { can, isLoading } = useAuthorization();
  const canViewPage = can('View', 'Expenses.Settings');

  if (isLoading) {
    return (
      <div className="w-full space-y-5">
        <Skeleton className="h-10 w-64" />
        {SECTIONS.map(section => (
          <div key={section.id} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {section.items.map(item => (
              <Skeleton key={item.title} className="h-24" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full">
        <PageHeader icon={Settings2} title="Expenses Settings" backHref="/expenses" />
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view these settings.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={Settings2}
        title="Expenses Settings"
        description="Masters, controls and access for the Expenses module"
        backHref="/expenses"
      />
      {SECTIONS.map(section => (
        <section key={section.id} aria-labelledby={`settings-${section.id}`} className="space-y-3">
          <div>
            <h2 id={`settings-${section.id}`} className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
              {section.title}
            </h2>
            <p className="text-xs text-muted-foreground">{section.description}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {section.items.map(item => (
              <ExpenseSettingCard key={item.title} item={item} disabled={!item.isEnabled(can)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
