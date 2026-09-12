
'use client';
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import {
  ArrowLeft,
  ShieldAlert,
  type LucideIcon,
  BarChart4,
  BookCheck,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { ReactNode } from 'react';
import { PmContent, PmNavCard, PmNavCardGrid, PmTopbar } from '@/components/project-management/pm-shell';

const reportItemsBase = [
  { 
    icon: BarChart4,
    gradient: 'from-indigo-500 to-blue-600',
        text: 'Work Order Progress', 
    description: 'Track financial and physical progress of work orders.',
    href: 'reports/work-order-progress',
    permission: 'View',
    permissionResource: 'Subcontractors Management.Reports.Work Order Progress',
  },
  { 
    icon: BookCheck,
    gradient: 'from-emerald-500 to-teal-600',
    text: 'Billing Summary',
    description: 'View a comprehensive summary of all bills.',
    href: 'reports/billing-summary',
    permission: 'View',
    permissionResource: 'Subcontractors Management.Reports.Billing Summary',
  }
];

export default function SubcontractorsReportsPage() {
    const { can, isLoading } = useAuthorization();
    const params = useParams();
    const projectSlug = params.project as string;
    const canViewPage = can('View', 'Subcontractors Management.Reports'); 

    const reportItems = reportItemsBase.map(item => ({
        ...item,
        title: item.text,
        disabled: !can(item.permission, item.permissionResource),
    }));
    
    if (isLoading) {
        return (
             <div className="w-full max-w-lg px-4 sm:px-6 lg:px-8">
                <Skeleton className="h-10 w-48 mb-6" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <Skeleton className="h-56" />
                    <Skeleton className="h-56" />
                </div>
            </div>
        )
    }

    if (!canViewPage) {
        return (
            <PmContent>
                <Card className="border-border/60">
                    <CardHeader>
                        <CardTitle>Access Denied</CardTitle>
                        <CardDescription>You do not have permission to view reports.</CardDescription>
                    </CardHeader>
                     <CardContent className="flex justify-center p-8">
                        <ShieldAlert className="h-16 w-16 text-destructive" />
                    </CardContent>
                </Card>
            </PmContent>
        );
    }

  return (
    <>
      <PmTopbar
        title="Reports"
        breadcrumbs={[
          { label: 'Subcontractors', href: `/subcontractors-management/${projectSlug}` },
        ]}
        backHref={`/subcontractors-management/${projectSlug}`}
        backLabel="Back to Subcontractors"
      />
      <PmContent>
        {reportItems.length > 0 ? (
          <PmNavCardGrid>
            {reportItems.map((item) => (
              <PmNavCard key={item.text} item={{ icon: item.icon, title: item.text, description: item.description, href: item.href, gradient: item.gradient, disabled: item.disabled }} />
            ))}
          </PmNavCardGrid>
        ) : (
          <Card className="border-border/60">
            <CardContent className="p-8 text-center">
                <p className="text-muted-foreground">No reports are currently available for this module.</p>
            </CardContent>
          </Card>
        )}
      </PmContent>
    </>
  );
}
