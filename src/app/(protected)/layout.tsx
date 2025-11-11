'use client';

// This layout now ONLY protects routes, redirects are handled by ClientSessionHandler
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  // All session-checking logic is now centralized in ClientSessionHandler.
  // This component's primary purpose is to apply layouts to protected routes.
  // We can add logic here for things that should *only* happen on protected routes
  // while the user is logged in.
  
  return <>{children}</>;
}
