

'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import {
  LayoutDashboard,
  Warehouse,
  ArrowRightLeft,
  GitCommit,
  Component,
  BarChart3,
  BrainCircuit,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Package,
  Settings,
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
import { collection, getDocs, query, where } from 'firebase/firestore';
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
      if (!projectSlug) return;
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
    { href: `/store-stock-management/${projectSlug}`, icon: LayoutDashboard, label: 'Dashboard', permission: can('View Dashboard', `Store & Stock Management.Projects`, projectId) },
    { href: `/store-stock-management/${projectSlug}/inventory`, icon: Warehouse, label: 'Inventory', permission: can('View Inventory', `Store & Stock Management.Projects`, projectId) },
    { href: `/store-stock-management/${projectSlug}/transactions`, icon: ArrowRightLeft, label: 'Transactions', permission: can('View Transactions', `Store & Stock Management.Projects`, projectId) },
    { href: `/store-stock-management/${projectSlug}/conversions`, icon: GitCommit, label: 'Conversions', permission: can('View Conversions', `Store & Stock Management.Projects`, projectId) },
    { href: `/store-stock-management/${projectSlug}/assembly`, icon: Component, label: 'BOM Management', permission: can('View BOM', `Store & Stock Management.Projects`, projectId) },
    { href: `/store-stock-management/${projectSlug}/boq`, icon: ClipboardList, label: 'BOQ', permission: can('View BOQ', `Store & Stock Management.Projects`, projectId) },
    { href: `/store-stock-management/${projectSlug}/reports`, icon: BarChart3, label: 'Reports', permission: can('View Reports', `Store & Stock Management.Projects`, projectId) },
    { href: `/store-stock-management/${projectSlug}/ai-forecast`, icon: BrainCircuit, label: 'AI Forecast', permission: can('View AI Forecast', `Store & Stock Management.Projects`, projectId) },
    { href: `/store-stock-management/settings`, icon: Settings, label: 'Settings', permission: can('View', 'Store & Stock Management.Settings') },
  ];
  
  const visibleNavItems = navItems.filter(item => item.permission);

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
                            variant={pathname.startsWith(item.href) && (item.href !== `/store-stock-management/${projectSlug}` || pathname === item.href) ? 'secondary' : 'ghost'}
                            className={cn(
                                "w-full justify-start",
                                !isExpanded && "h-10 w-10 p-0"
                            )}
                         >
                            <div
                              className={cn(
                                'flex items-center',
                                isExpanded ? '' : 'w-full justify-center'
                              )}
                            >
                              <item.icon
                                className={cn('h-5 w-5', isExpanded && 'mr-3')}
                              />
                              <span className={cn(!isExpanded && 'sr-only')}>
                                {item.label}
                              </span>
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
        </TooltipProvider>

        <div className="mt-auto p-2 border-t">
             <Button
                variant="ghost"
                className={cn(
                    "w-full justify-start",
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

      </aside>
      <div className={cn("flex-1 flex flex-col min-h-[calc(100vh-4rem)] transition-all duration-300", isExpanded ? "ml-56" : "ml-16")}>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
            {children}
        </main>
        <footer className="flex-shrink-0 flex justify-between items-center text-muted-foreground text-sm py-4 px-6">
            <span>Copyright © 2025 SEL. All Rights Reserved.</span>
        </footer>
      </div>
    </div>
  );
}
