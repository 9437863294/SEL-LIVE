'use client';

/**
 * Settings › Overview, the module's landing page: figures from each part of Settings the person may
 * open. It is not a second menu — the sidebar (and the phone's bar) is the menu, so this page has
 * no link cards. Each figure loads on its own and shows a dash when its source fails, so one slow
 * or refused read never holds up the rest. The drawing is in `overview-parts.tsx`.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getCountFromServer, getDoc, getDocs, query, Timestamp, where } from 'firebase/firestore';
import {
  Activity, Briefcase, CalendarDays, Clock, Construction, DatabaseZap, Hash, MonitorSmartphone, Palette, Receipt, Settings2,
} from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAppearance } from '@/components/theme/ThemeProvider';
import { HOME_DESIGN_META } from '@/components/home/home-designs';
import { KpiCard, KpiGrid } from '@/components/shared/kpi-card';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import {
  DocumentNumberList,
  OverviewAccount,
  WorkingWeekStrip,
  plural,
  type DocumentNumberRow,
  type Figure,
} from '@/components/settings/overview-parts';
import { SettingsPage, SettingsSection } from '@/components/settings/settings-ui';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { useCompanyProfile } from '@/hooks/use-company-profile';
import { useAuthorization } from '@/hooks/useAuthorization';
import { COMPANY_PROFILE_RESOURCE } from '@/lib/company-profile';
import { DOCUMENT_SERIES } from '@/lib/document-numbers';
import { db } from '@/lib/firebase';
import { REPORTING_COPY_RESOURCE, type ReportingCopyRun } from '@/lib/reporting-copy';
import { fetchReportingCopy } from '@/lib/reporting-copy-client';
import { USER_SESSIONS_COLLECTION } from '@/lib/session-manager';
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

const count = (value: number) => value.toLocaleString('en-IN');

async function loadDepartments() {
  const snapshot = await getDocs(collection(db, 'departments'));
  const statuses = snapshot.docs.map((entry) => entry.get('status'));
  return { total: statuses.length, active: statuses.filter((status) => status === 'Active').length };
}

async function loadProjects() {
  const projects = collection(db, 'projects');
  const [total, active] = await Promise.all([
    getCountFromServer(projects),
    getCountFromServer(query(projects, where('status', '==', 'Active'))),
  ]);
  return { total: total.data().count, active: active.data().count };
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

async function countAuditToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const snapshot = await getCountFromServer(query(collection(db, 'userLogs'), where('timestamp', '>=', Timestamp.fromDate(start))));
  return snapshot.data().count;
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

const RUN_LABEL: Record<ReportingCopyRun['status'], string> = {
  succeeded: 'Up to date',
  failed: 'Failed',
  stopped: 'Stopped',
  running: 'Refreshing',
};

/** "YYYY-MM-DD" for today in this browser — the form holiday dates are stored in. */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function holidayDate(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const date = parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

const MODE_LABEL = { light: 'Light', dark: 'Dark', system: 'Follows the device' } as const;

// ── The page ─────────────────────────────────────────────────────────────────────────────────────

export default function SettingsOverviewPage() {
  const back = useBackNavigation('/');
  const { user } = useAuth();
  const { can, roleNames } = useAuthorization();
  const { effective } = useAppearance();
  const { profile } = useCompanyProfile();

  const userId = user?.id;
  const sessionsLoad = useMemo(
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

  const sessions = useFigure(sessionsLoad);
  const departments = useFigure(canDepartments ? loadDepartments : null);
  const projects = useFigure(canProjects ? loadProjects : null);
  const week = useFigure(canWorkingHours ? loadWorkingWeek : null);
  const holidays = useFigure(canWorkingHours ? loadHolidays : null);
  const auditToday = useFigure(canAudit ? countAuditToday : null);
  const numbers = useFigure(canSerials ? loadDocumentNumbers : null);
  const reporting = useFigure(canReporting ? loadReportingRun : null);

  const upcoming = useMemo(() => {
    if (holidays?.status !== 'ready') return null;
    const today = todayIso();
    const year = today.slice(0, 4);
    const ahead = holidays.value.filter((holiday) => holiday.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    return { next: ahead[0] ?? null, leftThisYear: ahead.filter((holiday) => holiday.date.startsWith(year)).length };
  }, [holidays]);

  const reportingRun = reporting?.status === 'ready' ? reporting.value : null;

  const figures = [
    canCompany && (
      <KpiCard key="gst" label="GSTINs" value={count(profile.gstRegistrations.length)} hint={profile.shortName} icon={Receipt} tone="slate" />
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
    holidays && (
      <KpiCard
        key="holidays"
        label="Holidays left"
        value={upcoming ? count(upcoming.leftThisYear) : '—'}
        hint={upcoming ? (upcoming.next ? `Next: ${upcoming.next.name}` : 'None scheduled') : undefined}
        icon={CalendarDays}
        tone="teal"
      />
    ),
    auditToday && (
      <KpiCard key="audit" label="Actions today" value={shown(auditToday, count)} hint="In the audit log" icon={Activity} tone="violet" />
    ),
    reporting && (
      <KpiCard
        key="reporting"
        label="Reporting copy"
        value={reporting.status === 'ready' ? (reportingRun ? RUN_LABEL[reportingRun.status] : 'Not run yet') : '—'}
        hint={reportingRun ? new Date(reportingRun.finishedAt ?? reportingRun.startedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : undefined}
        icon={DatabaseZap}
        tone={reportingRun?.status === 'failed' ? 'rose' : reportingRun?.status === 'succeeded' ? 'emerald' : 'cyan'}
      />
    ),
  ].filter(Boolean);

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

      <OverviewAccount
        name={user?.name ?? ''}
        email={user?.email}
        photoURL={user?.photoURL}
        roles={roleNames.length > 0 ? roleNames : user?.role ? [user.role] : []}
        facts={[
          { icon: MonitorSmartphone, label: 'Signed in on', value: sessions ? shown(sessions, (value) => plural(value, 'device')) : '—' },
          { icon: Palette, label: 'Appearance', value: MODE_LABEL[effective.mode], hint: `${HOME_DESIGN_META[effective.homeDesign].label} home page` },
        ]}
      />

      {figures.length > 0 && (
        <section aria-labelledby="settings-overview-company" className="min-w-0">
          <SectionHeader title={<span id="settings-overview-company">Company set-up</span>} />
          <KpiGrid>{figures}</KpiGrid>
        </section>
      )}

      {(week || numbers) && (
        <div className={cn('grid grid-cols-1 gap-4', week && numbers && 'xl:grid-cols-2')}>
          {week && (
            <SettingsSection
              title="Working week"
              icon={Clock}
              description={upcoming?.next ? `Next holiday: ${upcoming.next.name}, ${holidayDate(upcoming.next.date)}.` : undefined}
            >
              <WorkingWeekStrip figure={week} />
            </SettingsSection>
          )}
          {numbers && (
            <SettingsSection title="Next document numbers" icon={Hash} description="What each series hands out next.">
              <DocumentNumberList figure={numbers} />
            </SettingsSection>
          )}
        </div>
      )}
    </SettingsPage>
  );
}
