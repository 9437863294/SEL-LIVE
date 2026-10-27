'use client';

// TEMPORARY verification probe — delete before committing.
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { navigationOrigin, noteNavigation } from '@/lib/navigation-history';

export default function ProbeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  // Exactly what AppShell does for protected pages.
  useEffect(() => {
    if (pathname) noteNavigation(pathname);
    const w = window as unknown as { __probeLog?: unknown[] };
    (w.__probeLog ??= []).push({ pathname, origin: navigationOrigin(pathname), href: location.href });
  }, [pathname]);
  return <>{children}</>;
}
