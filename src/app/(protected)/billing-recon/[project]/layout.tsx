
'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import {
  BarChart3, Calculator, ChevronLeft, ChevronRight, ClipboardList,
  FileEdit, FilePlus, HardHat, History, LayoutDashboard, Plus, Receipt, Settings, Truck,
  type LucideIcon,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleBottomNav, type ModuleMoreLink, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';
import { useSidebarDefault } from '@/components/theme/use-sidebar-default';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import { projectMatchesSlug } from '@/lib/project-slug';

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  iconBg: string;
  iconColor: string;
  activeGradient: string;
  permission: boolean;
  disabled?: boolean;
  soon?: boolean;
};

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const [isExpanded, setIsExpanded] = useSidebarDefault(false);
  const params = useParams();
  const projectSlug = params?.project as string;
  const pathname = usePathname();
  const { can } = useAuthorization();
  const [currentProject, setCurrentProject] = React.useState<Project | null>(null);

  React.useEffect(() => {
    const fetchProject = async () => {
      if (!projectSlug || projectSlug === 'all') { setCurrentProject(null); return; }
      const snap = await getDocs(collection(db, 'projects'));
      const found = snap.docs.map(d => ({ id: d.id, ...d.data() } as Project)).find(p => projectMatchesSlug(p.projectName, projectSlug));
      setCurrentProject(found || null);
    };
    fetchProject();
  }, [projectSlug]);

  const navItems: NavItem[] = [
    { href: '/billing-recon', icon: LayoutDashboard, label: 'Dashboard', iconBg: 'bg-blue-100', iconColor: 'text-blue-600', activeGradient: 'from-blue-500 to-indigo-600', permission: can('View Module', 'Billing Recon') },
    { href: `/billing-recon/${projectSlug}/boq`, icon: ClipboardList, label: 'BOQ', iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600', activeGradient: 'from-emerald-500 to-teal-600', permission: can('View', 'Billing Recon.BOQ') },
    { href: `/billing-recon/${projectSlug}/mvac`, icon: Truck, label: 'MVAC', iconBg: 'bg-amber-100', iconColor: 'text-amber-600', activeGradient: 'from-amber-500 to-orange-500', permission: can('View', 'Billing Recon.MVAC') },
    { href: `/billing-recon/${projectSlug}/jmc`, icon: HardHat, label: 'JMC', iconBg: 'bg-orange-100', iconColor: 'text-orange-600', activeGradient: 'from-orange-500 to-red-500', permission: can('View', 'Billing Recon.JMC') },
    { href: `/billing-recon/${projectSlug}/combined-log`, icon: History, label: 'Combined Log', iconBg: 'bg-slate-100', iconColor: 'text-slate-600', activeGradient: 'from-slate-500 to-slate-700', permission: can('View', 'Billing Recon.Combined Log') },
    { href: `/billing-recon/${projectSlug}/billing`, icon: Calculator, label: 'Billing', iconBg: 'bg-cyan-100', iconColor: 'text-cyan-600', activeGradient: 'from-cyan-500 to-sky-600', permission: can('View', 'Billing Recon.Billing') },
    { href: '#', icon: FileEdit, label: 'Amendment', iconBg: 'bg-slate-100', iconColor: 'text-slate-400', activeGradient: 'from-slate-400 to-slate-600', permission: true, disabled: true, soon: true },
    { href: '#', icon: BarChart3, label: 'Reports', iconBg: 'bg-slate-100', iconColor: 'text-slate-400', activeGradient: 'from-slate-400 to-slate-600', permission: true, disabled: true, soon: true },
    { href: '#', icon: FilePlus, label: 'Create ARD', iconBg: 'bg-slate-100', iconColor: 'text-slate-400', activeGradient: 'from-slate-400 to-slate-600', permission: true, disabled: true, soon: true },
  ].filter(i => i.permission);

  const settingsItem: NavItem = {
    href: '/billing-recon/settings', icon: Settings, label: 'Settings',
    iconBg: 'bg-slate-100', iconColor: 'text-slate-600', activeGradient: 'from-slate-500 to-slate-700',
    permission: can('View Module', 'Billing Recon'),
  };

  // The phone's bottom bar, standing in for the rail below `md`: the project's dashboard, JMC with
  // a new entry in the middle, and Billing. "More" lists the rail's other live screens. Each tab
  // only if the rail shows its screen.
  const projectBase = `/billing-recon/${projectSlug}`;
  const isVisible = (href: string) => navItems.some(item => item.href === href && !item.disabled);
  const bottomTabs: ModuleNavTab[] = [
    // The dashboard every screen's back button returns to; its page checks the same right as the rail's Dashboard.
    ...(can('View Module', 'Billing Recon')
      ? [{ href: projectBase, label: 'Home', icon: LayoutDashboard, exact: true }]
      : []),
    ...(isVisible(`${projectBase}/jmc`) ? [{ href: `${projectBase}/jmc`, label: 'JMC', icon: HardHat }] : []),
    // The JMC screen's own "JMC Entry" gate.
    ...(isVisible(`${projectBase}/jmc`) && can('Create JMC Entry', 'Billing Recon.JMC')
      ? [{ href: `${projectBase}/jmc/entry`, label: 'New', icon: Plus, emphasized: true, ariaLabel: 'New JMC entry' }]
      : []),
    ...(isVisible(`${projectBase}/billing`) ? [{ href: `${projectBase}/billing`, label: 'Billing', icon: Calculator }] : []),
  ];
  // The "Soon" placeholders go nowhere, so they stay out of the sheet.
  const moreLinks: ModuleMoreLink[] = [
    ...navItems
      .filter(item => !item.disabled && item.href !== '/billing-recon')
      .map(item => ({ href: item.href, label: item.label, icon: item.icon, group: 'This project' })),
    ...navItems
      .filter(item => item.href === '/billing-recon')
      .map(item => ({ href: item.href, label: 'All Projects', icon: item.icon, group: 'Billing Recon', exact: true })),
    ...(settingsItem.permission
      ? [{ href: settingsItem.href, label: settingsItem.label, icon: settingsItem.icon, group: 'Billing Recon' }]
      : []),
  ];

  const isPrintPage = pathname?.includes('/print');
  if (isPrintPage) return <>{children}</>;

  function isActive(href: string) {
    if (!pathname || href === '#') return false;
    if (href === '/billing-recon') return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <div className="flex w-full h-full">
      <aside className={cn(
        'fixed left-0 top-[var(--app-header-offset,4rem)] h-[calc(100vh-var(--app-header-offset,4rem))] z-40 hidden md:flex flex-col border-r border-border/60 bg-background/95 backdrop-blur-sm transition-all duration-300 shadow-sm',
        isExpanded ? 'w-56' : 'w-14',
      )}>
        <div className={cn('flex items-center gap-2 px-3 py-3 border-b border-border/40 shrink-0', !isExpanded && 'justify-center')}>
          <div className="rounded-lg bg-cyan-100 p-1.5 shrink-0">
            <Receipt className="h-4 w-4 text-cyan-600" />
          </div>
          {isExpanded && (
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground/80 truncate leading-tight">Billing Recon</p>
              {currentProject && <p className="text-[10px] text-muted-foreground truncate">{currentProject.projectName}</p>}
            </div>
          )}
        </div>

        <TooltipProvider delayDuration={0}>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {navItems.map(item => {
              const active = isActive(item.href);
              const isDisabled = item.disabled;
              return (
                <Tooltip key={item.href + item.label}>
                  <TooltipTrigger asChild>
                    <div className={isDisabled ? 'cursor-not-allowed' : ''}>
                      <Link href={isDisabled ? '#' : item.href} onClick={isDisabled ? e => e.preventDefault() : undefined}>
                        <div className={cn(
                          'relative flex items-center rounded-lg transition-all duration-200 group',
                          isExpanded ? 'px-2 py-1.5 gap-2.5' : 'p-1.5 justify-center',
                          isDisabled ? 'opacity-40 cursor-not-allowed' :
                            active
                              ? cn('bg-gradient-to-r text-white shadow-sm cursor-pointer', item.activeGradient)
                              : 'hover:bg-muted/40 cursor-pointer',
                        )}>
                          <div className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                            active ? 'bg-white/25' : cn(item.iconBg, !isDisabled && 'group-hover:scale-105'),
                          )}>
                            <item.icon className={cn('h-3.5 w-3.5 transition-transform', active ? 'text-white scale-110' : item.iconColor)} />
                          </div>
                          {isExpanded && (
                            <div className="flex flex-1 items-center justify-between min-w-0 gap-1">
                              <span className={cn('text-sm truncate', active ? 'font-semibold' : 'font-medium text-foreground/80')}>{item.label}</span>
                              {item.soon && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[9px] font-medium text-slate-400">Soon</span>}
                            </div>
                          )}
                        </div>
                      </Link>
                    </div>
                  </TooltipTrigger>
                  {!isExpanded && <TooltipContent side="right" className="text-xs font-medium">{item.label}{item.soon ? ' (Soon)' : ''}</TooltipContent>}
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
                      isActive(settingsItem.href)
                        ? cn('bg-gradient-to-r text-white shadow-sm', settingsItem.activeGradient)
                        : 'hover:bg-muted/40',
                    )}>
                      <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all', isActive(settingsItem.href) ? 'bg-white/25' : cn(settingsItem.iconBg, 'group-hover:scale-105'))}>
                        <settingsItem.icon className={cn('h-3.5 w-3.5', isActive(settingsItem.href) ? 'text-white' : settingsItem.iconColor)} />
                      </div>
                      {isExpanded && <span className={cn('text-sm truncate', isActive(settingsItem.href) ? 'font-semibold' : 'font-medium text-foreground/80')}>{settingsItem.label}</span>}
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

      {/* No rail on a phone — the bottom bar replaces it — so the content only steps aside from `md`. */}
      <div className={cn('flex-1 flex flex-col min-h-[calc(100vh-4rem)] transition-all duration-300', isExpanded ? 'md:ml-56' : 'md:ml-14')}>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
        <footer className="shrink-0 flex items-center text-muted-foreground text-xs py-3 px-6 border-t border-border/40">
          <span>Copyright © 2025 SEL. All Rights Reserved.</span>
        </footer>
        <ModuleBottomNav tabs={bottomTabs} moreLinks={moreLinks} moduleName="Billing Reconciliation" hideAbove="md" />
      </div>
    </div>
  );
}
