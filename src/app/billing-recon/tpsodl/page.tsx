
'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  ClipboardList,
  Truck,
  Calculator,
  FileEdit,
  BarChart3,
  FilePlus,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BillingReconCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
  };
}

const billingItems = [
  { icon: ClipboardList, text: 'BOQ Entry', href: '#', description: 'Manage Bill of Quantities.' },
  { icon: Truck, text: 'Supply and JMC Entry', href: '#', description: 'Record supply and JMC details.' },
  { icon: Calculator, text: 'Bill Qty Entry', href: '#', description: 'Enter and track bill quantities.' },
  { icon: FileEdit, text: 'Amendment Entry', href: '#', description: 'Manage amendments and revisions.' },
  { icon: BarChart3, text: 'Reports', href: '#', description: 'View and generate billing reports.' },
  { icon: FilePlus, text: 'Create ARD', href: '#', description: 'Create Abstract of Rate Document.' },
];

function BillingReconCard({ item }: BillingReconCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
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

    if (item.href === '#') {
        return <div className="h-full">{cardContent}</div>;
    }
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    )
}


export default function TpsodlPage() {

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/billing-recon">
            <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
            </Button>
        </Link>
        <h1 className="text-2xl font-bold">TPSODL</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {billingItems.map((item) => (
          <BillingReconCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
