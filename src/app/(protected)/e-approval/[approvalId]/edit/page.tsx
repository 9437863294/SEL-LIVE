'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  canEditEApprovalRequest,
  canRemoveEApprovalAttachment,
  E_APPROVAL_BASE_PATH,
  type EApprovalDetail,
} from '@/lib/e-approval';
import { loadEApprovalDetail } from '@/lib/e-approval-service';
import { ApprovalForm } from '@/components/e-approval/approval-form';
import { AttachmentList } from '@/components/e-approval/attachment-list';
import { DeleteApprovalButton } from '@/components/e-approval/delete-request-dialog';
import { FormSection, PageHeader } from '@/components/e-approval/page-header';
import { EApprovalStatusBadge } from '@/components/e-approval/shared';
import { useEApprovalActor, useEApprovalPermissions } from '@/components/e-approval/hooks';

/**
 * Editing is allowed on a draft and on a returned request — and nowhere else.
 *
 * A returned request is *meant* to be corrected; that is what returning it was for. Editing anything
 * live would change the proposal under an approver mid-approval, and editing a closed one would
 * rewrite what was approved.
 */
export default function EditEApprovalPage() {
  const params = useParams<{ approvalId: string }>();
  const approvalId = String(params?.approvalId ?? '');
  const router = useRouter();
  const { serviceActor } = useEApprovalActor();
  const permissions = useEApprovalPermissions();
  const [detail, setDetail] = useState<EApprovalDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!approvalId) return;
    setIsLoading(true);
    setDetail(await loadEApprovalDetail(approvalId));
    setIsLoading(false);
  }, [approvalId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // Narrowed on `detail` rather than on a derived `request`, so the delete control below — which
  // needs the whole detail to count what it is about to destroy — gets a non-null type too.
  if (!detail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Approval not found</CardTitle>
          <CardDescription>It may have been deleted, or the link may be wrong.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { request, attachments } = detail;
  const mine = request.requesterId === serviceActor?.userId;
  const isDraft = request.status === 'Draft';
  // Your own draft and your own returned request both need no Edit grant — creating it, and being
  // sent it back, are each the authority to change it. See `canEditEApprovalRequest`.
  const editable = canEditEApprovalRequest(request, serviceActor, { canEdit: permissions.canEdit });

  if (!editable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not editable</CardTitle>
          <CardDescription>
            {request.status === 'Returned'
              ? 'Correcting somebody else’s returned request needs the “Requests → Edit” permission. The requester can always correct their own.'
              : !mine
                ? 'Only the requester can edit this approval.'
                : `A ${request.status.toLowerCase()} approval cannot be edited. Only drafts and returned requests can.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="sm" variant="outline">
            <Link href={`${E_APPROVAL_BASE_PATH}/${request.id}`}>Back to the approval</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    // Uncapped, like every other screen in the module — the shell owns the measure.
    <div className="min-w-0 space-y-3">
      <PageHeader
        title={request.status === 'Returned' ? 'Correct and resubmit' : 'Edit draft'}
        description={
          request.status === 'Returned'
            ? 'Make the correction, save, then resubmit from the approval screen. Changing the subject, proposal, amount, department, project or attachments supersedes the approvals already given.'
            : 'Saved changes stay a draft until you submit.'
        }
        backHref={`${E_APPROVAL_BASE_PATH}/${request.id}`}
        backLabel="Back to the approval"
        meta={[
          { label: 'Reference', value: request.referenceNo || 'not yet allotted' },
          { label: 'Status', value: <EApprovalStatusBadge status={request.status} /> },
          { label: 'Version', value: request.version },
        ]}
        actions={
          // One shared control, so the authority, the warning and the write cannot drift apart
          // between here and the detail screen. It renders nothing where deletion is not permitted,
          // and a returned request reached by somebody holding `Requests → Delete` gets the
          // administrative confirmation rather than the mild draft one.
          <DeleteApprovalButton
            detail={detail}
            serviceActor={serviceActor}
            canDeleteDraft={permissions.canDeleteDraft}
            canDeleteAny={permissions.canDeleteAnyRequest}
            onDeleted={() => router.push(`${E_APPROVAL_BASE_PATH}/${isDraft ? 'drafts' : 'inbox'}`)}
          />
        }
      />

      {request.status === 'Returned' && request.returnReason && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
          <span className="font-semibold">Returned:</span> {request.returnReason}
        </div>
      )}

      <ApprovalForm serviceActor={serviceActor} existing={request} onSaved={() => void load()} />

      <FormSection
        title="Attachments"
        description="A document is corrected by attaching a new version of it — both files stay on the record. Changing the attachment set counts as a material change."
      >
        <AttachmentList
          approvalId={request.id}
          attachments={attachments}
          serviceActor={serviceActor}
          canUpload={permissions.canUpload}
          canRemove={canRemoveEApprovalAttachment(request, serviceActor)}
          // This screen only opens on a draft or a returned request, so a document here is always
          // still correctable — which is the whole reason the requester was sent back here.
          canRevise
          onChanged={load}
        />
      </FormSection>
    </div>
  );
}
