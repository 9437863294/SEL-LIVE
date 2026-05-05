
'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import {
  ArrowRightLeft, BarChart3, BrainCircuit, ChevronLeft, ChevronRight,
  ClipboardList, Component, GitCommit, LayoutDashboard, Package, Settings, Warehouse,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuthorization } from '@/hooks/useAuthorization';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';

type NavItem = {
  href: string;
  icon: React.ElementType;
  label: string;
  iconBg: string;
  iconColor: string;
  activeGradient: string;
  permission: boolean;
  exact?: boolean;
};

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const params = useParams();
  const projectSlug = params?.project as string;
  const pathname = usePathname();
  const { can } = useAuthorization();
  const [currentProject, setCurrentProject] = React.useState<Project | null>(null);

  React.useEffect(() => {
    const fetchProject = async () => {
      if (!projectSlug) return;
      const snap = await getDocs(collection(db, 'projects'));
      const slugify = (t: string) => t.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
      const found = snap.docs.map(d => ({ id: d.id, ...d.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);
      setCurrentProject(found || null);
    };
    fetchProject();
  }, [projectSlug]);

  const projectId = currentProject?.id || '';

  const navItems: NavItem[] = [
    { href: `/store-stock-management/${projectSlug}`, icon: LayoutDashboard, label: 'Dashboard', iconBg: 'bg-blue-100', iconColor: 'text-blue-600', activeGradient: 'from-blue-500 to-indigo-600', permission: can('View Dashboard', 'Store & Stock Management.Projects', projectId), exact: true },
    { href: `/store-stock-management/${projectSlug}/inventory`, icon: Warehouse, label: 'Inventory', iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600', activeGradient: 'from-emerald-500 to-teal-600', permission: can('View Inventory', 'Store & Stock Management.Projects', projectId) },
    { href: `/store-stock-management/${projectSlug}/transactions`, icon: ArrowRightLeft, label: 'Transactions', iconBg: 'bg-violet-100', iconColor: 'text-violet-600', activeGradient: 'from-violet-500 to-purple-600', permission: can('View Transactions', 'Store & Stock Management.Projects', projectId) },
    { href: `/store-stock-management/${projectSlug}/conversions`, icon: GitCommit, label: 'Conversions', iconBg: 'bg-amber-100', iconColor: 'text-amber-600', activeGradient: 'from-amber-500 to-orange-500', permission: can('View Conversions', 'Store & Stock Management.Projects', projectId) },
    { href: `/store-stock-management/${projectSlug}/assembly`, icon: Component, label: 'BOM Mgmt', iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600', activeGradient: 'from-indigo-500 to-blue-600', permission: can('View BOM', 'Store & Stock Management.Projects', projectId) },
    { href: `/store-stock-management/${projectSlug}/boq`, icon: ClipboardList, label: 'BOQ', iconBg: 'bg-teal-100', iconColor: 'text-teal-600', activeGradient: 'from-teal-500 to-cyan-600', permission: can('View BOQ', 'Store & Stock Management.Projects', projectId) },
    { href: `/store-stock-management/${projectSlug}/reports`, icon: BarChart3, label: 'Reports', iconBg: 'bg-sky-100', iconColor: 'text-sky-600', activeGradient: 'from-sky-500 to-blue-600', permission: can('View Reports', 'Store & Stock Management.Projects', projectId) },
    { href: `/store-stock-management/${projectSlug}/ai-forecast`, icon: BrainCircuit, label: 'AI Forecast', iconBg: 'bg-purple-100', iconColor: 'text-purple-600', activeGradient: 'from-purple-500 to-violet-600', permission: can('View AI Forecast', 'Store & Stock Management.Projects', projectId) },
  ].filter(i => i.permission);

  const settingsItem: NavItem = {
    href: '/store-stock-management/settings', icon: Settings, label: 'Settings',
    iconBg: 'bg-slate-100', iconColor: 'text-slate-600', activeGradient: 'from-slate-500 to-slate-700',
    permission: can('View', 'Store & Stock Management.Settings'),
  };

  const isPrintPage = pathname?.includes('/print');
  if (isPrintPage) return <>{children}</>;

  function isActive(item: NavItem) {
    if (!pathname) return false;
    if (item.exact) return pathname === item.href;
    return pathname.startsWith(item.href);
  }

  return (
    <div className="flex w-full h-full">
      <aside className={cn(
        'fixed left-0 top-16 h-[calc(100vh-4rem)] z-40 flex flex-col border-r border-border/60 bg-background/95 backdrop-blur-sm transition-all duration-300 shadow-sm',
        isExpanded ? 'w-56' : 'w-14',
      )}>
        <div className={cn('flex items-center gap-2 px-3 py-3 border-b border-border/40 shrink-0', !isExpanded && 'justify-center')}>
          <div className="rounded-lg bg-emerald-100 p-1.5 shrink-0">
            <Package className="h-4 w-4 text-emerald-600" />
          </div>
          {isExpanded && (
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground/80 truncate leading-tight">Store & Stock</p>
              {currentProject && <p className="text-[10px] text-muted-foreground truncate">{currentProject.projectName}</p>}
            </div>
          )}
        </div>

        <TooltipProvider delayDuration={0}>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {navItems.map(item => {
              const active = isActive(item);
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link href={item.href}>
                      <div className={cn(
                        'relative flex cursor-pointer items-center rounded-lg transition-all duration-200 group',
                        isExpanded ? 'px-2 py-1.5 gap-2.5' : 'p-1.5 justify-center',
                        active
                          ? cn('bg-gradient-to-r text-white shadow-sm', item.activeGradient)
                          : 'hover:bg-muted/40',
                      )}>
                        <div className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                          active ? 'bg-white/25' : cn(item.iconBg, 'group-hover:scale-105'),
                        )}>
                          <item.icon className={cn('h-3.5 w-3.5 transition-transform', active ? 'text-white scale-110' : item.iconColor)} />
                        </div>
                        {isExpanded && (
                          <span className={cn('text-sm truncate', active ? 'font-semibold' : 'font-medium text-foreground/80')}>
                            {item.label}
                          </span>
                        )}
                      </div>
                    </Link>
                  </TooltipTrigger>
                  {!isExpanded && <TooltipContent side="right" className="text-xs font-medium">{item.label}</TooltipContent>}
                </Tooltip>
              );
            })}
          </div>

          <div className="shrink-0 border-t border-border/40 p-2 space-y-0.5">
            {settingsItem.permission && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href={settingsItem.href}>
                    <div className={cn(
                      'relative flex cursor-pointer items-center rounded-lg transition-all duration-200 group',
                      isExpanded ? 'px-2 py-1.5 gap-2.5' : 'p-1.5 justify-center',
                      pathname?.startsWith(settingsItem.href)
                        ? cn('bg-gradient-to-r text-white shadow-sm', settingsItem.activeGradient)
                        : 'hover:bg-muted/40',
                    )}>
                      <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all', pathname?.startsWith(settingsItem.href) ? 'bg-white/25' : cn(settingsItem.iconBg, 'group-hover:scale-105'))}>
                        <settingsItem.icon className={cn('h-3.5 w-3.5', pathname?.startsWith(settingsItem.href) ? 'text-white' : settingsItem.iconColor)} />
                      </div>
                      {isExpanded && <span className={cn('text-sm truncate', pathname?.startsWith(settingsItem.href) ? 'font-semibold' : 'font-medium text-foreground/80')}>{settingsItem.label}</span>}
                    </div>
                  </Link>
                </TooltipTrigger>
                {!isExpanded && <TooltipContent side="right" className="text-xs font-medium">{settingsItem.label}</TooltipContent>}
              </Tooltip>
            )}
            <button
              className={cn('w-full flex items-center rounded-lg px-2 py-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-all duration-200 text-sm gap-2', !isExpanded && 'justify-center')}
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? <><ChevronLeft className="h-4 w-4 shrink-0" /><span>Collapse</span></> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
        </TooltipProvider>
      </aside>

      <div className={cn('flex-1 flex flex-col min-h-screen transition-all duration-300', isExpanded ? 'ml-56' : 'ml-14')}>
        <main className="flex-grow p-4 sm:p-6">{children}</main>
        <footer className="shrink-0 flex items-center text-muted-foreground text-xs py-3 px-6 border-t border-border/40">
          <span>Copyright © 2025 SEL. All Rights Reserved.</span>
        </footer>
      </div>
    </div>
  );
}
