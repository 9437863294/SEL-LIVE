
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';


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
    <div className="flex h-screen">
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
                      <item.icon className="h-5 w-5" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </Link>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter>
             <SidebarTrigger asChild>
                <Button variant="ghost" className="w-full justify-center">
                    <ChevronLeft className="h-5 w-5" />
                </Button>
             </SidebarTrigger>
          </SidebarFooter>
        </Sidebar>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </SidebarProvider>
    </div>
  );
}
