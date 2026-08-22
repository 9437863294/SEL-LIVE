'use client';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApprovalForm } from '@/components/e-approval/approval-form';
import { useEApprovalActor, useEApprovalPermissions } from '@/components/e-approval/hooks';

export default function CreateEApprovalPage() {
  const { serviceActor } = useEApprovalActor();
  const permissions = useEApprovalPermissions();

  if (!permissions.isLoading && !permissions.canCreate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not permitted</CardTitle>
          <CardDescription>You do not have permission to raise an approval.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4 sm:py-3">
          <CardTitle className="text-base">Create Approval</CardTitle>
          <CardDescription className="text-xs">
            Attachments can be added once the draft is saved.
          </CardDescription>
        </CardHeader>
      </Card>
      <ApprovalForm serviceActor={serviceActor} />
    </div>
  );
}
