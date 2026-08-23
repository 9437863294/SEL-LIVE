'use client';

import { SettingsSection } from '@/components/e-approval/settings/settings-section';
import { EApprovalSettingsPanel } from '@/components/e-approval/settings/settings-panel';
import { useEApprovalActor, useEApprovalSettings } from '@/components/e-approval/hooks';

export default function EApprovalPoliciesAdminPage() {
  const { serviceActor } = useEApprovalActor();
  const { settings, refreshSettings } = useEApprovalSettings();
  return (
    <SettingsSection
      title="Policies"
      description="The rules the whole module runs under. These all live in one settings record, which is why they share one page and one Save."
      node="Policies"
    >
      {(canEdit) => (
        <EApprovalSettingsPanel
          serviceActor={serviceActor}
          settings={settings}
          canEdit={canEdit}
          onSaved={refreshSettings}
        />
      )}
    </SettingsSection>
  );
}
