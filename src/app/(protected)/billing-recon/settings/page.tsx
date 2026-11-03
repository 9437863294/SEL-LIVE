'use client';

import Link from 'next/link';
import { ChevronRight, Hash, Settings, Split, type LucideIcon } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { PageAccessDenied } from '@/components/shared/module-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import { isBillingReconSeparated } from '@/lib/billing-recon/register';

interface SettingsCard {
  icon: LucideIcon;
  title: string;
  href: string;
  description: string;
  status?: string;
  visible: boolean;
}

export default function BillingReconSettingsPage() {
  const { can, isLoading } = useAuthorization();
  const { billingProjects, loading } = useBillingReconProjects();

  const canViewModule = can('View Module', 'Billing Recon');
  const separated = billingProjects.filter((p) => isBillingReconSeparated(p)).length;

  const cards: SettingsCard[] = [
    {
      icon: Settings,
      title: 'Billing Status',
      href: '/billing-recon/settings/billing-status',
      description: 'Switch billing on or off for each project. Billing Recon lists the projects switched on.',
      status: loading ? undefined : `${billingProjects.length} projects with billing on`,
      visible: canViewModule,
    },
    {
      icon: Hash,
      title: 'Serial No. Configuration',
      href: '/billing-recon/settings/serial-no',
      description: 'JMC and MVAC number series, per project and BOQ scope.',
      visible:
        canViewModule ||
        can('Edit Serial Nos', 'Billing Recon.JMC') ||
        can('Edit Serial Nos', 'Billing Recon.MVAC'),
    },
    {
      icon: Split,
      title: 'Data Separation',
      href: '/billing-recon/settings/data-separation',
      description: "Give a project's Billing Recon its own BOQ, JMC and MVAC records, apart from Project Management.",
      status: loading ? undefined : `${separated} of ${billingProjects.length} separated`,
      visible: can('View', 'Billing Recon.Data Separation') || can('Run', 'Billing Recon.Data Separation'),
    },
  ];
  const visible = cards.filter((c) => c.visible);

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (visible.length === 0) return <PageAccessDenied message="You don't have access to Billing Recon settings." />;

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Billing Recon's own settings. Each project's JMC and MVAC workflows are under that project's JMC / MVAC › Settings." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((card) => (
          <Link key={card.href} href={card.href} className="group h-full no-underline">
            <Card className="flex h-full flex-col rounded-xl transition-all duration-200 hover:border-primary/50 hover:shadow-md">
              <CardHeader className="flex-row items-start gap-4 space-y-0 p-4">
                <div className="rounded-lg bg-primary/10 p-3">
                  <card.icon className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    {card.title}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs">{card.description}</CardDescription>
                  {card.status && <div className="mt-2 text-xs font-medium text-foreground/80">{card.status}</div>}
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
