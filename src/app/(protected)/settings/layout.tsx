
'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, ChevronRight, Briefcase, Construction, Users, ShieldCheck,
  Hash, Palette, MailCheck, Clock, User as UserIcon, LogIn, Settings2, MonitorSmartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuthorization } from '@/hooks/useAuthorization';
import { usePathname } from 'next/navigation';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { can } = useAuthorization();
  const pathname = usePathname();

  const navItems = [
    {
      href: '/settings/profile', icon: UserIcon, label: 'Profile',
      permission: can('View', 'Settings.Profile'),
      color: 'text-violet-600 dark:text-violet-400',
      activeBg: 'bg-violet-50 dark:bg-violet-950/40',
      activeAccent: 'border-violet-400',
    },
    {
      href: '/settings/department', icon: Briefcase, label: 'Manage Department',
      permission: can('View', 'Settings.Manage Department'),
      color: 'text-sky-600 dark:text-sky-400',
      activeBg: 'bg-sky-50 dark:bg-sky-950/40',
      activeAccent: 'border-sky-400',
    },
    {
      href: '/settings/project', icon: Construction, label: 'Manage Project',
      permission: can('View', 'Settings.Manage Project'),
      color: 'text-amber-600 dark:text-amber-400',
      activeBg: 'bg-amber-50 dark:bg-amber-950/40',
      activeAccent: 'border-amber-400',
    },
    {
      href: '/employee', icon: Users, label: 'Employee',
      permission: can('View', 'Settings.Employee Management'),
      color: 'text-green-600 dark:text-green-400',
      activeBg: 'bg-green-50 dark:bg-green-950/40',
      activeAccent: 'border-green-400',
    },
    {
      href: '/settings/user-management', icon: Users, label: 'User Management',
      permission: can('View', 'Settings.User Management'),
      color: 'text-blue-600 dark:text-blue-400',
      activeBg: 'bg-blue-50 dark:bg-blue-950/40',
      activeAccent: 'border-blue-400',
    },
    {
      href: '/settings/role-management', icon: ShieldCheck, label: 'Role Management',
      permission: can('View', 'Settings.Role Management'),
      color: 'text-red-600 dark:text-red-400',
      activeBg: 'bg-red-50 dark:bg-red-950/40',
      activeAccent: 'border-red-400',
    },
    {
      href: '/settings/serial-no-configuration', icon: Hash, label: 'Serial No. Config',
      permission: can('View', 'Settings.Serial No. Config'),
      color: 'text-indigo-600 dark:text-indigo-400',
      activeBg: 'bg-indigo-50 dark:bg-indigo-950/40',
      activeAccent: 'border-indigo-400',
    },
    {
      href: '/settings/working-hours', icon: Clock, label: 'Working Hrs',
      permission: can('View', 'Settings.Working Hrs'),
      color: 'text-teal-600 dark:text-teal-400',
      activeBg: 'bg-teal-50 dark:bg-teal-950/40',
      activeAccent: 'border-teal-400',
    },
    {
      href: '/settings/appearance', icon: Palette, label: 'Appearance',
      permission: can('View', 'Settings.Appearance'),
      color: 'text-pink-600 dark:text-pink-400',
      activeBg: 'bg-pink-50 dark:bg-pink-950/40',
      activeAccent: 'border-pink-400',
    },
    {
      href: '/settings/email-authorization', icon: MailCheck, label: 'Email Authorization',
      permission: can('View', 'Settings.Email Authorization'),
      color: 'text-cyan-600 dark:text-cyan-400',
      activeBg: 'bg-cyan-50 dark:bg-cyan-950/40',
      activeAccent: 'border-cyan-400',
    },
    {
      href: '/settings/login-expiry', icon: LogIn, label: 'Login Expiry',
      permission: can('View', 'Settings.Login Expiry'),
      color: 'text-orange-600 dark:text-orange-400',
      activeBg: 'bg-orange-50 dark:bg-orange-950/40',
      activeAccent: 'border-orange-400',
    },
    {
      href: '/settings/session-management', icon: MonitorSmartphone, label: 'Sessions',
      permission: true, // everyone can see their own sessions
      color: 'text-indigo-600 dark:text-indigo-400',
      activeBg: 'bg-indigo-50 dark:bg-indigo-950/40',
      activeAccent: 'border-indigo-400',
    },
  ];

  const visibleNavItems = navItems.filter(item => item.permission);

  const isPrintPage = pathname?.includes('/print');
  if (isPrintPage) return <>{children}</>;

  return (
    <div className="flex w-full h-full">
      {/* ── Sidebar ── */}
      <aside
        className={cn(
          'fixed left-0 top-16 h-[calc(100vh-4rem)] z-40 flex flex-col border-r border-border/60 bg-background/95 backdrop-blur-sm transition-all duration-300 shadow-sm',
          isExpanded ? 'w-56' : 'w-14',
        )}
      >
        {/* Sidebar header */}
        <div className={cn(
          'flex items-center gap-2 px-3 py-3 border-b border-border/40',
          !isExpanded && 'justify-center',
        )}>
          <div className="rounded-lg bg-primary/10 p-1.5 shrink-0">
            <Settings2 className="h-4 w-4 text-primary" />
          </div>
          {isExpanded && (
            <span className="text-sm font-semibold text-foreground/80 truncate">Settings</span>
          )}
        </div>

        <TooltipProvider delayDuration={0}>
          <div className="flex-1 p-2 overflow-y-auto">
            <nav className="flex flex-col gap-0.5">
              {visibleNavItems.map(item => {
                const isActive = pathname === item.href || (pathname?.startsWith(item.href + '/') ?? false);
                return (
                  <Tooltip key={item.label}>
                    <TooltipTrigger asChild>
                      <Link href={item.href}>
                        <div
                          className={cn(
                            'relative flex items-center rounded-lg transition-all duration-200 group cursor-pointer overflow-hidden',
                            isExpanded ? 'px-3 py-2 gap-3' : 'p-2 justify-center',
                            isActive
                              ? cn('font-medium', item.activeBg, item.color)
                              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                          )}
                        >
                          {/* Active left accent */}
                          {isActive && (
                            <div className={cn(
                              'absolute left-0 top-1 bottom-1 w-0.5 rounded-full',
                              item.activeAccent.replace('border-', 'bg-'),
                            )} />
                          )}
                          <item.icon className={cn(
                            'shrink-0 transition-transform duration-200',
                            isExpanded ? 'h-4 w-4' : 'h-5 w-5',
                            isActive ? item.color : '',
                            !isActive && 'group-hover:scale-110',
                          )} />
                          {isExpanded && (
                            <span className="text-sm truncate">{item.label}</span>
                          )}
                        </div>
                      </Link>
                    </TooltipTrigger>
                    {!isExpanded && (
                      <TooltipContent side="right" className="text-xs">
                        <p>{item.label}</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </nav>
          </div>
        </TooltipProvider>

        {/* Collapse toggle */}
        <div className="mt-auto p-2 border-t border-border/40">
          <button
            className={cn(
              'w-full flex items-center rounded-lg px-2 py-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-all duration-200 text-sm gap-2',
              !isExpanded && 'justify-center',
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
      </aside>

      {/* ── Main content ── */}
      <div className={cn(
        'flex-1 flex flex-col min-h-screen transition-all duration-300',
        isExpanded ? 'ml-56' : 'ml-14',
      )}>
        <main className="flex-grow">
          {children}
        </main>
        <footer className="flex-shrink-0 flex justify-between items-center text-muted-foreground text-xs py-3 px-6 border-t border-border/40">
          <span>Copyright © 2025 SEL. All Rights Reserved.</span>
        </footer>
      </div>
    </div>
  );
}
