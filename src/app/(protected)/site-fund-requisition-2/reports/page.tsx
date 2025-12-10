
'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  ShieldAlert,
  BarChart4,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

interface ReportCardProps {
  item: {
    icon: LucideIcon;
    title: string;
    description: string;
    href: string;
    disabled?: boolean;
  };
}

const reportItemsBase = [
  { 
    icon: BarChart4, 
    title: 'Site Fund Summary', 
    description: 'View a summary of all requisitions, including totals and step-wise reports.', 
    href: 'reports/site-fund-summary',
    permission: 'View Reports',
  },
];

function ReportCard({ item }: ReportCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                (item.href === '#' || item.disabled) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="items-center text-center p-4">
                <div className="bg-primary/10 p-3 rounded-lg mb-2">
                  <item.icon className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-base font-semibold">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-center p-4 pt-0">
                <CardDescription className="text-xs">{item.description}</CardDescription>
            </CardContent>
        </Card>
    )

    if (item.href === '#' || item.disabled) {
        return <div className="h-full">{cardContent}</div>;
    }
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    )
}

export default function ReportsPage() {
    const { can, isLoading } = useAuthorization();
    const params = useParams();
    const projectSlug = params.project as string;
    const canViewPage = can('View', 'Site Fund Requisition 2.Reports'); 

    const reportItems = reportItemsBase.map(item => ({
        ...item,
        disabled: !can(item.permission, 'Site Fund Requisition 2.Reports'),
    }));
    
    if (isLoading) {
        return (
             <div className="w-full max-w-lg pr-4">
                <Skeleton className="h-10 w-48 mb-6" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <Skeleton className="h-56" />
                </div>
            </div>
        )
    }

    if (!canViewPage) {
        return (
            <div className="w-full max-w-lg px-4 sm:px-6 lg:px-8">
                <div className="mb-6 flex items-center gap-4">
                    <Link href="/site-fund-requisition-2"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-xl font-bold">Reports</h1>
                </div>
                <Card>
                    <CardHeader>
                        <CardTitle>Access Denied</CardTitle>
                        <CardDescription>You do not have permission to view reports.</CardDescription>
                    </CardHeader>
                     <CardContent className="flex justify-center p-8">
                        <ShieldAlert className="h-16 w-16 text-destructive" />
                    </CardContent>
                </Card>
            </div>
        );
    }

  return (
    <div className="w-full max-w-4xl px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/site-fund-requisition-2">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Reports</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {reportItems.map((item) => (
          <ReportCard key={item.title} item={item} />
        ))}
      </div>
    </div>
  );
}
