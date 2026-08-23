'use client';

import { SettingsSection } from '@/components/e-approval/settings/settings-section';
import { WorkflowTemplatesPanel } from '@/components/e-approval/settings/templates-panel';
import { useEApprovalActor, useEApprovalDirectory, useEApprovalSettings } from '@/components/e-approval/hooks';

export default function EApprovalWorkflowsAdminPage() {
  const { serviceActor } = useEApprovalActor();
  const { directory } = useEApprovalDirectory();
  const { settings } = useEApprovalSettings();
  return (
    <SettingsSection
      title="Workflows"
      description="Named chains of stages. A stage can hold one approver or several in parallel, and each one carries its own SLA and its own set of powers."
      node="Workflow Templates"
    >
      {(canEdit) => (
        <WorkflowTemplatesPanel
          serviceActor={serviceActor}
          directory={directory}
          canEdit={canEdit}
          defaultSlaHours={settings?.defaultSlaHours ?? 24}
        />
      )}
    </SettingsSection>
  );
}
