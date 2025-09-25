

'use client';

import type { Metadata } from 'next';
import './globals.css';
import { ModuleProvider } from '@/context/ModuleContext';
import { Toaster } from "@/components/ui/toaster";
import { cn } from '@/lib/utils';
import { AuthProvider } from '@/components/auth/AuthProvider';
import React, { useState, useEffect } from 'react';
import Header from '@/components/Header';
import { useAuth } from '@/components/auth/AuthProvider';
import { Loader2 } from 'lucide-react';
import { SessionExpiryDialog } from '@/components/auth/SessionExpiryDialog';
import { Inter, Roboto } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

const roboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-roboto',
  display: 'swap',
})


function SessionTimer() {
  const { user } = useAuth();
  const [remainingTime, setRemainingTime] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      setRemainingTime(null);
      return;
    }

    const interval = setInterval(() => {
      const loginTimestamp = parseInt(sessionStorage.getItem('loginTimestamp') || '0', 10);
      if (loginTimestamp === 0) {
        setRemainingTime(null);
        return;
      }
      
      const sessionDurationMinutes = user.theme?.sessionDuration || 60;
      const sessionDurationMs = sessionDurationMinutes * 60 * 1000;
      const expiryTimestamp = loginTimestamp + sessionDurationMs;
      const now = Date.now();
      const remainingMs = expiryTimestamp - now;

      if (remainingMs > 0) {
        setRemainingTime(Math.round(remainingMs / 1000));
      } else {
        setRemainingTime(0);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [user]);
  

  const formatTime = (totalSeconds: number | null): string => {
    if (totalSeconds === null || totalSeconds < 0) return '';
    
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
  
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  if (remainingTime === null || remainingTime <= 0) {
    return null;
  }

  return (
    <span className="font-medium">
      Session expires in: {formatTime(remainingTime)}
    </span>
  );
}


function AppBody({ children }: { children: React.ReactNode }) {
    const { user, loading, isSessionExpired, setIsSessionExpired, extendSession, handleSignOut } = useAuth();
    const themeColor = user?.theme?.color || 'violet';
    const themeFont = user?.theme?.font || 'inter';

    useEffect(() => {
        if (user) {
            const sessionDurationMinutes = user.theme?.sessionDuration || 60;
            const sessionDurationMs = sessionDurationMinutes * 60 * 1000;
            const loginTimestamp = parseInt(sessionStorage.getItem('loginTimestamp') || '0', 10);
            
            if (loginTimestamp === 0) return;

            const checkExpiry = () => {
                const expiryTimestamp = loginTimestamp + sessionDurationMs;
                if (Date.now() > expiryTimestamp) {
                    setIsSessionExpired(true);
                }
            };
            
            const interval = setInterval(checkExpiry, 30000); // Check every 30 seconds
            return () => clearInterval(interval);
        }
    }, [user, setIsSessionExpired]);


    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        )
    }

    return (
        <div className={cn('font-body antialiased', `theme-${themeColor}`, `font-${themeFont}`)}>
            <div className="relative flex h-screen flex-col overflow-hidden bg-background">
                <Header />
                <main className="flex-1 overflow-auto">{children}</main>
            </div>
            <Toaster />
            <SessionExpiryDialog
                isOpen={isSessionExpired}
                onOpenChange={setIsSessionExpired}
                onSessionExtend={extendSession}
                onLogout={() => handleSignOut(true)}
            />
        </div>
    )
}

// Metadata should be exported from a server component.
// Since the whole file is 'use client', we define metadata in a separate server component file if needed
// or remove 'use client' from the layout file. For now, let's remove the export to fix the error.
/*
export const metadata: Metadata = {
  title: 'Module Hub',
  description: 'Create and organize your modules.',
};
*/


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${roboto.variable}`}>
      <body>
        <AuthProvider>
          <ModuleProvider>
              <AppBody>{children}</AppBody>
          </ModuleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
