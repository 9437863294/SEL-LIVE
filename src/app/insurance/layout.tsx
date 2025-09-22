

'use client';

import * as React from "react";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Users,
  CalendarClock,
  Settings,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Building,
  Shield,
  HardHat,
  History as HistoryIcon,
  Files,
  ClipboardCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { collection, getDocs, query, where, Timestamp, addDoc, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { InsurancePolicy } from '@/lib/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { isWithinInterval, addDays, startOfDay, isPast, format as formatDate } from 'date-fns';

export default function InsuranceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const pathname = usePathname();
  const { can } = useAuthorization();

  const navItems = [
    { href: '/insurance', icon: Shield, label: 'Insurance Module', permission: can('View Module', 'Insurance') },
    { href: '/insurance/personal', icon: Users, label: 'Personal Insurance', permission: can('View', 'Insurance.Personal Insurance') },
    { href: '/insurance/project', icon: HardHat, label: 'Project Insurance', permission: can('View', 'Insurance.Project Insurance') },
    { href: '/insurance/my-tasks', icon: ClipboardCheck, label: 'My Tasks', permission: can('View', 'Insurance.My Tasks') },
  ];
  
  const settingsItem = { href: '/insurance/settings', icon: Settings, label: 'Settings', permission: can('View', 'Insurance.Settings') };

  const personalInsuranceSubItems = [
    { href: '/insurance/premium-due', icon: CalendarClock, label: 'Premium Due', permission: can('View', 'Insurance.Premium Due') },
    { href: '/insurance/maturity-due', icon: ShieldCheck, label: 'Maturity Due', permission: can('View', 'Insurance.Maturity Due') },
    { href: '/insurance/personal/history', icon: HistoryIcon, label: 'History', permission: can('View History', 'Insurance.Personal Insurance') },
  ];
  
  const projectInsuranceSubItems = [
      { href: '/insurance/project/premium-due', icon: CalendarClock, label: 'Premium Due', permission: can('View', 'Insurance.Project Insurance') },
      { href: '/insurance/project/all-policies', icon: Files, label: 'All Policies', permission: can('View', 'Insurance.Project Insurance') },
      { href: '/insurance/project/history', icon: HistoryIcon, label: 'History', permission: can('View History', 'Insurance.Project Insurance') },
  ];
  
  const showPersonalSubItems = pathname.startsWith('/insurance/personal') || pathname.startsWith('/insurance/premium-due') || pathname.startsWith('/insurance/maturity-due');
  const showProjectSubItems = pathname.startsWith('/insurance/project');

  const visibleNavItems = navItems.filter(item => item.permission);
  const visiblePersonalSubItems = personalInsuranceSubItems.filter(item => item.permission);
  const visibleProjectSubItems = projectInsuranceSubItems.filter(item => item.permission);

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
                <React.Fragment key={item.label}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link href={item.href}>
                        <Button
                          variant={
                            (pathname === item.href || (item.href !== '/insurance' && pathname.startsWith(item.href))) && !(item.href === '/insurance/personal' && showProjectSubItems)
                             ? 'secondary' 
                             : 'ghost'
                          }
                          className={cn(
                            'w-full justify-start',
                            !isExpanded && 'h-10 w-10 p-0'
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
                  {item.href === '/insurance/personal' && showPersonalSubItems && (
                     <div className={cn("space-y-1", isExpanded ? "pl-4 mt-2 border-l ml-4" : "mt-2")}>
                       {visiblePersonalSubItems.map((subItem) => (
                          <Tooltip key={subItem.label}>
                              <TooltipTrigger asChild>
                                  <Link href={subItem.href}>
                                      <Button
                                          variant={pathname.startsWith(subItem.href) ? 'secondary' : 'ghost'}
                                          className={cn(
                                              "w-full justify-start text-sm h-9",
                                              !isExpanded && "h-10 w-10 p-0"
                                          )}
                                      >
                                        <div className={cn("flex items-center", isExpanded ? "" : "w-full justify-center")}>
                                          <subItem.icon className={cn('h-4 w-4', isExpanded && 'mr-3')} />
                                          <span className={cn(!isExpanded && 'sr-only')}>{subItem.label}</span>
                                        </div>
                                      </Button>
                                  </Link>
                              </TooltipTrigger>
                              {!isExpanded && (
                                  <TooltipContent side="right">
                                      <p>{subItem.label}</p>
                                  </TooltipContent>
                              )}
                          </Tooltip>
                       ))}
                    </div>
                  )}
                  {item.href === '/insurance/project' && showProjectSubItems && (
                     <div className={cn("space-y-1", isExpanded ? "pl-4 mt-2 border-l ml-4" : "mt-2")}>
                       {visibleProjectSubItems.map((subItem) => (
                          <Tooltip key={subItem.label}>
                              <TooltipTrigger asChild>
                                  <Link href={subItem.href}>
                                      <Button
                                          variant={pathname.startsWith(subItem.href) ? 'secondary' : 'ghost'}
                                          className={cn(
                                              "w-full justify-start text-sm h-9",
                                              !isExpanded && "h-10 w-10 p-0"
                                          )}
                                      >
                                        <div className={cn("flex items-center", isExpanded ? "" : "w-full justify-center")}>
                                          <subItem.icon className={cn('h-4 w-4', isExpanded && 'mr-3')} />
                                          <span className={cn(!isExpanded && 'sr-only')}>{subItem.label}</span>
                                        </div>
                                      </Button>
                                  </Link>
                              </TooltipTrigger>
                              {!isExpanded && (
                                  <TooltipContent side="right">
                                      <p>{subItem.label}</p>
                                  </TooltipContent>
                              )}
                          </Tooltip>
                       ))}
                    </div>
                  )}
                </React.Fragment>
              ))}
            </nav>
          </div>
          
          <div className="mt-auto p-2 border-t">
             {settingsItem.permission && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Link href={settingsItem.href}>
                            <Button
                                variant={pathname.startsWith(settingsItem.href) ? 'secondary' : 'ghost'}
                                className={cn(
                                    "w-full justify-start",
                                    !isExpanded && "h-10 w-10 p-0"
                                )}
                            >
                                <div className={cn("flex items-center", isExpanded ? "" : "w-full justify-center")}>
                                    <settingsItem.icon className={cn("h-5 w-5", isExpanded && "mr-3")} />
                                    <span className={cn(!isExpanded && 'sr-only')}>{settingsItem.label}</span>
                                </div>
                            </Button>
                        </Link>
                    </TooltipTrigger>
                    {!isExpanded && (
                        <TooltipContent side="right">
                            <p>{settingsItem.label}</p>
                        </TooltipContent>
                    )}
                </Tooltip>
             )}
            <Button
              variant="ghost"
              className={cn(
                'w-full justify-start mt-1',
                !isExpanded && 'h-10 w-10 p-0 justify-center'
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
       <div className={cn("flex-1 flex flex-col transition-all duration-300", isExpanded ? "ml-56" : "ml-16")}>
        <main
          className={cn(
            'flex-1 p-4 sm:p-6 lg:p-8',
          )}
        >
          {children}
        </main>
         <footer className="flex-shrink-0 flex justify-between items-center text-muted-foreground text-sm py-4 px-6">
            <span>Copyright © 2025 SEL. All Rights Reserved.</span>
        </footer>
      </div>
    </div>
  );
}
