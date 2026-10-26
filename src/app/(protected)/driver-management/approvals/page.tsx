import { Suspense } from 'react';

import ApprovalsHub from '@/components/driver-management/approvals-hub';
import { LoadingBlock } from '@/components/driver-management/trips/trip-ui';

// Trip claims and company-vehicle approvals in one inbox. `?tab=` and `?open=` are read with
// useSearchParams, which needs a Suspense boundary.
export default function ApprovalsPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <ApprovalsHub />
    </Suspense>
  );
}
