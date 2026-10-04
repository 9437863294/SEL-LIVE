import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { dueDateChangeSchema } from '@/lib/bill-tracking/schemas';
import { changeDueDate } from '@/lib/bill-tracking/server/bills';

export const POST = btRoute<{ billId: string }>('bills.dueDate', async ({ request, context, params }) => {
  const body = dueDateChangeSchema.parse(await readJson(request));
  await changeDueDate(context, params.billId, body.dueDate, body.reason);
  return { ok: true };
});
