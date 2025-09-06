
'use client';

import Link from 'next/link';
import { ArrowLeft, BarChart3, PieChart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface ReportCardProps {
  item: {
    icon: LucideIcon;
    title: string;
    description: string;
    href: string;
  };
}

const reportItems = [
  { 
    icon: BarChart3, 
    title: 'Site Fund Summary', 
    description: 'View a summary of all requisitions, including totals and step-wise reports.', 
    href: '#' 
  },
  { 
    icon: PieChart, 
    title: 'Planned vs Actual', 
    description: 'Compare planned requisition amounts against actual approved amounts.', 
    href: '#' 
  },
];

function ReportCard({ item }: ReportCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="items-center text-center">
                <div className="bg-primary/10 p-4 rounded-full mb-4">
                  <item.icon className="w-8 h-8 text-primary" />
                </div>
                <CardTitle className="text-lg font-semibold">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-center">
                <CardDescription>{item.description}</CardDescription>
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

export default function ReportsPage() {
  return (
    <div className="w-full max-w-6xl mx-auto pr-14">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/site-fund-requisition">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Reports</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {reportItems.map((item) => (
          <ReportCard key={item.title} item={item} />
        ))}
      </div>
    </div>
  );
}
