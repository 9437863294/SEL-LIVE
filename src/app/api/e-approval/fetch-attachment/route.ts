import { NextResponse } from 'next/server';

/**
 * Fetches a Storage file server-side and hands the bytes back to the browser.
 *
 * Signing a PDF needs its actual bytes in the browser — `pdf-lib` reads the file, not a URL. The
 * natural way to get them, `fetch(attachment.url)` straight from the client, fails with a bare
 * "Failed to fetch": Firebase Storage's download host does not send permissive CORS headers to an
 * arbitrary origin's `fetch()`/XHR, only to a full navigation (an `<a href>` click, an `<img src>`).
 * Setting bucket CORS (`gsutil cors set`) would fix it too, but needs `gcloud` access this
 * environment does not have — and gating the whole feature on infrastructure access nobody
 * configured is worse than a small proxy route.
 *
 * A server-to-server `fetch` has no CORS to trip: CORS is a browser-enforced rule about the page's
 * own origin, irrelevant once the request is not coming from a page at all.
 *
 * Deliberately not an open proxy: `url` must resolve to this project's own Firebase Storage host and
 * bucket, checked before any request leaves this server, so this cannot be turned into a way to make
 * the server fetch arbitrary internal or third-party URLs (SSRF). No additional auth check beyond
 * that — the download URL itself already carries Storage's own per-object token, the same
 * authorization an `<a href>` to it already relies on with no further protection today.
 */

const ALLOWED_HOST = 'firebasestorage.googleapis.com';
const ALLOWED_BUCKETS = ['module-hub-uc7tw.firebasestorage.app', 'module-hub-uc7tw.appspot.com'];

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get('url');
  if (!target) {
    return NextResponse.json({ error: 'Missing url parameter.' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: 'That is not a valid URL.' }, { status: 400 });
  }

  const bucketSegment = decodeURIComponent(parsed.pathname.split('/')[3] ?? '');
  if (parsed.hostname !== ALLOWED_HOST || !ALLOWED_BUCKETS.includes(bucketSegment)) {
    return NextResponse.json({ error: 'This file is not one this endpoint is allowed to fetch.' }, { status: 403 });
  }

  const upstream = await fetch(parsed.toString());
  if (!upstream.ok) {
    return NextResponse.json({ error: `Could not read the file (${upstream.status}).` }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=0, no-store',
    },
  });
}
