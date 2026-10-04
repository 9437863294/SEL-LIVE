import { Suspense } from 'react';

import CollectionsRegister from '@/components/bill-tracking/collections-register';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default function Page() {
  return (
    <Suspense fallback={<BtLoading />}>
      <CollectionsRegister />
    </Suspense>
  );
}
