import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { commentInputSchema } from '@/lib/bill-tracking/schemas';
import { addComment } from '@/lib/bill-tracking/server/records';

export const POST = btRoute<{ billId: string }>('comments.add', async ({ request, context, params }) => {
  const body = commentInputSchema.parse(await readJson(request));
  return addComment(context, params.billId, body.text, body.mentions);
});
