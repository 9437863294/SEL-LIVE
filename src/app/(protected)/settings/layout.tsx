
'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Briefcase, ChevronLeft, ChevronRight, Clock, Construction, Hash,
  LogIn, MailCheck, MonitorSmartphone, Palette, Settings2,
  ShieldCheck, User as UserIcon, Users,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuthorization } from '@/hooks/useAuthorization';
import { usePathname } from 'next/navigation';

type NavItem = {
  href: string;
  icon: React.ElementType;
  label: string;
  permission: boolean;
  iconBg: string;
  iconColor: string;
  activeGradient: string;
};

type NavGroup = { label: string; items: NavItem[] };

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { can } = useAuthorization();
  const pathname = usePathname();

  const navGroups: NavGroup[] = [
    {
      label: 'Personal',
      items: [
        { href: '/settings/profile', icon: UserIcon, label: 'Profile', permission: can('View', 'Settings.Profile'), iconBg: 'bg-violet-100', iconColor: 'text-violet-600', activeGradient: 'from-violet-500 to-purple-600' },
      ],
    },
    {
      label: 'Organisation',
      items: [
        { href: '/settings/department', icon: Briefcase, label: 'Departments', permission: can('View', 'Settings.Manage Department'), iconBg: 'bg-sky-100', iconColor: 'text-sky-600', activeGradient: 'from-sky-500 to-cyan-600' },
        { href: '/settings/project', icon: Construction, label: 'Projects', permission: can('View', 'Settings.Manage Project'), iconBg: 'bg-amber-100', iconColor: 'text-amber-600', activeGradient: 'from-amber-500 to-orange-500' },
        { href: '/employee', icon: Users, label: 'Employees', permission: can('View', 'Settings.Employee Management'), iconBg: 'bg-green-100', iconColor: 'text-green-600', activeGradient: 'from-green-500 to-emerald-600' },
      ],
    },
    {
      label: 'Access',
      items: [
        { href: '/settings/user-management', icon: Users, label: 'Users', permission: can('View', 'Settings.User Management'), iconBg: 'bg-blue-100', iconColor: 'text-blue-600', activeGradient: 'from-blue-500 to-indigo-600' },
        { href: '/settings/role-management', icon: ShieldCheck, label: 'Roles', permission: can('View', 'Settings.Role Management'), iconBg: 'bg-red-100', iconColor: 'text-red-600', activeGradient: 'from-red-500 to-rose-600' },
        { href: '/settings/session-management', icon: MonitorSmartphone, label: 'Sessions', permission: true, iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600', activeGradient: 'from-indigo-500 to-blue-600' },
      ],
    },
    {
      label: 'Config',
      items: [
        { href: '/settings/serial-no-configuration', icon: Hash, label: 'Serial Nos.', permission: can('View', 'Settings.Serial No. Config'), iconBg: 'bg-violet-100', iconColor: 'text-violet-600', activeGradient: 'from-violet-600 to-indigo-600' },
        { href: '/settings/working-hours', icon: Clock, label: 'Working Hrs', permission: can('View', 'Settings.Working Hrs'), iconBg: 'bg-teal-100', iconColor: 'text-teal-600', activeGradient: 'from-teal-500 to-cyan-600' },
      ],
    },
    {
      label: 'System',
      items: [
        { href: '/settings/appearance', icon: Palette, label: 'Appearance', permission: can('View', 'Settings.Appearance'), iconBg: 'bg-pink-100', iconColor: 'text-pink-600', activeGradient: 'from-pink-500 to-rose-500' },
        { href: '/settings/email-authorization', icon: MailCheck, label: 'Email Auth', permission: can('View', 'Settings.Email Authorization'), iconBg: 'bg-cyan-100', iconColor: 'text-cyan-600', activeGradient: 'from-cyan-500 to-sky-600' },
        { href: '/settings/login-expiry', icon: LogIn, label: 'Login Expiry', permission: can('View', 'Settings.Login Expiry'), iconBg: 'bg-orange-100', iconColor: 'text-orange-600', activeGradient: 'from-orange-500 to-amber-500' },
      ],
    },
  ];

  const isPrintPage = pathname?.includes('/print');
  if (isPrintPage) return <>{children}</>;

  function active(href: string) {
    return pathname === href || (pathname?.startsWith(href + '/') ?? false);
  }

  return (
    <div className="flex w-full h-full">
      <aside className={cn(
        'fixed left-0 top-16 h-[calc(100vh-4rem)] z-40 flex flex-col border-r border-border/60 bg-background/95 backdrop-blur-sm transition-all duration-300 shadow-sm',
        isExpanded ? 'w-56' : 'w-14',
      )}>
        {/* Header */}
        <div className={cn('flex items-center gap-2 px-3 py-3 border-b border-border/40 shrink-0', !isExpanded && 'justify-center')}>
          <div className="rounded-lg bg-primary/10 p-1.5 shrink-0">
            <Settings2 className="h-4 w-4 text-primary" />
          </div>
          {isExpanded && <span className="text-sm font-semibold text-foreground/80 truncate">Settings</span>}
        </div>

        <TooltipProvider delayDuration={0}>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
            {navGroups.map(group => {
              const visible = group.items.filter(i => i.permission);
              if (!visible.length) return null;
              return (
                <div key={group.label}>
                  {isExpanded && (
                    <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">{group.label}</p>
                  )}
                  {!isExpanded && group.label !== 'Personal' && (
                    <div className="mb-1 mx-1 h-px bg-border/40" />
                  )}
                  <nav className="flex flex-col gap-0.5">
                    {visible.map(item => {
                      const isActive = active(item.href);
                      return (
                        <Tooltip key={item.href}>
                          <TooltipTrigger asChild>
                            <Link href={item.href}>
                              <div className={cn(
                                'relative flex cursor-pointer items-center rounded-lg transition-all duration-200 group',
                                isExpanded ? 'px-2 py-1.5 gap-2.5' : 'p-1.5 justify-center',
                                isActive
                                  ? cn('bg-gradient-to-r text-white shadow-sm', item.activeGradient)
                                  : 'hover:bg-muted/40',
                              )}>
                                <div className={cn(
                                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                                  isActive ? 'bg-white/25' : cn(item.iconBg, 'group-hover:scale-105'),
                                )}>
                                  <item.icon className={cn('h-3.5 w-3.5 transition-transform', isActive ? 'text-white scale-110' : item.iconColor)} />
                                </div>
                                {isExpanded && (
                                  <span className={cn('text-sm truncate', isActive ? 'font-semibold' : 'font-medium text-foreground/80')}>
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
                  </nav>
                </div>
              );
            })}
          </div>
        </TooltipProvider>

        <div className="shrink-0 border-t border-border/40 p-2">
          <button
            className={cn('w-full flex items-center rounded-lg px-2 py-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-all duration-200 text-sm gap-2', !isExpanded && 'justify-center')}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <><ChevronLeft className="h-4 w-4 shrink-0" /><span>Collapse</span></> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </aside>

      <div className={cn('flex-1 flex flex-col min-h-screen transition-all duration-300', isExpanded ? 'ml-56' : 'ml-14')}>
        <main className="flex-grow">{children}</main>
        <footer className="shrink-0 flex items-center text-muted-foreground text-xs py-3 px-6 border-t border-border/40">
          <span>Copyright © 2025 SEL. All Rights Reserved.</span>
        </footer>
      </div>
    </div>
  );
}
