'use client';

/**
 * One part of the company profile (`settings/companyProfile`), edited on its own. The company
 * profile is still a single document behind `/api/company-profile`; each part — the layout of
 * sidebars, tables and dialogs, or the text labels — loads the stored document, edits only its
 * own fields and, on Save, reads the document again and writes it back with just those fields
 * replaced, so an edit made elsewhere (Company Profile's details or letterhead, another tab)
 * is never overwritten. Opening needs `Settings.Company Profile › View`; saving needs `Edit`.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2, RotateCcw, Save, ShieldAlert } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { invalidateCompanyProfile } from '@/hooks/use-company-profile';
import {
  COMPANY_PROFILE_RESOURCE,
  DEFAULT_COMPANY_PROFILE,
  sanitizeCompanyProfile,
  type CompanyDesign,
  type CompanyProfile,
  type UiTextKey,
} from '@/lib/company-profile';
import { cn } from '@/lib/utils';
import { PreviewToggle } from '@/components/appearance/controls';

export async function companyProfileFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  const token = await user.getIdToken();
  const response = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The company profile request failed.');
  return data as T;
}

/** The stored document, sanitised — what the settings screens edit. */
export async function readStoredProfile(): Promise<CompanyProfile> {
  return sanitizeCompanyProfile(await companyProfileFetch<CompanyProfile>('/api/company-profile?stored=1'));
}

export interface CompanyProfilePartEditor {
  canView: boolean;
  canEdit: boolean;
  readOnly: boolean;
  loading: boolean;
  loadError: string | null;
  /** The full stored profile with this part's unsaved edits applied. */
  draft: CompanyProfile | null;
  /** The draft as Save would store it (sanitised) — for the previews. */
  preview: CompanyProfile;
  setDraft: (change: (current: CompanyProfile) => CompanyProfile) => void;
  dirty: boolean;
  saving: boolean;
  save: () => Promise<void>;
  discard: () => void;
}

/**
 * `pick` names the part (for "is anything unsaved?"); `apply` copies the part from the draft
 * onto a freshly read stored profile — the document that is written back.
 */
export function useCompanyProfilePart({
  pick,
  apply,
  savedMessage,
}: {
  pick: (profile: CompanyProfile) => unknown;
  apply: (stored: CompanyProfile, draft: CompanyProfile) => CompanyProfile;
  savedMessage: string;
}): CompanyProfilePartEditor {
  const { toast } = useToast();
  const { can, isLoading: authzLoading } = useAuthorization();
  const canEdit = can('Edit', COMPANY_PROFILE_RESOURCE);
  const canView = canEdit || can('View', COMPANY_PROFILE_RESOURCE);

  const [saved, setSaved] = useState<CompanyProfile | null>(null);
  const [draft, setDraftState] = useState<CompanyProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authzLoading || !canView) return;
    let cancelled = false;
    readStoredProfile().then(
      (profile) => {
        if (cancelled) return;
        setSaved(profile);
        setDraftState(profile);
      },
      (error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load the company profile.'); },
    );
    return () => { cancelled = true; };
  }, [authzLoading, canView]);

  const setDraft = useCallback((change: (current: CompanyProfile) => CompanyProfile) => {
    setDraftState((current) => (current ? change(current) : current));
  }, []);

  const dirty = useMemo(() => Boolean(draft && saved && JSON.stringify(pick(draft)) !== JSON.stringify(pick(saved))), [draft, saved, pick]);
  const preview = useMemo(() => (draft ? sanitizeCompanyProfile(draft) : DEFAULT_COMPANY_PROFILE), [draft]);

  const save = async () => {
    if (!draft || !canEdit) return;
    setSaving(true);
    try {
      // Read again, so whatever else changed since this screen opened is kept.
      const fresh = await readStoredProfile();
      const body = apply(fresh, draft);
      const result = await companyProfileFetch<{ profile: CompanyProfile; stored: CompanyProfile }>('/api/company-profile', { method: 'PUT', body: JSON.stringify(body) });
      const stored = sanitizeCompanyProfile(result.stored);
      setSaved(stored);
      setDraftState(stored);
      invalidateCompanyProfile(result.profile);
      toast({ title: 'Saved', description: savedMessage });
    } catch (error) {
      toast({ title: 'Could not save', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    }
    setSaving(false);
  };

  return {
    canView,
    canEdit,
    readOnly: !canEdit,
    loading: authzLoading || (canView && !draft && !loadError),
    loadError,
    draft,
    preview,
    setDraft,
    dirty,
    saving,
    save,
    discard: () => { if (saved) setDraftState(saved); },
  };
}

/** Title, description and the part's own Discard / Save — and the loading, denied and read-only states. */
export function CompanyPartFrame({
  editor,
  title,
  description,
  icon: Icon,
  saveLabel,
  children,
}: {
  editor: CompanyProfilePartEditor;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  saveLabel?: string;
  children: (draft: CompanyProfile) => ReactNode;
}) {
  const { canView, canEdit, readOnly, loading, loadError, draft, dirty, saving, save, discard } = editor;
  return (
    <section className="min-w-0 space-y-3" aria-label={title}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
          {canView && readOnly && <p className="mt-1 text-xs text-muted-foreground">Read-only: saving needs the Company Profile › Edit permission.</p>}
        </div>
        {canEdit && draft && (
          <div className="flex flex-wrap gap-2">
            {dirty && (
              <Button variant="outline" onClick={discard} disabled={saving}>
                <RotateCcw className="mr-2 h-4 w-4" />Discard changes
              </Button>
            )}
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {saveLabel ?? 'Save'}
            </Button>
          </div>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : !canView || loadError || !draft ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <ShieldAlert className="h-10 w-10 text-destructive" />
            <span className="text-sm text-muted-foreground">
              {!canView ? 'Opening this needs the Company Profile › View permission.' : loadError}
            </span>
          </CardContent>
        </Card>
      ) : (
        children(draft)
      )}
    </section>
  );
}

/* ── small field helpers ─────────────────────────────────────────────────────────────────────── */

export type Option<T extends string> = { value: T; label: string };

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label className="text-xs font-semibold">{label}</Label>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function ChoiceField<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Option<T>[]; onChange: (value: T) => void; disabled: boolean }) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function ToggleField({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled: boolean }) {
  return (
    <label className="flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
      <span className="min-w-0">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}

export function PreviewCard({ title, children, onHide }: { title: string; children: ReactNode; onHide?: () => void }) {
  return (
    <Card className="min-w-0 xl:sticky xl:top-[calc(var(--app-header-offset,4rem)+1rem)] xl:self-start">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm">{title}</CardTitle>
            <CardDescription className="text-xs">The unsaved draft, as it will look.</CardDescription>
          </div>
          {onHide ? <PreviewToggle visible onToggle={() => onHide()} /> : null}
        </div>
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}

export function DialogPreview({ dialogs, labels }: { dialogs: CompanyDesign['dialogs']; labels: Record<UiTextKey, string> }) {
  // The real widths (24 / 32 / 42 / 64rem) at a quarter-ish scale, so the preview fits its card.
  const width = { auto: 'max-w-full', sm: 'max-w-[12rem]', md: 'max-w-[16rem]', lg: 'max-w-[21rem]', xl: 'max-w-full' }[dialogs.defaultSize];
  const caption = { auto: 'Each dialog keeps its own size', sm: '24rem wide', md: '32rem wide', lg: '42rem wide', xl: '64rem wide' }[dialogs.defaultSize];
  const footer = { end: 'justify-end', between: 'justify-between', stretch: '[&>*]:flex-1' }[dialogs.footerAlign];
  return (
    <div className={cn('w-full rounded-xl border bg-background p-4 shadow-md', width)}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{caption}</p>
      <p className="font-semibold">{labels.confirmDeleteTitle}</p>
      <p className="mt-1 text-sm text-muted-foreground">{labels.confirmDeleteDescription}</p>
      <div className={cn('mt-4 flex gap-2', footer)}>
        <Button variant="outline" size="sm" type="button">{labels.cancel}</Button>
        <Button variant="destructive" size="sm" type="button">{labels.delete}</Button>
      </div>
    </div>
  );
}
