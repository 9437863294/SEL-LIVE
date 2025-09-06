
'use client';

import Link from 'next/link';
import { Settings, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export default function SiteFundRequisitionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full h-full">
      <div className="flex-1">
        {children}
      </div>
      <aside className="fixed right-0 top-16 h-[calc(100vh-4rem)] z-40">
        <div className="flex flex-col items-center h-full p-2 border-l bg-background">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="#">
                  <Button variant="ghost" size="icon">
                    <FileText className="h-5 w-5" />
                    <span className="sr-only">Reports</span>
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p>Reports</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/site-fund-requisition/settings">
                  <Button variant="ghost" size="icon">
                    <Settings className="h-5 w-5" />
                    <span className="sr-only">Settings</span>
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p>Site Fund Requisition Settings</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </aside>
    </div>
  );
}
