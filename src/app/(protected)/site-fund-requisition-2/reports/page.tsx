
'use client';
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import {
  ArrowLeft,
  ShieldAlert,
  type LucideIcon,
  BarChart4,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { ReactNode } from 'react';

interface ReportCardProps {
  item: {
    icon: LucideIcon;
    title: ReactNode;
    description: string;
    href: string;
    disabled?: boolean;
  };
}

const reportItemsBase = [
  { 
    icon: BarChart4, 
    text: 'Site Fund Summary', 
    description: 'View a summary of all requisitions, including totals and step-wise reports.', 
    href: 'reports/site-fund-summary',
    permission: 'View',
    permissionResource: 'Site Fund Requisition 2.Reports.Site Fund Summary',
  },
];

function ReportCard({ item }: ReportCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "group flex flex-col h-full overflow-hidden rounded-2xl border border-white/70 bg-white/65 shadow-[0_18px_60px_-45px_rgba(2,6,23,0.35)] backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_80px_-55px_rgba(2,6,23,0.55)]",
                (item.href === '#' || item.disabled) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <div className="h-1.5 w-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-70" />
            <CardHeader className="items-center text-center p-5">
                <div className="mb-2 rounded-2xl border border-white/70 bg-white/70 p-3 shadow-sm transition-colors group-hover:bg-white">
                  <item.icon className="h-6 w-6 text-slate-900/80" />
                </div>
                <CardTitle className="text-base font-semibold text-slate-900">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-center px-5 pb-6 pt-0">
                <CardDescription className="text-xs text-slate-600">{item.description}</CardDescription>
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
    const canViewPage = can('View', 'Site Fund Requisition 2.Reports'); 

    const reportItems = reportItemsBase.map(item => ({
        ...item,
        title: item.text,
        disabled: !can(item.permission, item.permissionResource),
    }));
    
    if (isLoading) {
        return (
             <div className="w-full px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
                <Skeleton className="h-10 w-48 mb-6" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <Skeleton className="h-56" />
                </div>
            </div>
        )
    }

    if (!canViewPage) {
        return (
            <div className="w-full px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
                <div className="mb-6 flex items-center gap-3">
                    <Link href="/site-fund-requisition-2">
                      <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-6 w-6" />
                      </Button>
                    </Link>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Site Fund Requisition 2</p>
                      <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Reports</h1>
                    </div>
                </div>
                <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
                    <div className="h-1.5 w-full bg-gradient-to-r from-rose-400 via-amber-300 to-cyan-400 opacity-70" />
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
    <div className="w-full px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/site-fund-requisition-2">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Site Fund Requisition 2</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-600">Summaries and step-wise performance views.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {reportItems.map((item) => (
          <ReportCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
