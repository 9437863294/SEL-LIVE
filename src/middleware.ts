import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function isPublicPrintRoute(pathname: string) {
  // /billing-recon/<slug>/<jmc|mvac>/<id>/print
  if (/^\/billing-recon\/[^/]+\/(jmc|mvac)\/[^/]+\/print$/.test(pathname)) {
    return true;
  }

  // /daily-requisition/entry-sheet/print
  // /daily-requisition/entry-sheet/<id>/print
  if (/^\/daily-requisition\/entry-sheet(\/print|\/[^/]+\/print)$/.test(pathname)) {
    return true;
  }

  // /site-fund-requisition/print/<project-slug>/<requisition-id>
  if (/^\/site-fund-requisition\/print\/[^/]+\/[^/]+$/.test(pathname)) {
    return true;
  }

  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow Next internals, APIs, favicon
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // ✅ Allow the passcode page itself (no redirects, no checks)
  if (pathname === '/print-auth') {
    return NextResponse.next();
  }

  // ✅ Only protect the whitelisted print routes with the print_auth cookie
  if (isPublicPrintRoute(pathname)) {
    const printAuth = req.cookies.get('print_auth');

    if (printAuth?.value !== 'ok') {
      const authUrl = new URL('/print-auth', req.url);
      authUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(authUrl);
    }

    return NextResponse.next();
  }

  // Everything else: no server-side restriction here
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
