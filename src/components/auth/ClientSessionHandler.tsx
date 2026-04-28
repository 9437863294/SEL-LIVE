
'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from './AuthProvider';

const PUBLIC_ROUTES = ['/login', '/driver-login', '/print-auth'];
const DRIVER_APP_DEFAULT_REDIRECT = '/driver-management/mobile-hub';
const WEB_DEFAULT_REDIRECT = '/';

const normalizePath = (path: string) => {
  if (!path) return '/';
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
};

const isSafeInternalPath = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');

type SearchParamGetter = { get: (key: string) => string | null } | null;

const isDriverAppClient = (currentPath: string, searchParams: SearchParamGetter) => {
  const appParam = searchParams?.get('app');
  if (appParam === 'driver') return true;

  if (typeof window === 'undefined') return false;

  const maybeCapacitor = (window as any).Capacitor;
  const isNativeCapacitor =
    typeof maybeCapacitor?.isNativePlatform === 'function' && Boolean(maybeCapacitor.isNativePlatform());
  if (isNativeCapacitor) return true;

  const ua = navigator.userAgent || '';
  const isAndroidWebView = /Android/i.test(ua) && /\bwv\b/i.test(ua);
  return isAndroidWebView && currentPath.startsWith('/driver-management');
};

export function ClientSessionHandler() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (loading) return;

    const currentPath = normalizePath(pathname || '/');
    const isPublicRoute = PUBLIC_ROUTES.some((route) => normalizePath(route) === currentPath);
    const isDriverContext = isDriverAppClient(currentPath, searchParams);
    const redirectParam = searchParams?.get('redirect');
    const requestedLoginFallback =
      isDriverContext || currentPath === '/driver-login' ? DRIVER_APP_DEFAULT_REDIRECT : WEB_DEFAULT_REDIRECT;
    const safeRedirect =
      isSafeInternalPath(redirectParam) &&
      !['/login', '/login/', '/driver-login', '/driver-login/'].includes(normalizePath(redirectParam))
        ? normalizePath(redirectParam)
        : requestedLoginFallback;

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
        const loginPath = isDriverContext ? '/driver-login' : '/login';
        const appQuery = isDriverContext ? '&app=driver' : '';
        router.replace(`${loginPath}?redirect=${encodeURIComponent(redirectTarget)}${appQuery}`);
      }
    }
  }, [user, loading, pathname, router, searchParams]);

  return null; // This component does not render anything.
}
