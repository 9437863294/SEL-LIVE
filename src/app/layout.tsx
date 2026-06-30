// src/app/layout.tsx
import './globals.css';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { Toaster } from '@/components/ui/toaster';
import { ModuleProvider } from '@/context/ModuleContext';
import { Suspense } from 'react';
import { ClientSessionHandler } from '@/components/auth/ClientSessionHandler';
import ProgressBar from '@/components/app/ProgressBar';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['300', '400', '500', '600', '700'],
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`font-body antialiased ${inter.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ProgressBar />
        <AuthProvider>
          {/* ClientSessionHandler must be inside AuthProvider but outside AppShell to run reliably */}
          <Suspense fallback={null}>
            <ClientSessionHandler />
          </Suspense>
          <ModuleProvider>
            {children}
            <Toaster />
          </ModuleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
