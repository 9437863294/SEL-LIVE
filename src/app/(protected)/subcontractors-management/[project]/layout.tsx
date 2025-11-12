
'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import {
  Users,
  FileText,
  Calculator,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuthorization } from '@/hooks/useAuthorization';
import { collection, getDocs, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = React.useState(false);
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
      };
      const projectsQuery = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
      const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);
      setCurrentProject(projectData || null);
    };
    fetchProject();
  }, [projectSlug]);

  const projectId = currentProject?.id || '';

  const navItems = [
    { href: `/subcontractors-management`, icon: FolderOpen, label: 'Projects', permission: can('View Module', 'Subcontractors Management')},
    { href: `/subcontractors-management/${projectSlug}/manage`, icon: Users, label: 'Manage', permission: can('View', 'Subcontractors Management.Manage Subcontractors') },
    { href: `/subcontractors-management/${projectSlug}/work-order`, icon: FileText, label: 'Work Order', permission: can('View', 'Subcontractors Management.Work Order') },
    { href: `/subcontractors-management/${projectSlug}/billing`, icon: Calculator, label: 'Billing', permission: can('View', 'Subcontractors Management.Billing') },
    { href: `/subcontractors-management/${projectSlug}/reports`, icon: BarChart3, label: 'Reports', permission: can('View', 'Subcontractors Management.Reports') },
  ];
  
  const visibleNavItems = navItems.filter(item => item.permission);
  
  const isPrintPage = pathname.includes('/print');
  if (isPrintPage) {
    return <>{children}</>;
  }

  // If we are on the "all" projects page, we don't need a sidebar, just the main content.
  if (projectSlug === 'all') {
    return <div className="p-4 sm:p-6 lg:p-8">{children}</div>;
  }

  return (
    <div className="flex w-full h-full">
      <aside 
        className={cn(
            "fixed left-0 top-16 h-[calc(100vh-4rem)] z-40 flex flex-col border-r bg-background transition-all duration-300",
            isExpanded ? "w-56" : "w-16"
        )}
      >
        <TooltipProvider delayDuration={0}>
          <div className="flex-1 p-2">
            <nav className="flex flex-col gap-1">
              {visibleNavItems.map((item) => (
                <Tooltip key={item.label}>
                    <TooltipTrigger asChild>
                       <Link href={item.href}>
                         <Button
                            variant={pathname.startsWith(item.href) ? 'secondary' : 'ghost'}
                            className={cn(
                                "w-full justify-start",
                                !isExpanded && "h-10 w-10 p-0"
                            )}
                         >
                            <div className={cn("flex items-center", isExpanded ? "" : "w-full justify-center")}>
                                <item.icon className={cn("h-5 w-5", isExpanded && "mr-3")} />
                                <span className={cn(!isExpanded && "sr-only")}>{item.label}</span>
                            </div>
                         </Button>
                       </Link>
                    </TooltipTrigger>
                    {!isExpanded && (
                       <TooltipContent side="right">
                         <p>{item.label}</p>
                       </TooltipContent>
                    )}
                </Tooltip>
              ))}
            </nav>
          </div>
          <div className="mt-auto p-2 border-t">
            <Button
                variant="ghost"
                className={cn(
                    "w-full justify-start mt-1",
                    !isExpanded && "h-10 w-10 p-0 justify-center"
                )}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {isExpanded ? (
                    <>
                        <ChevronLeft className="h-5 w-5 mr-3" />
                        <span>Collapse</span>
                    </>
                ) : (
                    <ChevronRight className="h-5 w-5" />
                )}
                <span className="sr-only">Toggle Sidebar</span>
            </Button>
          </div>
        </TooltipProvider>
      </aside>
      <div className={cn("flex-1 flex flex-col min-h-screen transition-all duration-300", isExpanded ? "ml-56" : "ml-16")}>
        <main className="flex-grow p-4 sm:p-6 lg:p-8">
            {children}
        </main>
        <footer className="flex-shrink-0 flex justify-between items-center text-muted-foreground text-sm py-4 px-6">
            <span>Copyright © 2025 SEL. All Rights Reserved.</span>
        </footer>
      </div>
    </div>
  );
}
