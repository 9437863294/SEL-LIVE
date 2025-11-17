
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users,
  FileText,
  Calculator,
  ShieldAlert,
  BarChart3,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from './ui/skeleton';

interface SubcontractorCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

function SubcontractorCard({ item }: SubcontractorCardProps) {
    const isDisabled = item.href === '#' || item.disabled;
    const cardContent = (
      <Card className={cn(
        'flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50',
        isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      )}>
        <CardHeader className="flex-row items-center gap-4 space-y-0 p-4">
          <div className="bg-primary/10 p-3 rounded-lg">
            <item.icon className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-base font-bold">{item.text}</CardTitle>
            <CardDescription className="text-xs">{item.description}</CardDescription>
          </div>
        </CardHeader>
      </Card>
    );
    if (isDisabled) return <div className="h-full">{cardContent}</div>;
  
    return (
      <Link href={item.href} className="no-underline h-full">{cardContent}</Link>
    );
}

export default function AllSubcontractorsDashboard() {
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const safeCan = useCallback(
    (action: string, resource: string) => {
      if (isAuthLoading) return false;
      return typeof can === 'function' ? can(action, resource) : false;
    },
    [can, isAuthLoading]
  );
  
  const dashboardItems = useMemo(
    () => [
      {
        icon: Users,
        text: 'Manage Subcontractors',
        href: `/subcontractors-management/all/manage`,
        description: 'View, add, or edit all subcontractors.',
        disabled: !safeCan('View', 'Subcontractors Management.Manage Subcontractors'),
      },
      {
        icon: FileText,
        text: 'Manage Work Order',
        href: `/subcontractors-management/all/work-order`,
        description: 'View and manage all work orders.',
        disabled: !safeCan('View', 'Subcontractors Management.Work Order'),
      },
      {
        icon: Calculator,
        text: 'Billing',
        href: `/subcontractors-management/all/billing`,
        description: 'Create and manage all bills.',
        disabled: !safeCan('View', 'Subcontractors Management.Billing'),
      },
       {
        icon: BarChart3,
        text: 'Reports',
        href: `/subcontractors-management/all/reports`,
        description: 'View consolidated reports.',
        disabled: !safeCan('View', 'Subcontractors Management.Reports'),
      },
      {
        icon: BarChart3,
        text: 'Work Order Progress Report',
        href: '/subcontractors-management/all/reports/work-order-progress',
        description: 'Track financial and physical progress of work orders.',
        disabled: !safeCan('View', 'Subcontractors Management.Reports.Work Order Progress'),
      },
      {
        icon: BarChart3,
        text: 'Billing Summary Report',
        href: '/subcontractors-management/all/reports/billing-summary',
        description: 'A summary of all billing activities.',
        disabled: !safeCan('View', 'Subcontractors Management.Reports.Billing Summary'),
      },
    ],
    [safeCan]
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {dashboardItems.map((item) => (
        <SubcontractorCard key={item.text} item={item} />
      ))}
    </div>
  );
}
