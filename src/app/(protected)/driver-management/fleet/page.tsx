import { Suspense } from 'react';
import FleetHome from '@/components/driver-management/fleet/fleet-home';
import { LoadingBlock } from '@/components/driver-management/trips/trip-ui';

// Suspense for `useSearchParams` (the `?kind=own|company` tab).
export default function FleetTripPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <FleetHome />
    </Suspense>
  );
}
