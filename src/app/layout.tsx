
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
    const { user, loading } = useAuth();
    const themeColor = user?.theme?.color || 'violet';
    const themeFont = user?.theme?.font || 'inter';

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
                <main className="flex-1 overflow-auto p-6 md:p-8 lg:p-10">{children}</main>
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
