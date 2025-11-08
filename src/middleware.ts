import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_ROUTES = ['/login'];
const PUBLIC_PRINT_ROUTES = [
  /^\/billing-recon\/[^/]+\/jmc\/[^/]+\/print$/,
  /^\/billing-recon\/[^/]+\/mvac\/[^/]+\/print$/,
  /^\/daily-requisition\/entry-sheet\/print$/,
  /^\/daily-requisition\/entry-sheet\/[^/]+\/print$/,
];

function isPublicRoute(pathname: string) {
  if (PUBLIC_ROUTES.includes(pathname)) {
    return true;
  }
  return PUBLIC_PRINT_ROUTES.some((re) => re.test(pathname));
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

  // If trying to access a public route, let them through
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // If no token and trying to access a protected route, redirect to login
  if (!token) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If token exists and trying to access login, redirect to home
  if (token && pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url));
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
