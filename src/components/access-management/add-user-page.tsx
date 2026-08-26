'use client';

/**
 * `/settings/access-management/users/new` — create a user, then go back where you came from.
 *
 * The page shell around `AddUserForm`: permission gate, directory load, and the return trip.
 *
 * ── The return trip ─────────────────────────────────────────────────────────────────────────────
 *
 * The form's value was always that it hands the new user straight to the assignment step, and a
 * separate page must not lose that. So the caller passes `?returnTo=`, and on success this navigates
 * there with `assignTo=<uid>` appended — which is the parameter the access-management screens already
 * read to preselect somebody. Nothing new had to be invented for it.
 *
 * `returnTo` is validated as a same-site path, not taken at face value: a `returnTo` an attacker can
 * set is an open redirect, and this page is reached by authenticated administrators.
 */

import * as React from 'react';
import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import { HrAccessDenied, HrLoader, HrPageHeader } from '@/components/hr/hr-ui';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAccessDirectory } from '@/hooks/useAccessDirectory';
import { actorFromUser, canAssignAccess } from '@/lib/access-control-service';
import { AddUserForm } from './add-user-form';

const DEFAULT_RETURN = '/settings/access-management';

/**
 * Accept only a path on this site.
 *
 * `//evil.example` and `https://evil.example` are both rejected — the first is a protocol-relative
 * URL that a naive "starts with /" check waves through.
 */
function safeReturnPath(raw: string | null): string {
  if (!raw) return DEFAULT_RETURN;
  if (!raw.startsWith('/') || raw.startsWith('//')) return DEFAULT_RETURN;
  return raw;
}

export function AddUserPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();

  const returnTo = safeReturnPath(params.get('returnTo'));

  /**
   * Creating a user is the same authority the drawer required, checked the same way.
   *
   * `canAssignAccess` rather than a bare permission check, because this screen also assigns roles on
   * the way in — and the access-management gate accepts the User Management + Role Management pair
   * that existing administrators already hold.
   */
  const allowed = useMemo(
    () => canAssignAccess(can) || can('Add', 'Settings.User Management'),
    [can],
  );

  const state = useAccessDirectory(!authLoading && allowed);
  const actor = useMemo(() => actorFromUser(user), [user]);

  const handleCreated = useCallback(
    (created: { id: string }) => {
      const separator = returnTo.includes('?') ? '&' : '?';
      router.push(`${returnTo}${separator}assignTo=${encodeURIComponent(created.id)}`);
    },
    [returnTo, router],
  );

  if (authLoading || (state.isLoading && allowed)) {
    return <HrLoader label="Loading roles and organisation data…" />;
  }
  if (!allowed) return <HrAccessDenied what="creating users" />;
  // The protected layout should make this unreachable, but every write here is attributed to the
  // actor — so an unattributable creation is refused rather than recorded against nobody.
  if (!actor) return <HrAccessDenied what="creating users" />;

  return (
    <div className="relative min-h-screen">
      <AuroraBackdrop />
      <div className="relative mx-auto max-w-5xl px-3 py-4 sm:px-6 sm:py-6">
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href={returnTo}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back
          </Link>
        </Button>

        <HrPageHeader
          title="Add user"
          description="Creates the login and the profile, then returns you to the assignment step with this user selected. A welcome email with the credentials is sent automatically."
        />

        {state.error && (
          <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {state.error}
          </div>
        )}

        <AddUserForm
          roles={state.directory.roles}
          departments={state.departments}
          designations={state.designations}
          projects={state.projects}
          users={state.directory.users}
          actor={actor}
          onCreated={handleCreated}
          onCancel={() => router.push(returnTo)}
        />
      </div>
    </div>
  );
}

/** The icon the entry points use, so the button and the page agree. */
export const AddUserIcon = UserPlus;
