
'use client';

import { useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { SessionExpiryDialog } from './SessionExpiryDialog';
import { Toaster } from '@/components/ui/toaster';

export function ClientAuthProvider({ children }: { children: React.ReactNode }) {
  const { user, loading, isSessionExpired, setIsSessionExpired, extendSession, handleSignOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user && pathname !== '/login') {
      router.push('/login');
    }
  }, [user, loading, pathname, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }
  
  const themeColor = user?.theme?.color || 'violet';
  const themeFont = user?.theme?.font || 'inter';


  return (
    <div className={`theme-${themeColor} font-${themeFont}`}>
        {children}
        <Toaster />
        <SessionExpiryDialog
            isOpen={isSessionExpired}
            onOpenChange={setIsSessionExpired}
            onSessionExtend={extendSession}
            onLogout={() => handleSignOut(true)}
        />
    </div>
  );
}
