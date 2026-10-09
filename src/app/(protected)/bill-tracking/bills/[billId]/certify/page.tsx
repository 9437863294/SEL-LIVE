import { Suspense } from 'react';

import CertificationForm from '@/components/bill-tracking/certification-form';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default async function Page({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = await params;
  return (
    <Suspense fallback={<BtLoading />}>
      <CertificationForm billId={billId} />
    </Suspense>
  );
}
