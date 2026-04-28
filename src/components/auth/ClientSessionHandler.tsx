
'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from './AuthProvider';

const PUBLIC_ROUTES = ['/login', '/print-auth'];
const FALLBACK_AFTER_LOGIN = '/driver-management/mobile-hub';

const normalizePath = (path: string) => {
  if (!path) return '/';
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
};

const isSafeInternalPath = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');

export function ClientSessionHandler() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (loading) return;

    const currentPath = normalizePath(pathname || '/');
    const isPublicRoute = PUBLIC_ROUTES.some((route) => normalizePath(route) === currentPath);
    const redirectParam = searchParams?.get('redirect');
    const safeRedirect =
      isSafeInternalPath(redirectParam) && normalizePath(redirectParam) !== '/login'
        ? normalizePath(redirectParam)
        : FALLBACK_AFTER_LOGIN;

    // If user is logged in...
    if (user) {
      // ...and they are on a public page like /login, redirect them away.
      if (isPublicRoute && currentPath !== safeRedirect) {
        router.replace(safeRedirect);
        // Fallback for some mobile WebView navigation cases where router replace does not complete.
        window.setTimeout(() => {
          const livePath = normalizePath(window.location.pathname || '/');
          if (livePath === currentPath || PUBLIC_ROUTES.some((route) => normalizePath(route) === livePath)) {
            window.location.replace(safeRedirect);
          }
        }, 250);
      }
    } 
    // If user is not logged in...
    else {
      // ...and they are on a protected page, redirect them to login.
      if (!isPublicRoute) {
        const redirectTarget = isSafeInternalPath(currentPath) ? currentPath : '/';
        router.replace(`/login?redirect=${encodeURIComponent(redirectTarget)}`);
      }
    }
  }, [user, loading, pathname, router, searchParams]);

  return null; // This component does not render anything.
}
