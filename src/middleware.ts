import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_ROUTES = ['/login', '/print-auth'];

function isPublicPrintRoute(pathname: string) {
  return (
    /^\/billing-recon\/[^/]+\/(jmc|mvac)\/[^/]+\/print$/.test(pathname) ||
    /^\/daily-requisition\/entry-sheet(\/[^/]+)?\/print$/.test(pathname)
  );
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

  // Public auth pages
  if (PUBLIC_ROUTES.includes(pathname)) {
    return NextResponse.next();
  }

  // Print routes: require print_auth, but NO normal login
  if (isPublicPrintRoute(pathname)) {
    const printAuth = req.cookies.get('print_auth');
    if (printAuth?.value !== 'ok') {
      const authUrl = new URL('/print-auth', req.url);
      authUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(authUrl);
    }
    return NextResponse.next();
  }

  // Everything else: let client-side AuthProvider handle protection
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
