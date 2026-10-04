import { Suspense } from 'react';

import BillDetail from '@/components/bill-tracking/bill-detail';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default async function Page({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = await params;
  return (
    <Suspense fallback={<BtLoading />}>
      <BillDetail billId={billId} />
    </Suspense>
  );
}
