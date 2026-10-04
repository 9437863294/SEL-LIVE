import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { targetInputSchema } from '@/lib/bill-tracking/schemas';
import { saveTarget } from '@/lib/bill-tracking/server/records';
import { report } from '@/lib/bill-tracking/server/queries';

export const POST = btRoute('targets.create', async ({ request, context }) => saveTarget(context, targetInputSchema.parse(await readJson(request))));

/** Targets page: performance (default) or forecast, under Targets · View. */
export const GET = btRoute('targets.list', async ({ context, url }) => report(context, url.searchParams.get('view') === 'forecast' ? 'forecast' : 'performance', url.searchParams, ['Targets', 'View']));
