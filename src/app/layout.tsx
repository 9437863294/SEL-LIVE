

'use client';

import type { Metadata } from 'next';
import './globals.css';
import { ModuleProvider } from '@/context/ModuleContext';
import { Toaster } from "@/components/ui/toaster";
import { cn } from '@/lib/utils';
import { AuthProvider } from '@/components/auth/AuthProvider';
import React from 'react';
import Header from '@/components/Header';
import { useAuth } from '@/components/auth/AuthProvider';
import { Loader2 } from 'lucide-react';

function AppBody({ children }: { children: React.ReactNode }) {
    const { user, loading, sessionRemainingTime } = useAuth();
    const themeColor = user?.theme?.color || 'violet';
    const themeFont = user?.theme?.font || 'inter';

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        )
    }
    
    const formatTime = (totalSeconds: number) => {
        if (totalSeconds < 0) return '00:00';
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    };

    return (
        <div className={cn('font-body antialiased', `theme-${themeColor}`, `font-${themeFont}`)}>
            <div className="relative flex h-screen flex-col overflow-hidden bg-background">
                <Header />
                <main className="flex-1 overflow-auto">{children}</main>
                <footer className="flex justify-between items-center text-muted-foreground text-sm py-4 px-6">
                    <span>Copyright © 2025 SEL. All Rights Reserved.</span>
                    {sessionRemainingTime !== null && (
                        <span className="font-medium">
                            Session expires in: {formatTime(sessionRemainingTime)}
                        </span>
                    )}
                </footer>
            </div>
            <Toaster />
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Module Hub</title>
        <meta name="description" content="Create and organize your modules." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto:wght@400;500;700&family=Lato:wght@400;700&display=swap" rel="stylesheet" />
      </head>
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
