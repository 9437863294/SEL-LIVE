'use client';

import { Hash, Printer, GitMerge, ShieldAlert } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  DailyWorkflowCard,
  dailyPageContainerClass,
  dailySurfaceCardClass,
} from '@/components/daily-requisition/module-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';

/* ---- Workflow items (new) ---- */
const workflowItems = [
  {
    icon: GitMerge,
    title: 'Workflow Configuration',
    description: 'Set the steps, users, actions, and TAT for the daily requisition process.',
    href: '/daily-requisition/settings/workflow-configuration',
    permission: 'View Workflow',
    badge: 'Workflow',
    accentClassName: 'bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400',
  },
] as const;

/* ---- Action items (existing settings) ---- */
const actionItems = [
  {
    icon: Hash,
    title: 'Serial No. Configuration',
    description: 'Configure serial numbers for daily requisitions.',
    href: '/settings/serial-no-configuration',
    permission: 'Edit Serial Nos',
    badge: 'Core',
    accentClassName: 'bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-400',
  },
  {
    icon: Printer,
    title: 'Printing Setup',
    description: 'Manage page size, margins, and header for printing.',
    href: '/daily-requisition/settings/printing',
    permission: 'View',
    badge: 'Output',
    accentClassName: 'bg-gradient-to-r from-amber-300 via-orange-300 to-rose-300',
  },
] as const;

export default function DailyRequisitionSettingsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewPage = can('View', 'Daily Requisition.Settings');

  const authorizedWorkflowItems = workflowItems.map((item) => ({
    ...item,
    disabled: !can(item.permission, 'Daily Requisition.Settings'),
  }));

  const authorizedActionItems = actionItems.map((item) => ({
    ...item,
    disabled: !can(item.permission, 'Daily Requisition.Settings'),
  }));

  if (isAuthLoading) {
    return (
      <div className={dailyPageContainerClass}>
        <Skeleton className="mb-6 h-10 w-full max-w-80" />
        <Skeleton className="mb-4 h-4 w-40" />
        <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-28 rounded-2xl" />
        </div>
        <Skeleton className="mb-4 h-4 w-40" />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className={dailyPageContainerClass}>
        <PageHeader backHref="/daily-requisition" eyebrow="Daily Requisition"
          title="Settings"
          description="Configure workflow and controls for the daily requisition module."
        />
        <Card className={dailySurfaceCardClass}>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this page.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={dailyPageContainerClass}>
      <PageHeader backHref="/daily-requisition" eyebrow="Daily Requisition"
        title="Settings"
        description="Configure workflow steps, numbering, and printing for the module."
      />

      {/* ---- Workflow Section ---- */}
      <div className="mb-2">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Workflow</h2>
        <p className="mb-4 text-xs text-slate-400">Configure the approval steps and process flow.</p>
      </div>
      <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {authorizedWorkflowItems.map((item) => (
          <DailyWorkflowCard key={item.title} item={item} />
        ))}
      </div>

      {/* ---- Actions Section ---- */}
      <div className="mb-2">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Actions</h2>
        <p className="mb-4 text-xs text-slate-400">Serial numbering and print output.</p>
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {authorizedActionItems.map((item) => (
          <DailyWorkflowCard key={item.title} item={item} />
        ))}
      </div>
    </div>
  );
}
