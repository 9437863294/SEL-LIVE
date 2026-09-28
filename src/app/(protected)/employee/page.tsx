'use client';

/**
 * The Employee Management hub.
 *
 * ── What was wrong with the old one ─────────────────────────────────────────────────────────────
 *
 * Eleven identical cards in one grid, each carrying a two- or three-line description, above a strip
 * of four plain KPI boxes. Three problems, all of them structural rather than cosmetic:
 *
 *  1. *No hierarchy.* "Manage Employee", opened every day, was rendered exactly like "Pay Slip
 *     Config", which does not exist yet. A reader had to read all eleven labels to find the one
 *     they came for.
 *  2. *Numbers with no consequence.* The KPI strip printed "Last sync — 18 days ago" in the same
 *     neutral grey as everything else. An eighteen-day-old mirror is the single most important fact
 *     on this page and it read as decoration. It is now a toned pill next to the sync destination,
 *     it turns amber and then rose as it ages, and it brings its own notice explaining what to do.
 *  3. *Wasted space.* Eleven cards at ~100px each, plus a lone unlabelled back arrow on a row of its
 *     own, plus a ragged final row wherever a group had two members. The same eleven destinations
 *     now occupy a little over half the height: three feature cards for the screens people actually
 *     open, and two even blocks of compact rows for the rest.
 *
 * ── What is on the page ─────────────────────────────────────────────────────────────────────────
 *
 * The standard page header, a row of figures — the one that describes the module (how many people
 * are on record) and the four facts that qualify it — then anything that needs attention, then the
 * destinations grouped by what the reader is trying to do — see `EMPLOYEE_GROUPS` for why those
 * three groups and not the four the old hub used.
 *
 * Gating is unchanged and deliberate: every destination is filtered on its own permission, and the
 * ones a user cannot use are removed rather than greyed out. When nothing is left, the page says so
 * plainly instead of showing an empty frame.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowRight,
  CalendarClock,
  Clock,
  Database,
  DownloadCloud,
  RefreshCw,
  ShieldAlert,
  UserCheck,
  UserMinus,
  Users,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { HrAccessDenied, HrLoader } from '@/components/hr/hr-ui';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import {
  EMPLOYEE_GROUPS,
  EMPLOYEE_NAV,
  EMP_CARD_CLASS,
  EmployeeKpiCard,
  EmployeePageShell,
  EmployeeSpotlightCard,
  EmployeeToolRow,
  useEmployeeAccess,
} from '@/components/employee/employee-ui';
import { fetchSyncReport, type SyncReport } from '@/lib/greythr-sync-client';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

/** How often the relative phrases are recomputed, so they age instead of freezing on mount. */
const STAMP_REFRESH_MS = 60 * 1000;

/** Beyond a day the mirror is worth a warning; beyond a week it is worth an alarm. */
const WARN_AFTER_HOURS = 24;
const ALERT_AFTER_HOURS = 7 * 24;

const screenCount = (count: number) => `${count} ${count === 1 ? 'screen' : 'screens'}`;

/* ------------------------------------------------------------------------------------------------
 * Sync freshness
 * ---------------------------------------------------------------------------------------------- */

interface Freshness {
  /** The pill's status tone: current green, a day old amber, a week old (or never) rose. */
  tone: StatusTone;
  /** For the pill beside the sync card: "Synced 4 hours ago". */
  pill: string;
  /** Hours since the last successful run; null when there has never been one, or is not known. */
  ageHours: number | null;
  /**
   * Whether the report was read at all.
   *
   * Three states, not two. Without a report we do not *know* when the last sync was — the usual
   * reasons are a failed read or a viewer whose permissions do not include the sync, and saying
   * "never synced" to either of them would be a guess presented as a fact, in rose, about the one
   * thing on this page people act on.
   */
  known: boolean;
}

function readFreshness(report: SyncReport | null): Freshness {
  if (!report) return { tone: 'neutral', pill: 'Sync status unavailable', ageHours: null, known: false };

  const stamp = report.settings.lastSuccessfulRunAt;
  const parsed = stamp ? new Date(stamp) : null;

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return { tone: 'danger', pill: 'Never synced', ageHours: null, known: true };
  }

  const ageHours = (Date.now() - parsed.getTime()) / 3_600_000;
  const phrase = `Synced ${formatDistanceToNow(parsed, { addSuffix: true })}`;
  const tone: StatusTone =
    ageHours >= ALERT_AFTER_HOURS ? 'danger' : ageHours >= WARN_AFTER_HOURS ? 'warning' : 'success';

  return { tone, pill: phrase, ageHours, known: true };
}

/* ------------------------------------------------------------------------------------------------
 * Attention notices
 * ---------------------------------------------------------------------------------------------- */

interface Notice {
  id: string;
  tone: 'amber' | 'rose';
  icon: LucideIcon;
  title: string;
  detail: string;
  action?: { label: string; href: string };
}

const NOTICE_TONE = {
  amber: { shell: 'border-amber-200 bg-amber-50/80', chip: 'bg-amber-100 text-amber-700', title: 'text-amber-900', body: 'text-amber-800' },
  rose: { shell: 'border-rose-200 bg-rose-50/80', chip: 'bg-rose-100 text-rose-700', title: 'text-rose-900', body: 'text-rose-800' },
} as const;

function NoticeRow({ notice, index }: { notice: Notice; index: number }) {
  const tone = NOTICE_TONE[notice.tone];
  return (
    <div
      style={{ animationDelay: `${120 + index * 60}ms` }}
      className={cn('animate-emp-card-in flex items-start gap-3 rounded-xl border px-3 py-2.5', tone.shell)}
    >
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', tone.chip)}>
        <notice.icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-semibold', tone.title)}>{notice.title}</p>
        <p className={cn('text-xs leading-snug', tone.body)}>{notice.detail}</p>
      </div>
      {notice.action && (
        <Button asChild variant="outline" size="sm" className="shrink-0 bg-white/80 max-sm:hidden">
          <Link href={notice.action.href}>{notice.action.label}</Link>
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * The page
 * ---------------------------------------------------------------------------------------------- */

export default function EmployeeHubPage() {
  const access = useEmployeeAccess();

  /**
   * The hero's figures, from the same Firestore-only report `/employee/sync` reads — deliberately
   * not the live-roster route, which is a real greytHR round trip and far too heavy to pay on every
   * visit to a page of links that nobody opens in order to wait.
   */
  const [report, setReport] = useState<SyncReport | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      setReport(await fetchSyncReport());
    } catch {
      // The hub still works with no figures — the destinations below are the point, and a failed
      // read here should not block them or raise an alarm on a page that is mostly navigation.
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (access.isLoading) return;
    if (!access.canView) {
      setStatsLoading(false);
      return;
    }
    void loadStats();
  }, [access.isLoading, access.canView, loadStats]);

  // Re-renders once a minute so "synced 59 minutes ago" becomes "an hour ago" on its own, and so a
  // page left open overnight crosses the warning threshold rather than lying about it.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!report?.settings.lastSuccessfulRunAt) return;
    const interval = setInterval(() => setTick(value => value + 1), STAMP_REFRESH_MS);
    return () => clearInterval(interval);
  }, [report?.settings.lastSuccessfulRunAt]);

  const freshness = useMemo(() => {
    void tick; // The stamp does not change; how long ago it was does.
    return readFreshness(report);
  }, [report, tick]);

  const mirror = report?.mirror;
  const schedule = report?.settings.schedule;
  const departed = mirror ? Math.max(0, mirror.employees - mirror.working) : 0;

  /**
   * greytHR's own count of who currently works here, and whether the mirror agrees.
   *
   * `mirror.working` is not the headcount — it counts *mirror records* that look employed. On a
   * mirror that is missing most of the workforce those are different numbers by an order of
   * magnitude, and the hub used to print only the second one: "182 records, 3 still working", as a
   * neutral fact, next to a green sync pill. The roster snapshot has had the real answer all along.
   *
   * A gap is reported whenever greytHR lists materially more current employees than the mirror can
   * account for. Not an exact inequality: a snapshot taken an hour before the last sync can be off
   * by a joiner or two without anything being wrong, and a notice that cries wolf gets ignored.
   */
  const rosterCount = report?.currentRoster.count ?? 0;
  const mirrorGap = mirror && rosterCount > 0 ? rosterCount - mirror.working : 0;
  const mirrorIncomplete = mirrorGap > Math.max(2, Math.round(rosterCount * 0.05));

  const notices = useMemo<Notice[]>(() => {
    if (!report) return [];
    const list: Notice[] = [];
    const syncHref = '/employee/sync';

    /*
      First, and rose, because it invalidates every other number on the page. While it holds, the
      roster, the registers, the reports and the salary screens are all describing whoever happens
      to be in the mirror rather than whoever works here.
    */
    if (mirrorIncomplete) {
      list.push({
        id: 'mirror-gap',
        tone: 'rose',
        icon: Users,
        title: `greytHR lists ${rosterCount.toLocaleString()} current employees; the mirror accounts for ${(mirror?.working ?? 0).toLocaleString()}`,
        detail:
          'Manage Employee, the leave and attendance registers, Reports and Salary are all built from the mirror, so until a sync fills the gap they describe the wrong people. Current Employees is unaffected — it reads the roster directly.',
        action: access.canSync ? { label: 'Sync now', href: syncHref } : undefined,
      });
    }

    if (!report.configured) {
      list.push({
        id: 'credentials',
        tone: 'rose',
        icon: ShieldAlert,
        title: 'greytHR credentials are not configured',
        detail:
          'Nothing can be fetched until the server has them, so every figure on this page is whatever was last written.',
        action: access.canSync ? { label: 'Sync console', href: syncHref } : undefined,
      });
    }

    if (freshness.ageHours === null) {
      list.push({
        id: 'never',
        tone: 'rose',
        icon: Clock,
        title: 'No sync has ever completed successfully',
        detail: 'The roster, registers and reports below are all built from the mirror, and it is empty or stale.',
        action: access.canSync ? { label: 'Run one', href: syncHref } : undefined,
      });
    } else if (freshness.ageHours >= WARN_AFTER_HOURS) {
      list.push({
        id: 'stale',
        tone: freshness.ageHours >= ALERT_AFTER_HOURS ? 'rose' : 'amber',
        icon: Clock,
        title: freshness.pill.replace('Synced', 'Last successful sync was'),
        detail:
          'Joiners and leavers since then are missing or wrongly listed everywhere except Current Employees, which asks greytHR directly.',
        action: access.canSync ? { label: 'Sync now', href: syncHref } : undefined,
      });
    }

    if (!report.settings.baselineCompletedAt) {
      list.push({
        id: 'baseline',
        tone: 'amber',
        icon: RefreshCw,
        title: 'No full baseline has completed',
        detail:
          'Incremental runs only fetch what greytHR says changed, so they can maintain a complete mirror but never build one. The next full run fetches everybody.',
        action: access.canSync ? { label: 'Sync console', href: syncHref } : undefined,
      });
    }

    if (schedule && !schedule.enabled) {
      list.push({
        id: 'schedule',
        tone: 'amber',
        icon: CalendarClock,
        title: 'Automatic sync is switched off',
        detail: 'The mirror changes only when somebody runs the sync by hand.',
        action: access.canSync ? { label: 'Turn it on', href: syncHref } : undefined,
      });
    }

    // Three is the point at which a list of warnings stops being read. The rest are all visible on
    // the sync console, which every one of these links to.
    return list.slice(0, 3);
  }, [report, freshness, schedule, access.canSync, mirrorIncomplete, rosterCount, mirror?.working]);

  /* ── Destinations ── */

  const permitted = useMemo(() => EMPLOYEE_NAV.filter(item => access.permits(item)), [access]);

  /** The live figure under each feature card. Null for anything the report could not answer. */
  const spotlightFooter = (key: string): React.ReactNode => {
    if (key === 'manage') {
      if (!mirror) return statsLoading ? 'Counting records…' : null;
      return (
        <>
          <span className="font-medium text-slate-700">{mirror.employees.toLocaleString()} records</span>
          <span aria-hidden className="text-slate-300">
            ·
          </span>
          {/* "3 still working" is exactly the misreading to avoid while the mirror is short of the
              roster: the screen behind this card can only show what the mirror holds. */}
          {mirrorIncomplete ? (
            <StatusBadge tone="warning">mirror incomplete</StatusBadge>
          ) : (
            <span>{mirror.working.toLocaleString()} still working</span>
          )}
        </>
      );
    }
    if (key === 'current') {
      return (
        <>
          <StatusBadge tone="success" dot>
            Live from greytHR
          </StatusBadge>
          <span>Fetched on open</span>
        </>
      );
    }
    if (key === 'sync') {
      return (
        <>
          <StatusBadge tone={statsLoading ? 'neutral' : freshness.tone}>
            <Clock className="h-3 w-3" aria-hidden="true" />
            {statsLoading ? 'Checking…' : freshness.pill}
          </StatusBadge>
          {schedule && <span>{schedule.enabled ? `${schedule.frequency} schedule` : 'Schedule off'}</span>}
        </>
      );
    }
    return null;
  };

  const groups = EMPLOYEE_GROUPS.map(group => ({
    ...group,
    items: permitted.filter(item => item.group === group.key),
  })).filter(group => group.items.length > 0);

  const primaries = groups.find(group => group.key === 'primary')?.items ?? [];
  const rowGroups = groups.filter(group => group.key !== 'primary');

  if (access.isLoading) {
    return (
      <EmployeePageShell>
        <HrLoader label="Checking your access…" />
      </EmployeePageShell>
    );
  }

  if (permitted.length === 0) {
    return (
      <EmployeePageShell>
        <HrAccessDenied what="Employee Management" />
      </EmployeePageShell>
    );
  }

  return (
    <EmployeePageShell>
      {/* ── Header ─────────────────────────────────────────────────────────────────────────────
          The app's standard page header. The Settings breadcrumb (and, on a phone, the back
          button) is where the hub sits; the freshness pill is the one fact about the module that
          needs reading before anything else, so it rides under the title. */}
      <PageHeader
        title="Employee Management"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Employee' }]}
        backHref="/settings"
        backLabel="Back to settings"
        meta={
          <StatusBadge tone={statsLoading ? 'neutral' : freshness.tone}>
            <Clock className="h-3 w-3" aria-hidden="true" />
            {statsLoading ? 'Checking sync status…' : freshness.pill}
            {freshness.known && freshness.ageHours !== null && freshness.ageHours >= WARN_AFTER_HOURS && (
              <span className="font-semibold">· needs a run</span>
            )}
          </StatusBadge>
        }
        actions={
          access.canSync ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/employee/sync">
                <DownloadCloud className="mr-1.5 h-4 w-4" />
                Sync console
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : undefined
        }
        className="mb-3 sm:mb-4"
      />

      {/* ── Figures ──────────────────────────────────────────────────────────────────────────────
          The module's headline — how many people this system holds records for — and the four
          facts that qualify it. They are the roster's, so they are shown to somebody who may read
          the roster; a user who holds only the linking permission gets the heading and the one
          destination they can open, not a row of em dashes. The headline spans the row on a phone
          so the four beside it sit two by two instead of leaving a ragged last row. */}
      {access.canView && (
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <EmployeeKpiCard
            label="Employee records"
            value={statsLoading || !mirror ? '—' : mirror.employees}
            hint="Mirrored from greytHR"
            icon={Users}
            tone="indigo"
            index={0}
            className="col-span-2 lg:col-span-1"
          />
          {/*
            greytHR's figure, not the mirror's. "How many people work here" has one right answer
            and the mirror is not where it lives — see `mirrorIncomplete` above. The mirror's own
            count follows in the hint whenever the two disagree, so the gap is visible on the
            same line rather than only in the notice below.
          */}
          <EmployeeKpiCard
            label="Currently employed"
            value={statsLoading ? '—' : rosterCount > 0 ? rosterCount.toLocaleString() : (mirror?.working.toLocaleString() ?? '—')}
            hint={
              statsLoading
                ? undefined
                : mirrorIncomplete
                  ? `Per greytHR · mirror has ${(mirror?.working ?? 0).toLocaleString()}`
                  : 'Per greytHR'
            }
            icon={UserCheck}
            tone="emerald"
            index={1}
          />
          <EmployeeKpiCard
            label="Departed"
            value={statsLoading || !mirror ? '—' : departed.toLocaleString()}
            hint="Records in the mirror"
            icon={UserMinus}
            tone="slate"
            index={2}
          />
          <EmployeeKpiCard
            label="Full baseline"
            value={statsLoading ? '—' : report?.settings.baselineCompletedAt ? 'Complete' : 'Never'}
            hint={
              statsLoading
                ? undefined
                : report?.settings.baselineCompletedAt
                  ? 'Every employee fetched once'
                  : 'Next full run fetches all'
            }
            icon={Database}
            tone="violet"
            index={3}
          />
          <EmployeeKpiCard
            label="Salary rows"
            value={statsLoading || !mirror ? '—' : mirror.salaryRows.toLocaleString()}
            hint="Monthly documents held"
            icon={Wallet}
            tone="blue"
            index={4}
          />
        </div>
      )}

      {/* ── Anything that needs doing ────────────────────────────────────────────────────────── */}
      {notices.length > 0 && (
        <div className={cn('mb-3 grid grid-cols-1 gap-2', notices.length > 1 && 'lg:grid-cols-2')}>
          {notices.map((notice, index) => (
            <NoticeRow key={notice.id} notice={notice} index={index} />
          ))}
        </div>
      )}

      {/* ── Start here ───────────────────────────────────────────────────────────────────────────
          Every section label carries a count on the right and its explanation underneath, including
          this one. The first draft put the primary section's sentence in the hint slot and the other
          two sections' counts there, which read as a mistake: three labels in a column, one ending
          in prose and two in a figure. */}
      {primaries.length > 0 && (
        <section className="mb-4">
          <SectionHeader
            icon={EMPLOYEE_GROUPS[0].icon}
            title={EMPLOYEE_GROUPS[0].title}
            actions={<span className="text-xs text-muted-foreground">{screenCount(primaries.length)}</span>}
            className="mb-2"
          />
          <div className={cn('grid grid-cols-1 gap-3', primaries.length === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2')}>
            {primaries.map((item, index) => (
              <EmployeeSpotlightCard
                key={item.key}
                item={item}
                index={index}
                footer={spotlightFooter(item.key)}
                /*
                  Three cards in a two-column grid leave the third alone beside an empty cell — the
                  ragged row this redesign set out to remove, reappearing between 640px and 1024px.
                  On that range the last one spans both columns instead; at `lg` the row is three
                  across and the span is dropped.
                */
                className={
                  primaries.length === 3 && index === 2 ? 'sm:col-span-2 lg:col-span-1' : undefined
                }
              />
            ))}
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">{EMPLOYEE_GROUPS[0].blurb}</p>
        </section>
      )}

      {/* ── Everything else, as rows ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {rowGroups.map(group => (
          <section key={group.key} className="min-w-0">
            <SectionHeader
              icon={group.icon}
              title={group.title}
              actions={<span className="text-xs text-muted-foreground">{screenCount(group.items.length)}</span>}
              className="mb-2"
            />
            <Card className={cn('rounded-2xl p-1.5', EMP_CARD_CLASS)}>
              <div className="grid grid-cols-1 gap-0.5">
                {group.items.map((item, index) => (
                  <EmployeeToolRow key={item.key} item={item} index={index} />
                ))}
              </div>
            </Card>
            <p className="mt-1.5 px-3 text-[11px] text-muted-foreground">{group.blurb}</p>
          </section>
        ))}
      </div>

      {/*
        No KPI strip under any of this, on purpose. The old page printed "Employee records", "Still
        working", "Full baseline" and "Last sync" as four plain boxes *above* eleven cards; those
        four figures are now in the row under the header, where they qualify the headline number instead of restating
        it. Adding them back at the foot would reintroduce exactly the duplication this redesign
        removed.
      */}
    </EmployeePageShell>
  );
}
