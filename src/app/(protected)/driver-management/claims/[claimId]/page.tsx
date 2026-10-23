'use client';

import { useParams } from 'next/navigation';
import ClaimDetailView from '@/components/driver-management/trips/claim-detail';

export default function ClaimPage() {
  const params = useParams<{ claimId: string }>();
  return <ClaimDetailView claimId={params?.claimId ?? ''} />;
}
