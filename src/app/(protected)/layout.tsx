
// src/app/(protected)/layout.tsx
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import AppShell from '@/components/AppShell';
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

  if (loading) {
    return <div className="flex justify-center items-center h-screen">Loading...</div>;
  }

  if (!user) return null; // Prevent flicker while redirecting

  return <AppShell>{children}</AppShell>;
}
