'use client';

import Link from 'next/link';
import { ArrowLeft, GitMerge, ShieldAlert, Hash } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { useMemo } from 'react';

type SettingsBaseItem = {
  icon: LucideIcon;
  text: string;
  description: string;
  href: string; // relative to /billing-recon/[project]/jmc/
  permission: string; // permission action, resource is Billing Recon.JMC
};

type SettingsItem = {
  icon: LucideIcon;
  text: string;
  description: string;
  href: string; // fully-resolved app path
  disabled?: boolean;
};

interface SettingsCardProps {
  item: SettingsItem;
}

const settingsItemsBase: SettingsBaseItem[] = [
  {
    icon: GitMerge,
    text: 'Workflow Configuration',
    description: 'Set up approval workflows for JMC entries.',
    href: 'settings/workflow-configuration',
    permission: 'View Settings',
  },
  {
    icon: Hash,
    text: 'Serial Number Configuration',
    description: 'Configure serial numbers for JMC entries.',
    href: '#', // To be implemented
    permission: 'Edit Serial Nos',
  },
];

function SettingsCard({ item }: SettingsCardProps) {
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
      <CardHeader className="flex-row items-start gap-4 space-y-0 p-4">
        <div className="bg-primary/10 p-3 rounded-lg">
          <item.icon className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1">
          <CardTitle className="text-lg font-semibold">{item.text}</CardTitle>
          <CardDescription className="mt-1">{item.description}</CardDescription>
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
    <Link
      href={item.href}
      className="no-underline h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-xl"
    >
      {card}
    </Link>
  );
}

export default function JmcSettingsPage() {
  const params = useParams();
  const projectSlug = params.project as string;
  const { can, isLoading: authLoading } = useAuthorization();

  // Only evaluate permissions when auth is ready
  const canViewPage = useMemo(() => {
    if (authLoading) return false;
    try {
      return can('View Settings', 'Billing Recon.JMC');
    } catch {
      return false;
    }
  }, [authLoading, can]);

  const settingsItems: SettingsItem[] = useMemo(() => {
    if (!projectSlug) return [];
    const base = `/billing-recon/${projectSlug}/jmc/`;

    // Resolve each card’s href and disabled state with its own permission
    return settingsItemsBase.map((it) => {
      const resolvedHref = it.href === '#' ? '#' : `${base}${it.href}`;
      const disabled =
        authLoading
          ? true
          : ((): boolean => {
              try {
                return !can(it.permission, 'Billing Recon.JMC');
              } catch {
                return true;
              }
            })();

      return {
        icon: it.icon,
        text: it.text,
        description: it.description,
        href: resolvedHref,
        disabled,
      };
    });
  }, [projectSlug, authLoading, can]);

  if (authLoading) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-96 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-4">
          <Link href={`/billing-recon/${projectSlug}`}>
            <Button variant="ghost" size="icon" aria-label="Back">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">JMC Settings</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access these settings.</CardDescription>
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
      <div className="mb-6 flex items-center gap-4">
        <Link href={`/billing-recon/${projectSlug}`}>
          <Button variant="ghost" size="icon" aria-label="Back">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">JMC Settings</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {settingsItems.map((item) => (
          <SettingsCard key={`${item.text}-${item.href}`} item={item} />
        ))}
      </div>
    </div>
  );
}
