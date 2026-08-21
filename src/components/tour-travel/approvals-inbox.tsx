'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ClipboardCheck, Inbox, ReceiptIndianRupee, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  TT_COLLECTIONS,
  type TravelAdvance,
  type TravelClaim,
  type TravelRequest,
} from '@/lib/tour-travel';
import { TT_PERMISSION_MODULE } from './module-layout-shell';
import { useTravelCollection, useTravelConfig } from './use-travel-config';
import { Money, TravelDataList, TravelEmptyState, TravelLoader, TravelPageHeader, TravelStatusBadge } from './travel-ui';

/**
 * Approvals inbox for this module.
 *
 * Deliberately scoped to travel rather than being the universal ERP approvals inbox of spec section
 * 29: that belongs at `/approvals` and has to aggregate BG, LC, FD, recurring payments and the rest,
 * which is a cross-module change well outside this module's boundary. Building it here would mean
 * either duplicating it later or coupling every module to this one. What this page does provide is
 * the per-item shape that a universal inbox can eventually link into.
 *
 * Tours awaiting *this* user are matched on `currentApprovers`, which the service layer resolves and
 * freezes at submission — so the inbox and the approval screen can never disagree about whose turn
 * it is.
 */
export default function ApprovalsInbox() {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { settings } = useTravelConfig();

  const { records: requests, loading: requestsLoading } = useTravelCollection<TravelRequest>(TT_COLLECTIONS.requests);
  const { records: advances, loading: advancesLoading } = useTravelCollection<TravelAdvance>(TT_COLLECTIONS.advances);
  const { records: claims, loading: claimsLoading } = useTravelCollection<TravelClaim>(TT_COLLECTIONS.claims);

  const canApproveAdvance = can('Approve', `${TT_PERMISSION_MODULE}.Advances`);
  const canVerifyClaim = can('Verify', `${TT_PERMISSION_MODULE}.Claims`);

  const pendingTours = useMemo(
    () =>
      requests
        .filter(request => request.status === 'UNDER_APPROVAL' && (request.currentApprovers || []).includes(user?.id || ''))
        .sort((a, b) => (a.departureDate || '').localeCompare(b.departureDate || '')),
    [requests, user?.id],
  );

  const postFacto = useMemo(
    () =>
      requests.filter(
        request => request.postFactoApprovalRequired && (request.currentApprovers || []).includes(user?.id || ''),
      ),
    [requests, user?.id],
  );

  const pendingAdvances = useMemo(
    () => (canApproveAdvance ? advances.filter(advance => advance.status === 'REQUESTED' && advance.employeeUserId !== user?.id) : []),
    [advances, canApproveAdvance, user?.id],
  );

  const pendingClaims = useMemo(
    () =>
      claims.filter(claim => {
        if (claim.employeeUserId === user?.id) return false;
        if (claim.status === 'MANAGER_REVIEW') return claim.reportingManagerId === user?.id || canVerifyClaim;
        if (claim.status === 'FINANCE_REVIEW' || claim.status === 'SUBMITTED') return canVerifyClaim;
        return false;
      }),
    [claims, canVerifyClaim, user?.id],
  );

  if (requestsLoading || advancesLoading || claimsLoading) return <TravelLoader label="Loading your approvals…" />;

  const total = pendingTours.length + pendingAdvances.length + pendingClaims.length;

  return (
    <div className="space-y-3">
      <TravelPageHeader
        title="Approvals"
        description={total ? `${total} travel item(s) waiting on you.` : 'Nothing is waiting on you.'}
      />

      {postFacto.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <p className="font-semibold">{postFacto.length} emergency tour(s) need post-facto approval</p>
          <p className="text-xs">These employees have already travelled. Approve or reject to close the record.</p>
        </div>
      )}

      {total === 0 ? (
        <TravelEmptyState title="Your approval queue is empty" description="Tours, advances and claims assigned to you will appear here." icon={Inbox} />
      ) : (
        <Tabs defaultValue={pendingTours.length ? 'tours' : pendingClaims.length ? 'claims' : 'advances'}>
          <TabsList>
            <TabsTrigger value="tours" className="gap-1.5">
              <ClipboardCheck className="h-3.5 w-3.5" /> Tours
              {pendingTours.length > 0 && <Badge variant="secondary" className="ml-1">{pendingTours.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="advances" className="gap-1.5">
              <Wallet className="h-3.5 w-3.5" /> Advances
              {pendingAdvances.length > 0 && <Badge variant="secondary" className="ml-1">{pendingAdvances.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="claims" className="gap-1.5">
              <ReceiptIndianRupee className="h-3.5 w-3.5" /> Claims
              {pendingClaims.length > 0 && <Badge variant="secondary" className="ml-1">{pendingClaims.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tours" className="mt-3">
            <TravelDataList
              rows={pendingTours}
              rowClassName={request => ((request.policyExceptions?.length || 0) > 0 ? 'bg-amber-50/40 border-amber-200' : undefined)}
              empty={<TravelEmptyState title="No tours awaiting your approval" icon={ClipboardCheck} />}
              columns={[
                {
                  header: 'Tour',
                  mobile: 'title',
                  cell: request => (
                    <>
                      <Link href={`/tour-travel/requests/${request.id}`} className="font-medium text-sky-700 hover:underline">
                        {request.referenceNumber}
                      </Link>
                      {request.isEmergency && <p className="text-[11px] font-medium text-amber-700">Emergency</p>}
                    </>
                  ),
                },
                {
                  header: 'Employee',
                  mobile: 'title',
                  cell: request => (
                    <>
                      {request.employeeName} <span className="text-muted-foreground">· {request.grade}</span>
                    </>
                  ),
                },
                {
                  header: 'Estimate',
                  align: 'right',
                  mobile: 'aside',
                  cell: request => (
                    <>
                      <span className="font-semibold"><Money value={request.estimate?.total || 0} /></span>
                      {(request.policyExceptions?.length || 0) > 0 && (
                        <p className="text-[11px] font-medium text-amber-700">Above entitlement</p>
                      )}
                    </>
                  ),
                },
                {
                  header: 'Purpose',
                  className: 'hidden md:table-cell max-w-[16rem]',
                  cell: request => (
                    <>
                      {request.tourType}
                      <p className="truncate text-[11px] text-muted-foreground">{request.purpose}</p>
                    </>
                  ),
                },
                { header: 'Departure', cell: request => <span className="tabular-nums">{request.departureDate}</span> },
                {
                  header: 'Stage',
                  className: 'hidden lg:table-cell',
                  cell: request => (
                    <span className="text-xs text-muted-foreground">{request.approvalStages?.[request.currentStageIndex || 0]?.name}</span>
                  ),
                },
                {
                  header: 'Action',
                  mobile: 'footer',
                  cell: request => (
                    <Button asChild size="sm" className="h-7 px-2 text-xs">
                      <Link href={`/tour-travel/requests/${request.id}`}>Review</Link>
                    </Button>
                  ),
                },
              ]}
            />
          </TabsContent>

          <TabsContent value="advances" className="mt-3">
            <TravelDataList
              rows={pendingAdvances}
              rowClassName={advance => (advance.outstandingOverride ? 'bg-amber-50/40 border-amber-200' : undefined)}
              empty={<TravelEmptyState title="No advance requests awaiting approval" icon={Wallet} />}
              columns={[
                { header: 'Advance', mobile: 'title', cell: advance => <span className="font-medium">{advance.referenceNumber}</span> },
                { header: 'Employee', mobile: 'title', cell: advance => advance.employeeName },
                {
                  header: 'Requested',
                  align: 'right',
                  mobile: 'aside',
                  cell: advance => <span className="font-semibold"><Money value={advance.requestedAmount} /></span>,
                },
                {
                  header: 'Tour',
                  className: 'hidden md:table-cell',
                  cell: advance => (
                    <Link href={`/tour-travel/requests/${advance.travelRequestId}`} className="text-sky-700 hover:underline">
                      {advance.travelRequestNumber}
                    </Link>
                  ),
                },
                {
                  header: 'Flag',
                  cell: advance =>
                    advance.outstandingOverride ? (
                      <span className="text-xs text-amber-800">
                        {advance.outstandingOverride.outstandingAmount} outstanding · {advance.outstandingOverride.oldestAgeDays}d
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Clear</span>
                    ),
                },
                {
                  header: 'Action',
                  mobile: 'footer',
                  cell: () => (
                    <Button asChild size="sm" className="h-7 px-2 text-xs">
                      <Link href="/tour-travel/advances">Open</Link>
                    </Button>
                  ),
                },
              ]}
            />
          </TabsContent>

          <TabsContent value="claims" className="mt-3">
            <TravelDataList
              rows={pendingClaims}
              empty={<TravelEmptyState title="No claims awaiting your verification" icon={ReceiptIndianRupee} />}
              columns={[
                { header: 'Claim', mobile: 'title', cell: claim => <span className="font-medium">{claim.referenceNumber}</span> },
                { header: 'Employee', mobile: 'title', cell: claim => claim.employeeName },
                { header: 'Status', mobile: 'aside', cell: claim => <TravelStatusBadge status={claim.status} /> },
                {
                  header: 'Tour',
                  className: 'hidden md:table-cell',
                  cell: claim => (
                    <Link href={`/tour-travel/requests/${claim.travelRequestId}`} className="text-sky-700 hover:underline">
                      {claim.travelRequestNumber}
                    </Link>
                  ),
                },
                { header: 'Claimed', align: 'right', cell: claim => <Money value={claim.totalClaimed} /> },
                {
                  header: 'vs Estimate',
                  align: 'right',
                  cell: claim => {
                    const variance = Number(claim.totalClaimed || 0) - Number(claim.approvedEstimate || 0);
                    return (
                      <span className={variance > 0 ? 'text-rose-600' : 'text-emerald-700'}>
                        {variance > 0 ? '+' : ''}
                        <Money value={variance} />
                      </span>
                    );
                  },
                },
                {
                  header: 'Action',
                  mobile: 'footer',
                  cell: claim => (
                    <Button asChild size="sm" className="h-7 px-2 text-xs">
                      <Link href={`/tour-travel/claims/${claim.id}/verify`}>Verify</Link>
                    </Button>
                  ),
                },
              ]}
            />
          </TabsContent>
        </Tabs>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Claims are due {settings.general.claimSubmissionDeadlineDays} days after travel; advances must settle within{' '}
        {settings.general.advanceSettlementDeadlineDays} days of payment.
      </p>
    </div>
  );
}
