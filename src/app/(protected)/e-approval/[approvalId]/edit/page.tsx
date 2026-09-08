'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
  canEditEApprovalRequest,
  E_APPROVAL_BASE_PATH,
  type EApprovalAttachment,
  type EApprovalRequest,
} from '@/lib/e-approval';
import { deleteEApprovalDraft, loadEApprovalDetail } from '@/lib/e-approval-service';
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
  const router = useRouter();
  const { toast } = useToast();
  const { serviceActor } = useEApprovalActor();
  const permissions = useEApprovalPermissions();
  const [request, setRequest] = useState<EApprovalRequest | null>(null);
  const [attachments, setAttachments] = useState<EApprovalAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

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
  const isDraft = request.status === 'Draft';
  // A draft needs no Edit grant — see `canEditEApprovalRequest`.
  const editable = canEditEApprovalRequest(request, serviceActor, { canEdit: permissions.canEdit });

  if (!editable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not editable</CardTitle>
          <CardDescription>
            {!mine
              ? 'Only the requester can edit this approval.'
              : request.status === 'Returned'
                ? 'Correcting a returned request needs the Edit permission.'
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

  const removeDraft = async () => {
    if (!serviceActor) return;
    setDeleting(true);
    try {
      await deleteEApprovalDraft(request.id, serviceActor);
      toast({ title: 'Draft deleted' });
      router.push(`${E_APPROVAL_BASE_PATH}/drafts`);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not delete the draft',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
      setDeleting(false);
    }
  };

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
          // Only a draft can be deleted — anything submitted is cancelled, not removed, because the
          // record of it existing is itself part of the trail. The service enforces the same rule.
          isDraft && permissions.canDeleteDraft ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-destructive"
              disabled={deleting}
              onClick={() => {
                if (window.confirm('Delete this draft? It has not been submitted, so nothing has seen it — this cannot be undone.')) {
                  void removeDraft();
                }
              }}
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete draft
            </Button>
          ) : undefined
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
        description="Files are added, never replaced. Changing the attachment set counts as a material change."
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
