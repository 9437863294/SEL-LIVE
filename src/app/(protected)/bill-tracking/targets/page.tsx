import { Suspense } from 'react';

import { TargetsPage } from '@/components/bill-tracking/retention-targets';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default function Page() {
  return (
    <Suspense fallback={<BtLoading />}>
      <TargetsPage />
    </Suspense>
  );
}
