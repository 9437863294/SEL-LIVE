'use client';

/**
 * `/settings/access-management/templates/new` and `/templates/[templateId]` — the template editor,
 * as a page. See `AccessTemplateForm` for why it stopped being a dialog.
 */

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HrAccessDenied, HrEmptyState, HrLoader, HrPageHeader } from '@/components/hr/hr-ui';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAccessDirectory } from '@/hooks/useAccessDirectory';
import { actorFromUser, canManageRoles } from '@/lib/access-control-service';
import { AccessPageShell } from './access-ui';
import { AccessTemplateForm } from './access-template-form';

const DEFAULT_RETURN = '/settings/access-management?tab=templates';

/** Same guard `AddUserPage` uses: accept only a same-site path, so a `returnTo` an attacker could
 * set cannot become an open redirect. */
function safeReturnPath(raw: string | null): string {
  if (!raw) return DEFAULT_RETURN;
  if (!raw.startsWith('/') || raw.startsWith('//')) return DEFAULT_RETURN;
  return raw;
}

export function AccessTemplatePage({ templateId }: { templateId?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();

  const returnTo = safeReturnPath(params.get('returnTo'));
  const allowed = useMemo(() => canManageRoles(can), [can]);

  const state = useAccessDirectory(!authLoading && allowed);
  const actor = useMemo(() => actorFromUser(user), [user]);

  const editing = useMemo(
    () => (templateId ? (state.directory.templates.find((entry) => entry.id === templateId) ?? null) : null),
    [templateId, state.directory.templates],
  );

  const goBack = useCallback(() => router.push(returnTo), [router, returnTo]);

  const handleSaved = useCallback(() => {
    router.push(returnTo);
  }, [router, returnTo]);

  if (authLoading || (state.isLoading && allowed)) {
    return (
      <AccessPageShell>
        <HrLoader label="Loading roles and templates…" />
      </AccessPageShell>
    );
  }
  if (!allowed || !actor) {
    return (
      <AccessPageShell backHref={returnTo} backLabel="Back to templates">
        <HrAccessDenied what="managing access templates" />
      </AccessPageShell>
    );
  }

  // A stale link to a template that was since deleted — say so rather than silently opening a blank
  // "new template" form under an edit URL, which would let an edit turn into an accidental duplicate.
  if (templateId && !editing && !state.isLoading) {
    return (
      <AccessPageShell width="form" backHref={returnTo} backLabel="Back to templates">
        <HrEmptyState
          icon={Sparkles}
          title="This template no longer exists"
          description="It may have been deleted since this link was made. Open the template list to see what is available now."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={returnTo}>Back to templates</Link>
            </Button>
          }
        />
      </AccessPageShell>
    );
  }

  return (
    // Full width, deliberately — same reasoning as the role builder: the permission tree and its
    // module chips are the content of this page, and a centred column would waste the room.
    <AccessPageShell backHref={returnTo} backLabel="Back to templates">
      <HrPageHeader
        title={editing ? `Edit ${editing.name}` : 'New access template'}
        description="A reusable bundle of roles, permissions and projects — applying one adds it on top of whatever the user already has."
      />

      {state.error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {state.error}
        </div>
      )}

      <AccessTemplateForm
        editing={editing}
        roles={state.directory.roles}
        projects={state.projects}
        registry={state.registry}
        actor={actor}
        onSaved={handleSaved}
        onCancel={goBack}
      />
    </AccessPageShell>
  );
}

/** Icon the entry points use, so the button and the page agree. */
export const AccessTemplateIcon = Sparkles;
