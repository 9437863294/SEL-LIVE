'use client';

/**
 * `/settings/access-management/roles/new` and `/roles/[roleId]` — the Role Builder, as a page.
 *
 * The shell around `RoleForm`: permission gate, directory load, and the return trip. See `RoleForm`
 * for why it stopped being a dialog.
 *
 * ── Three entry points, two routes ──────────────────────────────────────────────────────────────
 *
 *   `/roles/new`                        create from nothing
 *   `/roles/new?duplicateFrom=<id>`     create pre-filled from another role
 *   `/roles/<id>`                       edit that role
 *
 * Duplicating lives under `new` rather than under the source role's URL because it *creates* a role:
 * putting it on `/roles/<id>` would make the same address sometimes mean "change this" and sometimes
 * "copy this", which is exactly the ambiguity a bookmarkable URL should not have.
 *
 * ── The return trip ────────────────────────────────────────────────────────────────────────────
 *
 * The dialog's real value was that creating a role handed it straight to the assignment step, and a
 * separate page must not lose that. The caller passes `?returnTo=`, and on create this navigates
 * there with `assignRole=<id>` appended — the parameter the Access Control Center reads to open
 * Assign Access with a role preselected. Saving an *existing* role just returns, since its holders
 * already have it.
 *
 * `returnTo` is validated as a same-site path rather than taken at face value: a `returnTo` an
 * attacker can set is an open redirect, and this page is reached by authenticated administrators.
 */

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HrAccessDenied, HrEmptyState, HrLoader, HrPageHeader } from '@/components/hr/hr-ui';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAccessDirectory } from '@/hooks/useAccessDirectory';
import { actorFromUser, canManageRoles } from '@/lib/access-control-service';
import { AccessPageShell } from './access-ui';
import { RoleForm } from './role-form';

const DEFAULT_RETURN = '/settings/access-management?tab=roles';

/** Accept only a path on this site. `//evil.example` is rejected too — a protocol-relative URL that a
 * naive "starts with /" check waves through. */
function safeReturnPath(raw: string | null): string {
  if (!raw) return DEFAULT_RETURN;
  if (!raw.startsWith('/') || raw.startsWith('//')) return DEFAULT_RETURN;
  return raw;
}

export function RolePage({ roleId }: { roleId?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();

  const returnTo = safeReturnPath(params.get('returnTo'));
  const duplicateFrom = params.get('duplicateFrom');

  const allowed = useMemo(() => canManageRoles(can), [can]);

  const state = useAccessDirectory(!authLoading && allowed);
  const actor = useMemo(() => actorFromUser(user), [user]);

  const editing = useMemo(
    () => (roleId ? (state.directory.roles.find((role) => role.id === roleId) ?? null) : null),
    [roleId, state.directory.roles],
  );

  /** Only meaningful on `/roles/new`; an edit URL that also carried it would be contradictory. */
  const duplicating = useMemo(
    () =>
      !roleId && duplicateFrom
        ? (state.directory.roles.find((role) => role.id === duplicateFrom) ?? null)
        : null,
    [roleId, duplicateFrom, state.directory.roles],
  );

  const goBack = useCallback(() => router.push(returnTo), [router, returnTo]);

  const handleSaved = useCallback(
    (savedRoleId: string, created: boolean) => {
      if (!created) {
        router.push(returnTo);
        return;
      }
      const separator = returnTo.includes('?') ? '&' : '?';
      router.push(`${returnTo}${separator}assignRole=${encodeURIComponent(savedRoleId)}`);
    },
    [returnTo, router],
  );

  if (authLoading || (state.isLoading && allowed)) {
    return <HrLoader label="Loading roles and the permission registry…" />;
  }
  if (!allowed || !actor) return <HrAccessDenied what="managing roles" />;

  /**
   * A stale link to a role that has since been deleted.
   *
   * Said plainly rather than silently opening a blank "new role" form under an edit URL — which would
   * turn an intended edit into an accidental second role, under a name somebody is still assigned to.
   */
  if (roleId && !editing) {
    return (
      <AccessPageShell width="form" backHref={returnTo} backLabel="Back to roles">
        <HrEmptyState
          icon={ShieldCheck}
          title="This role no longer exists"
          description="It may have been deleted since this link was made. The role library lists everything that is still there."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={returnTo}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back to roles
              </Link>
            </Button>
          }
        />
      </AccessPageShell>
    );
  }

  /** Likewise for a duplicate link whose source is gone — falling through to a blank form would
   * silently create an empty role under the name "… (copy)". */
  if (!roleId && duplicateFrom && !duplicating) {
    return (
      <AccessPageShell width="form" backHref={returnTo} backLabel="Back to roles">
        <HrEmptyState
          icon={ShieldCheck}
          title="The role being copied no longer exists"
          description="Open the role library and duplicate it from there, or start a new role from scratch."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/access-management/roles/new">Start a new role instead</Link>
            </Button>
          }
        />
      </AccessPageShell>
    );
  }

  return (
    // Full width, deliberately: the permission tree and its 27 module chips are the content of this
    // page, and a centred column on a wide monitor would just turn that room into two empty gutters.
    <AccessPageShell backHref={returnTo} backLabel="Back to roles">
      <HrPageHeader
        title={editing ? `Edit ${editing.name}` : duplicating ? `Duplicate ${duplicating.name}` : 'New role'}
        description={
          duplicating
            ? 'Starts from the original’s permissions. Add or remove before saving — the original is untouched.'
            : editing
              ? 'Changes reach everybody holding this role, whether it is their base role or an additional one.'
              : 'Pick the permissions this role should carry, then assign it to users.'
        }
      />

      {state.error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {state.error}
        </div>
      )}

      <RoleForm
        editing={editing}
        duplicating={duplicating}
        registry={state.registry}
        existingNames={state.directory.roles.map((role) => role.name)}
        actor={actor}
        onSaved={handleSaved}
        onCancel={goBack}
      />
    </AccessPageShell>
  );
}
