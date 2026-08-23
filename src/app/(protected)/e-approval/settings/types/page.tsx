'use client';

import { SettingsSection } from '@/components/e-approval/settings/settings-section';
import { ApprovalTypesPanel } from '@/components/e-approval/settings/types-panel';
import { useEApprovalActor } from '@/components/e-approval/hooks';

export default function EApprovalTypesAdminPage() {
  const { serviceActor } = useEApprovalActor();
  return (
    <SettingsSection
      title="Approval Types"
      description="What people can raise. A type decides whether the amount field is shown at all, whether the file is confidential by default, and which workflow it falls back to."
      node="Approval Types"
    >
      {(canEdit) => <ApprovalTypesPanel serviceActor={serviceActor} canEdit={canEdit} />}
    </SettingsSection>
  );
}
