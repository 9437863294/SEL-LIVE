
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
    
    // If there's no user and we are not loading, it's a public view (e.g. login page)
    // We don't render the main app shell for these cases.
    if (!loading && !user) {
        return <div className="min-h-screen">{children}</div>;
    }

    // While loading, we can show a skeleton or nothing.
    // This avoids showing the app shell layout on the login page briefly.
    if (loading) {
        return <div className="flex justify-center items-center h-screen">Loading application...</div>;
    }

    return (
        <div className="flex flex-col min-h-screen">
            <Suspense fallback={null}>
                <ClientSessionHandler />
            </Suspense>
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
    );
}
