
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
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const resetTimeouts = useCallback(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);

        const sessionDuration = user?.theme?.sessionDuration || 60;
        const SESSION_TIMEOUT = sessionDuration * 60 * 1000;
        const WARNING_TIME = 1 * 60 * 1000;

        const lastActivity = parseInt(sessionStorage.getItem('loginTimestamp') || Date.now().toString(), 10);
        const now = Date.now();
        const timeElapsed = now - lastActivity;

        if (timeElapsed >= SESSION_TIMEOUT) {
            handleSignOut(true);
            return;
        }

        const timeRemaining = SESSION_TIMEOUT - timeElapsed;

        if (timeRemaining <= WARNING_TIME) {
            setIsSessionExpired(true);
        } else {
            warningTimeoutRef.current = setTimeout(() => {
                setIsSessionExpired(true);
            }, timeRemaining - WARNING_TIME);
        }

        timeoutRef.current = setTimeout(() => {
            handleSignOut(true);
        }, timeRemaining);
    }, [user, handleSignOut, setIsSessionExpired]);

    const activityHandler = useCallback(() => {
        extendSession();
        resetTimeouts();
    }, [extendSession, resetTimeouts]);

    useEffect(() => {
        if (user) {
            resetTimeouts();
            const activityEvents = ['mousemove', 'keydown', 'click', 'scroll'];
            activityEvents.forEach(event => window.addEventListener(event, activityHandler));

            return () => {
                if (timeoutRef.current) clearTimeout(timeoutRef.current);
                if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
                activityEvents.forEach(event => window.removeEventListener(event, activityHandler));
            };
        }
    }, [user, activityHandler, resetTimeouts]);


    return (
        <div className="flex flex-col min-h-screen">
            <Header />
            <div className="flex-1">
                {children}
            </div>
            <SessionExpiryDialog
                isOpen={isSessionExpired}
                onOpenChange={setIsSessionExpired}
                onSessionExtend={activityHandler} // Use activityHandler to reset everything
                onLogout={() => handleSignOut(true)}
            />
        </div>
    );
}
