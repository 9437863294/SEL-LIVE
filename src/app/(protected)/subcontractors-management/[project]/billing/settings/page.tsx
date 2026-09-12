
'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  ShieldAlert,
  GitMerge,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { PmContent, PmNavCard, PmNavCardGrid, PmTopbar } from '@/components/project-management/pm-shell';

interface SettingsCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

const settingsItemsBase = [
  {
    icon: GitMerge,
    text: 'Workflow Configuration',
    description: 'Set up approval workflows for bills.',
    href: 'settings/workflow-configuration',
    permission: 'View Settings',
  },
];

function SettingsCard({ item }: SettingsCardProps) {
  const isDisabled = item.href === '#' || item.disabled;

  const card = (
    <Card
      className={cn(
        "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
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
    return <div className="h-full">{card}</div>;
  }

  return (
    <Link
      href={item.href}
      className="no-underline h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-xl"
    >
      {card}
    </Link>
  );
}

export default function BillingSettingsPage() {
  const params = useParams();
  const projectSlug = params.project as string;
  const { can, isLoading } = useAuthorization();
  
  const canViewPage = can('View Settings', 'Subcontractors Management.Billing');

  const settingsItems = settingsItemsBase.map((item) => {
    const base = `/subcontractors-management/${projectSlug}/billing/`;
    const resolvedHref = item.href === '#' ? '#' : `${base}${item.href}`;
    const disabled = isLoading ? true : !can(item.permission, 'Subcontractors Management.Billing');

    return {
      ...item,
      href: resolvedHref,
      disabled,
    };
  });

  if (isLoading) {
    return (
      <PmContent>
        <Skeleton className="h-9 w-64" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          <Skeleton className="h-20 rounded-xl" />
        </div>
      </PmContent>
    );
  }

  if (!canViewPage) {
    return (
      <PmContent>
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access these settings.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </PmContent>
    );
  }

  return (
    <>
      <PmTopbar
        title="Billing Settings"
        breadcrumbs={[
          { label: 'Subcontractors', href: `/subcontractors-management/${projectSlug}` },
          { label: 'Billing', href: `/subcontractors-management/${projectSlug}/billing` },
        ]}
        backHref={`/subcontractors-management/${projectSlug}/billing`}
        backLabel="Back to Billing"
      />
      <PmContent>
        <PmNavCardGrid>
          {settingsItems.map((item) => (
            <PmNavCard
              key={item.text}
              item={{
                icon: item.icon,
                title: item.text,
                description: item.description,
                href: item.href,
                gradient: 'from-slate-500 to-slate-700',
                disabled: item.disabled,
              }}
            />
          ))}
        </PmNavCardGrid>
      </PmContent>
    </>
  );
}
