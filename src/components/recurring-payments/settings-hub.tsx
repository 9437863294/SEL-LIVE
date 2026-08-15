'use client';

import Link from 'next/link';
import {
  BellRing,
  Bot,
  Building2,
  ChevronRight,
  GitBranch,
  KeyRound,
  Loader2,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const SETTINGS_ITEMS = [
  {
    icon: ShieldCheck,
    text: 'Approval Rules',
    href: '/recurring-payments/settings/approval-rules',
    description: 'Decide who approves a payment by amount, category and project.',
    gradient: 'from-indigo-500 to-violet-600',
    bg: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
    scope: 'View',
  },
  {
    icon: BellRing,
    text: 'Notifications',
    href: '/recurring-payments/settings/notification-rules',
    description: 'Reminder channels and the due-date / overdue alert schedule.',
    gradient: 'from-violet-500 to-purple-600',
    bg: 'bg-violet-50',
    iconColor: 'text-violet-600',
    scope: 'View',
  },
  {
    icon: Bot,
    text: 'Automation',
    href: '/recurring-payments/settings/automation',
    description: 'Auto-generation settings, and a manual "run now" with a run log.',
    gradient: 'from-blue-500 to-cyan-600',
    bg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    scope: 'View',
  },
  {
    icon: Building2,
    text: 'Organization Controls',
    href: '/recurring-payments/settings/organization',
    description: 'Data isolation and payment-control policy for this organization.',
    gradient: 'from-emerald-500 to-teal-600',
    bg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    scope: 'View',
  },
  {
    icon: GitBranch,
    text: 'Workflow',
    href: '/recurring-payments/settings/workflow',
    description: 'Configure the steps, TAT, assignment type and actions.',
    gradient: 'from-amber-500 to-orange-600',
    bg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    scope: 'View Workflow',
  },
  {
    icon: KeyRound,
    text: 'Permissions',
    href: '/recurring-payments/settings/permissions',
    description: 'See the permission model and jump to Role Management.',
    gradient: 'from-slate-500 to-slate-700',
    bg: 'bg-slate-50',
    iconColor: 'text-slate-600',
    scope: 'Manage Permissions',
  },
  {
    icon: SlidersHorizontal,
    text: 'Field Control',
    href: '/recurring-payments/settings/field-control',
    description: 'Show, hide, require or relabel any field on every form in the module.',
    gradient: 'from-rose-500 to-pink-600',
    bg: 'bg-rose-50',
    iconColor: 'text-rose-600',
    scope: 'Manage Field Control',
  },
] as const;

export default function RecurringPaymentsSettingsHub() {
  const { can, isLoading } = useAuthorization();
  const canViewPage = can('View', 'Recurring Payments.Settings');

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Access denied</CardTitle>
          <CardDescription>You do not have permission to view Recurring Payments settings.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const visibleItems = SETTINGS_ITEMS.filter((item) => can(item.scope, 'Recurring Payments.Settings'));

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-none bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg">
        <CardContent className="flex items-center gap-3 p-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
            <Settings className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Recurring Payments Settings</h1>
            <p className="mt-1 text-sm text-white/85">Approval rules, notifications, automation, workflow and permissions — each in its own place.</p>
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
