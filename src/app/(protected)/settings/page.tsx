'use client';

/**
 * Settings › Overview, the module's landing page: how the person's account and the company's
 * set-up stand, from each part of Settings the person may open.
 *
 * - The band: who is signed in, and a set-up health score made from the checks below.
 * - Figures: people, sessions, departments, projects, GST registrations, holidays.
 * - Needs attention: each failed check with the page that fixes it. These are the only links on
 *   the page — the sidebar (and the phone's bar) is the menu, so there are no link cards.
 * - Recent changes and the last 14 days of audit-log activity, the working week with the next
 *   holidays, and the next document numbers.
 *
 * Each figure loads on its own and shows a dash or a short line when its source fails, so one slow
 * or refused read never holds up the rest. The logic is in `@/lib/settings-overview`; the drawing
 * in `overview-hero.tsx` and `overview-parts.tsx`.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query, Timestamp, where } from 'firebase/firestore';
import {
  Activity, Briefcase, CalendarDays, Clock, Construction, Hash, History, ListChecks, MonitorSmartphone, Palette, Radio, Receipt,
  Settings2, Users,
} from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAppearance } from '@/components/theme/ThemeProvider';
import { HOME_DESIGN_META } from '@/components/home/home-designs';
import { KpiCard, KpiGrid } from '@/components/shared/kpi-card';
import { PageHeader } from '@/components/shared/page-header';
import { toAuditLog, type AuditLogEntry } from '@/components/shared/record-history';
import { OverviewHero, type HeroFact } from '@/components/settings/overview-hero';
import {
  ActivityChart,
  AttentionList,
  DocumentNumberList,
  RecentChanges,
  UpcomingHolidays,
  WEEK_DAYS,
  WorkingWeekStrip,
  plural,
  type ActivityPoint,
  type DocumentNumberRow,
  type Figure,
} from '@/components/settings/overview-parts';
import { SettingsPage, SettingsSection } from '@/components/settings/settings-ui';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { useCompanyProfile } from '@/hooks/use-company-profile';
import { useAuthorization } from '@/hooks/useAuthorization';
import { canOpenAccessManagement } from '@/lib/access-control';
import { appearanceAdminRights } from '@/lib/appearance/permissions';
import { COMPANY_PROFILE_RESOURCE } from '@/lib/company-profile';
import { DOCUMENT_SERIES, nextDocumentNumber } from '@/lib/document-numbers';
import { db } from '@/lib/firebase';
import { REPORTING_COPY_RESOURCE, type ReportingCopyRun } from '@/lib/reporting-copy';
import { fetchReportingCopy } from '@/lib/reporting-copy-client';
import { USER_SESSIONS_COLLECTION, type UserSession } from '@/lib/session-manager';
import { inDaysLabel, isoDay, recentDays, settingsChecks, summarizeChecks, upcomingHolidays, type CheckInput } from '@/lib/settings-overview';
import type { Holiday, SerialNumberConfig, WorkingHours } from '@/lib/types';
import { cn } from '@/lib/utils';

// ── Figures ──────────────────────────────────────────────────────────────────────────────────────

/** One figure's load. `null` (no permission) loads nothing and returns `null`. */
function useFigure<T>(load: (() => Promise<T>) | null): Figure<T> | null {
  const [figure, setFigure] = useState<Figure<T>>({ status: 'loading' });
  useEffect(() => {
    if (!load) return;
    let live = true;
    load().then(
      (value) => {
        if (live) setFigure({ status: 'ready', value });
      },
      (error) => {
        console.warn('Settings overview: a figure did not load.', error);
        if (live) setFigure({ status: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [load]);
  return load ? figure : null;
}

/** The figure's text: a dash while it loads or when it failed. */
function shown<T>(figure: Figure<T> | null, format: (value: T) => string): string {
  return figure?.status === 'ready' ? format(figure.value) : '—';
}

const ready = <T,>(figure: Figure<T> | null): T | undefined => (figure?.status === 'ready' ? figure.value : undefined);

const count = (value: number) => value.toLocaleString('en-IN');

/** The modules Settings' own pages write their audit entries under. */
const SETTINGS_LOG_MODULES = ['Settings', 'User Management', 'Session Management'];
const RECENT_CHANGES = 8;
const ACTIVITY_DAYS = 14;
/** A session that has reported in this recently counts as someone online; it reports every 2 minutes in use. */
const ONLINE_WINDOW_MS = 15 * 60_000;

async function loadDepartments() {
  const snapshot = await getDocs(collection(db, 'departments'));
  const active = snapshot.docs.filter((entry) => entry.get('status') === 'Active');
  return {
    total: snapshot.size,
    active: active.length,
    withoutHead: active.filter((entry) => !String(entry.get('head') ?? '').trim()).length,
  };
}

async function loadProjects() {
  const projects = collection(db, 'projects');
  const [total, active] = await Promise.all([
    getCountFromServer(projects),
    getCountFromServer(query(projects, where('status', '==', 'Active'))),
  ]);
  return { total: total.data().count, active: active.data().count };
}

async function loadUsers() {
  const users = collection(db, 'users');
  const weekAgo = Timestamp.fromMillis(Date.now() - 7 * 86_400_000);
  const [total, active, seen] = await Promise.all([
    getCountFromServer(users),
    getCountFromServer(query(users, where('status', '==', 'Active'))),
    getCountFromServer(query(users, where('lastSeen', '>=', weekAgo))),
  ]);
  return { total: total.data().count, active: active.data().count, seenThisWeek: seen.data().count };
}

/** Everyone's open sessions: how many, how many people are active right now, and how many on phones. */
async function loadOpenSessions() {
  const snapshot = await getDocs(query(collection(db, USER_SESSIONS_COLLECTION), where('isActive', '==', true)));
  const sessions = snapshot.docs.map((entry) => entry.data() as UserSession);
  const since = Date.now() - ONLINE_WINDOW_MS;
  const online = new Set(sessions.filter((session) => (session.lastActiveAt?.seconds ?? 0) * 1000 >= since).map((session) => session.userId));
  return { open: sessions.length, online: online.size, phones: sessions.filter((session) => session.deviceType !== 'Desktop').length };
}

async function loadWorkingWeek(): Promise<WorkingHours | null> {
  const snapshot = await getDoc(doc(db, 'settings', 'workingHours'));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  // Older documents hold the days at the top level rather than under `schedule`.
  return (data.schedule ?? data) as WorkingHours;
}

async function loadHolidays(): Promise<Holiday[]> {
  const snapshot = await getDocs(collection(db, 'holidays'));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as Holiday);
}

/** Audit-log actions on each of the last 14 days — one count per day, never the entries themselves. */
async function loadActivity(): Promise<ActivityPoint[]> {
  const logs = collection(db, 'userLogs');
  return Promise.all(
    recentDays(new Date(), ACTIVITY_DAYS).map(async ({ day, start, end }) => {
      const snapshot = await getCountFromServer(
        query(logs, where('timestamp', '>=', Timestamp.fromDate(start)), where('timestamp', '<', Timestamp.fromDate(end))),
      );
      return { day, count: snapshot.data().count };
    }),
  );
}

async function loadRecentChanges(): Promise<AuditLogEntry[]> {
  const snapshot = await getDocs(
    query(collection(db, 'userLogs'), where('module', 'in', SETTINGS_LOG_MODULES), orderBy('timestamp', 'desc'), limit(RECENT_CHANGES)),
  );
  return snapshot.docs.map(toAuditLog);
}

async function loadDocumentNumbers(): Promise<DocumentNumberRow[]> {
  return Promise.all(
    DOCUMENT_SERIES.map(async (series) => {
      const snapshot = await getDoc(doc(db, 'serialNumberConfigs', series.id));
      return { series, config: snapshot.exists() ? (snapshot.data() as SerialNumberConfig) : null };
    }),
  );
}

const loadReportingRun = async (): Promise<ReportingCopyRun | null> => (await fetchReportingCopy()).state.lastRun;

const MODE_LABEL = { light: 'Light', dark: 'Dark', system: 'Follows the device' } as const;

const ATTENTION_ID = 'settings-attention';

// ── The page ─────────────────────────────────────────────────────────────────────────────────────

export default function SettingsOverviewPage() {
  const back = useBackNavigation('/');
  const { user } = useAuth();
  const { can, roleNames } = useAuthorization();
  const { effective, company: appearance, companyKnown } = useAppearance();
  const { profile, loading: profileLoading } = useCompanyProfile();
  // Fixed for the visit: the day the figures are counted for, and "now" for the change feed.
  const [now] = useState(() => Date.now());
  const today = isoDay(new Date(now));
  const weekday = WEEK_DAYS[(new Date(now).getDay() + 6) % 7];

  const userId = user?.id;
  const ownSessionsLoad = useMemo(
    () => (userId
      ? () => getCountFromServer(query(collection(db, USER_SESSIONS_COLLECTION), where('isActive', '==', true), where('userId', '==', userId))).then((snapshot) => snapshot.data().count)
      : null),
    [userId],
  );
  const canCompany = can('View', COMPANY_PROFILE_RESOURCE) || can('Edit', COMPANY_PROFILE_RESOURCE);
  const canDepartments = can('View', 'Settings.Manage Department');
  const canProjects = can('View', 'Settings.Manage Project');
  const canWorkingHours = can('View', 'Settings.Working Hrs');
  const canSerials = can('View', 'Settings.Serial No. Config');
  const canAudit = can('View', 'Settings.Audit Logs') || can('View', 'Settings.User Management') || can('View', 'Settings.Role Management');
  const canReporting = can('View', REPORTING_COPY_RESOURCE);
  const canUsers = canOpenAccessManagement(can);
  const canAllSessions = can('View', 'Settings.Session Management');
  const canThemes = appearanceAdminRights(can).viewThemes;

  const ownSessions = useFigure(ownSessionsLoad);
  const users = useFigure(canUsers ? loadUsers : null);
  const sessions = useFigure(canAllSessions ? loadOpenSessions : null);
  const departments = useFigure(canDepartments ? loadDepartments : null);
  const projects = useFigure(canProjects ? loadProjects : null);
  const week = useFigure(canWorkingHours ? loadWorkingWeek : null);
  const holidays = useFigure(canWorkingHours ? loadHolidays : null);
  const activity = useFigure(canAudit ? loadActivity : null);
  const changes = useFigure(canAudit ? loadRecentChanges : null);
  const numbers = useFigure(canSerials ? loadDocumentNumbers : null);
  const reporting = useFigure(canReporting ? loadReportingRun : null);

  const holidayList = ready(holidays);
  const upcoming = useMemo(() => (holidayList ? upcomingHolidays(holidayList, today, 4) : null), [holidayList, today]);
  const leftThisYear = holidayList?.filter((holiday) => holiday.date >= today && holiday.date.startsWith(today.slice(0, 4))).length;

  // Checks are made once every source they read has answered, so the score never climbs as
  // figures arrive; a source that failed simply makes no check.
  const sources = [numbers, week, holidays, departments, reporting];
  const settled = sources.every((figure) => !figure || figure.status !== 'loading') && (!canCompany || !profileLoading) && (!canThemes || companyKnown);
  const checks = useMemo(() => {
    if (!settled) return null;
    const input: CheckInput = { today };
    const rows = ready(numbers);
    if (rows) {
      input.series = rows.map(({ series, config }) => ({
        id: series.id,
        name: series.name,
        href: series.settingsHref,
        configured: Boolean(config),
        valid: Boolean(config && nextDocumentNumber(series, config)),
      }));
    }
    if (week?.status === 'ready') input.workingWeekSaved = week.value !== null;
    if (holidayList) input.holidayDates = holidayList.map((holiday) => holiday.date);
    const departmentFigure = ready(departments);
    if (departmentFigure) input.departments = departmentFigure;
    if (reporting?.status === 'ready') input.reporting = reporting.value;
    if (canCompany) input.company = { gstins: profile.gstRegistrations.length, pan: Boolean(profile.pan), logo: Boolean(profile.logoUrl) };
    if (canThemes) input.themePublished = appearance.version > 0;
    return settingsChecks(input);
  }, [settled, today, numbers, week, holidayList, departments, reporting, canCompany, profile, canThemes, appearance.version]);
  const health = checks ? summarizeChecks(checks) : null;

  const heroFacts: HeroFact[] = [
    { icon: MonitorSmartphone, label: 'Signed in on', value: ownSessions ? shown(ownSessions, (value) => plural(value, 'device')) : '—' },
    { icon: Palette, label: 'Appearance', value: MODE_LABEL[effective.mode], hint: `${HOME_DESIGN_META[effective.homeDesign].label} home page` },
    ...(upcoming
      ? [{
          icon: CalendarDays,
          label: 'Next holiday',
          value: upcoming[0]?.name ?? 'None scheduled',
          hint: upcoming[0] ? inDaysLabel(upcoming[0].inDays) : undefined,
        }]
      : []),
  ];

  const sessionFigure = ready(sessions);
  // Hints stay short: the grid puts four of these across a phone, two lines each.
  const figures = [
    users && (
      <KpiCard
        key="users"
        label="Users"
        value={shown(users, (value) => count(value.active))}
        hint={shown(users, (value) => `of ${count(value.total)} · ${count(value.seenThisWeek)} this week`)}
        icon={Users}
        tone="indigo"
      />
    ),
    sessions && (
      <KpiCard
        key="online"
        label="Online now"
        value={shown(sessions, (value) => count(value.online))}
        hint={sessionFigure ? `${count(sessionFigure.open)} open · ${count(sessionFigure.phones)} mobile` : undefined}
        icon={Radio}
        tone="emerald"
      />
    ),
    departments && (
      <KpiCard
        key="departments"
        label="Departments"
        value={shown(departments, (value) => count(value.active))}
        hint={shown(departments, (value) => `active of ${count(value.total)}`)}
        icon={Briefcase}
        tone="blue"
      />
    ),
    projects && (
      <KpiCard
        key="projects"
        label="Projects"
        value={shown(projects, (value) => count(value.active))}
        hint={shown(projects, (value) => `active of ${count(value.total)}`)}
        icon={Construction}
        tone="amber"
      />
    ),
    canCompany && (
      <KpiCard key="gst" label="GSTINs" value={count(profile.gstRegistrations.length)} hint={profile.shortName} icon={Receipt} tone="slate" />
    ),
    holidays && (
      <KpiCard
        key="holidays"
        label="Holidays left"
        value={leftThisYear !== undefined ? count(leftThisYear) : '—'}
        hint={`In ${today.slice(0, 4)}`}
        icon={CalendarDays}
        tone="teal"
      />
    ),
  ].filter(Boolean);

  const showAttention = Boolean(health && health.total > 0) || (!settled && sources.some(Boolean));
  const showChanges = Boolean(changes);

  return (
    <SettingsPage>
      <PageHeader
        title="Settings"
        description="Your account and how the company is set up, at a glance."
        icon={Settings2}
        backHref={back.href}
        backLabel={back.label}
        onBackClick={back.onClick}
      />

      <OverviewHero
        name={user?.name ?? ''}
        email={user?.email}
        photoURL={user?.photoURL}
        roles={roleNames.length > 0 ? roleNames : user?.role ? [user.role] : []}
        company={profile.shortName}
        facts={heroFacts}
        health={health}
        attentionId={ATTENTION_ID}
      />

      {figures.length > 0 && <KpiGrid>{figures}</KpiGrid>}

      {(showAttention || showChanges) && (
        <div className={cn('grid grid-cols-1 gap-4', showAttention && showChanges && 'xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:items-start')}>
          {showAttention && (
            <SettingsSection
              id={ATTENTION_ID}
              title="Needs attention"
              icon={ListChecks}
              description={health ? `${health.passing} of ${plural(health.total, 'check')} pass, on the settings you can see.` : 'Checking the set-up…'}
              className="scroll-mt-24"
              flush
            >
              {health && checks ? (
                <AttentionList summary={health} checks={checks} />
              ) : (
                <div className="space-y-3 p-4">
                  {[0, 1, 2].map((row) => <div key={row} className="h-12 animate-pulse rounded-lg bg-muted" />)}
                </div>
              )}
            </SettingsSection>
          )}
          {changes && (
            <SettingsSection title="Recent changes" icon={History} description="The latest entries from Settings, access and sessions in the audit log." flush>
              <RecentChanges figure={changes} now={now} />
            </SettingsSection>
          )}
        </div>
      )}

      {(activity || week) && (
        <div className={cn('grid grid-cols-1 gap-4', activity && week && 'xl:grid-cols-2 xl:items-start')}>
          {activity && (
            <SettingsSection title="Activity" icon={Activity} description={`Actions recorded in the audit log each day, last ${ACTIVITY_DAYS} days.`}>
              <ActivityChart figure={activity} />
            </SettingsSection>
          )}
          {week && (
            <SettingsSection title="Working week" icon={Clock} description="The company's working days and hours, and the holidays coming up.">
              <WorkingWeekStrip figure={week} today={weekday} />
              {holidays && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Upcoming holidays</p>
                  <UpcomingHolidays
                    figure={holidays.status === 'ready' ? { status: 'ready', value: upcoming ?? [] } : holidays}
                  />
                </div>
              )}
            </SettingsSection>
          )}
        </div>
      )}

      {numbers && (
        <SettingsSection title="Next document numbers" icon={Hash} description="What each series hands out next. Each is set in its own module's Settings.">
          <DocumentNumberList figure={numbers} />
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
