'use client';

import { SettingsSection } from '@/components/e-approval/settings/settings-section';
import { DepartmentRoutingPanel } from '@/components/e-approval/settings/routing-panel';
import { useEApprovalActor, useEApprovalDirectory } from '@/components/e-approval/hooks';

export default function EApprovalDepartmentRoutingAdminPage() {
  const { serviceActor } = useEApprovalActor();
  const { directory } = useEApprovalDirectory();
  return (
    <SettingsSection
      title="Department Routing"
      description="Who a step addressed to a department actually reaches, and the code it contributes to reference numbers. A department with nothing configured here reaches only its head — the safe failure, not a silent one."
      node="Department Routing"
    >
      {(canEdit) => (
        <DepartmentRoutingPanel serviceActor={serviceActor} directory={directory} canEdit={canEdit} />
      )}
    </SettingsSection>
  );
}
