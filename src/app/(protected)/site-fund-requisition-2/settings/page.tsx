'use client';

import Link from 'next/link';
import { GitMerge } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface SettingsCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

const settingsItems = [
  {
    icon: GitMerge,
    text: 'Workflow Configuration',
    href: '/site-fund-requisition-2/settings/workflow-configuration',
    description: 'Set the steps, users, and TAT for the process.',
  },
];

function SettingsCard({ item }: SettingsCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "group flex flex-col h-full overflow-hidden rounded-2xl border border-white/70 bg-white/65 shadow-[0_18px_60px_-45px_rgba(2,6,23,0.35)] backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_80px_-55px_rgba(2,6,23,0.55)]",
                item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <div className="h-1.5 w-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-70" />
            <CardHeader className="flex-row items-center gap-4 space-y-0 p-5">
                <div className="rounded-2xl border border-white/70 bg-white/70 p-3 shadow-sm transition-colors group-hover:bg-white">
                  <item.icon className="h-6 w-6 text-slate-900/80" />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-slate-900">{item.text}</CardTitle>
                    <CardDescription className="mt-1 text-xs text-slate-600">{item.description}</CardDescription>
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

export default function SiteFundRequisitionSettingsPage() {
  return (
    <div className="w-full px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
      <PageHeader
        backHref="/site-fund-requisition-2"
        backLabel="Back to dashboard"
        eyebrow="Site Fund Requisition 2"
        title="Settings"
        description="Configure workflow, assignments, actions, and TAT."
      />
       <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {settingsItems.map((item) => (
          <SettingsCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
