
'use client';

import Header from '@/components/Header';
import { SessionExpiryDialog } from './auth/SessionExpiryDialog';
import { useAuth } from './auth/AuthProvider';

export default function AppShell({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, loading, isSessionExpired, setIsSessionExpired, extendSession, handleSignOut } = useAuth();
    
    // If there's no user, we don't render the shell.
    // The protected layout will handle redirects.
    // This prevents the shell from appearing on the login page.
    if (loading || !user) {
        return <>{children}</>;
    }

    return (
        <div className="flex flex-col min-h-screen">
            <Header />
            <div className="flex-1">
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
