'use client';

/**
 * `/settings/access-management/templates/new` and `/templates/[templateId]` — the template editor,
 * as a page. See `AccessTemplateForm` for why it stopped being a dialog.
 */

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import { HrAccessDenied, HrLoader, HrPageHeader } from '@/components/hr/hr-ui';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAccessDirectory } from '@/hooks/useAccessDirectory';
import { actorFromUser, canManageRoles } from '@/lib/access-control-service';
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
    return <HrLoader label="Loading roles and templates…" />;
  }
  if (!allowed || !actor) return <HrAccessDenied what="managing access templates" />;

  // A stale link to a template that was since deleted — say so rather than silently opening a blank
  // "new template" form under an edit URL, which would let an edit turn into an accidental duplicate.
  if (templateId && !editing && !state.isLoading) {
    return (
      <div className="relative min-h-screen">
        <AuroraBackdrop />
        <div className="relative mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
          <HrAccessDenied what="a template that no longer exists" />
          <div className="mt-3 text-center">
            <Button asChild variant="outline" size="sm">
              <Link href={returnTo}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back to templates
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <AuroraBackdrop />
      {/*
        No `max-w` cap here, deliberately. The module-card grid and the permission tree both want
        width — more columns per row, a wider tree — and a 1024px-capped container centred on a wide
        monitor just turns that into two empty gutters. A small fixed side margin lets the form use
        the screen instead of fighting it.
      */}
      <div className="relative px-4 py-4 sm:px-8 sm:py-6">
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href={returnTo}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back
          </Link>
        </Button>

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
      </div>
    </div>
  );
}

/** Icon the entry points use, so the button and the page agree. */
export const AccessTemplateIcon = Sparkles;
