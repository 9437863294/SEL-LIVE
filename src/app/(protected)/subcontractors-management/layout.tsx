
'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import ProjectLayout from './[project]/layout';

export default function SubcontractorsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isProjectSpecificPage = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    // Path is /subcontractors-management/[slug] or deeper
    return segments.length > 1 && segments[0] === 'subcontractors-management';
  }, [pathname]);

  if (isProjectSpecificPage) {
    return <ProjectLayout>{children}</ProjectLayout>;
  }

  // This is the top-level /subcontractors-management page, which doesn't need the project sidebar.
  return <>{children}</>;
}
