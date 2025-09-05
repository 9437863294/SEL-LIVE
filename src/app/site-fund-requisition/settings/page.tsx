
'use client';

import Link from 'next/link';
import { ArrowLeft, Users, GitMerge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

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
    icon: Users, 
    title: 'User Rights', 
    description: 'Define permissions for each role.', 
    href: '#' 
  },
  { 
    icon: GitMerge, 
    title: 'Workflow Configuration', 
    description: 'Set the steps, users, and TAT for the process.', 
    href: '/site-fund-requisition/settings/workflow-configuration' 
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

export default function SiteFundRequisitionSettingsPage() {
  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/site-fund-requisition">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Site Fund Requisition Settings</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {settingsItems.map((item) => (
          <SettingsCard key={item.title} item={item} />
        ))}
      </div>
    </div>
  );
}
