'use client';

/**
 * The Master Drawing List's frame, on the shared module shell: sidebar on a desktop, header card and
 * bottom bar on a phone, like every other module.
 *
 * Access is decided by the server: the shell loads `/api/master-drawing-list/lookups`, which refuses
 * a user without the module and returns their permissions with project scope applied. A page is
 * listed only when its permission is held, and a page reached by URL without it is refused here as
 * well as by its API.
 */

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { CalendarDays, DraftingCompass, FileBarChart2, FileUp, GanttChart, ListTodo, Plus, Settings2, ShieldAlert, Table2, type LucideIcon } from 'lucide-react';

import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { MdlResource } from '@/lib/master-drawing-list/access';

import { MdlProvider, useMdl } from './mdl-client';

export const MDL_BASE = '/master-drawing-list';

type NavItem = { href: string; label: string; resource: MdlResource; action: string; icon: LucideIcon; tone: ModuleNavTone; group: string };

// The five views of Project Management's MDL page, each a page here (Reports first: the module
// opens on its figures), then the module's own data pages.
const NAV: NavItem[] = [
  { href: MDL_BASE, label: 'Reports', resource: 'Drawings', action: 'View', icon: FileBarChart2, tone: 'blue', group: 'views' },
  { href: `${MDL_BASE}/pending`, label: 'Pending Tasks', resource: 'Drawings', action: 'View', icon: ListTodo, tone: 'rose', group: 'views' },
  { href: `${MDL_BASE}/register`, label: 'Register', resource: 'Drawings', action: 'View', icon: Table2, tone: 'sky', group: 'views' },
  { href: `${MDL_BASE}/calendar`, label: 'Workplan Calendar', resource: 'Drawings', action: 'View', icon: CalendarDays, tone: 'violet', group: 'views' },
  { href: `${MDL_BASE}/gantt`, label: 'Gantt Chart', resource: 'Drawings', action: 'View', icon: GanttChart, tone: 'orange', group: 'views' },
  { href: `${MDL_BASE}/import`, label: 'Excel Import', resource: 'Import', action: 'View', icon: FileUp, tone: 'indigo', group: 'data' },
  { href: `${MDL_BASE}/settings`, label: 'Settings', resource: 'Settings', action: 'View', icon: Settings2, tone: 'slate', group: 'data' },
];

const GROUP_LABELS: Record<string, string> = { views: 'MDL Views', data: 'Data & Settings' };

const matchesPath = (pathname: string, href: string) => (href === MDL_BASE ? pathname === MDL_BASE : pathname === href || pathname.startsWith(`${href}/`));

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const { lookups, loading, error, reload, can } = useMdl();

  const navItems = useMemo(() => (lookups ? NAV.filter((item) => can(item.resource, item.action)) : []), [can, lookups]);
  const groups = useMemo<ModuleNavGroup[]>(() => {
    const list: ModuleNavGroup[] = [];
    for (const item of navItems) {
      let group = list.find((entry) => entry.id === item.group);
      if (!group) {
        group = { id: item.group, label: GROUP_LABELS[item.group], items: [] };
        list.push(group);
      }
      group.items.push({ id: item.href, label: item.label, href: item.href, icon: item.icon, tone: item.tone, match: (path: string) => matchesPath(path, item.href) });
    }
    return list;
  }, [navItems]);

  if (!lookups && !loading) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardContent className="space-y-3 py-14 text-center">
            <ShieldAlert className="mx-auto h-12 w-12 text-destructive" aria-hidden="true" />
            <p className="font-semibold text-slate-800">The Master Drawing List is not available</p>
            <p className="text-sm text-muted-foreground">{error ?? 'You do not have access to the Master Drawing List.'}</p>
            <p className="mx-auto max-w-xl text-sm text-muted-foreground">
              An administrator grants it in Settings › Access Management, on the role or the user: Master Drawing List · View Module, then Drawings (View, Add, Edit, Delete,
              Export), Import (View, Import), Settings (View, Manage) and All Projects · View as needed.
            </p>
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pageAllowed = navItems.some((item) => matchesPath(pathname, item.href));
  const isVisible = (href: string) => navItems.some((item) => item.href === href);
  const mobileTabs: ModuleNavTab[] = [
    ...(isVisible(MDL_BASE) ? [{ href: MDL_BASE, label: 'Reports', icon: FileBarChart2, match: (path: string) => path === MDL_BASE }] : []),
    ...(isVisible(`${MDL_BASE}/pending`) ? [{ href: `${MDL_BASE}/pending`, label: 'Pending', icon: ListTodo }] : []),
    ...(can('Drawings', 'Add') ? [{ href: `${MDL_BASE}/register?add=1`, label: 'Add', icon: Plus, emphasized: true, ariaLabel: 'Add a drawing item' }] : []),
    ...(isVisible(`${MDL_BASE}/register`) ? [{ href: `${MDL_BASE}/register`, label: 'Register', icon: Table2 }] : []),
  ];
  const subtitle = !lookups
    ? 'Drawing approvals'
    : lookups.allProjects
      ? 'All projects'
      : `${lookups.projects.length} project${lookups.projects.length === 1 ? '' : 's'}`;

  return (
    <ModuleShell
      title="Master Drawing List"
      subtitle={subtitle}
      icon={DraftingCompass}
      groups={groups}
      mobileTabs={mobileTabs}
      gate={{
        loading: loading && !lookups,
        allowed: true,
        pageAllowed,
        pageDeniedMessage: 'You do not have permission to view this Master Drawing List page.',
      }}
    >
      <div className="space-y-4">{children}</div>
    </ModuleShell>
  );
}

export default function MdlLayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <MdlProvider>
      <Shell>{children}</Shell>
    </MdlProvider>
  );
}
