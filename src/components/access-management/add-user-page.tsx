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
import { useRouter, useSearchParams } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { HrAccessDenied, HrLoader, HrPageHeader } from '@/components/hr/hr-ui';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAccessDirectory } from '@/hooks/useAccessDirectory';
import { actorFromUser, canAssignAccess } from '@/lib/access-control-service';
import { canCreateUser } from '@/lib/access-control';
import { AccessPageShell } from './access-ui';
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
   * This screen performs two distinct privileged operations: creating the login and assigning its
   * additive access. Requiring both prevents a role-only administrator from minting accounts, and
   * prevents a user-only administrator from assigning scoped access on the way in.
   */
  const allowed = useMemo(
    () => canCreateUser(can) && canAssignAccess(can),
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
    return (
      <AccessPageShell width="inset">
        <HrLoader label="Loading roles and organisation data…" />
      </AccessPageShell>
    );
  }
  // The protected layout should make this unreachable, but every write here is attributed to the
  // actor — so an unattributable creation is refused rather than recorded against nobody.
  if (!allowed || !actor) {
    return (
      <AccessPageShell width="inset" backHref={returnTo} backLabel="Back">
        <HrAccessDenied what="creating users" />
      </AccessPageShell>
    );
  }

  return (
    // A 2 cm gutter each side rather than a centred column: the form's sections are wide grids and
    // a role picker, and a 1024px cap on a wide monitor left more empty margin than form.
    <AccessPageShell width="inset" backHref={returnTo} backLabel="Back">
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
    </AccessPageShell>
  );
}

/** The icon the entry points use, so the button and the page agree. */
export const AddUserIcon = UserPlus;
