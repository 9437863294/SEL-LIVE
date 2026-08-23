'use client';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EApprovalSettingsHub } from '@/components/e-approval/settings/settings-hub';
import { useEApprovalPermissions } from '@/components/e-approval/hooks';

export default function EApprovalAdminPage() {
  const permissions = useEApprovalPermissions();

  if (!permissions.isLoading && !permissions.canManageSettings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not permitted</CardTitle>
          <CardDescription>You do not have permission to change E-Approval settings.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return <EApprovalSettingsHub />;
}
