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
      description="Named chains of stages and sub-workflows. A stage can hold one approver or several in parallel, carry its own SLA and powers, run only in certain conditions, and name a different person on each project."
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
