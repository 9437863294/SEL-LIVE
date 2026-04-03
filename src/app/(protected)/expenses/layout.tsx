
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Settings, Layers, BarChart3, ChevronLeft, ChevronRight, Receipt, TrendingUp, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuthorization } from '@/hooks/useAuthorization';
import { usePathname } from 'next/navigation';

export default function ExpensesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { can } = useAuthorization();
  const pathname = usePathname();

  const navItems = [
    {
      href: '/expenses',
      icon: LayoutDashboard,
      label: 'Overview',
      permission: true,
      exact: true,
    },
    {
      href: '/expenses/all',
      icon: Layers,
      label: 'Consolidated View',
      permission: can('View All', 'Expenses.Expense Requests'),
      exact: false,
    },
    {
      href: '/expenses/reports',
      icon: BarChart3,
      label: 'Reports',
      permission: can('View', 'Expenses.Reports'),
      exact: false,
    },
    {
      href: '/expenses/settings',
      icon: Settings,
      label: 'Settings',
      permission: can('View', 'Expenses.Settings'),
      exact: false,
    },
  ];

  const visibleNavItems = navItems.filter(item => item.permission);

  const isActive = (item: typeof navItems[0]) => {
    if (!pathname) return false;
    if (item.exact) return pathname === item.href;
    return pathname.startsWith(item.href);
  };

  const isPrintPage = pathname?.includes('/print') ?? false;
  if (isPrintPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex w-full h-full">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-16 h-[calc(100vh-4rem)] z-40 flex flex-col',
          'border-r border-border/50 transition-all duration-300 ease-in-out',
          'bg-background/80 backdrop-blur-xl',
          isExpanded ? 'w-52' : 'w-16'
        )}
        style={{
          boxShadow: '2px 0 20px rgba(0,0,0,0.08)',
        }}
      >
        {/* Sidebar top gradient accent */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

        {/* Module Header */}
        <div
          className={cn(
            'flex items-center gap-3 px-3 py-4 border-b border-border/40',
            'transition-all duration-300',
            isExpanded ? 'justify-start' : 'justify-center'
          )}
        >
          <div
            className={cn(
              'flex-shrink-0 flex items-center justify-center rounded-lg',
              'bg-primary/10 border border-primary/20 transition-all duration-300',
              isExpanded ? 'h-9 w-9' : 'h-9 w-9'
            )}
          >
            <Receipt className="h-4 w-4 text-primary" />
          </div>
          {isExpanded && (
            <div className="min-w-0">
              <p className="text-xs font-bold text-foreground truncate">Expenses</p>
              <p className="text-[10px] text-muted-foreground truncate">Management</p>
            </div>
          )}
        </div>

        {/* Nav Items */}
        <TooltipProvider delayDuration={0}>
          <div className="flex-1 p-2 pt-3">
            <nav className="flex flex-col gap-1">
              {visibleNavItems.map(item => {
                const active = isActive(item);
                return (
                  <Tooltip key={item.label}>
                    <TooltipTrigger asChild>
                      <Link href={item.href} className="block">
                        <div
                          className={cn(
                            'relative flex items-center rounded-lg transition-all duration-200 cursor-pointer group',
                            isExpanded ? 'px-3 py-2.5 gap-3' : 'h-10 w-10 mx-auto justify-center',
                            active
                              ? 'bg-primary/10 text-primary'
                              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                          )}
                        >
                          {/* Active indicator bar */}
                          {active && (
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.8)]" />
                          )}

                          <item.icon
                            className={cn(
                              'h-4 w-4 flex-shrink-0 transition-all duration-200',
                              active ? 'text-primary drop-shadow-sm' : 'text-muted-foreground group-hover:text-foreground'
                            )}
                          />

                          {isExpanded && (
                            <span
                              className={cn(
                                'text-sm font-medium truncate transition-all duration-200',
                                active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                              )}
                            >
                              {item.label}
                            </span>
                          )}
                        </div>
                      </Link>
                    </TooltipTrigger>
                    {!isExpanded && (
                      <TooltipContent side="right" className="font-medium">
                        <p>{item.label}</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </nav>
          </div>
        </TooltipProvider>

        {/* Collapse Toggle */}
        <div className="p-2 border-t border-border/40">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              'flex items-center rounded-lg transition-all duration-200 w-full',
              'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              isExpanded ? 'px-3 py-2.5 gap-3' : 'h-10 w-10 mx-auto justify-center'
            )}
          >
            {isExpanded ? (
              <>
                <ChevronLeft className="h-4 w-4 flex-shrink-0" />
                <span className="text-sm font-medium">Collapse</span>
              </>
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div
        className={cn(
          'flex-1 flex flex-col min-h-screen transition-all duration-300',
          isExpanded ? 'ml-52' : 'ml-16'
        )}
      >
        <main className="flex-grow py-6">
          {children}
        </main>
        <footer className="flex-shrink-0 flex justify-between items-center text-muted-foreground text-xs py-3 px-6 border-t border-border/30">
          <span>Copyright © 2025 SEL. All Rights Reserved.</span>
          <span className="flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" />
            Expenses Module
          </span>
        </footer>
      </div>
    </div>
  );
}
