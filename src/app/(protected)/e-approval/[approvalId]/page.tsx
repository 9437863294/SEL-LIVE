'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  History,
  Layers,
  MessageSquare,
  Paperclip,
  Pencil,
  Printer,
  RefreshCw,
  ShieldAlert,
  Workflow,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  canViewEApproval,
  E_APPROVAL_BASE_PATH,
  type EApprovalDetail,
} from '@/lib/e-approval';
import { loadEApprovalDetail } from '@/lib/e-approval-service';
import { ActionPanel } from '@/components/e-approval/action-panel';
import { AttachmentList } from '@/components/e-approval/attachment-list';
import { CommentThread } from '@/components/e-approval/comment-thread';
import { ResponsibilityCard } from '@/components/e-approval/responsibility-card';
import {
  EApprovalConfidentialBadge,
  EApprovalEmptyState,
  EApprovalField,
  EApprovalPriorityBadge,
  EApprovalStatusBadge,
} from '@/components/e-approval/shared';
import { WorkflowTimeline } from '@/components/e-approval/workflow-timeline';
import { PageHeader } from '@/components/e-approval/page-header';
import {
  formatEApprovalAmount,
  formatEApprovalDate,
  formatEApprovalDateTime,
  useEApprovalActor,
  useEApprovalDirectory,
  useEApprovalPermissions,
  useEApprovalSettings,
} from '@/components/e-approval/hooks';

/**
 * The approval detail screen of spec sections 16–17 — the most important page in the module.
 *
 * Reading order is deliberate: what is happening now (the responsibility box), what you can do about
 * it (the action panel), then the content and its history. An approver who opens a file should not
 * have to scroll to find out whether it is theirs to act on.
 */
export default function EApprovalDetailPage() {
  const params = useParams<{ approvalId: string }>();
  const approvalId = String(params?.approvalId ?? '');
  const { toast } = useToast();
  const { serviceActor, engineActor, isLoading: actorLoading } = useEApprovalActor();
  const permissions = useEApprovalPermissions();
  const { settings } = useEApprovalSettings();
  const { directory } = useEApprovalDirectory();
  const [detail, setDetail] = useState<EApprovalDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!approvalId) return;
    setIsLoading(true);
    try {
      const loaded = await loadEApprovalDetail(approvalId);
      if (!loaded) setNotFound(true);
      setDetail(loaded);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not load the approval',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [approvalId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const canView = useMemo(() => {
    if (!detail || !engineActor) return false;
    return canViewEApproval(detail.request, detail.steps, engineActor, {
      viewAll: permissions.canViewAll,
      viewDepartment: permissions.canViewDepartment,
      viewConfidential: permissions.canViewConfidential,
    });
  }, [detail, engineActor, permissions.canViewAll, permissions.canViewDepartment, permissions.canViewConfidential]);

  if (isLoading || actorLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Approval not found</CardTitle>
          <CardDescription>It may have been deleted, or the link may be wrong.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href={E_APPROVAL_BASE_PATH}>Back to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!canView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not visible to you</CardTitle>
          <CardDescription>
            {detail.request.confidential
              ? 'This approval is marked confidential. Only its participants and users with confidential access can open it.'
              : 'You are not a participant in this approval, and you do not hold permission to view other people’s approvals.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center py-6">
          <ShieldAlert className="h-12 w-12 text-destructive" />
        </CardContent>
      </Card>
    );
  }

  const { request, steps, history, comments, attachments, versions } = detail;
  const isRequester = request.requesterId === serviceActor?.userId;
  const editable = isRequester && (request.status === 'Draft' || request.status === 'Returned');
  const supersededVersions = versions.filter((version) => version.version < request.version);

  return (
    <div className="min-w-0 space-y-3">
      <PageHeader
        title={request.subject}
        description={`Raised by ${request.requesterName || 'a colleague'}${
          request.departmentName ? ` · ${request.departmentName}` : ''
        }${request.submittedAt ? ` · submitted ${formatEApprovalDateTime(request.submittedAt)}` : ''}`}
        backHref={`${E_APPROVAL_BASE_PATH}/inbox`}
        backLabel="Inbox"
        meta={[
          { label: 'Reference', value: <span className="font-mono">{request.referenceNo || 'Draft'}</span> },
          { label: 'Status', value: <EApprovalStatusBadge status={request.status} /> },
          ...(request.amount != null
            ? [
                {
                  label: 'Amount',
                  value: <span className="text-sm font-semibold">{formatEApprovalAmount(request.amount)}</span>,
                },
              ]
            : []),
          ...(request.priority !== 'Normal'
            ? [{ label: 'Priority', value: <EApprovalPriorityBadge priority={request.priority} /> }]
            : []),
          ...(request.confidential
            ? [{ label: 'Access', value: <EApprovalConfidentialBadge confidential /> }]
            : []),
          ...(request.version > 1 ? [{ label: 'Version', value: request.version }] : []),
        ]}
        actions={
          <>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void load()} aria-label="Refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            {editable && permissions.canEdit && (
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
                <Link href={`${E_APPROVAL_BASE_PATH}/${request.id}/edit`}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Link>
              </Button>
            )}
            {permissions.canPrint && (
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
                <Link href={`${E_APPROVAL_BASE_PATH}/${request.id}/print`}>
                  <Printer className="h-3.5 w-3.5" /> Approval note
                </Link>
              </Button>
            )}
          </>
        }
      />

      <ResponsibilityCard request={request} steps={steps} />

      {supersededVersions.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-semibold">Approval content was modified.</span>{' '}
            {supersededVersions.length === 1 ? 'One earlier version' : `${supersededVersions.length} earlier versions`}{' '}
            {supersededVersions.length === 1 ? 'has' : 'have'} been superseded, and the approvals given against{' '}
            {supersededVersions.length === 1 ? 'it' : 'them'} no longer stand. See the Versions tab.
          </p>
        </div>
      )}

      {request.status === 'Returned' && request.returnReason && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
          <span className="font-semibold">Returned:</span> {request.returnReason}
        </div>
      )}

      {request.status === 'On Hold' && request.holdReason && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-800">
          <span className="font-semibold">On hold:</span> {request.holdReason}
        </div>
      )}

      <ActionPanel
        detail={detail}
        engineActor={engineActor}
        serviceActor={serviceActor}
        settings={settings}
        directory={directory}
        onDone={load}
      />

      <Tabs defaultValue="overview">
        <TabsList className="flex w-full flex-wrap justify-start gap-1 bg-muted/50">
          <TabsTrigger value="overview" className="text-xs">
            Overview
          </TabsTrigger>
          <TabsTrigger value="workflow" className="gap-1 text-xs">
            <Workflow className="h-3.5 w-3.5" /> Workflow
          </TabsTrigger>
          <TabsTrigger value="comments" className="gap-1 text-xs">
            <MessageSquare className="h-3.5 w-3.5" /> Comments
            {comments.length > 0 && <span className="text-[10px] text-muted-foreground">({comments.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="attachments" className="gap-1 text-xs">
            <Paperclip className="h-3.5 w-3.5" /> Attachments
            {attachments.length > 0 && <span className="text-[10px] text-muted-foreground">({attachments.length})</span>}
          </TabsTrigger>
          {permissions.canViewAudit && (
            <TabsTrigger value="activity" className="gap-1 text-xs">
              <History className="h-3.5 w-3.5" /> Activity
            </TabsTrigger>
          )}
          <TabsTrigger value="versions" className="gap-1 text-xs">
            <Layers className="h-3.5 w-3.5" /> Versions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-2">
          <Card>
            <CardContent className="space-y-4 px-3 py-3 sm:px-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Proposal</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{request.body}</p>
              </div>
              <div className="grid gap-3 border-t pt-3 sm:grid-cols-3 lg:grid-cols-4">
                <EApprovalField label="Approval type">{request.approvalTypeName || '—'}</EApprovalField>
                <EApprovalField label="Department">{request.departmentName || '—'}</EApprovalField>
                <EApprovalField label="Project / Site">{request.projectName || '—'}</EApprovalField>
                <EApprovalField label="Your reference">{request.externalRef || '—'}</EApprovalField>
                <EApprovalField label="Amount">
                  {request.amount == null ? '—' : formatEApprovalAmount(request.amount)}
                </EApprovalField>
                <EApprovalField label="Vendor / party">{request.vendorName || '—'}</EApprovalField>
                <EApprovalField label="Cost centre">{request.costCentre || '—'}</EApprovalField>
                <EApprovalField label="Budget head">{request.budgetHead || '—'}</EApprovalField>
                <EApprovalField label="Required by">{formatEApprovalDate(request.requiredBy)}</EApprovalField>
                <EApprovalField label="Priority">{request.priority}</EApprovalField>
                <EApprovalField label="Submitted">{formatEApprovalDateTime(request.submittedAt)}</EApprovalField>
                <EApprovalField label="Closed">{formatEApprovalDateTime(request.completedAt)}</EApprovalField>
              </div>
              {(request.ccUserIds?.length || request.participantUserIds?.length) && (
                <div className="border-t pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Participants
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Array.from(new Set([...(request.ccUserIds ?? []), ...(request.participantUserIds ?? [])])).map(
                      (userId) => (
                        <Badge key={userId} variant="secondary" className="text-[10px]">
                          {directory.userById.get(userId)?.name || userId}
                        </Badge>
                      ),
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workflow" className="mt-2">
          <Card>
            <CardHeader className="px-3 py-2.5 sm:px-4">
              <CardTitle className="text-sm">Workflow</CardTitle>
              <CardDescription className="text-xs">
                Verification and clarification are shown inside the approver who raised them — they always return there.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-3 pb-3 sm:px-4">
              <WorkflowTimeline steps={steps} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="comments" className="mt-2">
          <Card>
            <CardContent className="px-3 py-3 sm:px-4">
              <CommentThread
                approvalId={request.id}
                comments={comments}
                serviceActor={serviceActor}
                directory={directory}
                canComment={permissions.canComment}
                onChanged={load}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attachments" className="mt-2">
          <Card>
            <CardContent className="px-3 py-3 sm:px-4">
              <AttachmentList
                approvalId={request.id}
                attachments={attachments}
                serviceActor={serviceActor}
                canUpload={permissions.canUpload}
                onChanged={load}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {permissions.canViewAudit && (
          <TabsContent value="activity" className="mt-2">
            <Card>
              <CardHeader className="px-3 py-2.5 sm:px-4">
                <CardTitle className="text-sm">Activity</CardTitle>
                <CardDescription className="text-xs">
                  Append-only. Nothing here can be edited or removed.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-3 pb-3 sm:px-4">
                {history.length === 0 ? (
                  <EApprovalEmptyState icon={History} title="No activity yet" />
                ) : (
                  <ol className="space-y-0">
                    {history.map((entry) => (
                      <li key={entry.id} className="flex gap-3 border-l-2 border-muted py-1.5 pl-3">
                        <span className="w-[128px] shrink-0 font-mono text-[11px] text-muted-foreground">
                          {formatEApprovalDateTime(entry.at)}
                        </span>
                        <span className="min-w-0 flex-1 text-xs">
                          <span className="font-medium">{entry.summary}</span>
                          {entry.comment && (
                            <span className="block text-[11px] italic text-muted-foreground">“{entry.comment}”</span>
                          )}
                          {entry.instruction && (
                            <span className="block text-[11px] text-muted-foreground">{entry.instruction}</span>
                          )}
                        </span>
                        {entry.version != null && (
                          <span className="shrink-0 text-[10px] text-muted-foreground">v{entry.version}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="versions" className="mt-2">
          <Card>
            <CardHeader className="px-3 py-2.5 sm:px-4">
              <CardTitle className="text-sm">Versions</CardTitle>
              <CardDescription className="text-xs">
                A superseded version keeps the approvals that were given against it, so the record shows what each
                approver actually signed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 px-3 pb-3 sm:px-4">
              {versions.length === 0 ? (
                <EApprovalEmptyState
                  icon={Layers}
                  title="Only one version"
                  description="Versions appear here when the content changes after an approval."
                />
              ) : (
                versions.map((version) => (
                  <div key={version.id} className="rounded-lg border p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={version.version < request.version ? 'outline' : 'default'} className="text-[10px]">
                        Version {version.version}
                      </Badge>
                      {version.version < request.version && (
                        <span className="text-[11px] text-muted-foreground">
                          Superseded {formatEApprovalDateTime(version.supersededAt)}
                        </span>
                      )}
                      {version.supersededReason && (
                        <span className="text-[11px] text-amber-700">{version.supersededReason}</span>
                      )}
                    </div>
                    <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                      <EApprovalField label="Subject">{String(version.snapshot?.subject ?? '—')}</EApprovalField>
                      <EApprovalField label="Amount">
                        {version.snapshot?.amount == null ? '—' : formatEApprovalAmount(Number(version.snapshot.amount))}
                      </EApprovalField>
                      <EApprovalField label="Approvals given">
                        {version.approvals?.length
                          ? version.approvals.map((row) => `${row.stepName}: ${row.outcome}`).join('; ')
                          : 'None'}
                      </EApprovalField>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
