'use client';

/**
 * The Employee Management hub.
 *
 * Every tile here is gated on its own permission rather than on the page as a whole: a user who may
 * read the roster but not run a sync should see Manage Employee and not see Sync with GreytHR, which
 * is a different statement from "you cannot open Employee Management". Cards the user cannot use are
 * removed rather than disabled — a greyed-out tile still tells them a capability exists and invites a
 * support ticket. When nothing is left to show, the page says so plainly.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  FileText,
  ArrowLeft,
  Tags,
  DownloadCloud,
  Briefcase,
  IndianRupee,
  BarChart3,
  UserCheck,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import { HrAccessDenied, HrLoader, HrPageHeader } from '@/components/hr/hr-ui';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { formatDistanceToNow } from 'date-fns';

/** How often the "Last synced" phrase is recomputed, so it ages instead of freezing on mount. */
const STAMP_REFRESH_MS = 60 * 1000;

interface HubCard {
  icon: LucideIcon;
  text: string;
  description: string;
  href: string;
  /** Whether the signed-in user holds the permission this card needs. */
  permitted: boolean;
  /** Not built yet: rendered, labelled, and deliberately not a link. */
  comingSoon?: boolean;
  lastSynced?: React.ReactNode;
}

function EmployeeSettingsCard({ item }: { item: HubCard }) {
  const cardContent = (
    <Card
      className={cn(
        'flex h-full flex-col rounded-xl border-white/60 bg-white/80 shadow-sm backdrop-blur-sm transition-all duration-300 ease-in-out',
        item.comingSoon ? 'cursor-default opacity-70' : 'cursor-pointer hover:border-primary/50 hover:shadow-lg',
      )}
    >
      <CardHeader className="flex-row items-start gap-4 space-y-0 p-4">
        <div className={cn('rounded-lg p-3', item.comingSoon ? 'bg-slate-100' : 'bg-primary/10')}>
          <item.icon className={cn('h-6 w-6', item.comingSoon ? 'text-slate-400' : 'text-primary')} />
        </div>
        <div className="flex-1">
          <CardTitle className="flex flex-wrap items-center gap-1.5 text-base font-bold">
            {item.text}
            {item.comingSoon && (
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] font-medium text-slate-500">
                Coming soon
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="mt-1 text-sm">{item.description}</CardDescription>
          {item.lastSynced && <p className="mt-2 text-xs text-muted-foreground">{item.lastSynced}</p>}
        </div>
      </CardHeader>
    </Card>
  );

  if (item.comingSoon) {
    // Not a link and not focusable: nothing here responds to a click, so it should not look or
    // behave as though it might.
    return (
      <div className="h-full" aria-disabled="true">
        {cardContent}
      </div>
    );
  }

  return (
    <Link href={item.href} className="no-underline h-full">
      {cardContent}
    </Link>
  );
}

export default function EmployeeSettingsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can('View', 'Settings.Employee Management');
  const canSync = can('Sync from GreytHR', 'Settings.Employee Management');

  /** The parsed timestamp, kept as a Date so the phrase below can be recomputed as time passes. */
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [stampLoading, setStampLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (isAuthLoading) return;
    // Only the Sync card shows this, so there is no reason to read Firestore for someone who will
    // never see the card.
    if (!canSync) {
      setStampLoading(false);
      return;
    }

    let cancelled = false;

    const fetchLastSynced = async () => {
      try {
        /**
         * `settings/greythrSync` is where the current sync records its runs;
         * `settings/employeeSync` is the old flow's document, which nothing writes any more.
         * Both are read so the timestamp keeps working on an installation that has not yet run
         * the new sync — otherwise this card would go blank on deploy and look broken.
         */
        const [current, legacy] = await Promise.all([
          getDoc(doc(db, 'settings', 'greythrSync')),
          getDoc(doc(db, 'settings', 'employeeSync')),
        ]);
        const stamp =
          (current.exists() ? (current.data().lastSuccessfulRunAt ?? current.data().lastRunAt) : null)
          ?? (legacy.exists() ? legacy.data().lastSynced : null);
        if (cancelled) return;
        if (stamp) {
          const parsed = new Date(stamp);
          if (!Number.isNaN(parsed.getTime())) {
            setSyncedAt(parsed);
          }
        }
      } catch (error) {
        console.error("Failed to fetch last sync time:", error);
      } finally {
        if (!cancelled) setStampLoading(false);
      }
    };

    void fetchLastSynced();

    return () => {
      cancelled = true;
    };
  }, [isAuthLoading, canSync]);

  /**
   * "Last synced 2 minutes ago" was computed once and then stayed there for as long as the tab was
   * open, so a stamp read at 09:00 still claimed "a few seconds ago" at noon. This re-renders once a
   * minute, which is the coarsest tick that keeps a relative phrase honest.
   */
  useEffect(() => {
    if (!syncedAt) return;
    const interval = setInterval(() => setTick((value) => value + 1), STAMP_REFRESH_MS);
    return () => clearInterval(interval);
  }, [syncedAt]);

  const lastSyncedLabel = useMemo(
    // `tick` is what makes this recompute — the timestamp itself does not change.
    () => (syncedAt ? `Last synced: ${formatDistanceToNow(syncedAt, { addSuffix: true })}` : null),
    [syncedAt, tick],
  );

  const cards = useMemo<HubCard[]>(
    () => [
      {
        icon: Users,
        text: 'Manage Employee',
        description: 'View the complete greytHR roster, including current and departed employees.',
        href: '/employee/manage',
        permitted: canView,
      },
      {
        icon: DownloadCloud,
        text: 'Sync with GreytHR',
        description: 'Fetch and import employee data from GreytHR.',
        href: '/employee/sync',
        permitted: canSync,
        lastSynced: stampLoading ? <Skeleton className="h-3 w-32" /> : lastSyncedLabel,
      },
      {
        icon: UserCheck,
        text: 'Current Employees (Live)',
        description:
          "Who greytHR says is currently employed, fetched fresh on every visit — bypasses the stored mirror entirely.",
        href: '/employee/current',
        permitted: canView,
      },
      {
        icon: Tags,
        text: 'Manage Category',
        description: 'View synced departments and designations.',
        href: '/employee/category',
        permitted: canView,
      },
      {
        icon: Briefcase,
        text: 'Employee Position Details',
        description: 'Get position details for an employee.',
        // Leading slash: without it this resolved relative to the current URL and broke the moment
        // the path gained a trailing slash.
        href: '/employee/position-details',
        permitted: canView,
      },
      {
        icon: IndianRupee,
        text: 'Employee Salary',
        description: 'View and manage employee salary details.',
        href: '/employee/salary',
        permitted: canView,
      },
      {
        icon: BarChart3,
        text: 'Reports',
        description: 'Employee headcount, movement and category reports.',
        href: '#',
        permitted: canView,
        comingSoon: true,
      },
      {
        icon: FileText,
        text: 'Pay Slip Config',
        description: 'Configure settings for generating pay slips.',
        href: '#',
        permitted: canView,
        comingSoon: true,
      },
    ],
    [canView, canSync, stampLoading, lastSyncedLabel],
  );

  const visibleCards = useMemo(() => cards.filter((card) => card.permitted), [cards]);

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
      <AuroraBackdrop />

      <div className="mb-1 flex items-center gap-2">
        <Link href="/settings">
          <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
      </div>

      <HrPageHeader
        title="Employee Management"
        description="The employee roster, its greytHR sync, categories, position details and salary — each opening only for the permissions you hold."
      />

      {isAuthLoading ? (
        <HrLoader label="Checking your access…" />
      ) : visibleCards.length === 0 ? (
        <HrAccessDenied what="Employee Management" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {visibleCards.map((item) => (
            <EmployeeSettingsCard key={item.text} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
