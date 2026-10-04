import { Suspense } from 'react';

import { ReconciliationPage } from '@/components/bill-tracking/import-pages';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return (
    <Suspense fallback={<BtLoading />}>
      <ReconciliationPage jobId={jobId} />
    </Suspense>
  );
}
