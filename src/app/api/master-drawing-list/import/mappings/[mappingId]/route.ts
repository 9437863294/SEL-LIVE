import { decodeParam, mdlRoute } from '@/lib/master-drawing-list/server/context';
import { deleteMapping } from '@/lib/master-drawing-list/server/import';

/** Forget a saved column mapping. */
export const DELETE = mdlRoute<{ mappingId: string }>('import.mappings.delete', async ({ context, params }) => {
  await deleteMapping(context, decodeParam(params.mappingId));
  return { ok: true };
});
