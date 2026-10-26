'use client';

/**
 * The company-vehicle half of Driver Management › Approvals (approvals-hub.tsx), as two sections:
 *
 * - **Over-limit requests** (`FleetRequestsSection`) — a driver asking, before a trip, to run a
 *   vehicle past its daily km limit. Waiting requests first (they expire two hours after they were
 *   raised), then what was decided. A request reaches the vehicle's approver (or the driver's
 *   reporting authority), then its backup, then the fleet's escalation list; anyone it has reached
 *   may decide.
 * - **Trips to review** (`FleetReviewsSection`) — trips whose GPS and odometer distances disagree, or
 *   that were closed without a reading, waiting for someone to pick the figure to bill.
 *
 * They were a page of their own, Fleet Approvals, beside the claims Approvals page: two inboxes for
 * one person's decisions. Now they are tabs of the one Approvals page. `?open=<id>` (the link in the
 * notification) opens that request directly. Nobody sees their own requests or trips here: they are
 * decided by someone else.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Inbox, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { useAuth } from '@/components/auth/AuthProvider';
import { useFleet } from '@/components/fleet/fleet-provider';
import { ApprovalStatusBadge, TripFlagChips, TripStatusBadge } from '@/components/fleet/fleet-ui';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import { EmptyBlock, ErrorBlock, LoadingBlock, SegmentTabs } from '@/components/driver-management/trips/trip-ui';
import { istTimeLabel, shortDateLabel } from '@/lib/fleet/dates';
import { formatKm, round1, type FleetApproval, type FleetTrip } from '@/lib/fleet/types';
import type { FuelEntryView } from '@/lib/fleet/server/fuel';
import { ApprovalDecisionDialog, LEVEL_LABELS, canDecideApproval } from './approval-decision-dialog';
import { ReviewTripDialog } from './review-dialogs';

/** Where these sections live, for links and for dropping `?open=` once a request is closed. */
export const APPROVALS_PATH = '/driver-management/approvals';

type RequestFilter = 'waiting' | 'decided';

/** Over-limit requests that have reached this person, and the decision dialog. */
export function FleetRequestsSection() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const fleet = useFleet();
  const userId = user?.id ?? '';

  const [filter, setFilter] = useState<RequestFilter>('waiting');
  const [openId, setOpenId] = useState<string | null>(params.get('open'));

  // A notification tapped while this page is already open changes only the query string.
  const linked = params.get('open');
  const [lastLinked, setLastLinked] = useState(linked);
  if (linked !== lastLinked) {
    setLastLinked(linked);
    if (linked) setOpenId(linked);
  }

  const inbox = useFleetQuery<{ approvals: FleetApproval[]; canOverride: boolean }>('approvals?view=inbox');
  const canOverride = Boolean(inbox.data?.canOverride);
  const approvals = useMemo(() => (inbox.data?.approvals ?? []).filter((approval) => approval.driverUserId !== userId), [inbox.data, userId]);
  const waiting = approvals.filter((approval) => approval.status === 'pending');
  const decided = approvals.filter((approval) => approval.status !== 'pending');

  const refresh = () => {
    void inbox.reload();
    // The tab and sidebar counts come from the bootstrap.
    void fleet.reload();
  };

  const closeDialog = (open: boolean) => {
    if (open) return;
    setOpenId(null);
    // Drop ?open= so a reload does not reopen what was just decided.
    if (params.get('open')) router.replace(`${APPROVALS_PATH}?tab=fleet`, { scroll: false });
  };

  const columns: ListColumn<FleetApproval>[] = [
    {
      header: 'Vehicle',
      mobile: 'title',
      cell: (approval) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-800">{approval.vehicleNumber}</p>
          <p className="truncate text-xs text-muted-foreground">{approval.driverName}</p>
        </div>
      ),
    },
    {
      header: 'Running today',
      cell: (approval) => (
        <span className="whitespace-nowrap text-xs tabular-nums">
          {formatKm(approval.usedKm)} of {formatKm(approval.limitKm)}
          <span className="block font-medium text-amber-700">+{formatKm(approval.requestedKm)} → {formatKm(round1(approval.usedKm + approval.requestedKm))}</span>
        </span>
      ),
    },
    {
      header: 'For',
      cell: (approval) => (
        <span className="block max-w-[18rem] text-xs">
          <span className="font-medium text-slate-700">
            {approval.purposeName}
            {approval.projectName ? ` · ${approval.projectName}` : ''}
          </span>
          <span className="block truncate text-muted-foreground" title={approval.reason}>
            {approval.reason}
          </span>
        </span>
      ),
    },
    {
      header: 'Asked',
      cell: (approval) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {shortDateLabel(approval.dateKey)} {istTimeLabel(approval.createdAt)}
          <span className="block">{approval.status === 'pending' ? `${LEVEL_LABELS[approval.level] ?? `Level ${approval.level}`} · expires ${istTimeLabel(approval.expiresAt)}` : approval.decidedByName ? `by ${approval.decidedByName}` : ''}</span>
        </span>
      ),
    },
    { header: 'Status', mobile: 'aside', cell: (approval) => <ApprovalStatusBadge status={approval.status} /> },
    {
      header: '',
      mobile: 'footer',
      align: 'right',
      cell: (approval) => (
        <Button type="button" size="sm" variant={canDecideApproval(approval, userId, canOverride) ? 'default' : 'outline'} onClick={() => setOpenId(approval.id)}>
          {canDecideApproval(approval, userId, canOverride) ? 'Decide' : 'View'}
        </Button>
      ),
    },
  ];

  const rows = filter === 'waiting' ? waiting : decided;

  return (
    <div className="space-y-4">
      <SegmentTabs<RequestFilter>
        label="Requests"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'waiting', label: 'Waiting', count: inbox.data ? waiting.length : undefined },
          { value: 'decided', label: 'Decided', count: inbox.data ? decided.length : undefined },
        ]}
      />

      {inbox.error ? (
        <ErrorBlock message={inbox.error} onRetry={inbox.reload} />
      ) : !inbox.data ? (
        <LoadingBlock />
      ) : (
        <DataList
          rows={rows}
          columns={columns}
          dense
          onRowClick={(approval) => setOpenId(approval.id)}
          rowClassName={(approval) => (canDecideApproval(approval, userId, canOverride) ? 'bg-amber-50/40' : undefined)}
          empty={
            <EmptyBlock icon={Inbox} title={filter === 'waiting' ? 'Nothing is waiting for you' : 'No decided requests yet'}>
              {filter === 'waiting' ? 'You are told by notification and email when a driver asks to run past a limit.' : 'Requests you were asked about appear here once decided, withdrawn or expired.'}
            </EmptyBlock>
          }
        />
      )}

      {approvals.length > 0 && (
        <p className="text-[11px] text-muted-foreground">Approving allows the vehicle that many km for the day only; approve-and-raise also changes its daily limit for good.</p>
      )}

      <ApprovalDecisionDialog approvalId={openId} open={Boolean(openId)} onOpenChange={closeDialog} onDone={refresh} currentUserId={userId} canOverride={canOverride} />
    </div>
  );
}

/** Fleet trips waiting for someone to pick the billable figure. */
export function FleetReviewsSection() {
  const { user } = useAuth();
  const fleet = useFleet();
  const userId = user?.id ?? '';
  const [reviewing, setReviewing] = useState<FleetTrip | null>(null);

  // From the exceptions list: it is already scoped to what this person manages (or everything, with
  // Fleet Trips · Review) and needs no date range.
  const exceptions = useFleetQuery<{ trips: FleetTrip[]; fuel: FuelEntryView[]; scope: 'all' | 'managed' }>('exceptions');
  const reviews = useMemo(() => (exceptions.data?.trips ?? []).filter((trip) => trip.status === 'pending_review' && trip.driverUserId !== userId), [exceptions.data, userId]);

  const refresh = () => {
    void exceptions.reload();
    void fleet.reload();
  };

  const columns: ListColumn<FleetTrip>[] = [
    {
      header: 'Trip',
      mobile: 'title',
      cell: (trip) => (
        <div className="min-w-0">
          <Link href={`/driver-management/fleet/trips/${trip.id}`} className="font-medium text-slate-800 hover:underline">
            {trip.vehicleNumber}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {trip.driverName} · {shortDateLabel(trip.dateKey)}
          </p>
        </div>
      ),
    },
    {
      header: 'GPS / odometer',
      cell: (trip) => (
        <span className="whitespace-nowrap text-xs tabular-nums">
          GPS {formatKm(trip.gpsDistanceKm > 0 ? trip.gpsDistanceKm : null)} · odo {formatKm(trip.odoDistanceKm)}
          {trip.odoDistanceKm !== null && trip.gpsDistanceKm > 0 && <span className="block font-medium text-amber-700">{formatKm(round1(Math.abs(trip.gpsDistanceKm - trip.odoDistanceKm)))} apart</span>}
        </span>
      ),
    },
    {
      header: 'Why',
      cell: (trip) => (
        <div className="max-w-[20rem] space-y-1">
          {trip.review?.reason && <p className="text-xs text-slate-700">{trip.review.reason}</p>}
          <TripFlagChips flags={trip.flagCodes} />
        </div>
      ),
    },
    { header: 'Status', mobile: 'aside', cell: (trip) => <TripStatusBadge status={trip.status} /> },
    {
      header: '',
      mobile: 'footer',
      align: 'right',
      cell: (trip) => (
        <Button type="button" size="sm" onClick={() => setReviewing(trip)}>
          Review
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {exceptions.error ? (
        <ErrorBlock message={exceptions.error} onRetry={exceptions.reload} />
      ) : !exceptions.data ? (
        <LoadingBlock />
      ) : (
        <DataList
          rows={reviews}
          columns={columns}
          dense
          rowClassName={() => 'bg-amber-50/30'}
          empty={
            <EmptyBlock icon={Scale} title="No trips to review">
              Trips whose GPS and odometer distances disagree, or that were closed without a reading, wait here for a manager to pick the figure to bill.
            </EmptyBlock>
          }
        />
      )}

      {reviewing && (
        <ReviewTripDialog
          trip={reviewing}
          open
          onOpenChange={(open) => {
            if (!open) setReviewing(null);
          }}
          onDone={() => {
            setReviewing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
