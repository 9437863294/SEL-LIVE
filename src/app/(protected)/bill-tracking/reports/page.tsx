import { Suspense } from 'react';

import { ReportsHub } from '@/components/bill-tracking/reports';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default function Page() {
  return (
    <Suspense fallback={<BtLoading />}>
      <ReportsHub />
    </Suspense>
  );
}
