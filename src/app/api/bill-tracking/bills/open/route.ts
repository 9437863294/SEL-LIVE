import { btRoute } from '@/lib/bill-tracking/server/context';
import { openBillsForAllocation } from '@/lib/bill-tracking/server/queries';

/** Open bills for the receipt allocator, across all FYs (old bills get paid too). */
export const GET = btRoute('bills.open', async ({ context, url }) => ({ bills: await openBillsForAllocation(context, url.searchParams) }));
