import { decodeParam, mdlRoute } from '@/lib/master-drawing-list/server/context';
import { deleteSubDrawing } from '@/lib/master-drawing-list/server/items';

/** Remove a sub-drawing (Drawings · Edit). */
export const DELETE = mdlRoute<{ itemId: string; subId: string }>('subdrawings.delete', async ({ context, params }) => {
  await deleteSubDrawing(context, decodeParam(params.itemId), decodeParam(params.subId));
  return { ok: true };
});
