import { Suspense } from 'react';

import { ImportHistory } from '@/components/bill-tracking/import-pages';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default function Page() {
  return (
    <Suspense fallback={<BtLoading />}>
      <ImportHistory />
    </Suspense>
  );
}
