'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import {
  ArrowLeftRight, BarChart3, CalendarClock, ClipboardCheck,
  Files, HardHat, History as HistoryIcon, LayoutDashboard, Settings2,
  ShieldCheck, ShieldHalf, Users,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCompanyProfile } from '@/hooks/use-company-profile';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab } from '@/components/shared/module-shell';

/**
 * Personal and project insurance are separate books. `/insurance` asks which one to open, and from
 * then on the sidebar carries only that book's pages, the pages both share (tasks, reports,
 * settings) and a way across to the other book.
 */
type Book = 'personal' | 'project';

/** Premium Due, Maturity Due and the holder master sit outside /insurance/personal but belong to it. */
const PERSONAL_PATTERNS = ['/insurance/dashboard/personal', '/insurance/personal', '/insurance/premium-due', '/insurance/maturity-due', '/insurance/policy-holders'];
const PROJECT_PATTERNS = ['/insurance/dashboard/project', '/insurance/project', '/insurance/settings/assets'];
const PROJECT_LISTS = ['/insurance/project/premium-due', '/insurance/project/all-policies', '/insurance/project/history'];

/** The personal register and the pages a policy opens from it (detail, edit, new), not its history. */
const isPersonalPolicyPage = (p: string) => p.startsWith('/insurance/personal') && !p.startsWith('/insurance/personal/history');
/** The asset register and the pages an asset opens from it, not the renewal, policy or history lists. */
const isProjectAssetPage = (p: string) => p.startsWith('/insurance/project') && !PROJECT_LISTS.some(x => p.startsWith(x));

/** The book a path belongs to, or null for the pages both books share. */
function bookOf(path: string): Book | null {
  if (PERSONAL_PATTERNS.some(p => path.startsWith(p))) return 'personal';
  if (PROJECT_PATTERNS.some(p => path.startsWith(p))) return 'project';
  return null;
}

export default function InsuranceLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const { can } = useAuthorization();
  const { profile } = useCompanyProfile();

  const canModule = can('View Module', 'Insurance');
  const canPersonal = can('View', 'Insurance.Personal Insurance');
  const canProject = can('View', 'Insurance.Project Insurance');
  const canMyTasks = can('View', 'Insurance.My Tasks');
  const canReports = can('View', 'Insurance.Reports');
  const canSettings = can('View', 'Insurance.Settings');

  // A shared page (My Tasks, Reports, Settings) keeps the sidebar of the book it was opened from.
  // Derived state updated while rendering, the way React documents it — no effect, no flash.
  const fallback: Book = canPersonal || !canProject ? 'personal' : 'project';
  const [lastBook, setLastBook] = React.useState<Book | null>(null);
  const pathBook = bookOf(pathname);
  if (pathBook && pathBook !== lastBook) setLastBook(pathBook);
  const book: Book = pathBook ?? lastBook ?? fallback;
  const isPersonal = book === 'personal';

  const groups = React.useMemo<ModuleNavGroup[]>(() => {
    const shared: ModuleNavGroup = {
      id: 'shared',
      label: 'General',
      items: [
        { id: 'my-tasks', href: '/insurance/my-tasks', label: 'My Tasks', icon: ClipboardCheck, tone: 'cyan', visible: canMyTasks },
        { id: 'reports', href: '/insurance/reports', label: 'Reports', icon: BarChart3, tone: 'indigo', visible: canReports },
        { id: 'settings', href: '/insurance/settings', label: 'Settings', icon: Settings2, tone: 'slate', visible: canSettings },
      ],
    };
    const switcher: ModuleNavGroup = {
      id: 'switch',
      label: 'Switch',
      items: [
        isPersonal
          ? { id: 'to-project', href: '/insurance/dashboard/project', label: 'Project Insurance', icon: HardHat, tone: 'emerald', visible: canModule && canProject }
          : { id: 'to-personal', href: '/insurance/dashboard/personal', label: 'Personal Insurance', icon: Users, tone: 'violet', visible: canModule && canPersonal },
        { id: 'chooser', href: '/insurance', label: 'All Sections', icon: ArrowLeftRight, tone: 'slate', match: 'exact', visible: canModule && canPersonal && canProject },
      ],
    };
    const own: ModuleNavGroup = isPersonal
      ? {
          id: 'personal',
          label: 'Personal Insurance',
          items: [
            { id: 'personal-dashboard', href: '/insurance/dashboard/personal', label: 'Dashboard', icon: LayoutDashboard, tone: 'blue', visible: canModule && canPersonal },
            { id: 'personal-policies', href: '/insurance/personal', label: 'Policies', icon: Users, tone: 'violet', visible: canPersonal, match: isPersonalPolicyPage },
            { id: 'personal-premium-due', href: '/insurance/premium-due', label: 'Premium Due', icon: CalendarClock, tone: 'amber', visible: canPersonal },
            { id: 'personal-maturity-due', href: '/insurance/maturity-due', label: 'Maturity Due', icon: ShieldCheck, tone: 'rose', visible: canPersonal },
            { id: 'personal-history', href: '/insurance/personal/history', label: 'History', icon: HistoryIcon, tone: 'slate', visible: canPersonal },
          ],
        }
      : {
          id: 'project',
          label: 'Project Insurance',
          items: [
            { id: 'project-dashboard', href: '/insurance/dashboard/project', label: 'Dashboard', icon: LayoutDashboard, tone: 'teal', visible: canModule && canProject },
            {
              id: 'project-assets', href: '/insurance/project', label: 'Insured Assets', icon: HardHat, tone: 'emerald', visible: canProject,
              match: isProjectAssetPage,
            },
            { id: 'project-premium-due', href: '/insurance/project/premium-due', label: 'Renewals Due', icon: CalendarClock, tone: 'amber', visible: canProject },
            { id: 'project-all-policies', href: '/insurance/project/all-policies', label: 'All Policies', icon: Files, tone: 'teal', visible: canProject },
            { id: 'project-history', href: '/insurance/project/history', label: 'History', icon: HistoryIcon, tone: 'slate', visible: canProject },
          ],
        };
    return [own, shared, switcher];
  }, [isPersonal, canModule, canPersonal, canProject, canMyTasks, canReports, canSettings]);

  // On a phone the rail gives way to the bottom bar: this book's dashboard, register and due list,
  // then the task inbox; "More" holds the rest, including the switch to the other book.
  const bottomTabs: ModuleNavTab[] = isPersonal
    ? [
        ...(canModule && canPersonal ? [{ href: '/insurance/dashboard/personal', label: 'Home', icon: LayoutDashboard }] : []),
        ...(canPersonal ? [{ href: '/insurance/personal', label: 'Policies', icon: Users, match: isPersonalPolicyPage }] : []),
        ...(canPersonal ? [{ href: '/insurance/premium-due', label: 'Due', icon: CalendarClock, ariaLabel: 'Premium due' }] : []),
        ...(canMyTasks ? [{ href: '/insurance/my-tasks', label: 'My Tasks', icon: ClipboardCheck }] : []),
      ]
    : [
        ...(canModule && canProject ? [{ href: '/insurance/dashboard/project', label: 'Home', icon: LayoutDashboard }] : []),
        ...(canProject ? [{ href: '/insurance/project', label: 'Assets', icon: HardHat, ariaLabel: 'Insured assets', match: isProjectAssetPage }] : []),
        ...(canProject ? [{ href: '/insurance/project/premium-due', label: 'Renewals', icon: CalendarClock, ariaLabel: 'Renewals due' }] : []),
        ...(canMyTasks ? [{ href: '/insurance/my-tasks', label: 'My Tasks', icon: ClipboardCheck }] : []),
      ];

  return (
    <ModuleShell
      title="Insurance"
      subtitle={isPersonal ? 'Personal Insurance' : 'Project Insurance'}
      icon={isPersonal ? ShieldHalf : HardHat}
      groups={groups}
      mobileTabs={bottomTabs}
      // The chooser stands alone: no book is open yet, so there is no sidebar to show.
      bare={pathname === '/insurance' || undefined}
      footer={<p className="text-xs text-muted-foreground">Copyright © {new Date().getFullYear()} {profile.shortName}. All Rights Reserved.</p>}
    >
      {children}
    </ModuleShell>
  );
}
