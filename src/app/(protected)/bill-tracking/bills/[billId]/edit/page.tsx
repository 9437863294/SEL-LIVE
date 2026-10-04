import { Suspense } from 'react';

import BillForm from '@/components/bill-tracking/bill-form';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default async function Page({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = await params;
  return (
    <Suspense fallback={<BtLoading />}>
      <BillForm billId={billId} />
    </Suspense>
  );
}
