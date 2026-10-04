import { Suspense } from 'react';

import { RetentionPage } from '@/components/bill-tracking/retention-targets';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default function Page() {
  return (
    <Suspense fallback={<BtLoading />}>
      <RetentionPage />
    </Suspense>
  );
}
