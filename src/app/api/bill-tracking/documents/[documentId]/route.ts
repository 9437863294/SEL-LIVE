import { btRoute } from '@/lib/bill-tracking/server/context';
import { readDocument, removeDocument } from '@/lib/bill-tracking/server/records';

export const runtime = 'nodejs';

/** Streams an attachment after checking the caller's access to the bill's project. */
export const GET = btRoute<{ documentId: string }>('documents.download', async ({ context, params, url }) => {
  const { document, data } = await readDocument(context, params.documentId);
  const disposition = url.searchParams.get('inline') === '1' ? 'inline' : 'attachment';
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': document.contentType || 'application/octet-stream',
      'Content-Disposition': `${disposition}; filename="${encodeURIComponent(document.fileName)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});

export const DELETE = btRoute<{ documentId: string }>('documents.remove', async ({ context, params }) => {
  await removeDocument(context, params.documentId);
  return { ok: true };
});
