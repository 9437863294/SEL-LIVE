'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useBt } from '@/components/bill-tracking/bt-client';
import { BtEmpty, BtLoading } from '@/components/bill-tracking/bt-ui';
import { landingPage } from '@/components/bill-tracking/module-layout-shell';

/**
 * `/bill-tracking` opens the first page the user may see — the Dashboard needs Dashboard · View, and
 * someone with only Bills, or only named on a workflow step, would otherwise land on a refusal.
 */
export default function Page() {
  const { lookups, can } = useBt();
  const router = useRouter();
  const target = lookups ? landingPage(can, Boolean(lookups.workflowAssigned)) : null;
  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);
  if (lookups && !target) return <BtEmpty title="No Bill Tracking page is open to you." description="Ask an administrator for access in Settings → Access Management." />;
  return <BtLoading />;
}
