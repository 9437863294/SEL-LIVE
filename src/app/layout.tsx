
'use client';

import type { Metadata } from 'next';
import './globals.css';
import { ModuleProvider } from '@/context/ModuleContext';
import { Toaster } from "@/components/ui/toaster";
import { cn } from '@/lib/utils';
import { AuthProvider, useAuth } from '@/components/auth/AuthProvider';
import React, { useState, useEffect } from 'react';
import Header from '@/components/Header';
import { Loader2 } from 'lucide-react';
import { SessionExpiryDialog } from '@/components/auth/SessionExpiryDialog';
import { Inter, Roboto } from 'next/font/google';
import { usePathname } from 'next/navigation';
import { ClientAuthProvider } from '@/components/auth/ClientAuthProvider';


const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const roboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-roboto',
  display: 'swap',
})


function AppBody({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth();
    const pathname = usePathname();
    const isPublicRoute = pathname === '/login';
    
    const themeColor = user?.theme?.color || 'violet';
    const themeFont = user?.theme?.font || 'inter';

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        )
    }
    
    if(isPublicRoute) {
        return <div className={cn('font-body antialiased', `theme-${themeColor}`, `font-${themeFont}`)}>{children}</div>
    }

    return (
      <ClientAuthProvider>
        <div className={cn('font-body antialiased')}>
            <div className="relative flex h-screen flex-col overflow-hidden bg-background">
                <Header />
                <main className="flex-1 overflow-auto">{children}</main>
            </div>
        </div>
      </ClientAuthProvider>
    )
}

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
