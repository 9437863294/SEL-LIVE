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
 * A hero band carrying the one figure that describes the module (how many people are on record) and
 * the four facts that qualify it, then anything that needs attention, then the destinations grouped
 * by what the reader is trying to do — see `EMPLOYEE_GROUPS` for why those three groups and not the
 * four the old hub used.
 *
 * Gating is unchanged and deliberate: every destination is filtered on its own permission, and the
 * ones a user cannot use are removed rather than greyed out. When nothing is left, the page says so
 * plainly instead of showing an empty frame.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Clock,
  DownloadCloud,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { HrAccessDenied, HrLoader } from '@/components/hr/hr-ui';
import { CountUp } from '@/components/effects/CountUp';
import {
  EMPLOYEE_GROUPS,
  EMPLOYEE_NAV,
  EMP_CARD_CLASS,
  EmployeePageShell,
  EmployeeSectionLabel,
  EmployeeSpotlightCard,
  EmployeeStatusPill,
  EmployeeToolRow,
  useEmployeeAccess,
  type EmpTone,
} from '@/components/employee/employee-ui';
import { fetchSyncReport, type SyncReport } from '@/lib/greythr-sync-client';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

/** How often the relative phrases are recomputed, so they age instead of freezing on mount. */
const STAMP_REFRESH_MS = 60 * 1000;

/** Beyond a day the mirror is worth a warning; beyond a week it is worth an alarm. */
const WARN_AFTER_HOURS = 24;
const ALERT_AFTER_HOURS = 7 * 24;

/* ------------------------------------------------------------------------------------------------
 * Sync freshness
 * ---------------------------------------------------------------------------------------------- */

interface Freshness {
  tone: EmpTone;
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
  if (!report) return { tone: 'slate', pill: 'Sync status unavailable', ageHours: null, known: false };

  const stamp = report.settings.lastSuccessfulRunAt;
  const parsed = stamp ? new Date(stamp) : null;

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return { tone: 'rose', pill: 'Never synced', ageHours: null, known: true };
  }

  const ageHours = (Date.now() - parsed.getTime()) / 3_600_000;
  const phrase = `Synced ${formatDistanceToNow(parsed, { addSuffix: true })}`;
  const tone: EmpTone =
    ageHours >= ALERT_AFTER_HOURS ? 'rose' : ageHours >= WARN_AFTER_HOURS ? 'amber' : 'emerald';

  return { tone, pill: phrase, ageHours, known: true };
}

/**
 * The freshness pill, restyled for the gradient hero.
 *
 * Not the `chip` entry from `EMP_TONES`: those are pale fills with dark text, made for a white
 * card, and on the gradient they read as a sticker pasted onto it. These are translucent washes of the same hues over
 * white text — the tone still carries the meaning, the surface still looks like one surface.
 */
const HERO_PILL_TONE: Record<EmpTone, string> = {
  emerald: 'border-emerald-300/40 bg-emerald-400/20 text-white',
  amber: 'border-amber-200/50 bg-amber-300/25 text-white',
  rose: 'border-rose-200/50 bg-rose-400/25 text-white',
  slate: 'border-white/25 bg-white/10 text-white/85',
  indigo: 'border-white/25 bg-white/10 text-white/85',
  violet: 'border-white/25 bg-white/10 text-white/85',
  blue: 'border-white/25 bg-white/10 text-white/85',
  cyan: 'border-white/25 bg-white/10 text-white/85',
  teal: 'border-white/25 bg-white/10 text-white/85',
};

/* ------------------------------------------------------------------------------------------------
 * Hero
 * ---------------------------------------------------------------------------------------------- */

/** One of the four qualifying figures beside the hero number. */
function HeroStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-white/10 px-3 py-2 backdrop-blur-sm">
      <dt className="truncate text-[10px] font-semibold uppercase tracking-wider text-white/65">{label}</dt>
      <dd className="mt-0.5 truncate text-base font-semibold leading-tight text-white">{value}</dd>
      {hint && <p className="mt-0.5 truncate text-[10px] text-white/60">{hint}</p>}
    </div>
  );
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

  const notices = useMemo<Notice[]>(() => {
    if (!report) return [];
    const list: Notice[] = [];
    const syncHref = '/employee/sync';

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
  }, [report, freshness, schedule, access.canSync]);

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
          <span>{mirror.working.toLocaleString()} still working</span>
        </>
      );
    }
    if (key === 'current') {
      return (
        <>
          <EmployeeStatusPill tone="emerald" pulse>
            Live from greytHR
          </EmployeeStatusPill>
          <span>Fetched on open</span>
        </>
      );
    }
    if (key === 'sync') {
      return (
        <>
          <EmployeeStatusPill tone={statsLoading ? 'slate' : freshness.tone} icon={Clock}>
            {statsLoading ? 'Checking…' : freshness.pill}
          </EmployeeStatusPill>
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
      {/* ── Hero ───────────────────────────────────────────────────────────────────────────────
          A gradient band rather than another white card, for one reason: this page is a list of
          links, and a list of links with no focal point reads as a menu. The figure in it is the
          module's headline — how many people this system holds records for — and the four beside it
          are the facts that qualify it. They replace the old page's separate KPI strip, which
          printed the same numbers a second time in plainer boxes. */}
      <section className="animate-emp-card-in relative mb-3 overflow-hidden rounded-2xl bg-gradient-to-br from-sky-600 via-indigo-600 to-violet-700 p-4 text-white shadow-lg sm:p-5">
        {/* Two soft highlights, so the gradient reads as light falling on a surface rather than as a
            flat block of colour. */}
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-white/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/4 h-64 w-64 rounded-full bg-cyan-300/25 blur-3xl" />

        <div className="relative grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end lg:gap-6">
          <div className="min-w-0">
            {/* A breadcrumb, not the bare round arrow that used to sit on a row of its own above
                the title. Same destination, no wasted row, and it says where it goes. */}
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/65">
              <Link
                href="/settings"
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors hover:bg-white/15 hover:text-white"
              >
                <ArrowLeft className="h-3 w-3" />
                Settings
              </Link>
              <span aria-hidden>/</span>
              <span className="text-white/90">Employee</span>
            </div>

            <h1 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">Employee Management</h1>

            {/* The headline figure, and the stats beside it, are the roster's — so they are shown to
                somebody who may read the roster. A user who holds only the linking permission gets
                the heading and the one destination they can open, not a row of em dashes. */}
            {access.canView && (
              <div className="mt-2 flex items-end gap-3">
                <p className="text-4xl font-semibold leading-none sm:text-5xl">
                  {statsLoading || !mirror ? '—' : <CountUp value={mirror.employees} />}
                </p>
                <p className="pb-1 text-sm text-white/75">
                  employee records
                  <br className="hidden sm:block" /> mirrored from greytHR
                </p>
              </div>
            )}

            <p className="mt-3 max-w-2xl text-sm text-white/80">
              The roster and its greytHR sync, leave and attendance registers, category masters,
              position history and salary — each opening only for the permissions you hold.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
                  HERO_PILL_TONE[statsLoading ? 'slate' : freshness.tone],
                )}
              >
                <Clock className="h-3 w-3" />
                {statsLoading ? 'Checking sync status…' : freshness.pill}
                {freshness.known && freshness.ageHours !== null && freshness.ageHours >= WARN_AFTER_HOURS && (
                  <span className="font-semibold">· needs a run</span>
                )}
              </span>
              {access.canSync && (
                <Button asChild size="sm" variant="secondary" className="bg-white text-slate-800 hover:bg-white/90">
                  <Link href="/employee/sync">
                    <DownloadCloud className="mr-1.5 h-4 w-4" />
                    Sync console
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              )}
            </div>
          </div>

          {access.canView && (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[20rem] lg:grid-cols-2">
              <HeroStat
                label="Still working"
                value={statsLoading || !mirror ? '—' : mirror.working.toLocaleString()}
                hint="Currently employed"
              />
              <HeroStat
                label="Departed"
                value={statsLoading || !mirror ? '—' : departed.toLocaleString()}
                hint="Exited or inactive"
              />
              <HeroStat
                label="Full baseline"
                value={statsLoading ? '—' : report?.settings.baselineCompletedAt ? 'Complete' : 'Never'}
                hint={
                  statsLoading
                    ? undefined
                    : report?.settings.baselineCompletedAt
                      ? 'Every employee fetched once'
                      : 'Next full run fetches all'
                }
              />
              <HeroStat
                label="Salary rows"
                value={statsLoading || !mirror ? '—' : mirror.salaryRows.toLocaleString()}
                hint="Monthly documents held"
              />
            </dl>
          )}
        </div>
      </section>

      {/* ── Anything that needs doing ────────────────────────────────────────────────────────── */}
      {notices.length > 0 && (
        <div className={cn('mb-3 grid gap-2', notices.length > 1 && 'lg:grid-cols-2')}>
          {notices.map((notice, index) => (
            <NoticeRow key={notice.id} notice={notice} index={index} />
          ))}
        </div>
      )}

      {/* ── Start here ───────────────────────────────────────────────────────────────────────── */}
      {primaries.length > 0 && (
        <section className="mb-4">
          <EmployeeSectionLabel
            icon={EMPLOYEE_GROUPS[0].icon}
            title={EMPLOYEE_GROUPS[0].title}
            hint={EMPLOYEE_GROUPS[0].blurb}
          />
          <div className={cn('grid gap-3', primaries.length === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2')}>
            {primaries.map((item, index) => (
              <EmployeeSpotlightCard key={item.key} item={item} index={index} footer={spotlightFooter(item.key)} />
            ))}
          </div>
        </section>
      )}

      {/* ── Everything else, as rows ─────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {rowGroups.map(group => (
          <section key={group.key} className="min-w-0">
            <EmployeeSectionLabel
              icon={group.icon}
              title={group.title}
              hint={`${group.items.length} ${group.items.length === 1 ? 'screen' : 'screens'}`}
            />
            <Card className={cn('rounded-2xl p-1.5', EMP_CARD_CLASS)}>
              <div className="grid gap-0.5">
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
        four figures are now the hero's, where they qualify the headline number instead of restating
        it. Adding them back at the foot would reintroduce exactly the duplication this redesign
        removed.
      */}
    </EmployeePageShell>
  );
}
