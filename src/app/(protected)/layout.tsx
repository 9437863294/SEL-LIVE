
'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// This layout now ONLY protects routes, redirects are handled by ClientSessionHandler
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login`);
    }
  }, [loading, user, router]);

  // While loading or if no user, render nothing to avoid flashes of content
  if (loading || !user) {
    return null;
  }
  
  return <>{children}</>;
}
