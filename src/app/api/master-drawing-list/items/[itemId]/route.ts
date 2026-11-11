import { decodeParam, mdlRoute, readJson } from '@/lib/master-drawing-list/server/context';
import { updateDetails } from '@/lib/master-drawing-list/server/items';
import { itemView } from '@/lib/master-drawing-list/server/queries';
import { detailsInputSchema } from '@/lib/master-drawing-list/schemas';

export const GET = mdlRoute<{ itemId: string }>('items.get', async ({ context, params }) => itemView(context, decodeParam(params.itemId)));

/** The Edit form: drawing number, planned and target dates, remarks, vendor finalised, on hold. */
export const PATCH = mdlRoute<{ itemId: string }>('items.update', async ({ request, context, params }) => ({
  item: await updateDetails(context, decodeParam(params.itemId), detailsInputSchema.parse(await readJson(request))),
}));
