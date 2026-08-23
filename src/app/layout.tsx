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
import { PushNotificationsLoader } from '@/components/notifications/PushNotificationsLoader';

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
      // globals.css sets `scroll-behavior: smooth` on html. Next needs this attribute to know the
      // smooth scroll is intentional, otherwise it warns and route transitions animate the scroll
      // reset instead of jumping.
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body>
        <ProgressBar />
        <AuthProvider>
          {/* ClientSessionHandler must be inside AuthProvider but outside AppShell to run reliably */}
          <Suspense fallback={null}>
            <ClientSessionHandler />
          </Suspense>
          <PushNotificationsLoader />
          <ModuleProvider>
            {children}
            <Toaster />
          </ModuleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
