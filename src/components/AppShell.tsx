
'use client';

import Header from '@/components/Header';
import { SessionExpiryDialog } from './auth/SessionExpiryDialog';
import { useAuth } from './auth/AuthProvider';
import { useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

export default function AppShell({
    children,
}: {
    children: React.ReactNode;
}) {
    const { isSessionExpired, setIsSessionExpired, extendSession, handleSignOut, user } = useAuth();
    const { toast } = useToast();
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const sessionDuration = user?.theme?.sessionDuration || 60; // in minutes
        const SESSION_TIMEOUT = sessionDuration * 60 * 1000;
        const WARNING_TIME = 1 * 60 * 1000; // 1 minute before expiry

        const resetTimeouts = () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);

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
        };
        
        const activityEvents = ['mousemove', 'keydown', 'click', 'scroll'];
        const activityHandler = () => {
            extendSession();
            resetTimeouts();
        };

        if (user) {
            resetTimeouts();
            activityEvents.forEach(event => window.addEventListener(event, activityHandler));
        }

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
            activityEvents.forEach(event => window.removeEventListener(event, activityHandler));
        };
    }, [user, extendSession, setIsSessionExpired, handleSignOut]);


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
