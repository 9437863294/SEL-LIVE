import { btRoute } from '@/lib/bill-tracking/server/context';
import { retentionCandidates } from '@/lib/bill-tracking/server/queries';

/** Bills of a project with retention still to raise — what a retention bill can claim. */
export const GET = btRoute('retention.pending', async ({ context, url }) => ({ bills: await retentionCandidates(context, url.searchParams) }));
