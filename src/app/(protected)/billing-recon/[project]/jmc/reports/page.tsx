
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
import { useParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

interface ReportCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

const ReportCard = ({ item }: ReportCardProps) => {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="items-center text-center p-4">
                <div className="bg-primary/10 p-3 rounded-lg mb-2">
                  <item.icon className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-base font-semibold">{item.text}</CardTitle>
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

export default function JmcReportsPage() {
    const { can, isLoading } = useAuthorization();
    const params = useParams();
    const projectSlug = params.project as string;
    const canViewPage = can('View Reports', 'Billing Recon.JMC'); 

    const reportItemsBase = [
      { 
        icon: BarChart4, 
        text: 'JMC Summary', 
        description: 'A summary of JMC status and progress.',
        href: `/billing-recon/${projectSlug}/jmc/reports/jmc-summary`,
        permission: 'View Reports',
        disabled: false,
      },
    ];

    const reportItems = reportItemsBase.map(item => ({
        ...item,
        disabled: !can(item.permission, 'Billing Recon.JMC') || item.disabled,
    }));
    
    if (isLoading) {
        return (
             <div className="w-full max-w-4xl pr-4">
                <Skeleton className="h-10 w-64 mb-6" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    <Skeleton className="h-48" />
                </div>
            </div>
        )
    }

    if (!canViewPage) {
        return (
            <div className="w-full max-w-lg">
                <div className="mb-6 flex items-center gap-4">
                    <Link href={`/billing-recon/${projectSlug}/jmc`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-2xl font-bold">JMC Reports</h1>
                </div>
                <Card>
                    <CardHeader>
                        <CardTitle>Access Denied</CardTitle>
                        <CardDescription>You do not have permission to view JMC reports.</CardDescription>
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
        <Link href={`/billing-recon/${projectSlug}/jmc`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">JMC Reports</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {reportItems.map((item) => (
          <ReportCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
