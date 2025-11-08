
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_ROUTES = ['/login', '/print-auth'];

function isPublicPrintRoute(pathname: string) {
  return /^\/billing-recon\/[^/]+\/(jmc|mvac)\/[^/]+\/print$/.test(pathname) ||
         /^\/daily-requisition\/entry-sheet(\/[^/]+)?\/print$/.test(pathname);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get('firebase-auth-token');

  // Allow static files and API routes to pass through
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }
  
  if (PUBLIC_ROUTES.includes(pathname)) {
    return NextResponse.next();
  }

  if (isPublicPrintRoute(pathname)) {
      const printAuth = req.cookies.get('print_auth');
      if (printAuth?.value !== 'ok') {
          const authUrl = new URL('/print-auth', req.url);
          authUrl.searchParams.set('next', pathname);
          return NextResponse.redirect(authUrl);
      }
      return NextResponse.next();
  }

  // If no token and trying to access a protected route, redirect to login
  if (!token) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }
  
  // Let the client-side handle redirecting authenticated users from /login
  if (token && pathname === '/login') {
    return NextResponse.next();
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
