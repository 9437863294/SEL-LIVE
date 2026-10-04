import { Suspense } from 'react';

import BillRegister from '@/components/bill-tracking/bill-register';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default function Page() {
  return (
    <Suspense fallback={<BtLoading />}>
      <BillRegister />
    </Suspense>
  );
}
