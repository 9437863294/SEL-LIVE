
'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from '@/components/Header';
import { SessionExpiryDialog } from './auth/SessionExpiryDialog';
import { useAuth } from './auth/AuthProvider';
import { usePathname } from 'next/navigation';

export default function AppShell({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, loading, isSessionExpired, setIsSessionExpired, extendSession, handleSignOut } = useAuth();
    const pathname = usePathname();
    const safePathname = pathname || '';
    const isPrintPage = safePathname.includes('/print');
    const [hasDriverAppFlag, setHasDriverAppFlag] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const sessionFlag = window.sessionStorage.getItem('driver_app_mode') === '1';
        const localFlag = window.localStorage.getItem('driver_app_mode') === '1';
        setHasDriverAppFlag(sessionFlag || localFlag);
    }, [safePathname]);

    const isDriverRoute = useMemo(
        () =>
            safePathname.startsWith('/driver-management') ||
            safePathname.startsWith('/vehicle-management/driver-mobile'),
        [safePathname]
    );

    const isAndroidWebView = useMemo(() => {
        if (typeof navigator === 'undefined') return false;
        const ua = navigator.userAgent || '';
        return /Android/i.test(ua) && /\bwv\b/i.test(ua);
    }, []);

    const shouldUseDriverMobileShell = isDriverRoute && (isAndroidWebView || hasDriverAppFlag);

    // If it's a print page, render children directly without any shell
    if (isPrintPage) {
        return <>{children}</>;
    }

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
                    {!shouldUseDriverMobileShell && <Header />}
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
