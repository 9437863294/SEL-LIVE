import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { statusOverrideSchema } from '@/lib/bill-tracking/schemas';
import { overridePaymentStatus } from '@/lib/bill-tracking/server/bills';

export const POST = btRoute<{ billId: string }>('bills.status', async ({ request, context, params }) => {
  const body = statusOverrideSchema.parse(await readJson(request));
  await overridePaymentStatus(context, params.billId, body.status, body.reason);
  return { ok: true };
});
