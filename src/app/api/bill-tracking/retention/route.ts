import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { retentionReleaseSchema } from '@/lib/bill-tracking/schemas';
import { addRetentionRelease } from '@/lib/bill-tracking/server/records';
import { report } from '@/lib/bill-tracking/server/queries';

export const POST = btRoute('retention.release', async ({ request, context }) => addRetentionRelease(context, retentionReleaseSchema.parse(await readJson(request))));

/** The retention ledger page, under Retention · View rather than Reports · View. */
export const GET = btRoute('retention.list', async ({ context, url }) => report(context, 'retention', url.searchParams, ['Retention', 'View']));
