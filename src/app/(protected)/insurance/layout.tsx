
'use client';

import * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Files,
  HardHat,
  History as HistoryIcon,
  LayoutDashboard,
  Settings2,
  ShieldCheck,
  ShieldHalf,
  Users,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';

// ─── nav config ──────────────────────────────────────────────────────────────

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  color: string;
  activeBg: string;
  activeAccent: string;
  subItems?: SubNavItem[];
  subActivePatterns?: string[];
};

type SubNavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  color: string;
  activeBg: string;
  activeAccent: string;
};

export default function InsuranceLayout({ children }: { children: React.ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const pathname = usePathname();
  const { can } = useAuthorization();

  const mainNavItems: NavItem[] = [
    {
      href: '/insurance',
      label: 'Dashboard',
      icon: LayoutDashboard,
      color: 'text-blue-600',
      activeBg: 'bg-blue-50',
      activeAccent: 'bg-blue-500',
    },
    {
      href: '/insurance/personal',
      label: 'Personal Insurance',
      icon: Users,
      color: 'text-violet-600',
      activeBg: 'bg-violet-50',
      activeAccent: 'bg-violet-500',
      subActivePatterns: ['/insurance/personal', '/insurance/premium-due', '/insurance/maturity-due'],
      subItems: can('View', 'Insurance.Personal Insurance')
        ? [
            {
              href: '/insurance/premium-due',
              label: 'Premium Due',
              icon: CalendarClock,
              color: 'text-amber-600',
              activeBg: 'bg-amber-50',
              activeAccent: 'bg-amber-500',
            },
            {
              href: '/insurance/maturity-due',
              label: 'Maturity Due',
              icon: ShieldCheck,
              color: 'text-rose-600',
              activeBg: 'bg-rose-50',
              activeAccent: 'bg-rose-500',
            },
            {
              href: '/insurance/personal/history',
              label: 'History',
              icon: HistoryIcon,
              color: 'text-slate-600',
              activeBg: 'bg-slate-50',
              activeAccent: 'bg-slate-400',
            },
          ]
        : [],
    },
    {
      href: '/insurance/project',
      label: 'Project Insurance',
      icon: HardHat,
      color: 'text-emerald-600',
      activeBg: 'bg-emerald-50',
      activeAccent: 'bg-emerald-500',
      subActivePatterns: ['/insurance/project'],
      subItems: can('View', 'Insurance.Project Insurance')
        ? [
            {
              href: '/insurance/project/premium-due',
              label: 'Premium Due',
              icon: CalendarClock,
              color: 'text-amber-600',
              activeBg: 'bg-amber-50',
              activeAccent: 'bg-amber-500',
            },
            {
              href: '/insurance/project/all-policies',
              label: 'All Policies',
              icon: Files,
              color: 'text-teal-600',
              activeBg: 'bg-teal-50',
              activeAccent: 'bg-teal-500',
            },
            {
              href: '/insurance/project/history',
              label: 'History',
              icon: HistoryIcon,
              color: 'text-slate-600',
              activeBg: 'bg-slate-50',
              activeAccent: 'bg-slate-400',
            },
          ]
        : [],
    },
    {
      href: '/insurance/my-tasks',
      label: 'My Tasks',
      icon: ClipboardCheck,
      color: 'text-cyan-600',
      activeBg: 'bg-cyan-50',
      activeAccent: 'bg-cyan-500',
    },
    {
      href: '/insurance/reports',
      label: 'Reports',
      icon: BarChart3,
      color: 'text-indigo-600',
      activeBg: 'bg-indigo-50',
      activeAccent: 'bg-indigo-500',
    },
  ].filter((item) => {
    if (item.href === '/insurance') return can('View Module', 'Insurance');
    if (item.href === '/insurance/personal') return can('View', 'Insurance.Personal Insurance');
    if (item.href === '/insurance/project') return can('View', 'Insurance.Project Insurance');
    if (item.href === '/insurance/my-tasks') return can('View', 'Insurance.My Tasks');
    if (item.href === '/insurance/reports') return can('View', 'Insurance.Reports');
    return true;
  });

  const settingsItem: NavItem = {
    href: '/insurance/settings',
    label: 'Settings',
    icon: Settings2,
    color: 'text-slate-600',
    activeBg: 'bg-slate-50',
    activeAccent: 'bg-slate-400',
  };

  const isPrintPage = pathname?.includes('/print');
  if (isPrintPage) return <>{children}</>;

  function isItemActive(item: NavItem): boolean {
    if (item.href === '/insurance') return pathname === '/insurance';
    const patterns = item.subActivePatterns ?? [item.href];
    return patterns.some((p) => pathname?.startsWith(p));
  }

  function isSubActive(sub: SubNavItem): boolean {
    return pathname?.startsWith(sub.href) ?? false;
  }

  function NavLink({
    href,
    icon: Icon,
    label,
    color,
    activeBg,
    activeAccent,
    active,
    size = 'md',
  }: {
    href: string;
    icon: React.ElementType;
    label: string;
    color: string;
    activeBg: string;
    activeAccent: string;
    active: boolean;
    size?: 'md' | 'sm';
  }) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href={href}>
            <div
              className={cn(
                'relative flex cursor-pointer items-center overflow-hidden rounded-lg transition-all duration-200 group',
                isExpanded ? cn('px-3 gap-3', size === 'sm' ? 'py-1.5' : 'py-2') : 'p-2 justify-center',
                active
                  ? cn('font-medium', activeBg, color)
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {active && (
                <div className={cn('absolute left-0 top-1 bottom-1 w-0.5 rounded-full', activeAccent)} />
              )}
              <Icon
                className={cn(
                  'shrink-0 transition-transform duration-200 group-hover:scale-110',
                  isExpanded ? (size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4') : 'h-5 w-5',
                  active ? color : ''
                )}
              />
              {isExpanded && (
                <span className={cn('truncate', size === 'sm' ? 'text-xs' : 'text-sm')}>{label}</span>
              )}
            </div>
          </Link>
        </TooltipTrigger>
        {!isExpanded && (
          <TooltipContent side="right" className="text-xs">
            {label}
          </TooltipContent>
        )}
      </Tooltip>
    );
  }

  return (
    <div className="flex w-full h-full">
      {/* ── Sidebar ── */}
      <aside
        className={cn(
          'fixed left-0 top-16 h-[calc(100vh-4rem)] z-40 flex flex-col border-r border-border/60 bg-background/95 backdrop-blur-sm transition-all duration-300 shadow-sm',
          isExpanded ? 'w-56' : 'w-14'
        )}
      >
        {/* Sidebar header */}
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-3 border-b border-border/40',
            !isExpanded && 'justify-center'
          )}
        >
          <div className="rounded-lg bg-blue-100 p-1.5 shrink-0">
            <ShieldHalf className="h-4 w-4 text-blue-600" />
          </div>
          {isExpanded && (
            <span className="text-sm font-semibold text-foreground/80 truncate">Insurance</span>
          )}
        </div>

        <TooltipProvider delayDuration={0}>
          <div className="flex-1 p-2 overflow-y-auto">
            <nav className="flex flex-col gap-0.5">
              {mainNavItems.map((item) => {
                const active = isItemActive(item);
                const showSubs =
                  item.subItems &&
                  item.subItems.length > 0 &&
                  (item.subActivePatterns ?? [item.href]).some((p) => pathname?.startsWith(p));

                return (
                  <React.Fragment key={item.href}>
                    <NavLink
                      href={item.href}
                      icon={item.icon}
                      label={item.label}
                      color={item.color}
                      activeBg={item.activeBg}
                      activeAccent={item.activeAccent}
                      active={active}
                    />
                    {showSubs && (
                      <div
                        className={cn(
                          'mt-0.5 mb-1 space-y-0.5',
                          isExpanded ? 'pl-4 border-l ml-5' : ''
                        )}
                      >
                        {item.subItems!.map((sub) => (
                          <NavLink
                            key={sub.href}
                            href={sub.href}
                            icon={sub.icon}
                            label={sub.label}
                            color={sub.color}
                            activeBg={sub.activeBg}
                            activeAccent={sub.activeAccent}
                            active={isSubActive(sub)}
                            size="sm"
                          />
                        ))}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </nav>
          </div>

          {/* Footer */}
          <div className="mt-auto p-2 border-t border-border/40 space-y-0.5">
            {can('View', 'Insurance.Settings') && (
              <NavLink
                href={settingsItem.href}
                icon={settingsItem.icon}
                label={settingsItem.label}
                color={settingsItem.color}
                activeBg={settingsItem.activeBg}
                activeAccent={settingsItem.activeAccent}
                active={pathname?.startsWith(settingsItem.href) ?? false}
              />
            )}
            <button
              className={cn(
                'w-full flex items-center rounded-lg px-2 py-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-all duration-200 text-sm gap-2',
                !isExpanded && 'justify-center'
              )}
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <>
                  <ChevronLeft className="h-4 w-4 shrink-0" />
                  <span>Collapse</span>
                </>
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </div>
        </TooltipProvider>
      </aside>

      {/* ── Main content ── */}
      <div
        className={cn(
          'flex-1 flex flex-col min-h-screen transition-all duration-300',
          isExpanded ? 'ml-56' : 'ml-14'
        )}
      >
        <main className="flex-grow p-4 sm:p-6">{children}</main>
        <footer className="flex-shrink-0 flex justify-between items-center text-muted-foreground text-xs py-3 px-6 border-t border-border/40">
          <span>Copyright © 2025 SEL. All Rights Reserved.</span>
        </footer>
      </div>
    </div>
  );
}
