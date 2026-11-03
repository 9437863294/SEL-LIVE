'use client';

/**
 * Billing Recon's JMC serial numbers. Billing Recon always numbers from
 * `billingReconSerialConfigs`; the scope pairs come from whichever BOQ Billing Recon reads for the
 * project — the shared register until the project is separated, its own copy after (see
 * src/lib/billing-recon/register.ts). Project Management edits its own counters from
 * Project Management › JMC › Settings › Serial Numbers.
 *
 * The editor itself is shared: src/components/jmc/jmc-serial-number-editor.tsx.
 */

import { JmcSerialNumberEditor } from '@/components/jmc/jmc-serial-number-editor';
import { BILLING_RECON_FIXED, billingReconRegister } from '@/lib/billing-recon/register';
import type { Project } from '@/lib/types';

const billingReconSerialCollection = () => BILLING_RECON_FIXED.serialConfigs;
const billingReconBoqCollection = (project: Project) => billingReconRegister(project).boqItems;

export default function SerialNoConfigPage() {
  return (
    <JmcSerialNumberEditor
      title="JMC Serial Number Configuration"
      backHref="/billing-recon/settings"
      backLabel="Back to settings"
      serialCollection={billingReconSerialCollection}
      boqCollection={billingReconBoqCollection}
      activityModule="Billing Recon"
      // Unchanged from before the editor was shared: the page has no permission check of its own;
      // Billing Recon's shell gates who reaches it.
      canEdit
    />
  );
}
