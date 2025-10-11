import './globals.css';
import { ModuleProvider } from '@/context/ModuleContext';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { Toaster } from "@/components/ui/toaster";
import { Inter, Roboto } from 'next/font/google';
import AppShell from '@/components/AppShell';

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
            <AppShell>
              {children}
            </AppShell>
          </ModuleProvider>
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
