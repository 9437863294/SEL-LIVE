
'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Users,
  FileText,
  Calculator,
  ShieldAlert,
  BarChart3,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { ReactNode } from 'react';

interface ReportCardProps {
  item: {
    icon: LucideIcon;
    title: ReactNode;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

const reportItemsBase = [
  { 
    icon: BarChart3, 
    text: 'Work Order Progress', 
    description: 'Track financial and physical progress of work orders.',
    href: 'reports/work-order-progress',
    permission: 'View',
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

export default function SubcontractorsReportsPage() {
    const { can, isLoading } = useAuthorization();
    const params = useParams();
    const projectSlug = params.project as string;
    const canViewPage = can('View', 'Subcontractors Management.Reports'); 

    const reportItems = reportItemsBase.map(item => ({
        ...item,
        title: item.text,
        disabled: !can('View Reports', 'Subcontractors Management.Reports'),
    }));
    
    if (isLoading) {
        return (
             <div className="w-full max-w-lg px-4 sm:px-6 lg:px-8">
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
                    <Link href={`/subcontractors-management/${projectSlug}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-xl font-bold">Subcontractor Reports</h1>
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
        <Link href={`/subcontractors-management/${projectSlug}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Subcontractor Reports</h1>
      </div>
      {reportItems.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {reportItems.map((item) => (
            <ReportCard key={item.text} item={item} />
            ))}
        </div>
      ) : (
        <Card>
            <CardContent className="p-8 text-center">
                <p className="text-muted-foreground">No reports are currently available for this module.</p>
            </CardContent>
        </Card>
      )}
    </div>
  );
}
