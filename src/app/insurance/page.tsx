
'use client';

import Link from 'next/link';
import { Shield, User, Home, HardHat, Car, Settings, ShieldAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

interface InsuranceCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

const insuranceItemsBase: Omit<InsuranceCardProps['item'], 'disabled'>[] = [
  { 
    icon: User, 
    text: 'Personal Insurance', 
    href: '/insurance/personal', 
    description: 'Manage personal health and life insurance policies.' 
  },
  { 
    icon: HardHat, 
    text: 'Project Insurance', 
    href: '/insurance/project', 
    description: 'Handle insurance policies related to specific projects.' 
  },
  { 
    icon: Car, 
    text: 'Vehicle Insurance', 
    href: '#', 
    description: 'Track vehicle insurance policies and renewals.' 
  },
];

function InsuranceCard({ item }: InsuranceCardProps) {
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

export default function InsurancePage() {
  const { can, isLoading } = useAuthorization();
  const canViewModule = can('View Module', 'Insurance');
  
  const insuranceItems = insuranceItemsBase.map(item => {
    let permission = 'View';
    let moduleName = `Insurance.${item.text.replace(' ', ' ')}`;
    return {
      ...item,
      disabled: item.href === '#' || !can(permission, moduleName)
    };
  });

  if (isLoading) {
    return (
        <div className="w-full">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {Array.from({length: 4}).map((_, i) => <Skeleton key={i} className="h-40" />)}
            </div>
        </div>
    )
  }

  if (!canViewModule) {
      return (
        <div className="w-full">
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to access the Insurance module.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8">
                    <ShieldAlert className="h-16 w-16 text-destructive" />
                </CardContent>
            </Card>
        </div>
      )
  }
  
  return (
    <div className="w-full">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {insuranceItems.map((item) => (
          <InsuranceCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
