import { Suspense } from 'react';

import BillTrackingDashboard from '@/components/bill-tracking/dashboard';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default function Page() {
  return (
    <Suspense fallback={<BtLoading />}>
      <BillTrackingDashboard />
    </Suspense>
  );
}
