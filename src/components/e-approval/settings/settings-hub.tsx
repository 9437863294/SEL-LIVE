'use client';

import Link from 'next/link';
import { ChevronRight, GitBranch, Building2, FileStack, Loader2, Settings, ShieldCheck, UserCheck, Workflow } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { E_APPROVAL_BASE_PATH, E_APPROVAL_PERMISSION_RESOURCE } from '@/lib/e-approval';
import { useEApprovalPermissions } from '../hooks';

/**
 * The settings hub, built like `site-account-statement/settings-hub.tsx`.
 *
 * One card per thing you might come here to change, each opening its own page — rather than tabs.
 * Tabs were wrong for this: they hide four of five sections behind a click, give no room to say what
 * a section is for, and put unrelated forms on one screen where a stray Save could touch something
 * the person was not looking at.
 *
 * The one deliberate exception is **Policies**, which stays a single page rather than five. Every
 * setting on it lives in the same Firestore settings document, and splitting one document across
 * five pages with five Save buttons is how a save on one page silently reverts an edit on another.
 */
const SECTIONS = [
  {
    icon: FileStack,
    text: 'Approval Types',
    href: `${E_APPROVAL_BASE_PATH}/settings/types`,
    description: 'What people can raise — purchase, leave exception, site expense. Sets whether an amount is required.',
    gradient: 'from-sky-500 to-blue-600',
    bg: 'bg-sky-50',
    iconColor: 'text-sky-600',
    node: 'Approval Types',
  },
  {
    icon: Workflow,
    text: 'Workflows',
    href: `${E_APPROVAL_BASE_PATH}/settings/workflows`,
    description: 'Named chains of stages, their approvers, parallel groups, and what each stage may do.',
    gradient: 'from-indigo-500 to-violet-600',
    bg: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
    node: 'Workflow Templates',
  },
  {
    icon: GitBranch,
    text: 'Approval Matrix',
    href: `${E_APPROVAL_BASE_PATH}/settings/matrix`,
    description: 'Which chain a request takes, by type, department, project and amount band.',
    gradient: 'from-teal-500 to-emerald-600',
    bg: 'bg-teal-50',
    iconColor: 'text-teal-600',
    node: 'Approval Matrix',
  },
  {
    icon: Building2,
    text: 'Department Routing',
    href: `${E_APPROVAL_BASE_PATH}/settings/departments`,
    description: 'Who a step addressed to a department actually reaches, and its reference-number code.',
    gradient: 'from-amber-500 to-orange-500',
    bg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    node: 'Department Routing',
  },
  {
    icon: ShieldCheck,
    text: 'Policies',
    href: `${E_APPROVAL_BASE_PATH}/settings/policies`,
    description: 'Change control, approver powers, recall and reverse windows, reminders, numbering.',
    gradient: 'from-rose-500 to-red-600',
    bg: 'bg-rose-50',
    iconColor: 'text-rose-600',
    node: 'Policies',
  },
  {
    icon: UserCheck,
    text: 'Delegations',
    href: `${E_APPROVAL_BASE_PATH}/delegations`,
    description: 'Substitute approvers for leave — dated windows that expire on their own.',
    gradient: 'from-fuchsia-500 to-pink-600',
    bg: 'bg-fuchsia-50',
    iconColor: 'text-fuchsia-600',
    node: null,
  },
] as const;

export function EApprovalSettingsHub() {
  const permissions = useEApprovalPermissions();

  if (permissions.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-sky-600" />
      </div>
    );
  }

  const resource = E_APPROVAL_PERMISSION_RESOURCE;
  const visible = SECTIONS.filter((section) => {
    // Delegations is not a Settings node — it has its own permission and its own page.
    if (section.node === null) return permissions.canViewDelegations;
    const node = `${resource}.Settings.${section.node}`;
    return (
      permissions.can('View', node) || permissions.can('Add', node) || permissions.can('Edit', node)
    );
  });

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-none bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-lg">
        <CardContent className="flex items-center gap-3 p-5 sm:p-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
            <Settings className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">E-Approval Settings</h1>
            <p className="mt-1 text-sm text-white/85">
              Everything that decides how an approval behaves before anybody touches it. Changes apply to
              approvals raised from now on — a request already in flight keeps the chain it was given.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((section) => (
          <Link key={section.text} href={section.href} className="no-underline">
            <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border/60 bg-background transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
              <div className={cn('h-1 w-full bg-gradient-to-r', section.gradient)} />
              <div className="flex items-center gap-3 p-4">
                <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', section.bg)}>
                  <section.icon className={cn('h-5 w-5', section.iconColor)} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-tight">{section.text}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{section.description}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
              </div>
            </div>
          </Link>
        ))}
        {!visible.length && (
          <div className="col-span-full rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
            You don’t have access to any settings sections yet. Ask your administrator to grant access.
          </div>
        )}
      </div>
    </div>
  );
}
