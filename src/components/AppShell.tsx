
'use client';

import { Suspense } from 'react';
import Header from '@/components/Header';
import { SessionExpiryDialog } from './auth/SessionExpiryDialog';
import { useAuth } from './auth/AuthProvider';
import { ClientSessionHandler } from './auth/ClientSessionHandler';

export default function AppShell({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, loading, isSessionExpired, setIsSessionExpired, extendSession, handleSignOut } = useAuth();

    return (
        <>
            {/* 
              This handler is now outside the conditional rendering to ensure it always runs.
              It will handle redirecting to /login if the user is not authenticated.
            */}
            <Suspense fallback={null}>
                <ClientSessionHandler />
            </Suspense>

            {/* 
              If we are loading or there's no user, we render a minimal layout or the public page.
              The ClientSessionHandler will have already decided if a redirect is needed.
            */}
            {loading || !user ? (
                <div className="min-h-screen">{children}</div>
            ) : (
                // Once authenticated, render the full application shell with header and footer.
                <div className="flex flex-col min-h-screen">
                    <Header />
                    <div className="flex-grow">
                        {children}
                    </div>
                    <SessionExpiryDialog
                        isOpen={isSessionExpired}
                        onOpenChange={setIsSessionExpired}
                        onSessionExtend={extendSession}
                        onLogout={() => handleSignOut(true)}
                    />
                </div>
            )}
        </>
    );
}
