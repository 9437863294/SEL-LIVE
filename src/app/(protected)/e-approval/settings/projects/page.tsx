'use client';

import { SettingsSection } from '@/components/e-approval/settings/settings-section';
import { ProjectRoutingPanel } from '@/components/e-approval/settings/project-routing-panel';
import { useEApprovalActor, useEApprovalDirectory } from '@/components/e-approval/hooks';

export default function EApprovalProjectRoutingAdminPage() {
  const { serviceActor } = useEApprovalActor();
  const { directory } = useEApprovalDirectory();
  return (
    <SettingsSection
      title="Project Routing"
      description="Who holds which post on each project. A workflow stage set to “Project Manager” resolves to this person on this project and to somebody else on the next — which is what lets one workflow serve every site instead of one copy per site."
      node="Project Routing"
    >
      {(canEdit) => <ProjectRoutingPanel serviceActor={serviceActor} directory={directory} canEdit={canEdit} />}
    </SettingsSection>
  );
}
