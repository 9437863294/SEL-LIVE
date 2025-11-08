'use client';
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ArrowLeft, LineChart, Banknote, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

interface ReportItemConfig {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  // Permission model: action + resource to pass into `can`
  permissionAction: string;
  permissionResource: string;
}

interface ReportCardProps {
  item: {
    icon: LucideIcon;
    title: string;
    description: string;
    href: string;
    disabled?: boolean;
  };
}

const reportItemsBase: ReportItemConfig[] = [
  { 
    icon: LineChart,
    title: 'Cashflow Statement',
    description: 'Analyze the movement of cash over a period.',
    href: '/bank-balance/reports/cashflow-statement',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Reports.Cashflow',
  },
  { 
    icon: Banknote,
    title: 'Bank Position Report',
    description: 'View a summary of balances across all banks.',
    href: '/bank-balance/reports/bank-position',
    permissionAction: 'View',
    permissionResource: 'Bank Balance.Reports.BankPosition',
  },
];

function ReportCard({ item }: ReportCardProps) {
  const isDisabled = item.disabled || item.href === '#';

  const cardContent = (
    <Card
      className={cn(
        'flex flex-col h-full transition-all duration-300 ease-in-out bg-background rounded-xl border border-border/80',
        !isDisabled && 'hover:shadow-lg hover:border-primary/50 cursor-pointer',
        isDisabled && 'cursor-not-allowed opacity-60'
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
  );

  if (isDisabled) {
    return <div className="h-full">{cardContent}</div>;
  }

  return (
    <Link href={item.href} className="no-underline h-full">
      {cardContent}
    </Link>
  );
}

export default function BankReportsPage() {
  const { can, isLoading } = useAuthorization();

  // Overall access to the reports section
  const canViewPage = can('View Module', 'Bank Balance');

  // Derive per-card disabled state from permission config
  const reportItems = reportItemsBase.map((item) => ({
    ...item,
    disabled: !can(item.permissionAction, item.permissionResource),
  }));

  if (isLoading) {
    return (
      <div className="w-full max-w-lg px-4 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-48 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full max-w-lg px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-4">
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Bank Reports</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view reports.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/bank-balance">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Bank Reports</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {reportItems.map((item) => (
          <ReportCard key={item.title} item={item} />
        ))}
      </div>
    </div>
  );
}
