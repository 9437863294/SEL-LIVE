import { MdlError, decodeParam, mdlRoute } from '@/lib/master-drawing-list/server/context';
import { readDrawingFile } from '@/lib/master-drawing-list/server/items';

export const runtime = 'nodejs';

/** A round's drawing file: `?path=<the path the item records>`, opened in the browser. */
export const GET = mdlRoute<{ itemId: string }>('items.file', async ({ context, params, url }) => {
  const path = url.searchParams.get('path');
  if (!path) throw new MdlError('Which file?');
  const file = await readDrawingFile(context, decodeParam(params.itemId), path);
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, no-store',
    },
  });
});
