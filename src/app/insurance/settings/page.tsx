
'use client';

import Link from 'next/link';
import { ArrowLeft, Users, Building } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';


interface SettingsCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

const settingsItems: Omit<SettingsCardProps['item'], 'disabled'>[] = [
  {
    icon: Users,
    text: 'Policy Holders',
    href: '/insurance/policy-holders',
    description: 'Manage details of all policy holders.'
  },
  { 
    icon: Building, 
    text: 'Insurance Companies', 
    href: '/insurance/companies', 
    description: 'Manage the list of insurance companies.' 
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

    if (item.href === '#') {
        return <div className="h-full">{cardContent}</div>;
    }
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    )
}

export default function InsuranceSettingsPage() {
  return (
    <div className="w-full">
        <div className="mb-6 flex items-center gap-2">
            <h1 className="text-xl font-bold">Insurance Settings</h1>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {settingsItems.map((item) => (
                <SettingsCard key={item.text} item={{...item, disabled: item.href === '#'}} />
            ))}
        </div>
    </div>
  );
}
