'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import TripRecordDetailView from '@/components/driver-management/trips/trip-record-detail';
import { LoadingBlock } from '@/components/driver-management/trips/trip-ui';

// Suspense for `useSearchParams` (`?from=`, where the back button goes).
export default function TripPage() {
  const params = useParams<{ tripId: string }>();
  return (
    <Suspense fallback={<LoadingBlock />}>
      <TripRecordDetailView tripId={params?.tripId ?? ''} />
    </Suspense>
  );
}
