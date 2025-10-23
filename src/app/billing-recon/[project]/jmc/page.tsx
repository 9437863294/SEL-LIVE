
'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  FilePlus,
  ClipboardCheck,
  History,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { useMemo } from 'react';

type JmcItem = {
  icon: LucideIcon;
  text: string;
  href: string;
  description: string;
  disabled?: boolean;
};

interface JmcCardProps {
  item: JmcItem;
}

function JmcCard({ item }: JmcCardProps) {
  const isDisabled = item.href === '#' || item.disabled;

  const card = (
    <Card
      className={cn(
        'flex flex-col h-full transition-all duration-300 ease-in-out bg-background rounded-xl border-border/80',
        !isDisabled && 'hover:shadow-lg hover:border-primary/50',
        isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      )}
      aria-disabled={isDisabled || undefined}
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
  );

  if (isDisabled) {
    return (
      <div className="h-full" title="You don't have permission for this" tabIndex={-1}>
        {card}
      </div>
    );
  }

  return (
    <Link href={item.href} className="no-underline h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-xl">
      {card}
    </Link>
  );
}

export default function JmcPage() {
  const params = useParams<{ project: string }>();
  const projectSlug = params.project;
  const { can, isLoading } = useAuthorization();

  const canViewModule = can('View', 'Billing Recon.JMC');

  const jmcItems: JmcItem[] = useMemo(() => {
    if (isLoading) return [];
    return [
      {
        icon: FilePlus,
        text: 'Create Work Order',
        href: `/billing-recon/${projectSlug}/jmc/work-order`,
        description: 'Issue a new work order to a subcontractor.',
        disabled: !can('Create Work Order', 'Billing Recon.JMC'),
      },
      {
        icon: ClipboardCheck,
        text: 'Create JMC',
        href: `/billing-recon/${projectSlug}/jmc/entry`,
        description: 'Create a Joint Measurement Certificate.',
        disabled: !can('Create JMC Entry', 'Billing Recon.JMC'),
      },
      {
        icon: History,
        text: 'JMC Log',
        href: `/billing-recon/${projectSlug}/jmc/log`,
        description: 'View and manage existing JMC entries.',
        disabled: !can('View Log', 'Billing Recon.JMC'),
      },
      {
        icon: ClipboardCheck,
        text: 'Certified JMC',
        href: `/billing-recon/${projectSlug}/jmc/certified`,
        description: 'View JMC entries that have been certified.',
        disabled: !can('View Certified JMC', 'Billing Recon.JMC'),
      },
    ];
  }, [projectSlug, isLoading, can]); 

  if (isLoading) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-64 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
           <Skeleton className="h-28" />
        </div>
      </div>
    );
  }

  if (!canViewModule) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href={`/billing-recon/${projectSlug}`}>
            <Button variant="ghost" size="icon" aria-label="Back">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">JMC Management</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access JMC management.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href={`/billing-recon/${projectSlug}`}>
          <Button variant="ghost" size="icon" aria-label="Back">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">JMC Management</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {jmcItems.map((item) => (
          <JmcCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
