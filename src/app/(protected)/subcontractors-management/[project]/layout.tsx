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
 * Using `PmShell` + `PmSidebar` here restyles every screen in the module at once, and leaves each
 * page free to add its own `PmTopbar` and `PmContent`. Navigation targets, the per-project
 * permission scoping and the `all` / print special cases are unchanged.
 */

import * as React from 'react';
import { usePathname, useParams } from 'next/navigation';
import {
  BarChart3,
  Calculator,
  FileText,
  FolderOpen,
  HardHat,
  Users,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { collection, getDocs, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import { projectMatchesSlug } from '@/lib/project-slug';
import { PmShell, PmSidebar, pmAccent } from '@/components/project-management/pm-shell';

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

  const isPrintPage = pathname.includes('/print');
  if (isPrintPage) {
    return <>{children}</>;
  }

  // The "all projects" view spans every project, so a project-scoped rail would be lying.
  if (projectSlug === 'all') {
    return <div className="p-4 sm:p-6 lg:p-8">{children}</div>;
  }

  return (
    <PmShell
      sidebar={
        <PmSidebar
          title="Subcontractors"
          subtitle={currentProject?.projectName || undefined}
          icon={HardHat}
          gradient="from-sky-600 to-blue-600"
          groups={[
            {
              label: 'Screens',
              links: visibleNavItems.map((item, index) => ({
                href: item.href,
                label: item.label,
                icon: item.icon,
                color: pmAccent(index).color,
                bg: pmAccent(index).bg,
                // `Projects` is the module root, so an exact match — otherwise it would light up
                // on every screen beneath it.
                active:
                  item.href === '/subcontractors-management'
                    ? pathname === item.href
                    : pathname.startsWith(item.href),
              })),
            },
          ]}
        />
      }
    >
      {children}
    </PmShell>
  );
}
