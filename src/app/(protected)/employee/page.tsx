'use client';

/**
 * The Employee Management hub.
 *
 * Every tile here is gated on its own permission rather than on the page as a whole: a user who may
 * read the roster but not run a sync should see Manage Employee and not see Sync with GreytHR, which
 * is a different statement from "you cannot open Employee Management". Cards the user cannot use are
 * removed rather than disabled — a greyed-out tile still tells them a capability exists and invites a
 * support ticket. When nothing is left to show, the page says so plainly.
 *
 * ── Why sections, not one flat grid ─────────────────────────────────────────────────────────────
 *
 * Eight-plus tiles in one grid reads as an unordered list; an administrator has to read every label
 * to find what they want. Grouped by what the tile is *for* — see who's here, see their time-off and
 * attendance, keep the data current, handle pay — the page can be scanned by section instead of by
 * tile, and a KPI strip up top answers "how many, how current" before anyone opens anything.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Briefcase,
  CalendarClock,
  Clock,
  DownloadCloud,
  FileText,
  IndianRupee,
  Link2,
  RefreshCw,
  Tags,
  UserCheck,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import { HrAccessDenied, HrKpiCard, HrLoader, HrPageHeader } from '@/components/hr/hr-ui';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { fetchSyncReport, type SyncReport } from '@/lib/greythr-sync-client';
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
  badge?: React.ReactNode;
}

interface HubSection {
  title: string;
  description?: string;
  cards: HubCard[];
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
          {/*
            A `<div>`, not a `<p>` — the badge can be a loading `<Skeleton>` (a `<div>`), and a `<p>`
            cannot legally contain one. That mismatch is what broke hydration here before.
          */}
          {item.badge && <div className="mt-2 text-xs text-muted-foreground">{item.badge}</div>}
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

function HubSectionBlock({ section }: { section: HubSection }) {
  if (section.cards.length === 0) return null;
  return (
    <section className="mb-6">
      <div className="mb-2.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{section.title}</h2>
        {section.description && <p className="text-xs text-muted-foreground">{section.description}</p>}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {section.cards.map((item) => (
          <EmployeeSettingsCard key={item.text} item={item} />
        ))}
      </div>
    </section>
  );
}

export default function EmployeeSettingsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can('View', 'Settings.Employee Management');
  const canSync = can('Sync from GreytHR', 'Settings.Employee Management');
  const canLink = can('View', 'Settings.User Management');

  /**
   * The KPI strip's numbers, from the same cheap Firestore-only report `/employee/sync` reads —
   * deliberately not the live-roster roster route, which is a real greytHR round trip and too heavy
   * to pay on every visit to a hub page nobody opens to wait.
   */
  const [report, setReport] = useState<SyncReport | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      setReport(await fetchSyncReport());
    } catch {
      // The hub still works with no stats — the cards below are what matters, and a failed read
      // here should not block them or show an alarming error on a page that is mostly links.
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canView) {
      setStatsLoading(false);
      return;
    }
    void loadStats();
  }, [isAuthLoading, canView, loadStats]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!report?.settings.lastSuccessfulRunAt) return;
    const interval = setInterval(() => setTick((value) => value + 1), STAMP_REFRESH_MS);
    return () => clearInterval(interval);
  }, [report?.settings.lastSuccessfulRunAt]);

  const lastSyncedLabel = useMemo(() => {
    void tick; // Recomputes the relative phrase as time passes; the timestamp itself does not change.
    const stamp = report?.settings.lastSuccessfulRunAt;
    if (!stamp) return null;
    const parsed = new Date(stamp);
    return Number.isNaN(parsed.getTime()) ? null : `Last synced ${formatDistanceToNow(parsed, { addSuffix: true })}`;
  }, [report?.settings.lastSuccessfulRunAt, tick]);

  const sections = useMemo<HubSection[]>(
    () => [
      {
        title: 'Directory',
        description: 'Who works here, and the numbers behind it.',
        cards: [
          {
            icon: Users,
            text: 'Manage Employee',
            description: 'The full roster, current and departed, corrected against greytHR live.',
            href: '/employee/manage',
            permitted: canView,
          },
          {
            icon: UserCheck,
            text: 'Current Employees (Live)',
            description: "Who greytHR says is currently employed, fetched fresh — bypasses the stored mirror entirely.",
            href: '/employee/current',
            permitted: canView,
          },
          {
            icon: BarChart3,
            text: 'Reports',
            description: 'Headcount, movement and category breakdowns, built from the same corrected roster.',
            href: '/employee/reports',
            permitted: canView,
          },
        ],
      },
      {
        title: 'Time & leave',
        description: "Registers of what greytHR already holds — read-only; applying or approving still happens in greytHR.",
        cards: [
          {
            icon: CalendarClock,
            text: 'Leave register',
            description: 'Every employee’s leave balance by type, organisation-wide.',
            href: '/employee/leave',
            permitted: canView,
          },
          {
            icon: Clock,
            text: 'Attendance register',
            description: "Everyone's synced monthly attendance summary, in one table.",
            href: '/employee/attendance',
            permitted: canView,
          },
        ],
      },
      {
        title: 'Sync & setup',
        description: 'Keep the mirror correct, and connect logins to the people they belong to.',
        cards: [
          {
            icon: DownloadCloud,
            text: 'Sync with GreytHR',
            description: 'Schedule, run and review the sync that keeps the mirror current.',
            href: '/employee/sync',
            permitted: canSync,
            badge: statsLoading ? <Skeleton className="h-3 w-32" /> : lastSyncedLabel,
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
            description: 'Effective-dated category history for one employee.',
            href: '/employee/position-details',
            permitted: canView,
          },
          {
            icon: Link2,
            text: 'greytHR Linking',
            description: 'Reconcile platform logins with greytHR employees — who is linked, who is not.',
            href: '/settings/user-management/greythr-linking',
            permitted: canLink,
          },
        ],
      },
      {
        title: 'Payroll',
        cards: [
          {
            icon: IndianRupee,
            text: 'Employee Salary',
            description: 'View and manage employee salary details.',
            href: '/employee/salary',
            permitted: canView,
          },
          {
            icon: FileText,
            text: 'Pay Slip Config',
            description:
              'Blocked on the salary-row migration — greytHR’s monthly salary sync still writes into the employee mirror rather than its own collection. See docs/greythr-integration.md §11a.',
            href: '#',
            permitted: canView,
            comingSoon: true,
          },
        ],
      },
    ],
    [canView, canSync, canLink, statsLoading, lastSyncedLabel],
  );

  const visibleSections = sections
    .map((section) => ({ ...section, cards: section.cards.filter((card) => card.permitted) }))
    .filter((section) => section.cards.length > 0);

  const totalVisible = visibleSections.reduce((sum, section) => sum + section.cards.length, 0);

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
        description="The employee roster, its greytHR sync, leave, attendance, categories, position details and salary — each opening only for the permissions you hold."
        actions={
          canView ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/employee/sync">
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Sync status
              </Link>
            </Button>
          ) : undefined
        }
      />

      {isAuthLoading ? (
        <HrLoader label="Checking your access…" />
      ) : totalVisible === 0 ? (
        <HrAccessDenied what="Employee Management" />
      ) : (
        <>
          {canView && (
            <div className="mb-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {/*
                `HrKpiCard` renders `value` inside a `<p>`, so the loading placeholder has to be text
                — an ellipsis, not a `<Skeleton>` (a `<div>`). That exact mismatch is the hydration
                bug fixed on this same page last time; reusing `HrKpiCard` here must not reintroduce it.
              */}
              <HrKpiCard
                label="Employee records"
                value={statsLoading ? '…' : report?.mirror.employees ?? '—'}
                icon={Users}
                tone="indigo"
              />
              <HrKpiCard
                label="Still working"
                value={statsLoading ? '…' : report?.mirror.working ?? '—'}
                icon={UserCheck}
                tone={report && report.mirror.employees > 0 && report.mirror.working === 0 ? 'rose' : 'emerald'}
              />
              <HrKpiCard
                label="Full baseline"
                value={statsLoading ? '…' : report?.settings.baselineCompletedAt ? 'Complete' : 'Never'}
                hint={report && !report.settings.baselineCompletedAt ? 'Next sync fetches everybody' : undefined}
                icon={RefreshCw}
                tone={report?.settings.baselineCompletedAt ? 'emerald' : 'amber'}
              />
              <HrKpiCard
                label="Last sync"
                value={statsLoading ? '…' : (lastSyncedLabel?.replace('Last synced ', '') ?? 'Never')}
                icon={Clock}
                tone="blue"
              />
            </div>
          )}

          {visibleSections.map((section) => (
            <HubSectionBlock key={section.title} section={section} />
          ))}
        </>
      )}
    </div>
  );
}
