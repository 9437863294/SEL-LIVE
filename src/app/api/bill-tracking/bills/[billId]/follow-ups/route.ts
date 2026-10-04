import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { followUpInputSchema } from '@/lib/bill-tracking/schemas';
import { addFollowUp } from '@/lib/bill-tracking/server/records';

export const POST = btRoute<{ billId: string }>('followups.add', async ({ request, context, params }) => addFollowUp(context, params.billId, followUpInputSchema.parse(await readJson(request))));
