import { btRoute } from '@/lib/bill-tracking/server/context';
import { activityFeed } from '@/lib/bill-tracking/server/queries';

export const GET = btRoute('activity', async ({ context, url }) => ({ activity: await activityFeed(context, url.searchParams) }));
