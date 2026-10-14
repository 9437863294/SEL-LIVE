'use client';

/**
 * Subcontractors Management chrome, built from Project Management's shell.
 *
 * The module previously carried its own fixed collapsible rail — a different width, a different
 * active state, its own collapse control and a copyright footer none of the Project Management
 * screens have. Sitting next to Supply or Civil it read as a different application, which is
 * exactly what it is not: work orders and subcontractor billing measure the same civil BOQ lines
 * the JMC lane certifies.
 *
 * It now sits on the shared `ModuleShell`, like every other module, so its sidebar, phone header
 * and bottom bar read the same as the rest of the application. Pages keep the Project Management
 * kit (`PmContent`, `PmNavCard`…), which `PmInModuleShell` tells not to pad a second time.
 * Navigation targets, the per-project permission scoping and the `all` / print special cases are
 * unchanged.
 */

import * as React from 'react';
import { usePathname, useParams } from 'next/navigation';
import {
  BarChart3,
  Calculator,
  FileText,
  FolderOpen,
  HardHat,
  LayoutDashboard,
  Plus,
  Users,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { collection, getDocs, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import { projectMatchesSlug } from '@/lib/project-slug';
import { PmInModuleShell } from '@/components/project-management/pm-shell';
import {
  ModuleShell,
  type ModuleNavGroup,
  type ModuleNavTab,
  type ModuleNavTone,
} from '@/components/shared/module-shell';

/** The accents the PM sidebar gave these rows by position (`pmAccent`). */
const TONES: ModuleNavTone[] = ['emerald', 'sky', 'violet', 'amber', 'rose', 'cyan', 'orange'];

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const projectSlug = params.project as string;
  const pathname = usePathname();
  const { can } = useAuthorization();
  const [currentProject, setCurrentProject] = React.useState<Project | null>(null);

  React.useEffect(() => {
    const fetchProject = async () => {
      if (!projectSlug || projectSlug === 'all') {
        setCurrentProject(null);
        return;
      }
      const projectsQuery = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const projectData = projectsSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as Project))
        .find((p) => projectMatchesSlug(p.projectName, projectSlug));
      setCurrentProject(projectData || null);
    };
    fetchProject();
  }, [projectSlug]);

  // Rights here are scoped to the global project id, as they always were.
  const projectId = currentProject?.id || '';

  const navItems = [
    {
      href: `/subcontractors-management`,
      icon: FolderOpen,
      label: 'Projects',
      permission: can('View Module', 'Subcontractors Management'),
      // The module root: in the bottom bar's pop-up it must not light up on every screen under it.
      exact: true,
    },
    {
      href: `/subcontractors-management/${projectSlug}/manage`,
      icon: Users,
      label: 'Manage',
      permission: can('View', 'Subcontractors Management.Manage Subcontractors', projectId),
    },
    {
      href: `/subcontractors-management/${projectSlug}/work-order`,
      icon: FileText,
      label: 'Work Order',
      permission: can('View', 'Subcontractors Management.Work Order', projectId),
    },
    {
      href: `/subcontractors-management/${projectSlug}/billing`,
      icon: Calculator,
      label: 'Billing',
      permission: can('View', 'Subcontractors Management.Billing', projectId),
    },
    {
      href: `/subcontractors-management/${projectSlug}/reports`,
      icon: BarChart3,
      label: 'Reports',
      permission: can('View', 'Subcontractors Management.Reports', projectId),
    },
  ];

  const visibleNavItems = navItems.filter((item) => item.permission);

  // The phone's bottom bar: the project's dashboard, its work orders and bills, raising a bill in
  // the middle, and "More" opening the bar's pop-up of the sidebar's screens. Each tab only if the
  // sidebar shows it.
  const projectBase = `/subcontractors-management/${projectSlug}`;
  const isVisible = (href: string) => visibleNavItems.some((item) => item.href === href);
  const bottomTabs: ModuleNavTab[] = [
    // The dashboard every screen's back button returns to, on the same right its page checks.
    ...(can('View Module', 'Subcontractors Management', projectId)
      ? [{ href: projectBase, label: 'Home', icon: LayoutDashboard, exact: true }]
      : []),
    ...(isVisible(`${projectBase}/work-order`)
      ? [{ href: `${projectBase}/work-order`, label: 'Orders', icon: FileText, ariaLabel: 'Work orders' }]
      : []),
    // Scoped exactly as the Billing screen's own "Bill Entry" tile is.
    ...(isVisible(`${projectBase}/billing`) && can('Create Bill', 'Subcontractors Management.Billing', projectSlug)
      ? [{ href: `${projectBase}/billing/create`, label: 'New', icon: Plus, emphasized: true, ariaLabel: 'New subcontractor bill' }]
      : []),
    ...(isVisible(`${projectBase}/billing`)
      ? [{ href: `${projectBase}/billing`, label: 'Billing', icon: Calculator }]
      : []),
  ];

  const groups = React.useMemo<ModuleNavGroup[]>(
    () => [
      {
        id: 'screens',
        items: navItems.map((item, index) => ({
          id: item.href,
          href: item.href,
          label: item.label,
          icon: item.icon,
          tone: TONES[index % TONES.length],
          visible: item.permission,
          // `Projects` is the module root, so an exact match — otherwise it would light up on
          // every screen beneath it.
          match: item.exact ? ('exact' as const) : ('prefix' as const),
        })),
      },
    ],
    // `navItems` is rebuilt every render from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, projectSlug, projectId],
  );

  // The "all projects" view spans every project, so a project-scoped rail would be lying. Print
  // routes render bare (the shell's own rule; checked first here, as before).
  if (projectSlug === 'all' && !pathname.includes('/print')) {
    return <div className="p-4 sm:p-6 lg:p-8">{children}</div>;
  }

  return (
    <ModuleShell
      title="Subcontractors"
      subtitle={currentProject?.projectName || undefined}
      icon={HardHat}
      groups={groups}
      mobileTabs={bottomTabs}
    >
      <PmInModuleShell>{children}</PmInModuleShell>
    </ModuleShell>
  );
}
