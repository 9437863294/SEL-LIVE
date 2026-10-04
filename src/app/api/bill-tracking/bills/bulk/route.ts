import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { bulkActionSchema } from '@/lib/bill-tracking/schemas';
import { bulkUpdate } from '@/lib/bill-tracking/server/bills';

export const POST = btRoute('bills.bulk', async ({ request, context }) => {
  const body = bulkActionSchema.parse(await readJson(request));
  return bulkUpdate(context, body.billIds, body.action, { ownerId: body.ownerId, targetWeek: body.targetWeek, date: body.date });
});
