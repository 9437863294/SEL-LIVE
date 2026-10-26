'use client';

import { useParams } from 'next/navigation';
import TripDetailView from '@/components/driver-management/fleet/trip-detail';

export default function FleetTripPage() {
  const params = useParams<{ tripId: string }>();
  return <TripDetailView tripId={params?.tripId ?? ''} />;
}
