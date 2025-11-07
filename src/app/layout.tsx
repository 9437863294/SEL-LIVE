
'use client';

import './globals.css';
import { ModuleProvider } from '@/context/ModuleContext';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { Toaster } from "@/components/ui/toaster";
import { Inter, Roboto } from 'next/font/google';
import AppShell from '@/components/AppShell';
import { usePathname } from 'next/navigation';

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

function AppContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPrintPage = pathname.includes('/print');

  if (isPrintPage) {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
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
            <AppContent>
              {children}
            </AppContent>
          </ModuleProvider>
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
