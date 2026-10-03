import { NextRequest, NextResponse } from 'next/server';
import { accessErrorResponse, authenticateAccess } from '@/lib/access-control-server';

/**
 * Download a Site Account Statement attachment as a file.
 *
 * The attachment's own Firebase download URL can only *open* a file: the `download` attribute is
 * ignored on a cross-origin link, and the bucket has no CORS configuration, so the browser cannot
 * fetch the bytes itself either. This route fetches them server-side and hands them back from the
 * app's own origin with an `attachment` disposition, which every browser saves as a file.
 *
 * Any signed-in user may read these paths under the Storage rules, so authentication is the same
 * bar here. The URL is checked rather than trusted: only Firebase Storage, only this project's
 * buckets, only the module's own folders — anything else is refused, so the route cannot be used
 * to fetch arbitrary URLs.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STORAGE_HOST = 'firebasestorage.googleapis.com';

const ALLOWED_PREFIXES = [
  'siteAccountExpenses/',
  'siteAccountPayments/',
  'sas/budget-approvals/',
  'sas/budget-allocations/',
];

function allowedBuckets(): Set<string> {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
  return new Set(
    [
      process.env.FIREBASE_STORAGE_BUCKET,
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      projectId && `${projectId}.firebasestorage.app`,
      projectId && `${projectId}.appspot.com`,
    ].filter((item): item is string => Boolean(item)),
  );
}

/** The object path of a Firebase download URL, or null when it is not one this route serves. */
function storageObjectPath(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.host !== STORAGE_HOST) return null;
  const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/);
  if (!match || !allowedBuckets().has(match[1])) return null;
  let objectPath: string;
  try {
    objectPath = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  if (objectPath.includes('..')) return null;
  return ALLOWED_PREFIXES.some(prefix => objectPath.startsWith(prefix)) ? objectPath : null;
}

function fileNameFor(name: string | null, objectPath: string): string {
  const fallback = objectPath.split('/').pop() || 'attachment';
  const cleaned = (name || '').replace(/[\r\n"\\/]/g, '_').trim();
  return cleaned || fallback;
}

export async function GET(req: NextRequest) {
  try {
    await authenticateAccess(req);
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }

  const target = req.nextUrl.searchParams.get('url') || '';
  const objectPath = storageObjectPath(target);
  if (!objectPath) {
    return NextResponse.json({ error: 'This file cannot be downloaded here.' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, { redirect: 'error', cache: 'no-store' });
  } catch {
    return NextResponse.json({ error: 'The file could not be reached. Try again.' }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    const status = upstream.status === 404 ? 404 : 502;
    const error = status === 404 ? 'This file no longer exists.' : 'The file could not be read. Try again.';
    return NextResponse.json({ error }, { status });
  }

  const fileName = fileNameFor(req.nextUrl.searchParams.get('name'), objectPath);
  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);
  return new Response(upstream.body, { status: 200, headers });
}
