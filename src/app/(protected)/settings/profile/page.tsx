'use client';

import { useCallback, useRef } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/AuthProvider';
import { AccessSummaryCard } from '@/components/profile/AccessSummaryCard';
import { PersonalDetailsCard } from '@/components/profile/PersonalDetailsCard';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { ProfilePreferencesCard } from '@/components/profile/ProfilePreferencesCard';
import { RecentActivityCard } from '@/components/profile/RecentActivityCard';
import { SecurityCard } from '@/components/profile/SecurityCard';
import { WorkDetailsCard } from '@/components/profile/WorkDetailsCard';

/**
 * Settings → Profile: who you are in SEL Live, what you can reach, and how your account is secured.
 *
 * Each section is its own component in `src/components/profile/` and loads its own data, so a slow
 * or failing source (greytHR, the activity log) only affects its own card. What a person can change
 * here is deliberately narrow — their display name and photo; email and mobile are identity keys
 * other modules match on and stay with administrators, and access is never granted from here.
 */
export default function ProfilePage() {
  const { loading } = useAuth();
  const security = useRef<HTMLDivElement>(null);

  // The completeness checklist's "Verify" / "Turn on" links land here.
  const jumpToSecurity = useCallback(() => {
    const target = security.current;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 px-3 py-3 sm:px-5">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-3 py-3 sm:px-5">
      <PageHeader
        title="Your profile"
        description="Your details, access and account security."
        backHref="/settings"
        backLabel="Back to settings"
      />

      <ProfileHero onJumpToSecurity={jumpToSecurity} />

      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <div className="min-w-0 space-y-4">
          <PersonalDetailsCard />
          <WorkDetailsCard />
          <AccessSummaryCard />
        </div>
        <div className="min-w-0 space-y-4">
          <div
            id="security"
            ref={security}
            tabIndex={-1}
            className="scroll-mt-[calc(var(--app-header-offset,4rem)+1rem)] rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SecurityCard />
          </div>
          <ProfilePreferencesCard />
          <RecentActivityCard />
        </div>
      </div>
    </div>
  );
}
