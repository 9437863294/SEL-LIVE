'use client';

import { Users, Hash, Printer, GitMerge } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  DailyMetricCard,
  DailyPageHeader,
  DailyWorkflowCard,
  dailyPageContainerClass,
  dailySurfaceCardClass,
} from '@/components/daily-requisition/module-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ShieldAlert } from 'lucide-react';

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

  const allItems = [...authorizedWorkflowItems, ...authorizedActionItems];

  if (isAuthLoading) {
    return (
      <div className={dailyPageContainerClass}>
        <Skeleton className="mb-6 h-10 w-80" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className={dailyPageContainerClass}>
        <DailyPageHeader
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

  const enabledCount = allItems.filter((item) => !item.disabled).length;

  return (
    <div className={dailyPageContainerClass}>
      <DailyPageHeader
        title="Settings"
        description="Configure workflow steps, numbering, printing, and access-related controls."
        meta={
          <>
            <span className="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs text-slate-600 backdrop-blur">
              Administrative controls
            </span>
            <span className="rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
              {enabledCount} visible options
            </span>
          </>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <DailyMetricCard label="Workflow" value={workflowItems.length} hint="Process configuration" />
        <DailyMetricCard label="Actions" value={actionItems.length} hint="Module controls" />
        <DailyMetricCard label="Your Access" value={enabledCount} hint="Cards enabled for your role" />
      </div>

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
        <p className="mb-4 text-xs text-slate-400">Serial numbering, roles, and output configuration.</p>
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {authorizedActionItems.map((item) => (
          <DailyWorkflowCard key={item.title} item={item} />
        ))}
      </div>
    </div>
  );
}
