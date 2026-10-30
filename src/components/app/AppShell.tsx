
'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Header from '@/components/app/Header';
import Breadcrumbs from '@/components/app/Breadcrumbs';
import { CompanyDesignProvider } from '@/components/shared/company-design-provider';
import { ActionAnimationProvider } from '@/components/shared/action-animations';
import { useAuth } from '@/components/auth/AuthProvider';
import { usePathname } from 'next/navigation';
import { noteNavigation } from '@/lib/navigation-history';
import { driverAppModeActive } from '@/lib/driver-app-mode';
import { cn } from '@/lib/utils';

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

    // Lets a page's back arrow return to the page it was opened from (see navigation-history.ts).
    useEffect(() => {
        if (safePathname) noteNavigation(safePathname);
    }, [safePathname]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        // Only on a phone: a desktop that once opened the driver sign-in keeps the global header.
        setHasDriverAppFlag(driverAppModeActive());
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

    const isDriverRoute = useMemo(() => safePathname.startsWith('/driver-management'), [safePathname]);

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

    // Signed in: the full shell. Loading or signed out: the page alone — the ClientSessionHandler, in
    // the root layout, handles redirects.
    const signedIn = !loading && !!user;
    const showHeader = !shouldUseDriverMobileShell;

    // `children` sits in the same place in the tree whichever way this goes. It used to be inside a
    // different wrapper before and after sign-in resolved, and React treats a moved subtree as a new
    // one: the whole page was thrown away and mounted a second time, re-running every hook and query
    // on it, at the moment the page was busiest.
    return (
        <div className={cn('min-h-screen', signedIn && 'flex flex-col')}>
            {signedIn && (
                <>
                    <CompanyDesignProvider />
                    <ActionAnimationProvider />
                    {showHeader && (
                        <>
                            <Header />
                            {/* Renders nothing unless the Breadcrumbs layout preference is on. */}
                            <Breadcrumbs />
                        </>
                    )}
                </>
            )}
            {/* The header's height (h-14 md:h-16 plus its border), held while sign-in resolves, so the
                page does not jump down when the real header arrives above it. */}
            {loading && showHeader && <div aria-hidden="true" className="box-content h-14 border-b md:h-16" />}
            <div className={cn(signedIn && 'flex-grow')}>
                {children}
            </div>
            {signedIn && (
                <SessionExpiryDialog
                    isOpen={isSessionExpired}
                    onOpenChange={setIsSessionExpired}
                    onSessionExtend={extendSession}
                    onLogout={() => handleSignOut(true)}
                />
            )}
        </div>
    );
}
