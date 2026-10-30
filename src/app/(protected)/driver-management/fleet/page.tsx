import { Suspense } from 'react';
import FleetHome, { FleetHomeSkeleton } from '@/components/driver-management/fleet/fleet-home';

// Suspense for `useSearchParams` (the `?kind=own|company` tab).
export default function FleetTripPage() {
  return (
    <Suspense fallback={<FleetHomeSkeleton />}>
      <FleetHome />
    </Suspense>
  );
}
