
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LayoutDashboard, Plus, BarChart3, ChevronLeft, ChevronRight, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuthorization } from '@/hooks/useAuthorization';
import { usePathname } from 'next/navigation';

export default function LoanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { can } = useAuthorization();
  const pathname = usePathname();

  const navItems = [
    { href: '/loan', icon: LayoutDashboard, label: 'Dashboard', permission: can('View', 'Loan.Dashboard') },
    { href: '/loan/manage', icon: Briefcase, label: 'Manage Loans', permission: can('View', 'Loan.Dashboard') },
    { href: '/loan/emi-summary', icon: BarChart3, label: 'EMI Details', permission: can('View', 'Loan.Dashboard') },
    { href: '/loan/reports', icon: BarChart3, label: 'Reports', permission: can('View', 'Loan.Reports') },
  ];

  const visibleNavItems = navItems.filter(item => item.permission);
  
  const isPrintPage = pathname.includes('/print');
  if (isPrintPage) {
    return <>{children}</>;
  }

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
      <div className={cn("flex-1 flex flex-col min-h-screen transition-all duration-300", isExpanded ? "ml-56" : "ml-16")}>
        <main className="flex-grow p-4 sm:p-6 lg:p-8">
          {children}
        </main>
        <footer className="flex-shrink-0 flex justify-between items-center text-muted-foreground text-sm py-4 px-6">
            <span>Copyright © 2025 SEL. All Rights Reserved.</span>
        </footer>
      </div>
    </div>
  );
}
