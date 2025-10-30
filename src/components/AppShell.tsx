
'use client';

import Header from '@/components/Header';
import { SessionExpiryDialog } from './auth/SessionExpiryDialog';
import { useAuth } from './auth/AuthProvider';
import { useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

export default function AppShell({
    children,
}: {
    children: React.ReactNode;
}) {
    const { isSessionExpired, setIsSessionExpired, extendSession, handleSignOut, user } = useAuth();
    
    return (
        <div className="flex flex-col min-h-screen">
            <Header />
            <div className="flex-1">
                {children}
            </div>
            <SessionExpiryDialog
                isOpen={isSessionExpired}
                onOpenChange={setIsSessionExpired}
                onSessionExtend={extendSession} // Let AuthProvider handle the reset
                onLogout={() => handleSignOut(true)}
            />
        </div>
    );
}
