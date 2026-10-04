import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { resolveMismatchSchema } from '@/lib/bill-tracking/schemas';
import { resolveNetMismatch } from '@/lib/bill-tracking/server/bills';

export const POST = btRoute<{ billId: string }>('bills.mismatch', async ({ request, context, params }) => {
  const body = resolveMismatchSchema.parse(await readJson(request));
  await resolveNetMismatch(context, params.billId, body.resolution, body.reason);
  return { ok: true };
});
