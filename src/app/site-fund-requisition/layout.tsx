
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Settings, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const navItems = [
    { href: '#', icon: FileText, label: 'Reports' },
    { href: '/site-fund-requisition/settings', icon: Settings, label: 'Settings' }
];

export default function SiteFundRequisitionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="flex w-full h-full">
      <div className={cn("flex-1 transition-all duration-300", isExpanded ? "mr-48" : "mr-16")}>
        {children}
      </div>
      <aside 
        className={cn(
            "fixed right-0 top-16 h-[calc(100vh-4rem)] z-40 flex flex-col border-l bg-background transition-all duration-300",
            isExpanded ? "w-48" : "w-16"
        )}
      >
        <TooltipProvider delayDuration={0}>
          <div className="flex-1 p-2">
            <nav className="flex flex-col items-center gap-1">
              {navItems.map(item => (
                <Tooltip key={item.label}>
                    <TooltipTrigger asChild>
                       <Link href={item.href}>
                         <Button
                            variant="ghost"
                            className={cn(
                                "w-full justify-start",
                                isExpanded ? "px-3" : "h-10 w-10 p-0"
                            )}
                         >
                            <item.icon className={cn("h-5 w-5", isExpanded && "mr-3")} />
                            <span className={cn(!isExpanded && "sr-only")}>{item.label}</span>
                         </Button>
                       </Link>
                    </TooltipTrigger>
                    {!isExpanded && (
                       <TooltipContent side="left">
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
                    isExpanded ? "px-3" : "h-10 w-10 p-0"
                )}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {isExpanded ? (
                    <>
                        <ChevronRight className="h-5 w-5 mr-3" />
                        <span>Collapse</span>
                    </>
                ) : (
                    <ChevronLeft className="h-5 w-5" />
                )}
                <span className="sr-only">Toggle Sidebar</span>
            </Button>
        </div>

      </aside>
    </div>
  );
}
