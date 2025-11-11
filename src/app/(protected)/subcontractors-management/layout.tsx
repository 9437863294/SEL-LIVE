// This file is intentionally left empty. 
// The layout logic has been moved to src/app/(protected)/subcontractors-management/[project]/layout.tsx
// to prevent nested layouts.

export default function SubcontractorsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
