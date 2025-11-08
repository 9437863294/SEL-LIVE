// src/app/(protected)/layout.tsx
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';

// ✅ This layout wraps all protected routes and ensures authentication
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, pathname, router]);

  if (loading || !user) {
    return <div className="flex justify-center items-center h-screen">Loading...</div>;
  }
  
  // The AppShell is now in the root layout, so this just renders children.
  return <>{children}</>;
}
