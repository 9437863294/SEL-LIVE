'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FilePlus2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  E_APPROVAL_BASE_PATH,
  isTerminalEApprovalStatus,
  type EApprovalRequest,
  type EApprovalStatus,
} from '@/lib/e-approval';
import { listEApprovals, OPEN_E_APPROVAL_STATUSES } from '@/lib/e-approval-service';
import { EApprovalRequestTable } from './request-table';
import { PageHeader } from './page-header';
import { useEApprovalActor, useEApprovalPermissions } from './hooks';

export type RegisterScope =
  | 'inbox'
  | 'created-by-me'
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
  const [rows, setRows] = useState<EApprovalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!serviceActor) return;
    setIsLoading(true);
    try {
      const organizationId = serviceActor.organizationId;
      if (scope === 'inbox') {
        // Three queries because a step can be assigned to a person, a department or a role, and
        // Firestore cannot express "any of these three arrays contains me" in one.
        const [mine, byDepartment, byRole] = await Promise.all([
          listEApprovals({ organizationId, assigneeId: serviceActor.userId, statuses: config.statuses }),
          engineActor?.departmentIds?.length
            ? listEApprovals({ organizationId, departmentIds: engineActor.departmentIds, statuses: config.statuses })
            : Promise.resolve([]),
          serviceActor.role
            ? listEApprovals({ organizationId, role: serviceActor.role, statuses: config.statuses })
            : Promise.resolve([]),
        ]);
        const byId = new Map<string, EApprovalRequest>();
        [...mine, ...byDepartment, ...byRole].forEach((row) => byId.set(row.id, row));
        setRows(Array.from(byId.values()));
      } else if (scope === 'department') {
        setRows(
          engineActor?.departmentIds?.length
            ? await listEApprovals({
                organizationId,
                departmentIds: engineActor.departmentIds,
                statuses: config.statuses,
              })
            : [],
        );
      } else if (scope === 'all') {
        setRows(await listEApprovals({ organizationId, limit: 400 }));
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
  }, [scope, serviceActor, engineActor, config.statuses, permissions.canViewAll, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (scope === 'inbox') {
      // A returned file sits with its requester, not with the approver who returned it.
      return rows.filter((row) => !isTerminalEApprovalStatus(row.status));
    }
    return rows;
  }, [rows, scope]);

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
      <Card>
        <CardContent className="px-2 py-3 sm:px-3">
          <EApprovalRequestTable
            rows={visible}
            isLoading={isLoading}
            emptyTitle={config.emptyTitle}
            emptyDescription={config.emptyDescription}
            showRequester={config.showRequester}
            showPendingWith={config.showPendingWith}
            showAgeing={scope !== 'drafts'}
            showStatusFilter={scope !== 'drafts'}
          />
        </CardContent>
      </Card>
    </div>
  );
}
