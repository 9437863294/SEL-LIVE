
// src/app/layout.tsx
import './globals.css';
import { Inter, Roboto } from 'next/font/google';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { Toaster } from '@/components/ui/toaster';
import { ModuleProvider } from '@/context/ModuleContext';
import AppShell from '@/components/AppShell';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const roboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-roboto',
  display: 'swap',
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${roboto.variable}`}
      suppressHydrationWarning
    >
      <body>
        <AuthProvider>
          <ModuleProvider>
            <AppShell>{children}</AppShell>
            <Toaster />
          </ModuleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
