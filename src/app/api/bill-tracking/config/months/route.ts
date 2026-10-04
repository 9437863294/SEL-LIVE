import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { monthCloseSchema } from '@/lib/bill-tracking/schemas';
import { setMonthClosed } from '@/lib/bill-tracking/server/settings';

export const POST = btRoute('config.months', async ({ request, context }) => {
  const body = monthCloseSchema.parse(await readJson(request));
  return { closedMonths: await setMonthClosed(context, body.month, body.action, body.reason) };
});
