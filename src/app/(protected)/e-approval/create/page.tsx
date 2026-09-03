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
    /*
     * Uncapped, like every other screen in the module — the shell owns the page's measure and its
     * left/right padding, so a page that caps itself is simply narrower than its siblings for no
     * reason a reader can see.
     *
     * What stops the width from emptying the cards out is the form's own two-column layout (steps
     * plus a summary panel) and fields that fill their cards. Capping the *fields* instead, as an
     * earlier attempt did, is what left every card a wide rectangle with an input hugging its left.
     */
    <div className="min-w-0 space-y-3">
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
