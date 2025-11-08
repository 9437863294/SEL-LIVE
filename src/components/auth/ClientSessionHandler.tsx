
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

    const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
    const redirectParam = searchParams.get('redirect') || '/';

    // If user is logged in...
    if (user) {
      // ...and they are on a public page like /login, redirect them away.
      if (isPublicRoute) {
        router.replace(redirectParam);
      }
    } 
    // If user is not logged in...
    else {
      // ...and they are on a protected page, redirect them to login.
      if (!isPublicRoute) {
        router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      }
    }
  }, [user, loading, pathname, router, searchParams]);

  return null; // This component does not render anything.
}
