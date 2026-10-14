'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import {
  BadgeCheck,
  Banknote,
  Building2,
  CalendarCheck,
  ClipboardCheck,
  ClipboardList,
  FileSignature,
  FileText,
  FolderKanban,
  Handshake,
  LayoutDashboard,
  ListChecks,
  Plus,
  Settings,
  Sparkles,
  Target,
  UserPlus,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';

/** The permission module name; must match the key in `permissionModules`. */
export const HR_PERMISSION_MODULE = 'HR & Recruitment';

type NavItem = {
  id: string;
  href: string;
  label: string;
  resource: string;
  icon: LucideIcon;
  tone: ModuleNavTone;
  group: string;
  match?: (path: string) => boolean;
};

const dashboardMatch = (path: string) => path === '/hr' || path === '/hr/dashboard';

/**
 * Navigation grouped exactly as spec section 62 lays it out — Manpower, then Recruitment, then
 * Talent, then Reports and Settings — which is also the order a vacancy actually travels.
 */
const navItems: NavItem[] = [
  { id: 'dashboard', href: '/hr', label: 'HR Dashboard', resource: 'Dashboard', icon: LayoutDashboard, tone: 'indigo', group: 'overview', match: dashboardMatch },
  { id: 'tasks', href: '/hr/tasks', label: 'My HR Tasks', resource: 'Dashboard', icon: ListChecks, tone: 'violet', group: 'overview' },

  { id: 'manpower-planning', href: '/hr/manpower/planning', label: 'Manpower Planning', resource: 'Manpower Planning', icon: Target, tone: 'sky', group: 'manpower' },
  { id: 'requirements', href: '/hr/requirements', label: 'Requirement Register', resource: 'Requirements', icon: ClipboardList, tone: 'blue', group: 'manpower' },
  { id: 'approvals', href: '/hr/approvals', label: 'Approval Inbox', resource: 'Approvals', icon: ClipboardCheck, tone: 'amber', group: 'manpower' },
  { id: 'manpower-project', href: '/hr/manpower/project', label: 'Project Manpower', resource: 'Project Manpower', icon: Building2, tone: 'cyan', group: 'manpower' },

  { id: 'candidates', href: '/hr/candidates', label: 'Candidate Database', resource: 'Candidates', icon: Users, tone: 'emerald', group: 'recruitment' },
  { id: 'pipeline', href: '/hr/pipeline', label: 'Recruitment Pipeline', resource: 'Pipeline', icon: FolderKanban, tone: 'teal', group: 'recruitment' },
  // 'My Interviews' sits under the interviews prefix; the shell's most-specific match keeps it apart.
  { id: 'interviews', href: '/hr/interviews', label: 'Interviews', resource: 'Interviews', icon: CalendarCheck, tone: 'fuchsia', group: 'recruitment' },
  { id: 'my-interviews', href: '/hr/interviews/my', label: 'My Interviews', resource: 'My Interviews', icon: UserRound, tone: 'purple', group: 'recruitment' },
  { id: 'selection', href: '/hr/selection', label: 'Selection', resource: 'Selection', icon: BadgeCheck, tone: 'lime', group: 'recruitment' },
  { id: 'offers', href: '/hr/offers', label: 'Offers', resource: 'Offers', icon: FileSignature, tone: 'orange', group: 'recruitment' },
  { id: 'pre-joining', href: '/hr/pre-joining', label: 'Pre-Joining', resource: 'Pre-Joining', icon: FileText, tone: 'rose', group: 'recruitment' },
  { id: 'joining', href: '/hr/joining', label: 'Joining', resource: 'Joining', icon: UserPlus, tone: 'green', group: 'recruitment' },

  { id: 'talent-pool', href: '/hr/talent-pool', label: 'Talent Pool', resource: 'Talent Pool', icon: Sparkles, tone: 'yellow', group: 'talent' },
  { id: 'referrals', href: '/hr/referrals', label: 'Employee Referrals', resource: 'Referrals', icon: Handshake, tone: 'pink', group: 'talent' },
  { id: 'agencies', href: '/hr/agencies', label: 'Recruitment Agencies', resource: 'Agencies', icon: Banknote, tone: 'slate', group: 'talent' },

  { id: 'reports', href: '/hr/reports', label: 'Reports', resource: 'Reports', icon: FileText, tone: 'stone', group: 'reports' },
  { id: 'settings', href: '/hr/settings', label: 'Settings', resource: 'Settings', icon: Settings, tone: 'zinc', group: 'settings' },
];

/** Headings for each `group`, in the sidebar and in the phone's "More" pop-up. */
const GROUP_LABELS: Record<string, string> = {
  overview: 'Overview',
  manpower: 'Manpower',
  recruitment: 'Recruitment',
  talent: 'Talent',
  reports: 'Reports',
  settings: 'Settings',
};
const GROUP_ORDER = ['overview', 'manpower', 'recruitment', 'talent', 'reports', 'settings'];

/**
 * Two screens are open to anyone who can see the module, for the same reason the travel module opens
 * "My Travel" to everyone: an interviewer has to reach their own feedback form and an employee has to
 * reach the referral form (spec sections 25, 46), and those are exactly the people a
 * recruitment-register permission would never be granted to.
 */
const ALWAYS_VISIBLE = ['/hr/interviews/my', '/hr/referrals'];

function matchesPath(pathname: string, href: string) {
  if (href === '/hr') return dashboardMatch(pathname);
  // 'My Interviews' sits under the interviews prefix, so the parent must not swallow it.
  if (href === '/hr/interviews') return pathname === href || /^\/hr\/interviews\/(?!my)/.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function HrLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname || '';
  const { can, isLoading: authLoading } = useAuthorization();

  const visibleItems = useMemo(
    () =>
      navItems.filter(item => {
        if (item.href === '/hr' || ALWAYS_VISIBLE.includes(item.href)) return true;
        return can('View', `${HR_PERMISSION_MODULE}.${item.resource}`);
      }),
    [can],
  );

  const groups = useMemo<ModuleNavGroup[]>(
    () =>
      GROUP_ORDER.map(group => ({
        id: group,
        label: GROUP_LABELS[group],
        items: navItems
          .filter(item => item.group === group)
          .map(item => ({
            id: item.id,
            href: item.href,
            label: item.label,
            icon: item.icon,
            tone: item.tone,
            match: item.match,
            visible: visibleItems.includes(item),
          })),
      })),
    [visibleItems],
  );

  const canViewModule = can('View Module', HR_PERMISSION_MODULE);
  const currentPageAllowed =
    // The requirement wizard and the workspace sit under routes the register permission covers by
    // prefix; 'My HR Tasks' is a view of work the user already has permission to act on.
    safePathname === '/hr/tasks' ||
    ALWAYS_VISIBLE.some(href => safePathname.startsWith(href)) ||
    visibleItems.some(item => matchesPath(safePathname, item.href));

  // The phone's bottom bar: the day-to-day screens, raising a requirement in the middle, and
  // "More" opening the bar's pop-up of every visible page. Each tab only if its sidebar entry is
  // visible too.
  const isVisible = (href: string) => visibleItems.some(item => item.href === href);
  const bottomTabs: ModuleNavTab[] = [
    { href: '/hr', label: 'Home', icon: LayoutDashboard, match: dashboardMatch },
    ...(isVisible('/hr/tasks') ? [{ href: '/hr/tasks', label: 'My Tasks', icon: ListChecks }] : []),
    ...(can('Add', `${HR_PERMISSION_MODULE}.Requirements`)
      ? [{ href: '/hr/requirements/new', label: 'New', icon: Plus, emphasized: true, ariaLabel: 'New manpower requirement' }]
      : []),
    ...(isVisible('/hr/approvals') ? [{ href: '/hr/approvals', label: 'Approvals', icon: ClipboardCheck }] : []),
  ];

  return (
    // `hr-module-root` carries the module's mobile rules (44px tap targets, scrollable tab strips,
    // safe-area padding, compact card padding) — see globals.css.
    <div className="hr-theme hr-module-root w-full">
      <ModuleShell
        title="HR & Recruitment"
        subtitle="Manpower & Recruitment Control"
        icon={Users}
        groups={groups}
        mobileTabs={bottomTabs}
        gate={{
          loading: authLoading,
          allowed: canViewModule,
          pageAllowed: currentPageAllowed,
          pageDeniedMessage: 'You do not have permission to view this page.',
        }}
      >
        {children}
      </ModuleShell>
    </div>
  );
}
