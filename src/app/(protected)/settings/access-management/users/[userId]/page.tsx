'use client';

/**
 * `/settings/access-management/users/[userId]` — one user's access profile (§25).
 *
 * A route of its own rather than a dialog on the main screen, because it is the thing an
 * administrator wants to send somebody: "here is exactly what Amit can do and where each piece came
 * from" is a URL, not a modal somebody else has to reproduce by clicking.
 */

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { HrAccessDenied, HrLoader } from '@/components/hr/hr-ui';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAccessDirectory } from '@/hooks/useAccessDirectory';
import {
  actorFromUser,
  canOpenAccessManagement,
  canRevokeAccess,
} from '@/lib/access-control-service';
import { AccessPageShell } from '@/components/access-management/access-ui';
import { UserAccessProfile } from '@/components/access-management/user-access-profile';

export default function UserAccessProfilePage() {
  const params = useParams<{ userId: string }>();
  const userId = String(params?.userId ?? '');

  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();

  const allowed = useMemo(() => canOpenAccessManagement(can), [can]);
  const state = useAccessDirectory(!authLoading && allowed);
  const actor = useMemo(() => actorFromUser(user), [user]);

  if (authLoading) {
    return (
      <AccessPageShell>
        <HrLoader />
      </AccessPageShell>
    );
  }

  if (!allowed || !actor) {
    return (
      <AccessPageShell
        backHref="/settings"
        backLabel="Back to settings"
        aside={<h1 className="text-xl font-semibold text-slate-800">Access profile</h1>}
      >
        <HrAccessDenied what="this access profile" />
      </AccessPageShell>
    );
  }

  return (
    // No back link here: the profile renders its own, alongside the user's name and its actions.
    <AccessPageShell>
      <UserAccessProfile
        userId={userId}
        state={state}
        actor={actor}
        canRevoke={canRevokeAccess(can)}
      />
    </AccessPageShell>
  );
}
