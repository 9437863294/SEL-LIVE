

'use client';

import Link from 'next/link';
import { ArrowLeft, BarChart3, PieChart, ShieldAlert, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
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
    icon: ClipboardCheck, 
    title: 'My Tasks Summary', 
    description: 'View a step-wise summary of your assigned tasks.', 
    href: '/insurance/reports/my-tasks-summary',
    permission: 'View Reports',
  },
  { 
    icon: BarChart3, 
    title: 'Cashflow Statement', 
    description: 'Analyze the movement of cash over a period.', 
    href: '#',
    permission: 'View Cashflow',
  },
  { 
    icon: PieChart, 
    title: 'Bank Position Report', 
    description: 'View a summary of balances across all banks.',
    href: '#',
    permission: 'View Bank Position',
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
            <CardHeader className="items-center text-center">
                <div className="bg-primary/10 p-4 rounded-full mb-4">
                  <item.icon className="w-8 h-8 text-primary" />
                </div>
                <CardTitle className="text-lg font-semibold">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-center">
                <CardDescription>{item.description}</CardDescription>
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

export default function InsuranceReportsPage() {
    const { can, isLoading } = useAuthorization();
    const canViewPage = can('View Reports', 'Insurance.Reports'); 

    const reportItems = reportItemsBase.map(item => ({
        ...item,
        disabled: !can(item.permission, 'Insurance.Reports'),
    }));
    
    if (isLoading) {
        return (
             <div className="w-full max-w-lg pr-4">
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
            <div className="w-full max-w-lg px-4 sm:px-6 lg:px-8">
                <div className="mb-6 flex items-center gap-4">
                    <Link href="/insurance"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-xl font-bold">Insurance Reports</h1>
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
    <div className="w-full max-w-4xl pr-4">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/insurance">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Insurance Reports</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {reportItems.map((item) => (
          <ReportCard key={item.title} item={item} />
        ))}
      </div>
    </div>
  );
}
