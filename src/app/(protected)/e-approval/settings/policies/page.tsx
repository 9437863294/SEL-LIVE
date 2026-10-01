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
      description="Rules that apply to every approval in the module. Change what you need — a save bar appears at the bottom until you save or discard."
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
