import { MdlError, decodeParam, mdlRoute } from '@/lib/master-drawing-list/server/context';
import { deleteItem, saveDrawing, updateItemDetails, type UploadedFile } from '@/lib/master-drawing-list/server/items';
import { itemFor } from '@/lib/master-drawing-list/server/store';
import { drawingSaveInputSchema, itemDetailsInputSchema } from '@/lib/master-drawing-list/schemas';

export const runtime = 'nodejs';

export const GET = mdlRoute<{ itemId: string }>('items.get', async ({ context, params }) => {
  const { item, project } = await itemFor(context, decodeParam(params.itemId));
  context.require('Drawings', 'View', project);
  return { item, project, today: context.today };
});

/**
 * Save the Drawing Details dialog: multipart, `payload` = `{ target, form }` as JSON and one
 * `file:<round>` part per round with a drawing attached.
 */
export const PUT = mdlRoute<{ itemId: string }>('items.save', async ({ request, context, params }) => {
  let body: FormData;
  try {
    body = await request.formData();
  } catch {
    throw new MdlError('The request is not a form upload.');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(String(body.get('payload') ?? ''));
  } catch {
    throw new MdlError('The drawing details are missing.');
  }
  const files = new Map<string, UploadedFile>();
  for (const [key, value] of body.entries()) {
    if (!key.startsWith('file:') || typeof value === 'string') continue;
    files.set(key.slice(5), { name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) });
  }
  return { item: await saveDrawing(context, decodeParam(params.itemId), drawingSaveInputSchema.parse(payload), files) };
});

/** Edit item details: the description and group only (Drawings · Edit). JSON `{ description, group }`. */
export const PATCH = mdlRoute<{ itemId: string }>('items.details', async ({ request, context, params }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new MdlError('The item details are missing.');
  }
  return { item: await updateItemDetails(context, decodeParam(params.itemId), itemDetailsInputSchema.parse(body)) };
});

/** Delete the item from the register (Drawings · Delete). */
export const DELETE = mdlRoute<{ itemId: string }>('items.delete', async ({ context, params }) => {
  await deleteItem(context, decodeParam(params.itemId));
  return { ok: true };
});
