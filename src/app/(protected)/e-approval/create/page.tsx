'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApprovalForm } from '@/components/e-approval/approval-form';
import { useEApprovalBack } from '@/components/e-approval/back-navigation';
import { E_APPROVAL_BASE_PATH } from '@/lib/e-approval';
import { withEApprovalReturnTo } from '@/lib/e-approval-navigation';
import { markNextNavigationAsReplace } from '@/lib/navigation-history';
import { useEApprovalActor, useEApprovalPermissions } from '@/components/e-approval/hooks';
import { PageHeader } from '@/components/shared/page-header';

export default function CreateEApprovalPage() {
  const router = useRouter();
  const { serviceActor, user } = useEApprovalActor();
  const permissions = useEApprovalPermissions();
  // Back to the page the form was opened from — the inbox, a register, a request — and the
  // dashboard only when that is not known.
  const back = useEApprovalBack(E_APPROVAL_BASE_PATH, { replace: true });

  /*
   * The new request takes the form's place in the history rather than being pushed after it. Pushed,
   * the browser's Back from a request just submitted reopened an empty New Approval form, and the
   * request's own arrow went to My Inbox. Replaced, both lead to wherever the form was opened from.
   */
  const openRequest = useCallback(
    (approvalId: string) => {
      markNextNavigationAsReplace();
      router.replace(withEApprovalReturnTo(`${E_APPROVAL_BASE_PATH}/${approvalId}`, back.href));
    },
    [router, back.href],
  );

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
        backHref={back.href}
        backLabel={back.label}
        onBackClick={back.onClick}
        meta={[
          { label: 'Raised by', value: user?.name || '—' },
          { label: 'Reference', value: <span className="text-muted-foreground">allotted on submission</span> },
          { label: 'Status', value: 'Draft' },
        ]}
      />
      <ApprovalForm serviceActor={serviceActor} onFinished={openRequest} />
    </div>
  );
}
