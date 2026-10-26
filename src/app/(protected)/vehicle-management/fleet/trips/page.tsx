import { Suspense } from 'react';

import FleetTripsRegister from '@/components/vehicle-management/fleet/fleet-trips';
import { LoadingBlock } from '@/components/driver-management/trips/trip-ui';

// `?vehicleId=` (from a vehicle's details) is read with useSearchParams, which needs a Suspense boundary.
export default function FleetTripsPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <FleetTripsRegister />
    </Suspense>
  );
}
