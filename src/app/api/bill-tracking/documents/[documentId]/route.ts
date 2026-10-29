import { btRoute } from '@/lib/bill-tracking/server/context';
import { INLINE_DOCUMENT_TYPES, readDocument, removeDocument } from '@/lib/bill-tracking/server/records';

export const runtime = 'nodejs';

/**
 * Streams an attachment after checking the caller's access to the bill's project. The browser is never
 * left to guess, as in Mail Hub's attachments: `nosniff`, a download unless a preview was asked for a
 * type safe to show (PDF, PNG, JPEG, WEBP — never HTML or SVG), and a CSP that stops the file running
 * anything if it is opened directly.
 */
export const GET = btRoute<{ documentId: string }>('documents.download', async ({ context, params, url }) => {
  const { document, data } = await readDocument(context, params.documentId);
  const contentType = document.contentType ?? '';
  const inline = url.searchParams.get('inline') === '1' && INLINE_DOCUMENT_TYPES.has(contentType);
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': inline ? contentType : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
});

export const DELETE = btRoute<{ documentId: string }>('documents.remove', async ({ context, params }) => {
  await removeDocument(context, params.documentId);
  return { ok: true };
});
