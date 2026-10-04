import { btRoute } from '@/lib/bill-tracking/server/context';
import { deleteView } from '@/lib/bill-tracking/server/settings';

export const DELETE = btRoute<{ viewId: string }>('views.delete', async ({ context, params }) => {
  await deleteView(context, params.viewId);
  return { ok: true };
});
