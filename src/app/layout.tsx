import type { Metadata } from 'next';
import './globals.css';
import { ModuleProvider } from '@/context/ModuleContext';
import Header from '@/components/Header';
import { Toaster } from "@/components/ui/toaster";
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Module Hub',
  description: 'Create and organize your modules.',
};

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
      <body className={cn('font-body antialiased min-h-screen bg-background')}>
        <ModuleProvider>
          <div className="relative flex min-h-screen flex-col">
          </div>
          <Toaster />
        </ModuleProvider>
      </body>
    </html>
  );
}
