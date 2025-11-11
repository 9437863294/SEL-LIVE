

'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  FilePlus,
  History,
  ShieldAlert,
  FileClock,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

interface BillingCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

function BillingCard({ item }: BillingCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
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


export default function BillingDashboardPage() {
  const params = useParams();
  const projectSlug = params.project as string;
  const { can, isLoading } = useAuthorization();
  
  const isAllProjectsView = projectSlug === 'all';
  
  const billingItems = [
    { icon: FilePlus, text: 'Bill Entry', href: `/subcontractors-management/${projectSlug}/billing/create`, description: 'Generate a new bill from JMC items.', disabled: !can('Create', 'Subcontractors Management.Billing') || isAllProjectsView },
    { icon: FileClock, text: 'Proforma/Advance Bill', href: `/subcontractors-management/${projectSlug}/billing/proforma`, description: 'Create proforma or advance bills.', disabled: !can('Create', 'Subcontractors Management.Billing') || isAllProjectsView },
    { icon: History, text: 'Billing Log', href: `/subcontractors-management/${projectSlug}/billing/log`, description: 'View and manage all past bills.', disabled: !can('View', 'Subcontractors Management.Billing') },
    { icon: History, text: 'Proforma/Advance Log', href: `/subcontractors-management/${projectSlug}/billing/proforma-log`, description: 'View all proforma and advance bills.', disabled: !can('View', 'Subcontractors Management.Billing') },
  ];
  
  const canViewModule = can('View', 'Subcontractors Management.Billing');

  if(isLoading) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-64 mb-6" />
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
            </div>
       </div>
    )
  }

  if(!canViewModule) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
            <Link href={`/subcontractors-management/${projectSlug}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
            <h1 className="text-2xl font-bold">Billing Management</h1>
        </div>
         <Card>
            <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to access billing management.</CardDescription></CardHeader>
            <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href={`/subcontractors-management/${projectSlug}`}>
            <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
            </Button>
        </Link>
        <h1 className="text-2xl font-bold">Billing Management</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {billingItems.map((item) => (
          <BillingCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
