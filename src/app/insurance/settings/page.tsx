

'use client';

import Link from 'next/link';
import { ArrowLeft, Users, Building, ShieldAlert, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
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
    icon: Users,
    text: 'Policy Holders',
    href: '/insurance/policy-holders',
    description: 'Manage details of all policy holders.',
    permission: 'View'
  },
  { 
    icon: Building, 
    text: 'Insurance Companies', 
    href: '/insurance/companies', 
    description: 'Manage the list of insurance companies.',
    permission: 'View'
  },
  { 
    icon: Tags, 
    text: 'Policy Category', 
    href: '/insurance/settings/policy-category', 
    description: 'Define categories for project insurance.',
    permission: 'View'
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
            <CardHeader className="flex-col items-center text-center gap-4 p-6">
                <div className="bg-primary/10 p-3 rounded-full">
                  <item.icon className="w-8 h-8 text-primary" />
                </div>
                <div className="space-y-1">
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

export default function InsuranceSettingsPage() {
  const { can, isLoading } = useAuthorization();
  const canViewPage = can('View', 'Insurance.Settings');
  
  const settingsItems = settingsItemsBase.map(item => {
      let moduleScope;
      switch(item.text) {
          case 'Policy Holders': moduleScope = 'Insurance.Settings.Holders'; break;
          case 'Insurance Companies': moduleScope = 'Insurance.Settings.Companies'; break;
          case 'Policy Category': moduleScope = 'Insurance.Settings.Categories'; break;
          default: moduleScope = 'Insurance.Settings';
      }
      return {
          ...item,
          disabled: !can(item.permission, moduleScope)
      }
  });

  if (isLoading) {
      return (
        <div className="w-full">
            <div className="mb-6"><Skeleton className="h-10 w-64" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                <Skeleton className="h-40" />
                <Skeleton className="h-40" />
                <Skeleton className="h-40" />
            </div>
        </div>
      );
  }

  if (!canViewPage) {
      return (
         <div className="w-full">
            <div className="mb-6 flex items-center gap-2">
                <h1 className="text-xl font-bold">Insurance Settings</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to view settings.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8">
                    <ShieldAlert className="h-16 w-16 text-destructive" />
                </CardContent>
            </Card>
         </div>
      );
  }
  
  return (
    <div className="w-full">
        <div className="mb-6 flex items-center gap-2">
            <h1 className="text-xl font-bold">Insurance Settings</h1>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {settingsItems.map((item) => (
                <SettingsCard key={item.text} item={item} />
            ))}
        </div>
    </div>
  );
}
