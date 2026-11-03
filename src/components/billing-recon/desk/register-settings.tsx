'use client';

/**
 * JMC / MVAC › Settings: the register's settings as cards with their live state, back to the
 * register's desk. The workflow card counts the steps of the workflow this project's register uses
 * — read exactly as the workflow configuration page reads it (the project's JMC workflow, its own
 * once separated; the one MVAC workflow every project shares).
 *
 * Used by `billing-recon/[project]/jmc/settings/page.tsx` and `.../mvac/settings/page.tsx`.
 */

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { GitMerge, Hash, Settings } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import { ActionCard, BrAccessDenied, BrPage, BrPageSkeleton, BrSection, BR_TONE } from '@/components/billing-recon/page-kit';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { WORKFLOWS_COLLECTION } from '@/lib/billing-recon/register';
import type { RegisterKind } from './register-desk';

interface WorkflowState {
  id: string;
  exists: boolean;
  steps: number;
  error: boolean;
}

export function RegisterSettings({ kind }: { kind: RegisterKind }) {
  const params = useParams<{ project: string }>();
  const projectSlug = params?.project ?? '';
  const segment = kind === 'JMC' ? 'jmc' : 'mvac';
  const resource = `Billing Recon.${kind}`;
  const tone = kind === 'JMC' ? BR_TONE.jmc : BR_TONE.mvac;
  const deskHref = `/billing-recon/${projectSlug}/${segment}`;

  const { can, isLoading: authLoading } = useAuthorization();
  const { register, loading: projectsLoading } = useBillingReconProjects();

  const allowed = (action: string) => {
    if (authLoading) return false;
    try {
      return can(action, resource);
    } catch {
      return false;
    }
  };
  const canViewPage = allowed('View Settings');
  const canEditSettings = allowed('Edit Settings');
  const canSerials = allowed('Edit Serial Nos');

  const workflowId = kind === 'JMC' ? register.jmcWorkflowId : register.mvacWorkflowId;
  const ready = !authLoading && !projectsLoading && canViewPage;
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    getDoc(doc(db, WORKFLOWS_COLLECTION, workflowId))
      .then((snap) => {
        if (cancelled) return;
        const steps = snap.exists() ? snap.data()?.steps : undefined;
        setWorkflow({ id: workflowId, exists: snap.exists(), steps: Array.isArray(steps) ? steps.length : 0, error: false });
      })
      .catch((error) => {
        console.error(`Billing Recon: could not read the ${kind} workflow`, error);
        if (!cancelled) setWorkflow({ id: workflowId, exists: false, steps: 0, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [ready, workflowId, kind]);

  const wf = workflow && workflow.id === workflowId ? workflow : null;

  if (authLoading) return <BrPageSkeleton kpis={0} />;
  if (!canViewPage) return <BrAccessDenied message={`You do not have permission to access ${kind} settings.`} />;

  const sharing =
    kind === 'MVAC' ? (
      <StatusBadge tone="info">Same for every project</StatusBadge>
    ) : projectsLoading ? undefined : register.separated ? (
      <StatusBadge tone="success">Billing Recon&apos;s own</StatusBadge>
    ) : (
      <StatusBadge tone="warning">Shared with Project Management</StatusBadge>
    );

  return (
    <BrPage tone={tone}>
      <PageHeader
        title={`${kind} Settings`}
        description={`How ${kind} entries move through approval, and how they're numbered.`}
        icon={Settings}
        backHref={deskHref}
        backLabel={`Back to ${kind}`}
      />

      <BrSection title={`${kind} settings`} description="Open a card to change it." icon={Settings} tone={BR_TONE.settings}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <ActionCard
            href={`${deskHref}/settings/workflow-configuration`}
            title="Workflow Configuration"
            description={`The approval steps for ${kind} entries — who acts at each step, and its turnaround.`}
            icon={GitMerge}
            tone={tone}
            figure={!wf || wf.error ? '—' : wf.steps}
            figureLabel={wf && !wf.error && wf.steps === 1 ? 'step' : 'steps'}
            alert={wf && !wf.error && !wf.exists ? <StatusBadge tone="warning">Not saved yet</StatusBadge> : undefined}
            badge={
              <>
                {sharing}
                {!canEditSettings && <StatusBadge tone="neutral">View only</StatusBadge>}
              </>
            }
          />
          <ActionCard
            href="/billing-recon/settings/serial-no"
            title="Serial Numbers"
            description="Prefix, format and next number per project and BOQ scope — one series that JMC and MVAC entries share."
            icon={Hash}
            tone="indigo"
            disabled={!canSerials}
            disabledReason="Needs the Edit Serial Nos permission"
          />
        </div>
      </BrSection>
    </BrPage>
  );
}
