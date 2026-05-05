
'use client';

import Link from 'next/link';
import {
  Building2,
  ChevronRight,
  Construction,
  GitMerge,
  HelpCircle,
  Settings2,
  ShieldAlert,
  Tags,
  Users,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const SETTINGS_ITEMS = [
  {
    icon: Users,
    text: 'Policy Holders',
    href: '/insurance/policy-holders',
    description: 'Manage personal insurance policy holders, contacts and DOB.',
    gradient: 'from-violet-500 to-purple-600',
    bg: 'bg-violet-50',
    iconColor: 'text-violet-600',
    scope: 'Insurance.Settings.Holders',
  },
  {
    icon: Building2,
    text: 'Insurance Companies',
    href: '/insurance/companies',
    description: 'Maintain the master list of insurance providers.',
    gradient: 'from-blue-500 to-indigo-600',
    bg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    scope: 'Insurance.Settings.Companies',
  },
  {
    icon: Tags,
    text: 'Policy Category',
    href: '/insurance/settings/policy-category',
    description: 'Define and manage categories for project insurance policies.',
    gradient: 'from-amber-500 to-orange-500',
    bg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    scope: 'Insurance.Settings.Categories',
  },
  {
    icon: Construction,
    text: 'Projects & Properties',
    href: '/insurance/settings/assets',
    description: 'Manage insurable assets — projects and property entries.',
    gradient: 'from-emerald-500 to-teal-600',
    bg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    scope: 'Insurance.Settings.Assets',
  },
  {
    icon: GitMerge,
    text: 'Workflow',
    href: '/insurance/settings/workflow',
    description: 'Configure multi-step approval workflows with TAT and assignments.',
    gradient: 'from-cyan-500 to-sky-600',
    bg: 'bg-cyan-50',
    iconColor: 'text-cyan-600',
    scope: 'Insurance.Settings',
  },
  {
    icon: HelpCircle,
    text: 'Help',
    href: '/insurance/settings/help',
    description: 'View documentation for property and workmen compensation insurance.',
    gradient: 'from-slate-400 to-slate-600',
    bg: 'bg-slate-50',
    iconColor: 'text-slate-600',
    scope: 'Insurance.Settings',
  },
] as const;

export default function InsuranceSettingsPage() {
  const { can, isLoading } = useAuthorization();
  const canViewPage = can('View', 'Insurance.Settings');

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Access Denied</CardTitle>
          <CardDescription>You do not have permission to view settings.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-slate-400 via-slate-500 to-slate-600" />
        <CardHeader className="flex items-center gap-3 flex-row">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 ring-1 ring-slate-200">
            <Settings2 className="h-5 w-5 text-slate-600" />
          </div>
          <div>
            <CardTitle className="tracking-tight">Insurance Settings</CardTitle>
            <CardDescription>Configure masters, workflows and documentation</CardDescription>
          </div>
        </CardHeader>
      </Card>

      {/* Settings cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SETTINGS_ITEMS.map((item) => {
          const isDisabled = !can('View', item.scope);
          const content = (
            <div className={cn(
              'group relative flex flex-col overflow-hidden rounded-xl border transition-all duration-200',
              isDisabled
                ? 'cursor-not-allowed opacity-60 border-border/40 bg-muted/30'
                : 'cursor-pointer border-border/60 bg-background hover:-translate-y-1 hover:shadow-md'
            )}>
              <div className={cn('h-1 w-full bg-gradient-to-r', item.gradient)} />
              <div className="flex items-center gap-3 p-4">
                <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', item.bg)}>
                  <item.icon className={cn('h-5 w-5', item.iconColor)} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm leading-tight">{item.text}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.description}</p>
                </div>
                {!isDisabled && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />}
              </div>
            </div>
          );
          if (isDisabled) return <div key={item.text}>{content}</div>;
          return <Link key={item.text} href={item.href} className="no-underline">{content}</Link>;
        })}
      </div>
    </div>
  );
}
