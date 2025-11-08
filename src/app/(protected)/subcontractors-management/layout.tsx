
'use client';

import { usePathname } from 'next/navigation';

export default function SubcontractorsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  
  // This layout is just a pass-through. 
  // The logic is handled in the child layouts to show sidebars appropriately.
  // We add this to cleanly handle the top-level `/subcontractors-management` route.
  return <>{children}</>;
}
