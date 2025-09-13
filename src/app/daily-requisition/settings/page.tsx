
'use client';

import Link from 'next/link';
import {
  Users,
  Hash,
  ArrowLeft,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SettingsCardProps {
  item: {
    icon: LucideIcon;
    title: string;
    description: string;
    href: string;
  };
}

const settingsItems = [
  { 
    icon: Hash, 
    title: 'Serial No. Configuration', 
    description: 'Configure serial numbers for daily requisitions.',
    href: '/settings/serial-no-configuration' 
  },
   { 
    icon: Users, 
    title: 'User Role Configuration', 
    description: 'Assign users to specific roles within the module.',
    href: '#' 
  },
];

function SettingsCard({ item }: SettingsCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="flex-row items-start gap-4 space-y-0 p-4">
                <div className="bg-primary/10 p-3 rounded-lg">
                  <item.icon className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-lg font-semibold">{item.title}</CardTitle>
                    <CardDescription className="mt-1">{item.description}</CardDescription>
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

export default function DailyRequisitionSettingsPage() {
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
        {settingsItems.map((item) => (
          <SettingsCard key={item.title} item={item} />
        ))}
      </div>
    </div>
  );
}
