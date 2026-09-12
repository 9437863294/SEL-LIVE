
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
import { Skeleton } from '@/components/ui/skeleton';
import { PmNavCard, PmNavCardGrid } from '@/components/project-management/pm-shell';

/** Per-tile accents, cycled so neighbouring cards stay tellable apart. */
const TILE_GRADIENTS = [
  'from-sky-500 to-blue-600',
  'from-violet-500 to-purple-600',
  'from-amber-500 to-orange-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
];
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
    ],
    [safeCan]
  );

  return (
    <PmNavCardGrid>
      {dashboardItems.map((item, index) => (
        <PmNavCard
          key={item.text}
          item={{
            icon: item.icon,
            title: item.text,
            description: item.description,
            href: item.href,
            gradient: TILE_GRADIENTS[index % TILE_GRADIENTS.length],
            disabled: item.disabled,
          }}
        />
      ))}
    </PmNavCardGrid>
  );
}
