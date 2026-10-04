import { Suspense } from 'react';

import ImportWizard from '@/components/bill-tracking/import-wizard';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default function Page() {
  return (
    <Suspense fallback={<BtLoading />}>
      <ImportWizard />
    </Suspense>
  );
}
