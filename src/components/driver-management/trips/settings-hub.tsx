'use client';

/**
 * Driver Management › Settings: one card per part of the trip-claims setup. The cards are the only
 * way in — they get no sidebar entries of their own.
 */

import Link from 'next/link';
import { ChevronRight, GitBranch, IndianRupee, Settings, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { vmToneChip, type VmTone } from '@/components/vehicle-management/vm-ui';
import { cn } from '@/lib/utils';
import { useTripClaims } from './trip-claims-provider';
import { ErrorBlock, LoadingBlock } from './trip-ui';

const ITEMS: { icon: typeof Settings; text: string; href: string; description: string; tone: VmTone }[] = [
  { icon: IndianRupee, text: 'Rates per km', href: '/driver-management/settings/rates', description: 'What is paid per kilometre for each vehicle type, on own and company vehicles, from a date on.', tone: 'emerald' },
  { icon: GitBranch, text: 'Workflow & approvers', href: '/driver-management/settings/workflow', description: "Claims go to each employee's reporting authority first; add levels for large claims, exceptions, and who pays.", tone: 'violet' },
  { icon: SlidersHorizontal, text: 'Trip rules', href: '/driver-management/settings/rules', description: 'Own and company vehicles, odometer readings, toll and parking, the claim window and the limits that flag a trip.', tone: 'amber' },
];

export default function TripSettingsHub() {
  const { data, loading, error, reload } = useTripClaims();
  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBlock message={error ?? 'Could not load settings.'} onRetry={() => void reload()} />;
  if (!data.access.settingsView) return <ErrorBlock message="Trip settings need Driver Management · Trip Settings · View." />;

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" icon={Settings} description="How trips are priced, who approves and pays the claims, and the rules every trip is checked against." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className="no-underline">
            <div className="group flex h-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50">
              <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', vmToneChip(item.tone))}>
                <item.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight">{item.text}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
