'use client';

import { usePathname } from 'next/navigation';

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // ✅ Skip any redirect logic for /print-auth
  // Example: if you normally redirect unauthenticated users, disable it here
  const isPrintAuth = pathname === '/print-auth';

  // Example:
  // if (!isPrintAuth && !user) router.push('/login');

  return <>{children}</>;
}
