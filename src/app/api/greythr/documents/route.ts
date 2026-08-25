import { NextResponse } from 'next/server';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import {
  buildDocumentTree,
  documentContentType,
  isSafeGreytHRId,
  safeDownloadName,
} from '@/lib/greythr';
import {
  fetchEmployeeDocumentFile,
  fetchEmployeeDocuments,
  isGreytHRConfigured,
} from '@/lib/greythr-client';

/**
 * Employee documents, proxied from greytHR on demand.
 *
 *   `GET ?employeeId=83`                                    — the category / file tree
 *   `GET ?employeeId=83&documentId=…&fileId=…`               — the file itself, streamed
 *
 * ── Why these are proxied rather than synced ────────────────────────────────────────────────────
 *
 * Every other greytHR module in this integration is mirrored into Firestore on a schedule. Documents
 * are not, for three reasons that all point the same way:
 *
 *   1. **There is no bulk endpoint.** Listing is per employee, so a nightly run would make ~1,300
 *      calls before downloading anything. That is a lot of load on an HR system to answer a question
 *      almost nobody asks on any given night.
 *   2. **They are files.** Mirroring means copying them into Firebase Storage, which means a second
 *      copy of everybody's Aadhaar scan and offer letter, plus a retention policy, plus a deletion
 *      story when greytHR's copy changes.
 *   3. **Proxying is simply better here.** The list is always current, greytHR stays the only store,
 *      and access is checked on every single request rather than once at sync time.
 *
 * The proxy exists because the browser cannot call greytHR directly: the API credentials are
 * server-only, and there is no CORS allowance for a browser origin.
 */

export const runtime = 'nodejs';
/** A scanned document can be a few MB over a slow upstream. */
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);

    /**
     * Documents get their own permission rather than riding on "can view employees".
     *
     * An employee's document folder can hold anything — Aadhaar scans, offer letters, medical
     * certificates. It is not the same decision as seeing somebody's designation, and it is not the
     * same decision as seeing their PAN *number* either, so it is neither of those permissions.
     */
    requireAccess(context, 'Employee.Documents', 'View');

    const url = new URL(request.url);
    const employeeId = url.searchParams.get('employeeId') ?? '';
    const documentId = url.searchParams.get('documentId');
    const fileId = url.searchParams.get('fileId');
    const fileName = url.searchParams.get('name');

    if (!isSafeGreytHRId(employeeId)) {
      return NextResponse.json({ ok: false, error: 'A valid employeeId is required.' }, { status: 400 });
    }
    if (!isGreytHRConfigured()) {
      return NextResponse.json(
        { ok: false, error: 'greytHR credentials are not configured on the server.' },
        { status: 400 },
      );
    }

    /* ── One file ── */

    if (documentId || fileId) {
      // Downloading is a separate action from listing: an organisation may reasonably let HR see
      // that a document exists without letting everyone pull the file.
      requireAccess(context, 'Employee.Documents', 'Download');

      // Validated rather than escaped. These three ids are interpolated into the upstream path, and
      // a value containing a slash or `..` could reshape that URL — there is no legitimate reason for
      // one, so anything outside [A-Za-z0-9_-] is refused outright.
      if (!isSafeGreytHRId(documentId) || !isSafeGreytHRId(fileId)) {
        return NextResponse.json(
          { ok: false, error: 'documentId and fileId must both be valid greytHR identifiers.' },
          { status: 400 },
        );
      }

      const { bytes } = await fetchEmployeeDocumentFile(employeeId, documentId!, fileId!);
      const { contentType, inline } = documentContentType(fileName);
      const disposition = `${inline ? 'inline' : 'attachment'}; filename="${safeDownloadName(fileName)}"`;

      return new NextResponse(bytes, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': disposition,
          'Content-Length': String(bytes.byteLength),
          // Never cached by a shared cache: the URL is not a capability, the permission check is.
          'Cache-Control': 'private, no-store',
        },
      });
    }

    /* ── The tree ── */

    const rows = await fetchEmployeeDocuments(employeeId);
    const tree = buildDocumentTree(employeeId, rows);

    return NextResponse.json({
      ok: true,
      ...tree,
      canDownload: true,
      /**
       * greytHR exposes no endpoint to list document categories and no LOV key for them, so a
       * category can only be shown by its id. Said explicitly so the screen can explain the numbers
       * rather than looking half-finished.
       */
      categoriesAreUnnamed: true,
    });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
