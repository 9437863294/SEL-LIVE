import { btRoute } from '@/lib/bill-tracking/server/context';
import { dashboard } from '@/lib/bill-tracking/server/queries';

export const GET = btRoute('dashboard', async ({ context, url }) => dashboard(context, url.searchParams));
