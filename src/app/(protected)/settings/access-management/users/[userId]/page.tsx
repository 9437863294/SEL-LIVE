'use client';

/**
 * `/settings/access-management/users/[userId]` — one user's access profile (§25).
 *
 * A route of its own rather than a dialog on the main screen, because it is the thing an
 * administrator wants to send somebody: "here is exactly what Amit can do and where each piece came
 * from" is a URL, not a modal somebody else has to reproduce by clicking.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import { HrAccessDenied, HrLoader } from '@/components/hr/hr-ui';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAccessDirectory } from '@/hooks/useAccessDirectory';
import {
  actorFromUser,
  canOpenAccessManagement,
  canRevokeAccess,
} from '@/lib/access-control-service';
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
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <HrLoader />
      </div>
    );
  }

  if (!allowed || !actor) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <div className="mb-4 flex items-center gap-2">
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-semibold text-slate-800">Access profile</h1>
        </div>
        <HrAccessDenied what="this access profile" />
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
      <AuroraBackdrop />
      <div className="relative">
        <UserAccessProfile
          userId={userId}
          state={state}
          actor={actor}
          canRevoke={canRevokeAccess(can)}
        />
      </div>
    </div>
  );
}
