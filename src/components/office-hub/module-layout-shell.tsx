'use client';

/**
 * The module's chrome, on the shared `ModuleShell`: sidebar on a desktop; on a phone, the floating
 * bottom bar, whose "More" opens the same grouped pop-up of pages every module uses (§53, §54).
 *
 * Two behaviours worth knowing:
 *
 *   • **A print route gets the page to itself.** The shell drops its chrome on `/print`, and the
 *     gate is skipped there too, so the printed minutes never wait on (or are wrapped by) the
 *     module's own loading or access screens — the print page checks its own access.
 *
 *   • **The nav is gated, and the guide never is.** A user who cannot find anything is exactly the
 *     user who needs the guide, so it renders for everyone with access to the module.
 */

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  FileText,
  Gauge,
  Gavel,
  LayoutTemplate,
  ListTodo,
  Plus,
  Search,
  Settings,
  Upload,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';
import { OFFICE_HUB_BASE_PATH } from '@/lib/office-hub';
import { OfficeHubProvider, useOfficeHub } from './hooks';
import { OfficeHubErrorBoundary } from './error-boundary';
import { OfficeHubCommandPalette } from './global-search';

type Gate =
  | 'always'
  | 'dashboard'
  | 'calendar'
  | 'meetings'
  | 'tasks'
  | 'teams'
  | 'decisions'
  | 'actionItems'
  | 'employees'
  | 'reports'
  | 'workload'
  | 'overview'
  | 'templates'
  | 'settings'
  | 'import';

type Group = 'work' | 'registers' | 'insight' | 'config';

const SECTIONS: { id: string; href: string; label: string; icon: LucideIcon; tone: ModuleNavTone; group: Group; gate: Gate }[] = [
  { id: 'dashboard', href: OFFICE_HUB_BASE_PATH, label: 'Dashboard', icon: Gauge, tone: 'sky', group: 'work', gate: 'dashboard' },
  { id: 'calendar', href: `${OFFICE_HUB_BASE_PATH}/calendar`, label: 'Calendar', icon: CalendarDays, tone: 'indigo', group: 'work', gate: 'calendar' },
  { id: 'meetings', href: `${OFFICE_HUB_BASE_PATH}/meetings`, label: 'Meetings', icon: ClipboardList, tone: 'violet', group: 'work', gate: 'meetings' },
  { id: 'tasks', href: `${OFFICE_HUB_BASE_PATH}/tasks`, label: 'Tasks', icon: ListTodo, tone: 'emerald', group: 'work', gate: 'tasks' },

  { id: 'decisions', href: `${OFFICE_HUB_BASE_PATH}/decisions`, label: 'Decision Register', icon: Gavel, tone: 'amber', group: 'registers', gate: 'decisions' },
  { id: 'action-items', href: `${OFFICE_HUB_BASE_PATH}/action-items`, label: 'Action Items', icon: CheckSquare, tone: 'teal', group: 'registers', gate: 'actionItems' },
  { id: 'teams', href: `${OFFICE_HUB_BASE_PATH}/teams`, label: 'Teams', icon: Users, tone: 'fuchsia', group: 'registers', gate: 'teams' },
  { id: 'employees', href: `${OFFICE_HUB_BASE_PATH}/employees`, label: 'Employees', icon: UserRound, tone: 'cyan', group: 'registers', gate: 'employees' },

  { id: 'reports', href: `${OFFICE_HUB_BASE_PATH}/reports`, label: 'Reports', icon: BarChart3, tone: 'blue', group: 'insight', gate: 'reports' },
  { id: 'workload', href: `${OFFICE_HUB_BASE_PATH}/workload`, label: 'Workload', icon: FileText, tone: 'orange', group: 'insight', gate: 'workload' },
  { id: 'overview', href: `${OFFICE_HUB_BASE_PATH}/overview`, label: 'Management Overview', icon: Gauge, tone: 'rose', group: 'insight', gate: 'overview' },
  { id: 'search', href: `${OFFICE_HUB_BASE_PATH}/search`, label: 'Search', icon: Search, tone: 'slate', group: 'insight', gate: 'always' },

  { id: 'templates', href: `${OFFICE_HUB_BASE_PATH}/templates`, label: 'Templates', icon: LayoutTemplate, tone: 'indigo', group: 'config', gate: 'templates' },
  { id: 'import', href: `${OFFICE_HUB_BASE_PATH}/import`, label: 'Import Employees', icon: Upload, tone: 'emerald', group: 'config', gate: 'import' },
  { id: 'settings', href: `${OFFICE_HUB_BASE_PATH}/settings`, label: 'Settings', icon: Settings, tone: 'slate', group: 'config', gate: 'settings' },
  { id: 'help', href: `${OFFICE_HUB_BASE_PATH}/help`, label: 'Guide', icon: BookOpen, tone: 'amber', group: 'config', gate: 'always' },
];

const GROUP_LABELS: Record<Group, string> = {
  work: 'My Work',
  registers: 'Registers',
  insight: 'Insight',
  config: 'Configuration',
};

export default function OfficeHubLayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <OfficeHubProvider>
      <OfficeHubLayoutShellInner>{children}</OfficeHubLayoutShellInner>
    </OfficeHubProvider>
  );
}

function OfficeHubLayoutShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const { capabilities, isLoading } = useOfficeHub();

  const gates = useMemo<Record<Gate, boolean>>(
    () => ({
      always: true,
      dashboard: capabilities.canViewDashboard,
      calendar: capabilities.canViewCalendar,
      meetings: capabilities.canViewMeetings,
      tasks: capabilities.canViewTasks,
      teams: capabilities.canViewTeams,
      decisions: capabilities.canViewDecisions,
      actionItems: capabilities.canViewActionItems,
      employees: capabilities.canViewEmployees,
      reports: capabilities.canViewReports,
      workload: capabilities.canViewWorkload,
      overview: capabilities.canViewManagementOverview,
      templates: capabilities.canViewTemplates,
      settings: capabilities.canViewSettings,
      import: capabilities.canImportEmployees,
    }),
    [capabilities],
  );

  const groups = useMemo<ModuleNavGroup[]>(
    () =>
      (Object.keys(GROUP_LABELS) as Group[]).map((group) => ({
        id: group,
        label: GROUP_LABELS[group],
        // Detail routes match by prefix; the dashboard, first, is exact-match only.
        items: SECTIONS.filter((section) => section.group === group).map((section) => ({ ...section, visible: gates[section.gate] })),
      })),
    [gates],
  );

  // The phone's bottom bar: the dashboard, the two working registers either side of scheduling a
  // meeting (or, for someone who may only raise tasks, a new task), and "More" opening the bar's
  // pop-up of every page. Each register tab only if its sidebar entry is visible; the create tab
  // on the same capability its page checks.
  const isAvailable = (href: string) => SECTIONS.some((section) => section.href === href && gates[section.gate]);
  const createTab: ModuleNavTab | null = capabilities.canCreateMeeting
    ? { href: `${OFFICE_HUB_BASE_PATH}/meetings/new`, label: 'New', icon: Plus, emphasized: true, ariaLabel: 'Schedule a meeting' }
    : capabilities.canCreateTask
      ? { href: `${OFFICE_HUB_BASE_PATH}/tasks/new`, label: 'New', icon: Plus, emphasized: true, ariaLabel: 'New task' }
      : null;
  const mobileTabs: ModuleNavTab[] = [
    ...(isAvailable(OFFICE_HUB_BASE_PATH) ? [{ href: OFFICE_HUB_BASE_PATH, label: 'Home', icon: Gauge, exact: true }] : []),
    ...(isAvailable(`${OFFICE_HUB_BASE_PATH}/meetings`)
      ? [{ href: `${OFFICE_HUB_BASE_PATH}/meetings`, label: 'Meetings', icon: ClipboardList }]
      : []),
    ...(createTab ? [createTab] : []),
    ...(isAvailable(`${OFFICE_HUB_BASE_PATH}/tasks`) ? [{ href: `${OFFICE_HUB_BASE_PATH}/tasks`, label: 'Tasks', icon: ListTodo }] : []),
  ];

  return (
    <ModuleShell
      title="Office Hub"
      subtitle="Meet · Decide · Assign"
      icon={CalendarDays}
      groups={groups}
      mobileTabs={mobileTabs}
      headerActions={<OfficeHubCommandPalette />}
      gate={
        pathname.includes('/print')
          ? undefined
          : {
              loading: isLoading,
              allowed: capabilities.canViewModule,
              deniedMessage: 'You do not have permission to access Office Hub. Contact your administrator to request access.',
            }
      }
    >
      {/*
        One boundary per module rather than per page: a render failure inside a register should
        leave the nav usable so the user can go somewhere else, which a boundary at the page
        level cannot do (§2's error-boundary requirement).
      */}
      <OfficeHubErrorBoundary>{children}</OfficeHubErrorBoundary>
    </ModuleShell>
  );
}
