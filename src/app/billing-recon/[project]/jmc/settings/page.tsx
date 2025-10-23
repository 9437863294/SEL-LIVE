

'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  GitMerge,
  ShieldAlert,
  Hash,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

interface SettingsCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

const settingsItemsBase = [
  { 
    icon: GitMerge, 
    text: 'Workflow Configuration', 
    description: 'Set up approval workflows for JMC entries.',
    href: 'settings/workflow-configuration',
    permission: 'View Settings'
  },
  {
    icon: Hash,
    text: 'Serial Number Configuration',
    description: 'Configure serial numbers for JMC entries.',
    href: '#', // To be implemented
    permission: 'Edit Serial Nos'
  },
];

function SettingsCard({ item }: SettingsCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="flex-row items-start gap-4 space-y-0 p-4">
                <div className="bg-primary/10 p-3 rounded-lg">
                <item.icon className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-lg font-semibold">{item.text}</CardTitle>
                    <CardDescription className="mt-1">{item.description}</CardDescription>
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

export default function JmcSettingsPage() {
    const { can, isLoading } = useAuthorization();
    const canViewPage = can('View Settings', 'Billing Recon.JMC');

    const settingsItems = settingsItemsBase.map(item => ({
        ...item,
        disabled: !can(item.permission, 'Billing Recon.JMC'),
    }));

    if (isLoading) {
        return (
            <div className="w-full max-w-6xl mx-auto">
                <Skeleton className="h-10 w-96 mb-6" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    <Skeleton className="h-40" />
                </div>
            </div>
        );
    }
    
    if (!canViewPage) {
        return (
             <div className="w-full max-w-6xl mx-auto">
                <div className="mb-6 flex items-center gap-4">
                    <Link href={`/billing-recon`}>
                        <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
                    </Link>
                    <h1 className="text-xl font-bold">JMC Settings</h1>
                </div>
                <Card>
                    <CardHeader>
                        <CardTitle>Access Denied</CardTitle>
                        <CardDescription>You do not have permission to access these settings.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center p-8">
                        <ShieldAlert className="h-16 w-16 text-destructive" />
                    </CardContent>
                </Card>
             </div>
        );
    }

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <Link href={`/billing-recon`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">JMC Settings</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {settingsItems.map((item) => (
          <SettingsCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
