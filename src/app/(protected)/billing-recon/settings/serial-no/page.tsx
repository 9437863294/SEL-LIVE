'use client';

/**
 * Billing Recon's JMC / MVAC serial numbers. Billing Recon always numbers from
 * `billingReconSerialConfigs` — JMC and MVAC entries draw from the same counter per project and
 * scope; the scope pairs come from whichever BOQ Billing Recon reads for the project — the shared
 * register until the project is separated, its own copy after (see src/lib/billing-recon/register.ts).
 * Project Management edits its own counters from Project Management › JMC › Settings › Serial Numbers.
 *
 * The editor itself is shared: src/components/jmc/jmc-serial-number-editor.tsx. This page only adds
 * Billing Recon's frame (backdrop, notice, project filter).
 */

import { useCallback, useMemo, useState } from 'react';
import { Hash, Info } from 'lucide-react';
import { JmcSerialNumberEditor } from '@/components/jmc/jmc-serial-number-editor';
import { useAuthorization } from '@/hooks/useAuthorization';
import { BILLING_RECON_FIXED, billingReconRegister } from '@/lib/billing-recon/register';
import type { Project } from '@/lib/types';
import { BrAccessDenied, BrNotice, BrPage, BrPageSkeleton, BR_TONE } from '@/components/billing-recon/page-kit';
import { Switch } from '@/components/ui/switch';

const billingReconSerialCollection = () => BILLING_RECON_FIXED.serialConfigs;
const billingReconBoqCollection = (project: Project) => billingReconRegister(project).boqItems;
const billingProjectsOnly = (project: Project) => Boolean(project.billingRequired);

export default function SerialNoConfigPage() {
  const { can, isLoading } = useAuthorization();
  // Every project's BOQ is read to list its scopes, so by default only the projects Billing Recon
  // bills are listed (it used to read every project in the company).
  const [everyProject, setEveryProject] = useState(false);
  const projectFilter = useMemo(() => (everyProject ? undefined : billingProjectsOnly), [everyProject]);

  // The same people the Settings page shows this card to.
  const allowed = can('View Module', 'Billing Recon') || can('Edit Serial Nos', 'Billing Recon.JMC') || can('Edit Serial Nos', 'Billing Recon.MVAC');

  const notice = useCallback(
    () => (
      <BrNotice tone="info" icon={Info} title="One series per project and scope">
        JMC and MVAC entries of a scope draw their numbers from the same series. An entry can&apos;t be numbered until its scope&apos;s series is set up
        — “Not set up” ones show the suggested prefix; save them to start numbering.
      </BrNotice>
    ),
    [],
  );

  if (isLoading) return <BrPageSkeleton kpis={0} blocks={2} />;
  if (!allowed) return <BrAccessDenied message="You don't have access to Billing Recon's number series." />;

  return (
    <BrPage tone={BR_TONE.settings}>
      <JmcSerialNumberEditor
        className="w-full min-w-0 space-y-5"
        title="Serial No. Configuration"
        description="The JMC and MVAC number series — prefix, format and next number — for each project and BOQ scope."
        icon={Hash}
        backHref="/billing-recon/settings"
        backLabel="Back to settings"
        serialCollection={billingReconSerialCollection}
        boqCollection={billingReconBoqCollection}
        projectFilter={projectFilter}
        activityModule="Billing Recon"
        // Everyone the page lets in can edit, as before the editor was shared.
        canEdit
        notice={notice}
        toolbar={
          <label className="flex w-fit items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground">
            <Switch checked={everyProject} onCheckedChange={setEveryProject} aria-label="Show every project" />
            Show projects with billing off too
          </label>
        }
        emptyText={everyProject ? 'No projects found.' : 'No project has billing switched on (Settings › Billing Status).'}
      />
    </BrPage>
  );
}
