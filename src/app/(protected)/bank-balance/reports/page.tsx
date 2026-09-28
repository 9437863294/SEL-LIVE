'use client';
export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useBankBalanceNav } from '@/components/bank-balance/nav';

/**
 * The reports used to be a grid of cards here. Each report is now its own entry in the module
 * sidebar (and in the phone's "More" sheet), so this address — still linked from the dashboard
 * and bookmarked by people — opens the first report instead of a page of links.
 */
export default function BankReportsPage() {
  const router = useRouter();
  const { can, isLoading } = useAuthorization();
  const { items } = useBankBalanceNav();
  const canViewPage = can('View', 'Bank Balance.Reports');
  const firstReport = items.find((item) => item.group === 'Reports')?.href;

  useEffect(() => {
    if (!isLoading && canViewPage && firstReport) router.replace(firstReport);
  }, [isLoading, canViewPage, firstReport, router]);

  if (isLoading || (canViewPage && firstReport)) {
    return (
      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6">
      <PageHeader title="Bank Reports" backHref="/bank-balance" backLabel="Back to dashboard" />
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You do not have permission to view reports.</CardDescription>
        </CardHeader>
        <div className="flex justify-center p-8">
          <ShieldAlert className="h-14 w-14 text-destructive" />
        </div>
      </Card>
    </div>
  );
}
