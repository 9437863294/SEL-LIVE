'use client';

import { CheckCircle2, GitBranch, Hash, Settings, Split, ToggleRight } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import { ActionCard, BrAccessDenied, BrPage, BrPageSkeleton, BrSection, BR_TONE } from '@/components/billing-recon/page-kit';
import { isBillingReconSeparated } from '@/lib/billing-recon/register';

/**
 * Billing Recon › Settings: the module's own settings, as cards with their live state. Per-project
 * JMC / MVAC workflows live under each project's JMC / MVAC › Settings.
 */
export default function BillingReconSettingsPage() {
  const { can, isLoading } = useAuthorization();
  const { projects, billingProjects, loading } = useBillingReconProjects();

  const canViewModule = can('View Module', 'Billing Recon');
  const canSerials = canViewModule || can('Edit Serial Nos', 'Billing Recon.JMC') || can('Edit Serial Nos', 'Billing Recon.MVAC');
  const canSeparation = can('View', 'Billing Recon.Data Separation') || can('Run', 'Billing Recon.Data Separation');
  const separated = billingProjects.filter((p) => isBillingReconSeparated(p)).length;
  const shared = billingProjects.length - separated;

  if (isLoading) return <BrPageSkeleton kpis={3} />;
  if (!canViewModule && !canSerials && !canSeparation) return <BrAccessDenied message="You don't have access to Billing Recon settings." />;

  return (
    <BrPage tone={BR_TONE.settings}>
      <PageHeader
        title="Settings"
        description="Billing Recon's own settings. Each project's JMC and MVAC workflows are under that project's JMC / MVAC › Settings."
        icon={Settings}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Projects with billing on" value={loading ? '—' : billingProjects.length} hint={loading ? undefined : `of ${projects.length} projects`} icon={ToggleRight} tone="cyan" accent />
        <KpiCard label="Separated from Project Management" value={loading ? '—' : separated} hint={loading ? undefined : `${shared} still shared`} icon={GitBranch} tone={shared ? 'amber' : 'emerald'} accent />
        <KpiCard label="Register" value={loading ? '—' : shared ? 'Mixed' : 'Own'} hint={shared ? 'Some projects still share BOQ & JMC' : 'Every billing project has its own records'} icon={CheckCircle2} tone={shared ? 'amber' : 'emerald'} accent />
      </div>

      <BrSection title="Module settings" description="Open a card to change it." icon={Settings} tone={BR_TONE.settings}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {canViewModule && (
            <ActionCard
              href="/billing-recon/settings/billing-status"
              title="Billing Status"
              description="Switch billing on or off per project, with its work order, name of work and signatories. Billing Recon lists the projects switched on."
              icon={ToggleRight}
              tone="cyan"
              figure={loading ? '—' : billingProjects.length}
              figureLabel="projects on"
            />
          )}
          {canSerials && (
            <ActionCard
              href="/billing-recon/settings/serial-no"
              title="Serial No. Configuration"
              description="JMC and MVAC number series — prefix, format and next number — per project and BOQ scope."
              icon={Hash}
              tone="indigo"
            />
          )}
          {canSeparation && (
            <ActionCard
              href="/billing-recon/settings/data-separation"
              title="Data Separation"
              description="Give a project's Billing Recon its own BOQ, JMC and MVAC records, apart from Project Management."
              icon={Split}
              tone="violet"
              figure={loading ? '—' : `${separated}/${billingProjects.length}`}
              figureLabel="separated"
              badge={!loading && shared > 0 ? <StatusBadge tone="warning" status={`${shared} shared`} /> : !loading && billingProjects.length ? <StatusBadge tone="success" status="All separated" /> : undefined}
            />
          )}
        </div>
      </BrSection>
    </BrPage>
  );
}
