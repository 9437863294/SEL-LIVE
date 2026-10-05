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
import { FormSection } from '@/components/e-approval/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { useEApprovalActor, useEApprovalPermissions } from '@/components/e-approval/hooks';
import { PageHeader } from '@/components/shared/page-header';

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

  const [loadError, setLoadError] = useState<string | null>(null);

  /*
   * A failed read used to leave this page on its loading skeleton forever: there was no catch, so
   * `isLoading` never came back down. And had it come down, the empty branch below says "Approval
   * not found — it may have been deleted", which is the wrong thing to tell somebody whose network
   * dropped or whose permission was refused. The error is kept apart from "not found" for that reason.
   *
   * Every load still shows the skeleton, including the reload after a save. That is deliberate: it
   * remounts the form on the freshly saved record, version number included, rather than leaving the
   * form holding the version it was opened with.
   */
  const load = useCallback(async ({ initial = false }: { initial?: boolean } = {}) => {
    if (!approvalId) return;
    // The first load starts from the initial state already; only a reload needs to reset it.
    if (!initial) {
      setIsLoading(true);
      setLoadError(null);
    }
    try {
      setDetail(await loadEApprovalDetail(approvalId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      setIsLoading(false);
    }
  }, [approvalId]);

  useEffect(() => {
    void load({ initial: true });
  }, [load]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // Only when there is nothing to show. A reload that fails after a save keeps the page it already
  // has, rather than replacing a working form with an error.
  if (loadError && !detail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load this approval</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </CardContent>
      </Card>
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
          {
            label: 'Status',
            value: (
              <StatusBadge status={request.status}>
                {request.status === 'Superseded' ? <s>Superseded</s> : undefined}
              </StatusBadge>
            ),
          },
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
          onChanged={() => void load()}
        />
      </FormSection>
    </div>
  );
}
