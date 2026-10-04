import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { billInputSchema, deleteSchema } from '@/lib/bill-tracking/schemas';
import { deleteBill, updateBill } from '@/lib/bill-tracking/server/bills';
import { billDetail } from '@/lib/bill-tracking/server/queries';

type Params = { billId: string };

export const GET = btRoute<Params>('bills.detail', async ({ context, params }) => billDetail(context, params.billId));
export const PUT = btRoute<Params>('bills.update', async ({ request, context, params }) => updateBill(context, params.billId, billInputSchema.parse(await readJson(request))));
export const DELETE = btRoute<Params>('bills.delete', async ({ request, context, params }) => {
  await deleteBill(context, params.billId, deleteSchema.parse(await readJson(request)).reason);
  return { ok: true };
});
