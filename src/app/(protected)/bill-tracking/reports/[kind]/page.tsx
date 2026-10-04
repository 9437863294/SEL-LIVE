import { Suspense } from 'react';

import { ReportView } from '@/components/bill-tracking/reports';
import { BtLoading } from '@/components/bill-tracking/bt-ui';

export default async function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return (
    <Suspense fallback={<BtLoading />}>
      <ReportView kind={kind} />
    </Suspense>
  );
}
