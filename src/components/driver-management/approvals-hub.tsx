'use client';

/**
 * Driver Management › Approvals: everything waiting for this person's decision, in one place.
 *
 * - **Trip claims** — claims at an approval stage this person is named on (ClaimsList, approvals
 *   mode), for those named on an approval stage, holding Override Workflow, or with a claim waiting.
 * - **Company vehicle requests** — drivers asking to run a vehicle past its daily km limit.
 * - **Trips to review** — fleet trips whose GPS and odometer disagree, or closed without a reading.
 *
 * The fleet tabs show for the vehicles' approvers, backups and reporting authorities, the
 * escalation list, Fleet Trips · Review holders, and anyone something has reached (the fleet
 * bootstrap says which). These used to be a second page, Fleet Approvals; one inbox is easier to
 * keep empty than two. Being assigned is the authority — no role permission is needed to decide.
 *
 * `?tab=claims|fleet|reviews` picks the tab (the fleet notifications and the Fleet Control
 * dashboard link straight to theirs); `?open=<id>` opens an over-limit request.
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Inbox } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { useFleet } from '@/components/fleet/fleet-provider';
import ClaimsList from './trips/claims-list';
import { useTripClaims } from './trips/trip-claims-provider';
import { EmptyBlock, LoadingBlock, SegmentTabs } from './trips/trip-ui';
import { APPROVALS_PATH, FleetRequestsSection, FleetReviewsSection } from './fleet/fleet-approvals';

type Tab = 'claims' | 'fleet' | 'reviews';

const TABS: Tab[] = ['claims', 'fleet', 'reviews'];

const asTab = (value: string | null): Tab | null => (TABS.includes(value as Tab) ? (value as Tab) : null);

export default function ApprovalsHub() {
  const router = useRouter();
  const params = useSearchParams();
  const claims = useTripClaims();
  const fleet = useFleet();

  // The tab the address asks for; a notification tapped while the page is open changes only that.
  const linked = params.get('open') ? 'fleet' : asTab(params.get('tab'));
  const [chosen, setChosen] = useState<Tab | null>(linked);
  const [lastLinked, setLastLinked] = useState(linked);
  if (linked !== lastLinked) {
    setLastLinked(linked);
    if (linked) setChosen(linked);
  }

  const trips = claims.data;
  const bootstrap = fleet.data;
  const showClaims = Boolean(trips && (trips.named.approval || trips.access.override || trips.inbox.approvals > 0));
  const showFleet = Boolean(bootstrap && (bootstrap.isApprover || bootstrap.access.review || bootstrap.inbox.approvals > 0 || bootstrap.inbox.reviews > 0));
  const settled = (Boolean(trips) || Boolean(claims.error) || !claims.loading) && (Boolean(bootstrap) || Boolean(fleet.error) || !fleet.loading);

  const options: { value: Tab; label: string; count?: number }[] = [
    ...(showClaims ? [{ value: 'claims' as const, label: 'Trip claims', count: trips?.inbox.approvals }] : []),
    ...(showFleet
      ? [
          { value: 'fleet' as const, label: 'Company vehicle requests', count: bootstrap?.inbox.approvals },
          { value: 'reviews' as const, label: 'Trips to review', count: bootstrap?.inbox.reviews },
        ]
      : []),
  ];
  // The chosen tab when it is shown; else the first with something waiting; else the first.
  const tab = options.find((option) => option.value === chosen)?.value ?? options.find((option) => (option.count ?? 0) > 0)?.value ?? options[0]?.value ?? null;

  const select = (next: Tab) => {
    setChosen(next);
    router.replace(`${APPROVALS_PATH}?tab=${next}`, { scroll: false });
  };

  const waiting = options.reduce((sum, option) => sum + (option.count ?? 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approvals"
        icon={Inbox}
        description="Trip claims, company-vehicle running past its daily limit, and fleet trips to review — everything waiting for your decision."
        meta={options.length ? [{ label: 'Waiting for you', value: String(waiting) }] : undefined}
      />

      {!settled && !options.length ? (
        <LoadingBlock />
      ) : !tab ? (
        <EmptyBlock icon={Inbox} title="Nothing to approve">
          Claims, over-limit requests and trips to review appear here when they reach you.
        </EmptyBlock>
      ) : (
        <>
          {options.length > 1 && <SegmentTabs<Tab> label="Approvals" value={tab} onChange={select} options={options} />}
          {tab === 'claims' && <ClaimsList mode="approvals" embedded />}
          {tab === 'fleet' && <FleetRequestsSection />}
          {tab === 'reviews' && <FleetReviewsSection />}
        </>
      )}
    </div>
  );
}
