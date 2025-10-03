
'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import {
  LayoutDashboard,
  Warehouse,
  ArrowRightLeft,
  GitCommit,
  Component,
  BarChart3,
  BrainCircuit,
  ClipboardList,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarTrigger,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';


function CustomSidebarFooter() {
    const { state, toggleSidebar } = useSidebar();
    const isExpanded = state === 'expanded';

    return (
        <SidebarFooter>
            <div className="flex w-full items-center justify-center data-[state=expanded]:justify-end">
                <Button
                    variant="ghost"
                    className={cn(
                        'w-full justify-start',
                        !isExpanded && 'h-10 w-10 p-0 justify-center'
                    )}
                    onClick={toggleSidebar}
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
        </SidebarFooter>
    );
}


export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useParams();
  const projectSlug = params.project as string;

  const navItems = [
    { href: `/store-stock-management/${projectSlug}`, icon: LayoutDashboard, label: 'Dashboard' },
    { href: `/store-stock-management/${projectSlug}/inventory`, icon: Warehouse, label: 'Inventory' },
    { href: `/store-stock-management/${projectSlug}/transactions`, icon: ArrowRightLeft, label: 'Transactions' },
    { href: `/store-stock-management/${projectSlug}/conversions`, icon: GitCommit, label: 'Conversions' },
    { href: `/store-stock-management/${projectSlug}/assembly`, icon: Component, label: 'Assembly' },
    { href: `/store-stock-management/${projectSlug}/boq`, icon: ClipboardList, label: 'BOQ' },
    { href: `/store-stock-management/${projectSlug}/reports`, icon: BarChart3, label: 'Reports' },
    { href: `/store-stock-management/${projectSlug}/ai-forecast`, icon: BrainCircuit, label: 'AI Forecast' },
  ];

  return (
    <SidebarProvider>
        <Sidebar>
            <SidebarHeader>
                 <h2 className="text-lg font-semibold px-2 truncate">Stock Management</h2>
                 {projectSlug && <p className="text-sm text-muted-foreground px-2 truncate capitalize">{projectSlug.replace(/-/g, ' ')}</p>}
            </SidebarHeader>
            <SidebarContent>
                <SidebarMenu>
                    {navItems.map((item) => (
                        <SidebarMenuItem key={item.label}>
                            <Link href={item.href}>
                                <SidebarMenuButton
                                    isActive={pathname === item.href}
                                    tooltip={item.label}
                                >
                                    <item.icon/>
                                    <span>{item.label}</span>
                                </SidebarMenuButton>
                            </Link>
                        </SidebarMenuItem>
                    ))}
                </SidebarMenu>
            </SidebarContent>
            <CustomSidebarFooter/>
        </Sidebar>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </SidebarProvider>
  );
}
