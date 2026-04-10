
'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from './AuthProvider';

const PUBLIC_ROUTES = ['/login', '/print-auth'];

export function ClientSessionHandler() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (loading) return;

    const currentPath = pathname || '/';
    const isPublicRoute = PUBLIC_ROUTES.includes(currentPath);
    const redirectParam = searchParams?.get('redirect');
    const safeRedirect =
      redirectParam &&
      redirectParam.startsWith('/') &&
      !redirectParam.startsWith('//') &&
      redirectParam !== '/login'
        ? redirectParam
        : '/';

    // If user is logged in...
    if (user) {
      // ...and they are on a public page like /login, redirect them away.
      if (isPublicRoute && currentPath !== safeRedirect) {
        router.replace(safeRedirect);
      }
    } 
    // If user is not logged in...
    else {
      // ...and they are on a protected page, redirect them to login.
      if (!isPublicRoute) {
        router.replace(`/login?redirect=${encodeURIComponent(currentPath)}`);
      }
    }
  }, [user, loading, pathname, router, searchParams]);

  return null; // This component does not render anything.
}
