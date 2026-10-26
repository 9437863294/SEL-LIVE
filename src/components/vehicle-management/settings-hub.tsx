'use client';

import Link from 'next/link';
import {
  ChevronRight,
  GitBranch,
  Loader2,
  Settings,
  SlidersHorizontal,
  Tag,
  Truck,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { cn } from '@/lib/utils';
import { vmToneChip, type VmTone } from './vm-ui';

const MODULE = 'Vehicle Management';

/**
 * The cards, each opened by its own permission: the module's own settings need Vehicle Management ·
 * Settings · View; Fleet opens for Fleet Settings · View too, so a fleet admin who holds only that
 * still reaches the hub — and sees only the card they can use.
 */
const SETTINGS_ITEMS = [
  {
    icon: Truck,
    text: 'Fleet',
    href: '/vehicle-management/settings/fleet',
    description: "Daily km limits, the GPS-against-odometer rule, over-limit approvals, trip purposes, each vehicle's rate and approver, and project sites.",
    tone: 'emerald' as VmTone,
    resource: 'Fleet Settings',
  },
  {
    icon: Tag,
    text: 'Vehicle Types',
    href: '/vehicle-management/settings/vehicle-types',
    description: 'Manage the list of vehicle types offered in Vehicle Master.',
    tone: 'violet' as VmTone,
    resource: 'Settings',
  },
  {
    icon: GitBranch,
    text: 'Insurance Workflow',
    href: '/vehicle-management/settings/insurance-workflow',
    description: 'Configure dynamic stages, assignment, premium-based approvals, TAT and escalation.',
    tone: 'amber' as VmTone,
    resource: 'Settings',
  },
  {
    icon: SlidersHorizontal,
    text: 'Field Control',
    href: '/vehicle-management/settings/field-control',
    description: 'Show, hide, require or relabel any field on every form in the module.',
    tone: 'slate' as VmTone,
    resource: 'Settings',
  },
] as const;

export default function VehicleManagementSettingsHub() {
  const { can, isLoading } = useAuthorization();
  const canSettings = can('View', `${MODULE}.Settings`) || can('Edit', `${MODULE}.Settings`);
  const canFleet = canSettings || can('View', `${MODULE}.Fleet Settings`) || can('Edit', `${MODULE}.Fleet Settings`);
  const items = SETTINGS_ITEMS.filter((item) => (item.resource === 'Fleet Settings' ? canFleet : canSettings));
  const canView = items.length > 0;

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardContent className="py-10 text-center">
          <p className="font-semibold text-slate-800">Access Restricted</p>
          <p className="mt-1 text-sm text-muted-foreground">You do not have permission to view vehicle settings.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vehicle Management Settings"
        description="The fleet, vehicle types, trip tracking, insurance workflow and field control — each in its own place."
        icon={Settings}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Link key={item.text} href={item.href} className="no-underline">
            <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-colors hover:border-slate-300 hover:bg-slate-50">
              <div className="flex items-center gap-3 p-4">
                <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', vmToneChip(item.tone))}>
                  <item.icon className="h-5 w-5" />
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
      </div>
    </div>
  );
}
