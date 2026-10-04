import { Suspense } from 'react';

import BillForm from '@/components/bill-tracking/bill-form';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default function Page() {
  return (
    <Suspense fallback={<BtLoading />}>
      <BillForm />
    </Suspense>
  );
}
