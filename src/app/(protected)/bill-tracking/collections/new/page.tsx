import { Suspense } from 'react';

import CollectionForm from '@/components/bill-tracking/collection-form';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default function Page() {
  return (
    <Suspense fallback={<BtLoading />}>
      <CollectionForm />
    </Suspense>
  );
}
