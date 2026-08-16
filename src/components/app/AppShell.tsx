
'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Header from '@/components/app/Header';
import { useAuth } from '@/components/auth/AuthProvider';
import { usePathname } from 'next/navigation';

const SessionExpiryDialog = dynamic(
  () => import('@/components/auth/SessionExpiryDialog').then((m) => m.SessionExpiryDialog),
  { ssr: false }
);

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

    // Listen for this user's administrator-managed location capture setting.
    // Imported on demand: this module statically pulls in the whole Capacitor
    // native plugin graph (geolocation, camera, filesystem, background-geolocation,
    // …), which has no business sitting in the web app's first paint.
    useEffect(() => {
        const userId = user?.id;
        if (!userId) return;
        let cancelled = false;
        let stop: ((options: { stopNative?: boolean }) => void) | null = null;

        void import('@/lib/user-location-service').then((locationService) => {
            if (cancelled) return;
            stop = locationService.stopUserLocationTracking;
            locationService.startUserLocationTracking(userId).catch(() => {});
        });

        return () => {
            cancelled = true;
            stop?.({ stopNative: false });
        };
    }, [user?.id]);

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
