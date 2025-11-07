import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ✅ Allow these print routes
const PRINT_PUBLIC_PATHS = [
  /^\/billing-recon\/[^/]+\/jmc\/[^/]+\/print$/,
  /^\/billing-recon\/[^/]+\/mvac\/[^/]+\/print$/,
];

function isPrintPath(pathname: string) {
  return PRINT_PUBLIC_PATHS.some((re) => re.test(pathname));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip system routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // ✅ Passcode logic for print routes
  if (isPrintPath(pathname)) {
    const hasCookie = req.cookies.get('print_auth')?.value === 'ok';
    if (hasCookie) return NextResponse.next();

    // redirect to /print-auth
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/print-auth';
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // 🔒 (optional) Normal login logic for other routes can go here

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
