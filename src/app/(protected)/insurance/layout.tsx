
'use client';

import * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import {
  BarChart3, CalendarClock, ChevronLeft, ChevronRight, ClipboardCheck,
  Files, HardHat, History as HistoryIcon, LayoutDashboard, Settings2,
  ShieldCheck, ShieldHalf, Users,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  activeGradient: string;
  subItems?: SubNavItem[];
  subActivePatterns?: string[];
};

type SubNavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  activeGradient: string;
};

export default function InsuranceLayout({ children }: { children: React.ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const pathname = usePathname();
  const { can } = useAuthorization();

  const mainNavItems: NavItem[] = [
    {
      href: '/insurance', label: 'Dashboard', icon: LayoutDashboard,
      iconBg: 'bg-blue-100', iconColor: 'text-blue-600', activeGradient: 'from-blue-500 to-indigo-600',
    },
    {
      href: '/insurance/personal', label: 'Personal Insurance', icon: Users,
      iconBg: 'bg-violet-100', iconColor: 'text-violet-600', activeGradient: 'from-violet-500 to-purple-600',
      subActivePatterns: ['/insurance/personal', '/insurance/premium-due', '/insurance/maturity-due'],
      subItems: can('View', 'Insurance.Personal Insurance') ? [
        { href: '/insurance/premium-due', label: 'Premium Due', icon: CalendarClock, iconBg: 'bg-amber-100', iconColor: 'text-amber-600', activeGradient: 'from-amber-500 to-orange-500' },
        { href: '/insurance/maturity-due', label: 'Maturity Due', icon: ShieldCheck, iconBg: 'bg-rose-100', iconColor: 'text-rose-600', activeGradient: 'from-rose-500 to-red-600' },
        { href: '/insurance/personal/history', label: 'History', icon: HistoryIcon, iconBg: 'bg-slate-100', iconColor: 'text-slate-600', activeGradient: 'from-slate-500 to-slate-700' },
      ] : [],
    },
    {
      href: '/insurance/project', label: 'Project Insurance', icon: HardHat,
      iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600', activeGradient: 'from-emerald-500 to-teal-600',
      subActivePatterns: ['/insurance/project'],
      subItems: can('View', 'Insurance.Project Insurance') ? [
        { href: '/insurance/project/premium-due', label: 'Premium Due', icon: CalendarClock, iconBg: 'bg-amber-100', iconColor: 'text-amber-600', activeGradient: 'from-amber-500 to-orange-500' },
        { href: '/insurance/project/all-policies', label: 'All Policies', icon: Files, iconBg: 'bg-teal-100', iconColor: 'text-teal-600', activeGradient: 'from-teal-500 to-cyan-600' },
        { href: '/insurance/project/history', label: 'History', icon: HistoryIcon, iconBg: 'bg-slate-100', iconColor: 'text-slate-600', activeGradient: 'from-slate-500 to-slate-700' },
      ] : [],
    },
    {
      href: '/insurance/my-tasks', label: 'My Tasks', icon: ClipboardCheck,
      iconBg: 'bg-cyan-100', iconColor: 'text-cyan-600', activeGradient: 'from-cyan-500 to-sky-600',
    },
    {
      href: '/insurance/reports', label: 'Reports', icon: BarChart3,
      iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600', activeGradient: 'from-indigo-500 to-blue-600',
    },
  ].filter(item => {
    if (item.href === '/insurance') return can('View Module', 'Insurance');
    if (item.href === '/insurance/personal') return can('View', 'Insurance.Personal Insurance');
    if (item.href === '/insurance/project') return can('View', 'Insurance.Project Insurance');
    if (item.href === '/insurance/my-tasks') return can('View', 'Insurance.My Tasks');
    if (item.href === '/insurance/reports') return can('View', 'Insurance.Reports');
    return true;
  });

  const settingsItem: NavItem = {
    href: '/insurance/settings', label: 'Settings', icon: Settings2,
    iconBg: 'bg-slate-100', iconColor: 'text-slate-600', activeGradient: 'from-slate-500 to-slate-700',
  };

  const isPrintPage = pathname?.includes('/print');
  if (isPrintPage) return <>{children}</>;

  function isItemActive(item: NavItem) {
    if (item.href === '/insurance') return pathname === '/insurance';
    const patterns = item.subActivePatterns ?? [item.href];
    return patterns.some(p => pathname?.startsWith(p));
  }

  function isSubActive(href: string) { return pathname?.startsWith(href) ?? false; }

  function NavLink({ item, size = 'md' }: { item: NavItem | SubNavItem; size?: 'md' | 'sm' }) {
    const isActive = 'subActivePatterns' in item ? isItemActive(item as NavItem) : isSubActive(item.href);
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href={item.href}>
            <div className={cn(
              'relative flex cursor-pointer items-center rounded-lg transition-all duration-200 group',
              isExpanded ? cn('gap-2.5', size === 'sm' ? 'px-2 py-1' : 'px-2 py-1.5') : 'p-1.5 justify-center',
              isActive
                ? cn('bg-gradient-to-r text-white shadow-sm', item.activeGradient)
                : 'hover:bg-muted/40',
            )}>
              <div className={cn(
                'flex shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
                isActive ? 'bg-white/25' : cn(item.iconBg, 'group-hover:scale-105'),
              )}>
                <item.icon className={cn('transition-transform', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5', isActive ? 'text-white scale-110' : item.iconColor)} />
              </div>
              {isExpanded && (
                <span className={cn('truncate', size === 'sm' ? 'text-xs' : 'text-sm', isActive ? 'font-semibold' : 'font-medium text-foreground/80')}>
                  {item.label}
                </span>
              )}
            </div>
          </Link>
        </TooltipTrigger>
        {!isExpanded && <TooltipContent side="right" className="text-xs font-medium">{item.label}</TooltipContent>}
      </Tooltip>
    );
  }

  return (
    <div className="flex w-full h-full">
      <aside className={cn(
        'fixed left-0 top-16 h-[calc(100vh-4rem)] z-40 flex flex-col border-r border-border/60 bg-background/95 backdrop-blur-sm transition-all duration-300 shadow-sm',
        isExpanded ? 'w-56' : 'w-14',
      )}>
        {/* Header */}
        <div className={cn('flex items-center gap-2 px-3 py-3 border-b border-border/40 shrink-0', !isExpanded && 'justify-center')}>
          <div className="rounded-lg bg-blue-100 p-1.5 shrink-0">
            <ShieldHalf className="h-4 w-4 text-blue-600" />
          </div>
          {isExpanded && <span className="text-sm font-semibold text-foreground/80 truncate">Insurance</span>}
        </div>

        <TooltipProvider delayDuration={0}>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {mainNavItems.map(item => {
              const showSubs = item.subItems?.length && (item.subActivePatterns ?? [item.href]).some(p => pathname?.startsWith(p));
              return (
                <React.Fragment key={item.href}>
                  <NavLink item={item} />
                  {showSubs && (
                    <div className={cn('mt-0.5 mb-0.5 space-y-0.5', isExpanded ? 'pl-4 border-l ml-5 border-border/40' : '')}>
                      {item.subItems!.map(sub => <NavLink key={sub.href} item={sub} size="sm" />)}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          <div className="shrink-0 border-t border-border/40 p-2 space-y-0.5">
            {can('View', 'Insurance.Settings') && <NavLink item={settingsItem} />}
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
