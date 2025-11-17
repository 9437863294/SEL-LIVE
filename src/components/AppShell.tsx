
'use client';

import { Suspense } from 'react';
import Header from '@/components/Header';
import { SessionExpiryDialog } from './auth/SessionExpiryDialog';
import { useAuth } from './auth/AuthProvider';

export default function AppShell({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, loading, isSessionExpired, setIsSessionExpired, extendSession, handleSignOut } = useAuth();

    return (
        <>
            {/* 
              If we are loading or there's no user, we render a minimal layout or the public page.
              The ClientSessionHandler, now in the root layout, handles redirects.
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
