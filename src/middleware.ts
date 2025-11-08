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

  // 1️⃣ Allow static & API
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // 2️⃣ Public routes: /login, /print-auth
  if (PUBLIC_ROUTES.includes(pathname)) {
    return NextResponse.next();
  }

  // 3️⃣ Public print routes with passcode gate
  if (isPublicPrintRoute(pathname)) {
    const printAuth = req.cookies.get('print_auth');
    if (printAuth?.value !== 'ok') {
      const authUrl = new URL('/print-auth', req.url);
      authUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(authUrl);
    }
    return NextResponse.next();
  }

  // 4️⃣ Everything else:
  // ✅ DO NOT check firebase-auth-token here
  // Let the client-side AuthProvider decide redirects.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
