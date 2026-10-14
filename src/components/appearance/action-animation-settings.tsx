'use client';

/**
 * Settings for the animated action buttons, self-contained (its own load, save, loading and error
 * states, toasts):
 *
 *   <ActionAnimationSettings scope="company" />   the company default per action kind — saved into
 *       Settings › Company Profile (`design.animations`), editable with Settings.Company Profile › Edit
 *   <ActionAnimationSettings scope="personal" />  this user's own choice — Company default / My own /
 *       Off — saved with their appearance preferences (`animations`)
 *
 * Every kind has a live "Try it" (press, then completion) and "Try failure", which play the values
 * on screen before they are saved.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useAppearance, useReducedMotion } from '@/components/theme/ThemeProvider';
import { playActionAnimation } from '@/components/shared/action-animations';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { invalidateCompanyProfile, useCompanyProfile } from '@/hooks/use-company-profile';
import { COMPANY_PROFILE_RESOURCE, sanitizeCompanyProfile, type CompanyProfile } from '@/lib/company-profile';
import {
  ACTION_ANIMATION_PRESETS,
  ACTION_KINDS,
  ACTION_KIND_META,
  ANIMATION_MODES,
  DEFAULT_ACTION_ANIMATIONS,
  DEFAULT_ACTION_KIND_CONFIGS,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  resolveActionAnimations,
  sanitizeActionAnimations,
  sanitizeKindConfig,
  type ActionAnimationSettings as CompanyAnimations,
  type ActionKind,
  type ActionKindConfig,
  type AnimationMode,
  type UserActionAnimations,
} from '@/lib/action-animations';

type Kinds = Record<ActionKind, ActionKindConfig>;

async function authorizedFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  const token = await user.getIdToken();
  const response = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `The server answered ${response.status}.`);
  return data as T;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const labelOf = <T extends string>(list: { id: T; label: string }[], id: T) => list.find((option) => option.id === id)?.label ?? id;

export function ActionAnimationSettings({ scope }: { scope: 'company' | 'personal' }) {
  return scope === 'company' ? <CompanyAnimationSettings /> : <PersonalAnimationSettings />;
}

// ── Company scope ────────────────────────────────────────────────────────────────────────────────

function CompanyAnimationSettings() {
  const { toast } = useToast();
  const { can, isLoading: authzLoading } = useAuthorization();
  const canEdit = can('Edit', COMPANY_PROFILE_RESOURCE);
  const { profile, loading } = useCompanyProfile();
  const current = profile.design.animations;
  // Null until the admin changes something: until then the stored value is shown as it updates.
  const [edited, setEdited] = useState<CompanyAnimations | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = edited ?? current;
  const setDraft = (next: CompanyAnimations | null) => setEdited(next && same(next, current) ? null : next);

  const dirty = Boolean(edited && !same(edited, current));
  const readOnly = !canEdit || saving;

  const save = async () => {
    if (!draft || !canEdit) return;
    setSaving(true);
    setError(null);
    try {
      // Read the stored document fresh, so only the animations change.
      const stored = sanitizeCompanyProfile(await authorizedFetch<CompanyProfile>('/api/company-profile?stored=1'));
      const body: CompanyProfile = { ...stored, design: { ...stored.design, animations: sanitizeActionAnimations(draft) } };
      const result = await authorizedFetch<{ profile: CompanyProfile; stored: CompanyProfile }>('/api/company-profile', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setEdited(null);
      invalidateCompanyProfile(result.profile);
      toast({ title: 'Button animations saved', description: 'Everyone who follows the company default now sees them.' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Please try again.';
      setError(message);
      toast({ title: 'Could not save button animations', description: message, variant: 'destructive' });
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Button animations · company default</CardTitle>
        <CardDescription>
          How action buttons respond when pressed and when their action finishes or fails, for everyone who has not chosen their own.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || authzLoading ? (
          <LoadingRows />
        ) : (
          <>
            {!canEdit && (
              <Notice>Only people with Settings › Company Profile › Edit can change the company default. You can still try each animation.</Notice>
            )}
            <ReducedMotionNotice />
            <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Label htmlFor="aa-company-enabled" className="font-medium">Animate action buttons</Label>
                <div className="text-sm text-muted-foreground">Off turns every button animation off for people who follow the company.</div>
              </div>
              <Switch
                id="aa-company-enabled"
                checked={draft.enabled}
                disabled={readOnly}
                onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
              />
            </div>
            <KindList
              kinds={draft.kinds}
              disabled={readOnly || !draft.enabled}
              onChange={(kind, config) => setDraft({ ...draft, kinds: { ...draft.kinds, [kind]: config } })}
              resetTo={(kind) => DEFAULT_ACTION_KIND_CONFIGS[kind]}
              resetLabel="Built-in default"
            />
            {error && <Notice tone="error">{error}</Notice>}
            {canEdit && (
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" disabled={saving} action={false} onClick={() => setDraft(DEFAULT_ACTION_ANIMATIONS)}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Restore built-in defaults
                </Button>
                <Button variant="outline" disabled={!dirty || saving} onClick={() => setDraft(null)}>
                  Discard changes
                </Button>
                <Button disabled={!dirty || saving} onClick={() => void save()} action="save">
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Personal scope ───────────────────────────────────────────────────────────────────────────────

const MODE_META: Record<AnimationMode, { label: string; description: string }> = {
  company: { label: 'Company default', description: 'Use the animations your company chose.' },
  custom: { label: 'My own', description: 'Choose each animation yourself.' },
  off: { label: 'Off', description: 'No button animations.' },
};

/** What to store for a choice: nothing for the company default, only the kinds that differ for "My own". */
function toStored(mode: AnimationMode, kinds: Kinds, company: CompanyAnimations): UserActionAnimations | undefined {
  if (mode === 'company') return undefined;
  if (mode === 'off') return { mode: 'off' };
  const own: Partial<Kinds> = {};
  for (const kind of ACTION_KINDS) if (!same(kinds[kind], company.kinds[kind])) own[kind] = kinds[kind];
  return { mode: 'custom', kinds: own };
}

function PersonalAnimationSettings() {
  const { toast } = useToast();
  const { preferences, updatePreferences, ready, signedIn, saveStatus, saveError } = useAppearance();
  const { profile, loading } = useCompanyProfile();
  const company = profile.design.animations;
  const stored = preferences.animations;

  const storedKinds = useMemo(() => resolveActionAnimations(company, stored?.mode === 'custom' ? stored : undefined).kinds, [company, stored]);
  // Null until the user changes something: until then what is stored is shown.
  const [edited, setEdited] = useState<{ mode: AnimationMode; kinds: Kinds } | null>(null);
  const mode = edited?.mode ?? stored?.mode ?? 'company';
  const kinds = edited?.kinds ?? storedKinds;
  const setMode = (id: AnimationMode) => setEdited({ mode: id, kinds });
  const setKinds = (next: Kinds) => setEdited({ mode, kinds: next });
  const awaiting = useRef<'idle' | 'requested' | 'saving'>('idle');

  const next = useMemo(() => toStored(mode, kinds, company), [mode, kinds, company]);
  const dirty = Boolean(edited) && !same(next ?? null, stored ?? null);

  useEffect(() => {
    if (awaiting.current === 'idle') return;
    if (saveStatus === 'saving') awaiting.current = 'saving';
    else if (saveStatus === 'saved' && awaiting.current === 'saving') {
      awaiting.current = 'idle';
      toast({ title: 'Button animations saved', description: 'Your choice applies on every device you sign in on.' });
    } else if (saveStatus === 'error') {
      awaiting.current = 'idle';
      toast({ title: 'Could not save button animations', description: saveError ?? 'Please try again.', variant: 'destructive' });
    }
  }, [saveStatus, saveError, toast]);

  const save = () => {
    updatePreferences((current) => {
      const updated = { ...current };
      if (next) updated.animations = next;
      else delete updated.animations;
      return updated;
    });
    setEdited(null);
    if (signedIn) awaiting.current = 'requested';
    else toast({ title: 'Button animations saved on this device' });
  };

  const discard = () => setEdited(null);

  const shownKinds = mode === 'custom' ? kinds : company.kinds;
  const busy = saveStatus === 'saving';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Button animations · just for me</CardTitle>
        <CardDescription>How action buttons respond for you when pressed and when their action finishes or fails.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!ready || loading ? (
          <LoadingRows />
        ) : (
          <>
            <ReducedMotionNotice />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Button animations">
              {ANIMATION_MODES.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={mode === id}
                  onClick={() => setMode(id)}
                  className={
                    mode === id
                      ? 'min-w-0 rounded-md border border-primary bg-primary/10 p-3 text-left ring-1 ring-primary'
                      : 'min-w-0 rounded-md border p-3 text-left hover:bg-muted'
                  }
                >
                  <div className="font-medium">{MODE_META[id].label}</div>
                  <div className="text-sm text-muted-foreground">{MODE_META[id].description}</div>
                </button>
              ))}
            </div>
            {mode !== 'off' && (
              <>
                {mode === 'company' && (
                  <Notice>
                    {company.enabled ? 'These are the company’s choices. Pick “My own” to change them for yourself.' : 'Your company has button animations turned off. Pick “My own” to have them anyway.'}
                  </Notice>
                )}
                <KindList
                  kinds={shownKinds}
                  disabled={mode !== 'custom'}
                  onChange={(kind, config) => setKinds({ ...kinds, [kind]: config })}
                  resetTo={(kind) => company.kinds[kind]}
                  resetLabel="Company default"
                />
              </>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" disabled={!dirty} onClick={discard}>
                Discard changes
              </Button>
              <Button disabled={!dirty || busy} onClick={save} action="save">
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Shared pieces ────────────────────────────────────────────────────────────────────────────────

function KindList({
  kinds,
  disabled,
  onChange,
  resetTo,
  resetLabel,
}: {
  kinds: Kinds;
  disabled: boolean;
  onChange: (kind: ActionKind, config: ActionKindConfig) => void;
  resetTo: (kind: ActionKind) => ActionKindConfig;
  resetLabel: string;
}) {
  return (
    // The list's own controls (accordion headers) are not actions; "Try it" plays explicitly.
    <div data-action-animations="off">
      <Accordion type="multiple" className="rounded-md border">
        {ACTION_KINDS.map((kind) => (
          <KindRow key={kind} kind={kind} config={kinds[kind]} disabled={disabled} onChange={(config) => onChange(kind, config)} reset={resetTo(kind)} resetLabel={resetLabel} />
        ))}
      </Accordion>
    </div>
  );
}

function KindRow({
  kind,
  config,
  disabled,
  onChange,
  reset,
  resetLabel,
}: {
  kind: ActionKind;
  config: ActionKindConfig;
  disabled: boolean;
  onChange: (config: ActionKindConfig) => void;
  reset: ActionKindConfig;
  resetLabel: string;
}) {
  const tryRef = useRef<HTMLButtonElement>(null);
  const failRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const set = (patch: Partial<ActionKindConfig>) => onChange(sanitizeKindConfig({ ...config, ...patch }, config));
  const meta = ACTION_KIND_META[kind];
  const id = `aa-${kind}`;

  const tryIt = () => {
    const element = tryRef.current;
    if (!element) return;
    window.clearTimeout(timer.current);
    playActionAnimation(element, kind, 'press', { config, force: true });
    const pressMs = config.press === 'none' ? 0 : Math.max(150, Math.round(config.durationMs * 0.5));
    timer.current = window.setTimeout(() => playActionAnimation(tryRef.current, kind, 'complete', { config, force: true }), pressMs * 0.7 + 60);
  };
  const tryFailure = () => {
    const element = failRef.current;
    if (!element) return;
    playActionAnimation(element, kind, 'press', { config, force: true });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => playActionAnimation(failRef.current, kind, 'failure', { config, force: true }), 220);
  };

  const summary = config.enabled
    ? `${labelOf(ACTION_ANIMATION_PRESETS.press, config.press)} · ${labelOf(ACTION_ANIMATION_PRESETS.complete, config.complete)}`
    : 'Off';

  return (
    <AccordionItem value={kind} className="px-3 last:border-b-0">
      <AccordionTrigger className="gap-3 py-3 text-left hover:no-underline">
        <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-3">
          <span className="font-medium">{meta.label}</span>
          <span className="truncate text-sm font-normal text-muted-foreground">{summary}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-4 pb-2">
          <div className="flex items-center gap-3">
            <Switch id={`${id}-enabled`} checked={config.enabled} disabled={disabled} onCheckedChange={(enabled) => set({ enabled })} />
            <Label htmlFor={`${id}-enabled`}>Animate {meta.label.toLowerCase()} buttons</Label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <EffectSelect label="When pressed" id={`${id}-press`} value={config.press} options={ACTION_ANIMATION_PRESETS.press} disabled={disabled} onChange={(press) => set({ press })} />
            <EffectSelect label="When it finishes" id={`${id}-complete`} value={config.complete} options={ACTION_ANIMATION_PRESETS.complete} disabled={disabled} onChange={(complete) => set({ complete })} />
            <EffectSelect label="When it fails" id={`${id}-failure`} value={config.failure} options={ACTION_ANIMATION_PRESETS.failure} disabled={disabled} onChange={(failure) => set({ failure })} />
            <EffectSelect label="Intensity" id={`${id}-intensity`} value={config.intensity} options={ACTION_ANIMATION_PRESETS.intensity} disabled={disabled} onChange={(intensity) => set({ intensity })} />
            <div className="min-w-0 space-y-2 sm:col-span-2">
              <Label htmlFor={`${id}-speed`}>Speed · {config.durationMs} ms</Label>
              <Slider
                id={`${id}-speed`}
                min={MIN_DURATION_MS}
                max={MAX_DURATION_MS}
                step={50}
                value={[config.durationMs]}
                disabled={disabled}
                onValueChange={([durationMs]) => set({ durationMs })}
                aria-label={`${meta.label} animation length in milliseconds`}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Faster</span>
                <span>Slower</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button ref={tryRef} type="button" size="sm" action={false} onClick={tryIt}>
              <Play className="mr-2 h-4 w-4" /> Try it: {meta.example}
            </Button>
            <Button ref={failRef} type="button" size="sm" variant="outline" action={false} onClick={tryFailure}>
              <TriangleAlert className="mr-2 h-4 w-4" /> Try failure
            </Button>
            {!disabled && !same(config, reset) && (
              <Button type="button" size="sm" variant="ghost" action={false} onClick={() => onChange(reset)}>
                <RotateCcw className="mr-2 h-4 w-4" /> {resetLabel}
              </Button>
            )}
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function EffectSelect<T extends string>({
  label,
  id,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  id: string;
  value: T;
  options: { id: T; label: string; description: string }[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} disabled={disabled} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="text-xs text-muted-foreground">{options.find((option) => option.id === value)?.description}</div>
    </div>
  );
}

function ReducedMotionNotice() {
  const reduced = useReducedMotion();
  if (!reduced) return null;
  return (
    <Notice>
      Reduced motion is on (this device’s setting or Appearance › Motion), so no button animations play here — not even “Try it”.
    </Notice>
  );
}

function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={tone === 'error' ? 'rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive' : 'rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground'}
    >
      {children}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading button animations">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
