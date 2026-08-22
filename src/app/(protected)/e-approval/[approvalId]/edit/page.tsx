'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { E_APPROVAL_BASE_PATH, type EApprovalRequest } from '@/lib/e-approval';
import { getEApprovalRequest } from '@/lib/e-approval-service';
import { ApprovalForm } from '@/components/e-approval/approval-form';
import { AttachmentList } from '@/components/e-approval/attachment-list';
import { loadEApprovalDetail } from '@/lib/e-approval-service';
import type { EApprovalAttachment } from '@/lib/e-approval';
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
    setRequest(detail?.request ?? (await getEApprovalRequest(approvalId)));
    setAttachments(detail?.attachments ?? []);
    setIsLoading(false);
  }, [approvalId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  if (!request) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Approval not found</CardTitle>
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
      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4 sm:py-3">
          <Button asChild size="sm" variant="ghost" className="-ml-2 h-7 w-fit gap-1 px-1.5 text-xs">
            <Link href={`${E_APPROVAL_BASE_PATH}/${request.id}`}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Link>
          </Button>
          <CardTitle className="text-base">Edit {request.referenceNo || 'draft'}</CardTitle>
          <CardDescription className="text-xs">
            {request.status === 'Returned'
              ? 'Correct the request, then resubmit it from the approval screen. Changing the subject, proposal, amount, department, project or attachments supersedes the approvals already given.'
              : 'Saved changes stay a draft until you submit.'}
          </CardDescription>
        </CardHeader>
      </Card>

      <ApprovalForm serviceActor={serviceActor} existing={request} onSaved={() => void load()} />

      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4 sm:py-3">
          <CardTitle className="text-sm">Attachments</CardTitle>
          <CardDescription className="text-xs">
            Uploaded files are added, never replaced. Changing the attachment set counts as a material change.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-3 pb-3 sm:px-4">
          <AttachmentList
            approvalId={request.id}
            attachments={attachments}
            serviceActor={serviceActor}
            canUpload={permissions.canUpload}
            onChanged={load}
          />
        </CardContent>
      </Card>
    </div>
  );
}
