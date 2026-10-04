import { Suspense } from 'react';

import SettingsPage from '@/components/bill-tracking/settings-page';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default function Page() {
  return (
    <Suspense fallback={<BtLoading />}>
      <SettingsPage />
    </Suspense>
  );
}
