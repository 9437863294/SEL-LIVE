
'use client';

import Link from 'next/link';
import {
  Settings,
  Hash,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

interface BillingStatusCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
  };
}

const settingsItems = [
  {
    icon: Settings,
    text: 'Billing Status',
    href: '/billing-recon/settings/billing-status',
    description: 'Enable or disable billing requirements for each project.',
  },
  {
    icon: Hash,
    text: 'Serial No. Configuration',
    description: 'Configure serial numbers for JMC, based on Project and Scope.',
    href: '/billing-recon/settings/serial-no',
  },
];

function BillingStatusCard({ item }: BillingStatusCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                'cursor-pointer'
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
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    )
}


export default function ProjectBillingSettingsPage() {
  
  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/billing-recon">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Project Billing Settings</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {settingsItems.map((item) => (
          <BillingStatusCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
