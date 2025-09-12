
'use client';

import Link from 'next/link';
import {
  Home,
  FilePlus,
  Landmark,
  Receipt,
  Settings,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DailyRequisitionCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
  };
}

function DailyRequisitionCard({ item }: DailyRequisitionCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="flex-col items-start gap-4 space-y-2 p-6">
                <div className="bg-primary/10 p-3 rounded-lg">
                  <item.icon className="w-6 h-6 text-primary" />
                </div>
                <div>
                    <CardTitle className="text-xl font-bold">{item.text}</CardTitle>
                    <CardDescription className="text-sm pt-1">{item.description}</CardDescription>
                </div>
            </CardHeader>
            <CardContent className="mt-auto p-6 pt-0">
                <Button className="w-full">Go to {item.text}</Button>
            </CardContent>
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


export default function DailyRequisitionPage() {
  
  const dailyRequisitionItems = [
    { icon: FilePlus, text: 'Entry Sheet', href: '/daily-requisition/entry-sheet', description: 'Create a new daily requisition.' },
    { icon: Landmark, text: 'Receiving at Finance', href: '#', description: 'Manage entries received by finance.' },
    { icon: Receipt, text: 'GST & TDS Verification', href: '#', 'description': 'Verify GST and TDS for received entries.' },
    { icon: Settings, text: 'Settings', href: '/daily-requisition/settings', description: 'Configure settings for this module.' },
  ];

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/">
            <Button variant="ghost" size="icon">
                <Home className="h-6 w-6" />
            </Button>
        </Link>
        <h1 className="text-2xl font-bold">Daily Requisition</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {dailyRequisitionItems.map((item) => (
          <DailyRequisitionCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
