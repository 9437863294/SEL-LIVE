'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FilePlus2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  eApprovalDelegators,
  E_APPROVAL_BASE_PATH,
  E_APPROVAL_STATUSES,
  OPEN_E_APPROVAL_STATUSES,
  canViewEApproval,
  isTerminalEApprovalStatus,
  type EApprovalRequest,
  type EApprovalStatus,
} from '@/lib/e-approval';
import {
  listEApprovals,
  loadEApprovalExportDetails,
  subscribeEApprovals,
  type EApprovalListFilter,
} from '@/lib/e-approval-service';
import { buildEApprovalExportSheets, eApprovalExportFilename } from '@/lib/e-approval-export';
import { exportWorkbook } from '@/lib/report-excel';
import { DeleteApprovalDialog, DeleteApprovalRowButton } from './delete-request-dialog';
import { EApprovalRequestTable } from './request-table';
import { useEApprovalActor, useEApprovalDirectory, useEApprovalPermissions, useEApprovalRefreshOnReturn } from './hooks';
import { PageHeader } from '@/components/shared/page-header';

export type RegisterScope =
  | 'inbox'
  | 'created-by-me'
  | 'copied'
  | 'drafts'
  | 'department'
  | 'all'
  | 'completed'
  | 'rejected';

interface ScopeConfig {
  title: string;
  description: string;
  statuses?: EApprovalStatus[];
  emptyTitle: string;
  emptyDescription: string;
  showRequester: boolean;
  showPendingWith: boolean;
}

const scopes: Record<RegisterScope, ScopeConfig> = {
  inbox: {
    title: 'My Inbox',
    description: 'Everything waiting on you — approvals, verifications, clarifications and returns.',
    statuses: OPEN_E_APPROVAL_STATUSES,
    emptyTitle: 'Your inbox is clear',
    emptyDescription: 'Approvals, verifications and clarifications assigned to you will appear here.',
    showRequester: true,
    showPendingWith: true,
  },
  'created-by-me': {
    title: 'Created by Me',
    description: 'Every approval you have raised, at whatever stage it has reached.',
    emptyTitle: 'You have not raised any approvals',
    emptyDescription: 'Use Create Approval to raise your first note-sheet.',
    showRequester: false,
    showPendingWith: true,
  },
  copied: {
    title: 'Copied to Me',
    description: 'Approvals you have been copied on. Follow them and comment — you are not being asked to act.',
    // Every status but Draft. CC users are recorded the moment a draft is saved, but a draft is still
    // the requester’s own working copy: it appears here when it is submitted, which is also when
    // the copied people are notified.
    statuses: E_APPROVAL_STATUSES.filter((status) => status !== 'Draft'),
    emptyTitle: 'Nothing has been copied to you',
    emptyDescription: 'When someone adds you in CC on a request, it appears here once they submit it.',
    showRequester: true,
    showPendingWith: true,
  },
  drafts: {
    title: 'Drafts',
    description: 'Saved but not yet submitted. A draft has no reference number until it is submitted.',
    statuses: ['Draft'],
    emptyTitle: 'No drafts',
    emptyDescription: 'Drafts you save before submitting appear here.',
    showRequester: false,
    showPendingWith: false,
  },
  department: {
    title: 'Department Inbox',
    description: 'Approvals routed to your department rather than to a named person.',
    statuses: OPEN_E_APPROVAL_STATUSES,
    emptyTitle: 'Nothing in the department queue',
    emptyDescription: 'Approvals sent to a department appear here for anyone entitled to take them.',
    showRequester: true,
    showPendingWith: true,
  },
  all: {
    title: 'All Approvals',
    description: 'The full register, across departments and projects.',
    emptyTitle: 'No approvals yet',
    emptyDescription: 'Once approvals are raised they appear here.',
    showRequester: true,
    showPendingWith: true,
  },
  completed: {
    title: 'Completed',
    description: 'Approvals that have run their full course.',
    statuses: ['Approved', 'Closed'],
    emptyTitle: 'Nothing completed yet',
    emptyDescription: 'Fully approved requests appear here.',
    showRequester: true,
    showPendingWith: false,
  },
  rejected: {
    title: 'Rejected',
    description: 'Approvals that were rejected or cancelled.',
    statuses: ['Rejected', 'Cancelled'],
    emptyTitle: 'Nothing rejected',
    emptyDescription: 'Rejected and cancelled requests appear here.',
    showRequester: true,
    showPendingWith: false,
  },
};

/**
 * One screen behind every list route.
 *
 * The routes differ only in scope, and the scope decides both the query and the columns. Keeping that
 * in a table rather than in seven page files means a change to the register — a new column, a
 * different empty state — happens once.
 */
export function RegisterView({ scope }: { scope: RegisterScope }) {
  const config = scopes[scope];
  const { toast } = useToast();
  const { serviceActor, engineActor } = useEApprovalActor();
  const permissions = useEApprovalPermissions();
  const { directory } = useEApprovalDirectory();
  const [rows, setRows] = useState<EApprovalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  /** The row whose delete confirmation is open. One dialog for the table, not one per row. */
  const [deleting, setDeleting] = useState<EApprovalRequest | null>(null);

  const deleteAuthority = useMemo(
    () =>
      permissions.canDeleteDraft || permissions.canDeleteAnyRequest
        ? {
            serviceActor,
            canDeleteDraft: permissions.canDeleteDraft,
            canDeleteAny: permissions.canDeleteAnyRequest,
          }
        : null,
    [serviceActor, permissions.canDeleteDraft, permissions.canDeleteAnyRequest],
  );

  /**
   * The queries behind a queue that other people are also working through.
   *
   * Several, because a step can be addressed to a person, a department, a role or a project, and
   * Firestore cannot express "any of these four arrays contains me" in one. The last group is the
   * one people had to do by hand: an inbound standing delegation means the delegator's queue is
   * yours for the duration, and nothing anywhere asked for it — the substitute was given authority
   * to act and no list that would ever show them the file. It is the same query shape as the first,
   * so it needs no new index.
   */
  const pendingSources = useMemo<EApprovalListFilter[] | null>(() => {
    if (!serviceActor) return null;
    const organizationId = serviceActor.organizationId;
    const statuses = config.statuses;
    if (scope === 'inbox') {
      return [
        { organizationId, assigneeId: serviceActor.userId, statuses },
        ...eApprovalDelegators(engineActor).map((delegatorId) => ({
          organizationId,
          assigneeId: delegatorId,
          statuses,
        })),
        ...(engineActor?.departmentIds?.length
          ? [{ organizationId, departmentIds: engineActor.departmentIds, statuses }]
          : []),
        ...(serviceActor.role ? [{ organizationId, role: serviceActor.role, statuses }] : []),
        ...(engineActor?.projectIds?.length
          ? [{ organizationId, pendingProjectIds: engineActor.projectIds, statuses }]
          : []),
      ];
    }
    if (scope === 'department') {
      return engineActor?.departmentIds?.length
        ? [{ organizationId, departmentIds: engineActor.departmentIds, statuses }]
        : [];
    }
    return null;
  }, [scope, serviceActor, engineActor, config.statuses]);

  /** Stable across renders that did not actually change the queries, so the listeners stay up. */
  const pendingSourcesKey = pendingSources ? JSON.stringify(pendingSources) : '';

  const load = useCallback(async () => {
    if (!serviceActor) return;
    setIsLoading(true);
    try {
      const organizationId = serviceActor.organizationId;
      if (pendingSources) {
        const results = await Promise.all(pendingSources.map((filter) => listEApprovals(filter)));
        const byId = new Map<string, EApprovalRequest>();
        results.flat().forEach((row) => byId.set(row.id, row));
        setRows(Array.from(byId.values()));
      } else if (scope === 'all') {
        setRows(await listEApprovals({ organizationId, limit: 400 }));
      } else if (scope === 'copied') {
        setRows(await listEApprovals({ organizationId, participantId: serviceActor.userId, statuses: config.statuses }));
      } else if (scope === 'completed' || scope === 'rejected') {
        // Scoped to the user's own files unless they can see the whole register — the same rule the
        // detail screen enforces, applied to the list so the two never disagree.
        setRows(
          permissions.canViewAll
            ? await listEApprovals({ organizationId, statuses: config.statuses, limit: 400 })
            : await listEApprovals({ organizationId, requesterId: serviceActor.userId, statuses: config.statuses }),
        );
      } else {
        setRows(
          await listEApprovals({ organizationId, requesterId: serviceActor.userId, statuses: config.statuses }),
        );
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not load approvals',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [scope, serviceActor, config.statuses, permissions.canViewAll, pendingSources, toast]);

  /**
   * The queues people wait on are live; the registers they browse are not.
   *
   * My Inbox and the Department Inbox are where somebody sits waiting for a file to arrive, so they
   * hold standing listeners and a file that reaches them appears on its own — which is the whole of
   * the complaint that an answered clarification "took ten minutes to show". The historical
   * registers, All / Completed / Rejected / Created by me / Drafts, are read rather than watched:
   * four hundred rows apiece, changing rarely, and nobody is staring at them waiting for movement.
   * Those refresh when the user comes back to them instead.
   */
  useEffect(() => {
    if (!pendingSources) return;
    if (!pendingSources.length) {
      setRows([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const latest = new Map<number, EApprovalRequest[]>();
    const emit = () => {
      // Nothing is painted until every source has reported once, so the list does not visibly grow
      // from one query's results to all of them on first load.
      if (latest.size < pendingSources.length) return;
      const byId = new Map<string, EApprovalRequest>();
      for (const group of latest.values()) group.forEach((row) => byId.set(row.id, row));
      setRows(Array.from(byId.values()));
      setIsLoading(false);
    };
    const unsubscribes = pendingSources.map((filter, index) =>
      subscribeEApprovals(
        filter,
        (next) => {
          latest.set(index, next);
          emit();
        },
        (error) => {
          // Report the failed source as empty rather than leaving it silent. `emit` waits for every
          // source before it paints, so a source that never reports holds the whole list back for
          // good — one query failing, for instance because its composite index has not been
          // deployed yet, would leave the screen saying "Your inbox is clear" while the other
          // queries returned rows all along. Missing some rows is recoverable and visible; a
          // confidently empty inbox is neither.
          latest.set(index, []);
          emit();
          setIsLoading(false);
          toast({
            variant: 'destructive',
            title: 'Some approvals could not be loaded',
            description: error instanceof Error ? error.message : 'Something went wrong.',
          });
        },
      ),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    // Keyed on the serialised filters rather than the array, which is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSourcesKey, toast]);

  useEffect(() => {
    if (pendingSources) return;
    void load();
  }, [load, pendingSources]);

  /*
   * Covers the one-shot registers only.
   *
   * A live list must not be refetched this way: `load` blanks the table to skeletons on its way
   * past, so every return to the tab would flash a populated inbox back to a loading state, and a
   * one-shot result landing after a newer listener push would roll the list backwards. The
   * listeners are the freshness mechanism there; this is the freshness mechanism for the screens
   * that have none.
   */
  const refreshIfOneShot = useCallback(() => {
    if (pendingSources) return;
    void load();
  }, [load, pendingSources]);
  useEApprovalRefreshOnReturn(refreshIfOneShot);

  const visible = useMemo(() => {
    if (scope === 'inbox') {
      // A returned file sits with its requester, not with the approver who returned it.
      return rows.filter((row) => !isTerminalEApprovalStatus(row.status));
    }
    return rows;
  }, [rows, scope]);

  /*
   * The list as an Excel workbook: every field of every request on screen, and the workflow,
   * activity, comments and attachments behind them, one sheet each.
   *
   * What a confidential request may reveal is decided per row with `canViewEApproval`, the same
   * call the detail screen makes — a row the viewer could not open is exported with the summary the
   * register already shows them and nothing more. Gated on the module's Export grant, the one the
   * reports already use, so there is one permission to manage for "may take data out of E-Approval".
   */
  const exportToExcel = useCallback(
    async (exportRows: EApprovalRequest[], filterSummary: string) => {
      if (!exportRows.length) return;
      try {
        const details = await loadEApprovalExportDetails(exportRows.map((row) => row.id));
        const stepsByRequest = new Map<string, typeof details.steps>();
        for (const step of details.steps) {
          const list = stepsByRequest.get(step.approvalId) ?? [];
          list.push(step);
          stepsByRequest.set(step.approvalId, list);
        }
        const openable = new Set(
          exportRows
            .filter((row) =>
              engineActor
                ? canViewEApproval(row, stepsByRequest.get(row.id) ?? [], engineActor, {
                    viewAll: permissions.canViewAll,
                    viewDepartment: permissions.canViewDepartment,
                    viewConfidential: permissions.canViewConfidential,
                  })
                : false,
            )
            .map((row) => row.id),
        );
        const iso = (value: { toMillis: () => number } | null | undefined) =>
          value ? new Date(value.toMillis()).toISOString() : null;
        const sheets = buildEApprovalExportSheets(
          {
            requests: exportRows.map((row) => ({ ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) })),
            steps: details.steps,
            events: details.history,
            comments: details.comments.map((comment) => ({ ...comment, createdAt: iso(comment.createdAt) })),
            attachments: details.attachments,
          },
          {
            openable,
            nameOf: (userId) => directory.userById.get(userId)?.name,
            linkFor: (id) => `${window.location.origin}${E_APPROVAL_BASE_PATH}/${id}`,
            listName: config.title,
            exportedBy: serviceActor?.userName,
            exportedAt: new Date(),
            filterSummary,
          },
        );
        await exportWorkbook(eApprovalExportFilename(config.title), sheets);
        const hidden = exportRows.length - openable.size;
        toast({
          title: 'Exported to Excel',
          description: `${exportRows.length} ${exportRows.length === 1 ? 'request' : 'requests'}, with ${details.steps.length} workflow steps, ${details.history.length} activity entries and ${details.comments.length} comments.${
            hidden ? ` ${hidden} confidential ${hidden === 1 ? 'request is' : 'requests are'} summarised only.` : ''
          }`,
        });
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Could not export',
          description: error instanceof Error ? error.message : 'Something went wrong.',
        });
      }
    },
    [
      config.title,
      directory.userById,
      engineActor,
      permissions.canViewAll,
      permissions.canViewConfidential,
      permissions.canViewDepartment,
      serviceActor,
      toast,
    ],
  );

  return (
    <div className="space-y-3">
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          <>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void load()} disabled={isLoading}>
              <RefreshCw className={isLoading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            {permissions.canCreate && (
              <Button asChild size="sm" className="h-8 gap-1.5">
                <Link href={`${E_APPROVAL_BASE_PATH}/create`}>
                  <FilePlus2 className="h-3.5 w-3.5" /> New approval
                </Link>
              </Button>
            )}
          </>
        }
        meta={[{ label: 'Showing', value: `${visible.length} ${visible.length === 1 ? 'approval' : 'approvals'}` }]}
      />
      <EApprovalRequestTable
        rows={visible}
        isLoading={isLoading}
        emptyTitle={config.emptyTitle}
        emptyDescription={config.emptyDescription}
        showRequester={config.showRequester}
        showPendingWith={config.showPendingWith}
        showAgeing={scope !== 'drafts'}
        showStatusFilter={scope !== 'drafts'}
        onExport={permissions.canExport ? exportToExcel : undefined}
        // Offered on every register rather than only the full one: the row button renders nothing
        // where the viewer may not delete that row, so a requester sees it on their own drafts
        // and nowhere else, and an administrator sees it wherever they genuinely hold the grant.
        // Deciding that per scope here would be a second copy of a rule the engine already owns.
        renderActions={
          deleteAuthority
            ? (row) => (
                <DeleteApprovalRowButton request={row} authority={deleteAuthority} onSelect={setDeleting} />
              )
            : undefined
        }
      />

      {/* Keyed by the row, so each confirmation mounts fresh — a reason typed for one request can
          never be carried into another one's dialog. */}
      {deleting && deleteAuthority && (
        <DeleteApprovalDialog
          key={deleting.id}
          request={deleting}
          {...deleteAuthority}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
