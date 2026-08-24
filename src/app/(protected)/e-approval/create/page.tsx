'use client';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApprovalForm } from '@/components/e-approval/approval-form';
import { PageHeader } from '@/components/e-approval/page-header';
import { E_APPROVAL_BASE_PATH } from '@/lib/e-approval';
import { useEApprovalActor, useEApprovalPermissions } from '@/components/e-approval/hooks';

export default function CreateEApprovalPage() {
  const { serviceActor, user } = useEApprovalActor();
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
    // One column, one measure. 1024px keeps the two-column field grids inside a step comfortable
    // without letting the proposal box stretch to a 1600px line on a wide monitor.
    <div className="mx-auto w-full max-w-5xl space-y-3">
      <PageHeader
        title="New approval"
        description="A note-sheet, routed for approval. Only the first approver has to be named — the rest of the chain is built by whoever holds the file."
        backHref={E_APPROVAL_BASE_PATH}
        backLabel="Dashboard"
        meta={[
          { label: 'Raised by', value: user?.name || '—' },
          { label: 'Reference', value: <span className="text-muted-foreground">allotted on submission</span> },
          { label: 'Status', value: 'Draft' },
        ]}
      />
      <ApprovalForm serviceActor={serviceActor} />
    </div>
  );
}
