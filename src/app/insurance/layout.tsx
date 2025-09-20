
'use client';

import { useState } from 'react';
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

export default function InsuranceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const pathname = usePathname();

  const navItems = [
    { href: '/insurance', icon: Shield, label: 'Insurance Module' },
    { href: '/insurance/personal', icon: Users, label: 'Personal Insurance' },
  ];
  
  const settingsItem = { href: '/insurance/settings', icon: Settings, label: 'Settings' };

  const personalInsuranceSubItems = [
    { href: '/insurance/premium-due', icon: CalendarClock, label: 'Premium Due' },
    { href: '/insurance/maturity-due', icon: ShieldCheck, label: 'Maturity Due' },
  ];
  
  const showSubItems = pathname.startsWith('/insurance/personal');

  return (
    <div className="flex w-full h-full">
      <aside
        className={cn(
          'fixed left-0 top-16 h-[calc(100vh-4rem)] z-40 flex flex-col border-r bg-background transition-all duration-300',
          isExpanded ? 'w-56' : 'w-16'
        )}
      >
        <TooltipProvider delayDuration={0}>
          <div className="flex-1 p-2">
            <nav className="flex flex-col gap-1">
              {navItems.map((item) => (
                <Tooltip key={item.label}>
                  <TooltipTrigger asChild>
                    <Link href={item.href}>
                      <Button
                        variant={pathname === item.href || (item.href !== '/insurance' && pathname.startsWith(item.href)) ? 'secondary' : 'ghost'}
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
              ))}
              {showSubItems && (
                <div className={cn("space-y-1", isExpanded ? "pl-4 mt-2 border-l ml-4" : "mt-2")}>
                   {personalInsuranceSubItems.map((item) => (
                      <Tooltip key={item.label}>
                          <TooltipTrigger asChild>
                              <Link href={item.href}>
                                  <Button
                                      variant={pathname.startsWith(item.href) ? 'secondary' : 'ghost'}
                                      className={cn(
                                          "w-full justify-start text-sm h-9",
                                          !isExpanded && "h-10 w-10 p-0"
                                      )}
                                  >
                                    <div className={cn("flex items-center", isExpanded ? "" : "w-full justify-center")}>
                                      <item.icon className={cn('h-4 w-4', isExpanded && 'mr-3')} />
                                      <span className={cn(!isExpanded && 'sr-only')}>{item.label}</span>
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
                </div>
              )}
            </nav>
          </div>
          
          <div className="mt-auto p-2 border-t">
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
      <main
        className={cn(
          'flex-1 transition-all duration-300 p-4 sm:p-6 lg:p-8',
          isExpanded ? 'ml-56' : 'ml-16'
        )}
      >
        {children}
      </main>
    </div>
  );
}
