import { btRoute } from '@/lib/bill-tracking/server/context';
import { lookups } from '@/lib/bill-tracking/server/queries';

/** Everything the module's screens need to render pickers and gate actions, in one call. */
export const GET = btRoute('lookups', async ({ context }) => lookups(context));
