'use client';

import { SettingsSection } from '@/components/e-approval/settings/settings-section';
import { ApprovalMatrixPanel } from '@/components/e-approval/settings/matrix-panel';
import { useEApprovalActor, useEApprovalDirectory } from '@/components/e-approval/hooks';

export default function EApprovalMatrixAdminPage() {
  const { serviceActor } = useEApprovalActor();
  const { directory } = useEApprovalDirectory();
  return (
    <SettingsSection
      title="Approval Matrix"
      description="Which chain a request takes, by type, department, project and amount band. The most specific rule wins; between two equally specific ones, the narrower band does. Use the tester at the bottom before trusting it."
      node="Approval Matrix"
    >
      {(canEdit) => (
        <ApprovalMatrixPanel serviceActor={serviceActor} directory={directory} canEdit={canEdit} />
      )}
    </SettingsSection>
  );
}
