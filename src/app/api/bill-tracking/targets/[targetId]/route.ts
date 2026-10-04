import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { targetInputSchema } from '@/lib/bill-tracking/schemas';
import { deleteTarget, saveTarget } from '@/lib/bill-tracking/server/records';

type Params = { targetId: string };

export const PUT = btRoute<Params>('targets.update', async ({ request, context, params }) => saveTarget(context, targetInputSchema.parse(await readJson(request)), params.targetId));
export const DELETE = btRoute<Params>('targets.delete', async ({ context, params }) => {
  await deleteTarget(context, params.targetId);
  return { ok: true };
});
