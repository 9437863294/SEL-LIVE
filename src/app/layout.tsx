

import type { Metadata } from 'next';
import './globals.css';
import { ModuleProvider } from '@/context/ModuleContext';
import { Toaster } from "@/components/ui/toaster";
import { cn } from '@/lib/utils';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { Loader2 } from 'lucide-react';
import React, { Suspense } from 'react';
import Header from '@/components/Header';

export const metadata: Metadata = {
  title: 'Module Hub',
  description: 'Create and organize your modules.',
};

function RootLayoutComponent({ children }: { children: React.ReactNode }) {
    return (
        <AuthProvider>
            <ModuleProvider>
                 <div className="relative flex min-h-screen flex-col bg-background">
                    <Header />
                    <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
                </div>
                <Toaster />
            </ModuleProvider>
        </AuthProvider>
    )
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className={cn('font-body antialiased')}>
        <Suspense fallback={
            <div className="flex min-h-screen items-center justify-center bg-background">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        }>
            <RootLayoutComponent>{children}</RootLayoutComponent>
        </Suspense>
      </body>
    </html>
  );
}
