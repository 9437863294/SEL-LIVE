// src/app/(public)/layout.tsx
import type { ReactNode } from 'react';

export default function PublicLayout({ children }: { children: ReactNode }) {
  // Important:
  // - no auth checks
  // - no redirects
  // - no html/body tags (those stay in root layout)
  return <>{children}</>;
}
