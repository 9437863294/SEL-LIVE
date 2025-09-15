

'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  Briefcase,
  Tags,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthorization } from '@/hooks/useAuthorization';

interface ReportCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

function ReportCard({ item }: ReportCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
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

    if (item.href === '#' || item.disabled) {
        return <div className="h-full">{cardContent}</div>;
    }
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    )
}


export default function ExpenseReportsPage() {
  const { can, isLoading } = useAuthorization();

  const reportItems = [
    { icon: Building2, text: 'Department-wise Summary', href: '/expenses/reports/department-summary', description: 'Summary of expenses for each department.', disabled: !can('View All', 'Expenses.Expense Requests') },
    { icon: Briefcase, text: 'Project-wise Summary', href: '/expenses/reports/project-summary', description: 'Breakdown of expenses by project.', disabled: !can('View All', 'Expenses.Expense Requests') },
    { icon: Tags, text: 'Head of Account Summary', href: '/expenses/reports/account-summary', description: 'Consolidated view based on account heads.', disabled: !can('View All', 'Expenses.Expense Requests') },
  ];

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/expenses">
            <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
            </Button>
        </Link>
        <h1 className="text-2xl font-bold">Expense Reports</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {reportItems.map((item) => (
          <ReportCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
