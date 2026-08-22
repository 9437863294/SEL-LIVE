'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import OfferPanel from '@/components/hr/offer-panel';
import { HrLoader } from '@/components/hr/hr-ui';

/**
 * `?proposal=<id>` opens the create-offer dialog for that selection proposal, which is how the
 * "Create offer" action on the selection desk hands over. `useSearchParams` needs a Suspense
 * boundary in the App Router, so the panel is wrapped rather than the whole route being dynamic.
 */
function OffersRoute() {
  const searchParams = useSearchParams();
  return <OfferPanel preselectProposalId={searchParams?.get('proposal') || undefined} />;
}

export default function Page() {
  return (
    <Suspense fallback={<HrLoader label="Loading offers…" />}>
      <OffersRoute />
    </Suspense>
  );
}
