

'use client';

import Link from 'next/link';
import {
  Users,
  Hash,
  ArrowLeft,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

interface SettingsCardProps {
  item: {
    icon: LucideIcon;
    title: string;
    description: string;
    href: string;
    disabled?: boolean;
  };
}

const settingsItems = [
  { 
    icon: Hash, 
    title: 'Serial No. Configuration', 
    description: 'Configure serial numbers for daily requisitions.',
    href: '/settings/serial-no-configuration',
    permission: 'Edit Serial Nos'
  },
   { 
    icon: Users, 
    title: 'User Role Configuration', 
    description: 'Assign users to specific roles within the module.',
    href: '#',
    permission: 'Edit User Rights'
  },
];

function SettingsCard({ item }: SettingsCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                (item.href === '#' || item.disabled) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="flex-col items-start gap-4 space-y-2 p-6">
                <div className="bg-primary/10 p-3 rounded-lg">
                  <item.icon className="w-6 h-6 text-primary" />
                </div>
                <div>
                    <CardTitle className="text-xl font-bold">{item.title}</CardTitle>
                    <CardDescription className="text-sm pt-1">{item.description}</CardDescription>
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

export default function DailyRequisitionSettingsPage() {
    const { can, isLoading: isAuthLoading } = useAuthorization();
    const canViewPage = can('View', 'Daily Requisition.Settings');

    const authorizedSettingsItems = settingsItems.map(item => ({
        ...item,
        disabled: !can(item.permission, 'Daily Requisition.Settings'),
    }));

    if (isAuthLoading) {
        return (
            <div className="w-full px-4 sm:px-6 lg:px-8">
                <Skeleton className="h-10 w-80 mb-6" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    <Skeleton className="h-48" />
                    <Skeleton className="h-48" />
                </div>
            </div>
        );
    }
    
    if (!canViewPage) {
        return (
            <div className="w-full px-4 sm:px-6 lg:px-8">
                <div className="mb-6 flex items-center gap-4">
                    <Link href="/daily-requisition"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-2xl font-bold">Daily Requisition Settings</h1>
                </div>
                <Card>
                    <CardHeader>
                        <CardTitle>Access Denied</CardTitle>
                        <CardDescription>You do not have permission to view this page.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center p-8">
                        <ShieldAlert className="h-16 w-16 text-destructive" />
                    </CardContent>
                </Card>
            </div>
        );
    }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/daily-requisition">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Daily Requisition Settings</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {authorizedSettingsItems.map((item) => (
          <SettingsCard key={item.title} item={item} />
        ))}
      </div>
    </div>
  );
}
