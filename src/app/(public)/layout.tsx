
// This layout is intentionally empty.
// The root layout handles the base HTML structure, and this route group
// ensures public pages do not inherit the protected layout's auth checks.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
