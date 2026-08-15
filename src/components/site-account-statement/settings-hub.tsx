'use client';

import Link from 'next/link';
import {
  ChevronRight,
  ClipboardList,
  Loader2,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Tags,
  UserCog,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const MODULE = 'Site Account Statement';

const SETTINGS_ITEMS = [
  {
    icon: UserCog,
    text: 'Project Setup',
    href: '/site-account-statement/settings/projects',
    description: 'Assign responsible users, alternates and viewers per project.',
    gradient: 'from-emerald-500 to-teal-600',
    bg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    resource: 'Project Settings',
  },
  {
    icon: Tags,
    text: 'Expense Categories',
    href: '/site-account-statement/expense-categories',
    description: 'Manage main and sub-categories used across expense entries.',
    gradient: 'from-amber-500 to-orange-500',
    bg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    resource: 'Expense Categories',
  },
  {
    icon: ShieldAlert,
    text: 'Budget Alerts',
    href: '/site-account-statement/budget-alerts',
    description: 'Configure threshold-based email alerts, module-wide or per project.',
    gradient: 'from-red-500 to-rose-600',
    bg: 'bg-red-50',
    iconColor: 'text-red-600',
    resource: 'Budget Alerts',
  },
  {
    icon: ClipboardList,
    text: 'Tender Setup',
    href: '/site-account-statement/tender-budget',
    description: 'Set the tender amount and coverage period per project.',
    gradient: 'from-teal-500 to-cyan-600',
    bg: 'bg-teal-50',
    iconColor: 'text-teal-600',
    resource: 'Tender Budget',
  },
  {
    icon: SlidersHorizontal,
    text: 'Field Control',
    href: '/site-account-statement/settings/field-control',
    description: 'Show, hide, require or relabel any field on every form in the module.',
    gradient: 'from-slate-500 to-slate-700',
    bg: 'bg-slate-50',
    iconColor: 'text-slate-600',
    resource: 'Field Control',
  },
] as const;

export default function SiteAccountStatementSettingsHub() {
  const { can, isLoading } = useAuthorization();

  function canAccess(resource: string) {
    return can('View', `${MODULE}.${resource}`) || can('Add', `${MODULE}.${resource}`) || can('Edit', `${MODULE}.${resource}`);
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    );
  }

  const visibleItems = SETTINGS_ITEMS.filter((item) => canAccess(item.resource));

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-none bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg">
        <CardContent className="flex items-center gap-3 p-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
            <Settings className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Site Account Statement Settings</h1>
            <p className="mt-1 text-sm text-white/85">Project setup, categories, budget alerts, tender setup and field control — each in its own place.</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleItems.map((item) => (
          <Link key={item.text} href={item.href} className="no-underline">
            <div className="group relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-background transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
              <div className={cn('h-1 w-full bg-gradient-to-r', item.gradient)} />
              <div className="flex items-center gap-3 p-4">
                <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', item.bg)}>
                  <item.icon className={cn('h-5 w-5', item.iconColor)} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-tight">{item.text}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
              </div>
            </div>
          </Link>
        ))}
        {!visibleItems.length && (
          <div className="col-span-full rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
            You don’t have access to any settings sections yet. Ask your administrator to grant access.
          </div>
        )}
      </div>
    </div>
  );
}
