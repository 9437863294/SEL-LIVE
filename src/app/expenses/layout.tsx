

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Settings, Layers, BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuthorization } from '@/hooks/useAuthorization';

export default function ExpensesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { can } = useAuthorization();

  const navItems = [
    { href: '/expenses/all', icon: Layers, label: 'Consolidated View', permission: can('View All', 'Expenses.Expense Requests') },
    { href: '/expenses/reports', icon: BarChart3, label: 'Reports', permission: can('View', 'Expenses.Reports') },
    { href: '/expenses/settings', icon: Settings, label: 'Settings', permission: can('View', 'Expenses.Settings') }
  ];

  const visibleNavItems = navItems.filter(item => item.permission);

  return (
    <div className="flex w-full h-full">
      <aside 
        className={cn(
            "fixed left-0 top-16 h-[calc(100vh-4rem)] z-40 flex flex-col border-r bg-background transition-all duration-300",
            isExpanded ? "w-48" : "w-16"
        )}
      >
        <TooltipProvider delayDuration={0}>
          <div className="flex-1 p-2">
            <nav className="flex flex-col items-center gap-1">
              {visibleNavItems.map(item => (
                <Tooltip key={item.label}>
                    <TooltipTrigger asChild>
                       <Link href={item.href}>
                         <Button
                            variant="ghost"
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
      <main className={cn("flex-1 transition-all duration-300", isExpanded ? "ml-48" : "ml-16")}>
        {children}
      </main>
    </div>
  );
}
