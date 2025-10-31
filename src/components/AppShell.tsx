
'use client';

import Header from '@/components/Header';
import { SessionExpiryDialog } from './auth/SessionExpiryDialog';
import { useAuth } from './auth/AuthProvider';

export default function AppShell({
    children,
}: {
    children: React.ReactNode;
}) {
    const { isSessionExpired, setIsSessionExpired, extendSession, handleSignOut } = useAuth();
    
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
