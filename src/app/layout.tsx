// src/app/layout.tsx
import './globals.css';
// After globals.css: its dark-mode remaps must come later than Tailwind's utilities to win.
import './dark-compat.css';
import type { ReactNode } from 'react';
import { Atkinson_Hyperlegible, Inter, Roboto } from 'next/font/google';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { Toaster } from '@/components/ui/toaster';
import { ModuleProvider } from '@/context/ModuleContext';
import { Suspense } from 'react';
import { ClientSessionHandler } from '@/components/auth/ClientSessionHandler';
import ProgressBar from '@/components/app/ProgressBar';
import { PushNotificationsLoader } from '@/components/notifications/PushNotificationsLoader';
import { InlineScript } from '@/components/theme/InlineScript';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { appearanceInitScript } from '@/lib/appearance/init-script';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['300', '400', '500', '600', '700'],
});

// The other approved interface fonts (Settings → Appearance). Not preloaded: their files are only
// fetched on devices whose user picked them.
const roboto = Roboto({ subsets: ['latin'], display: 'swap', variable: '--font-roboto-face', weight: ['400', '500', '700'], preload: false });
const atkinson = Atkinson_Hyperlegible({ subsets: ['latin'], display: 'swap', variable: '--font-atkinson-face', weight: ['400', '700'], preload: false });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`font-body antialiased ${inter.variable} ${roboto.variable} ${atkinson.variable}`}
      // globals.css sets `scroll-behavior: smooth` on html. Next needs this attribute to know the
      // smooth scroll is intentional, otherwise it warns and route transitions animate the scroll
      // reset instead of jumping.
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {/* Replays the saved appearance (mode, text size, density, theme) while the HTML is parsed. */}
        <InlineScript html={appearanceInitScript()} />
      </head>
      <body>
        <ProgressBar />
        <AuthProvider>
          {/* ClientSessionHandler must be inside AuthProvider but outside AppShell to run reliably */}
          <Suspense fallback={null}>
            <ClientSessionHandler />
          </Suspense>
          <PushNotificationsLoader />
          <ThemeProvider>
            <ModuleProvider>
              {children}
              <Toaster />
            </ModuleProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
