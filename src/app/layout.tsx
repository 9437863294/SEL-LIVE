// src/app/layout.tsx
import './globals.css';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { Toaster } from '@/components/ui/toaster';
import { ModuleProvider } from '@/context/ModuleContext';
import AppShell from '@/components/AppShell';
import { Suspense } from 'react';
import { ClientSessionHandler } from '@/components/auth/ClientSessionHandler';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className="font-body"
      suppressHydrationWarning
    >
      <body>
        <AuthProvider>
          {/* ClientSessionHandler must be inside AuthProvider but outside AppShell to run reliably */}
          <Suspense fallback={null}>
            <ClientSessionHandler />
          </Suspense>
          <ModuleProvider>
            <AppShell>{children}</AppShell>
            <Toaster />
          </ModuleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
