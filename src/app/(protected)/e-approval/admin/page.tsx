'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { E_APPROVAL_BASE_PATH, E_APPROVAL_PERMISSION_RESOURCE } from '@/lib/e-approval';
import { ApprovalMatrixPanel } from '@/components/e-approval/admin/matrix-panel';
import { ApprovalTypesPanel } from '@/components/e-approval/admin/types-panel';
import { DepartmentRoutingPanel } from '@/components/e-approval/admin/routing-panel';
import { EApprovalSettingsPanel } from '@/components/e-approval/admin/settings-panel';
import { WorkflowTemplatesPanel } from '@/components/e-approval/admin/templates-panel';
import { PageHeader } from '@/components/e-approval/page-header';
import {
  useEApprovalActor,
  useEApprovalDirectory,
  useEApprovalPermissions,
  useEApprovalSettings,
} from '@/components/e-approval/hooks';

/**
 * Administration (spec sections 27 and 33), as one screen with tabs rather than ten routes.
 *
 * The pieces are read together in practice — a matrix rule points at a workflow, a workflow's
 * department step depends on department routing — and splitting them across ten pages means
 * configuring one thing requires remembering the state of another.
 */
export default function EApprovalAdminPage() {
  const { serviceActor } = useEApprovalActor();
  const permissions = useEApprovalPermissions();
  const { directory } = useEApprovalDirectory();
  const { settings, refreshSettings } = useEApprovalSettings();

  if (!permissions.isLoading && !permissions.canAdminister) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not permitted</CardTitle>
          <CardDescription>You do not have permission to administer E-Approval.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const resource = E_APPROVAL_PERMISSION_RESOURCE;
  const canEditTypes = permissions.can('Edit', `${resource}.Administration.Approval Types`) || permissions.can('Add', `${resource}.Administration.Approval Types`);
  const canEditTemplates = permissions.can('Edit', `${resource}.Administration.Workflow Templates`) || permissions.can('Add', `${resource}.Administration.Workflow Templates`);
  const canEditMatrix = permissions.can('Edit', `${resource}.Administration.Approval Matrix`) || permissions.can('Add', `${resource}.Administration.Approval Matrix`);
  const canEditRouting = permissions.can('Edit', `${resource}.Administration.Department Routing`);
  const canEditSettings = permissions.can('Edit', `${resource}.Administration.Settings`);

  return (
    <div className="space-y-3">
      <PageHeader
        title="Administration"
        description="Approval types, workflows, the approval matrix, department routing, change control, numbering and reminders."
        backHref={E_APPROVAL_BASE_PATH}
        backLabel="Dashboard"
      />

      <Tabs defaultValue="types">
        <TabsList className="flex w-full flex-wrap justify-start gap-1 bg-muted/50">
          <TabsTrigger value="types" className="text-xs">Approval Types</TabsTrigger>
          <TabsTrigger value="templates" className="text-xs">Workflows</TabsTrigger>
          <TabsTrigger value="matrix" className="text-xs">Approval Matrix</TabsTrigger>
          <TabsTrigger value="routing" className="text-xs">Department Routing</TabsTrigger>
          <TabsTrigger value="settings" className="text-xs">Control &amp; SLA</TabsTrigger>
        </TabsList>

        <TabsContent value="types" className="mt-2">
          <ApprovalTypesPanel serviceActor={serviceActor} canEdit={canEditTypes} />
        </TabsContent>
        <TabsContent value="templates" className="mt-2">
          <WorkflowTemplatesPanel
            serviceActor={serviceActor}
            directory={directory}
            canEdit={canEditTemplates}
            defaultSlaHours={settings?.defaultSlaHours ?? 24}
          />
        </TabsContent>
        <TabsContent value="matrix" className="mt-2">
          <ApprovalMatrixPanel serviceActor={serviceActor} directory={directory} canEdit={canEditMatrix} />
        </TabsContent>
        <TabsContent value="routing" className="mt-2">
          <DepartmentRoutingPanel serviceActor={serviceActor} directory={directory} canEdit={canEditRouting} />
        </TabsContent>
        <TabsContent value="settings" className="mt-2">
          <EApprovalSettingsPanel
            serviceActor={serviceActor}
            settings={settings}
            canEdit={canEditSettings}
            onSaved={refreshSettings}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
