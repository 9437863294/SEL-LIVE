'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { E_APPROVAL_BASE_PATH, type EApprovalAttachment, type EApprovalRequest } from '@/lib/e-approval';
import { loadEApprovalDetail } from '@/lib/e-approval-service';
import { ApprovalForm } from '@/components/e-approval/approval-form';
import { AttachmentList } from '@/components/e-approval/attachment-list';
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
  const { serviceActor } = useEApprovalActor();
  const permissions = useEApprovalPermissions();
  const [request, setRequest] = useState<EApprovalRequest | null>(null);
  const [attachments, setAttachments] = useState<EApprovalAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!approvalId) return;
    setIsLoading(true);
    const detail = await loadEApprovalDetail(approvalId);
    setRequest(detail?.request ?? null);
    setAttachments(detail?.attachments ?? []);
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

  if (!request) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Approval not found</CardTitle>
          <CardDescription>It may have been deleted, or the link may be wrong.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const mine = request.requesterId === serviceActor?.userId;
  const editable = mine && (request.status === 'Draft' || request.status === 'Returned');

  if (!editable || !permissions.canEdit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not editable</CardTitle>
          <CardDescription>
            {mine
              ? `A ${request.status.toLowerCase()} approval cannot be edited. Only drafts and returned requests can.`
              : 'Only the requester can edit this approval.'}
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
    <div className="space-y-3">
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
      />

      {request.status === 'Returned' && request.returnReason && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
          <span className="font-semibold">Returned:</span> {request.returnReason}
        </div>
      )}

      <ApprovalForm serviceActor={serviceActor} existing={request} onSaved={() => void load()} />

      <FormSection
        title="Attachments"
        description="Files are added, never replaced. Changing the attachment set counts as a material change."
        className="mb-20"
      >
        <AttachmentList
          approvalId={request.id}
          attachments={attachments}
          serviceActor={serviceActor}
          canUpload={permissions.canUpload}
          onChanged={load}
        />
      </FormSection>
    </div>
  );
}
