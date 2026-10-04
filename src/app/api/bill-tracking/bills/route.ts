import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { billInputSchema } from '@/lib/bill-tracking/schemas';
import { createBill } from '@/lib/bill-tracking/server/bills';
import { listBills } from '@/lib/bill-tracking/server/queries';

export const GET = btRoute('bills.list', async ({ context, url }) => listBills(context, url.searchParams));
export const POST = btRoute('bills.create', async ({ request, context }) => createBill(context, billInputSchema.parse(await readJson(request))));
